import { normalizeEmail } from "@/lib/csv";

export type SentContactCandidate = {
  contactId: string;
  contactName: string;
  primaryEmail: string | null;
  sentAt: Date | null;
};

export type InboundReplyCandidate = {
  providerThreadId?: string | null;
  receivedAt: Date;
  senderEmail: string | null;
  summary?: string | null;
};

export function extractEmailAddress(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/<([^>]+)>/);
  return normalizeEmail(match?.[1] ?? value);
}

export function buildLatestSentContactMap(
  rows: SentContactCandidate[],
) {
  const map = new Map<
    string,
    {
      contactId: string;
      contactName: string;
      sentAt: Date;
    }
  >();

  for (const row of rows) {
    const email = normalizeEmail(row.primaryEmail);

    if (!email || !row.sentAt) {
      continue;
    }

    const existing = map.get(email);

    if (!existing || existing.sentAt.getTime() < row.sentAt.getTime()) {
      map.set(email, {
        contactId: row.contactId,
        contactName: row.contactName,
        sentAt: row.sentAt,
      });
    }
  }

  return map;
}

export function matchInboundReplies(
  sentContacts: Map<
    string,
    {
      contactId: string;
      contactName: string;
      sentAt: Date;
    }
  >,
  inboundMessages: InboundReplyCandidate[],
) {
  const matches = new Map<
    string,
    {
      contactId: string;
      contactName: string;
      receivedAt: Date;
      senderEmail: string;
      summary: string | null;
    }
  >();

  for (const message of inboundMessages) {
    const senderEmail = normalizeEmail(message.senderEmail);

    if (!senderEmail) {
      continue;
    }

    const sentContact = sentContacts.get(senderEmail);

    if (!sentContact) {
      continue;
    }

    if (message.receivedAt.getTime() <= sentContact.sentAt.getTime()) {
      continue;
    }

    const existing = matches.get(sentContact.contactId);

    if (!existing || existing.receivedAt.getTime() < message.receivedAt.getTime()) {
      matches.set(sentContact.contactId, {
        contactId: sentContact.contactId,
        contactName: sentContact.contactName,
        receivedAt: message.receivedAt,
        senderEmail,
        summary: message.summary?.trim() || null,
      });
    }
  }

  return Array.from(matches.values()).sort(
    (left, right) => right.receivedAt.getTime() - left.receivedAt.getTime(),
  );
}

export function matchThreadedInboundReplies(
  sentThreads: Map<
    string,
    {
      contactId: string;
      contactName: string;
      senderEmail: string;
      sentAt: Date;
    }
  >,
  inboundMessages: InboundReplyCandidate[],
) {
  const matches = new Map<
    string,
    {
      contactId: string;
      contactName: string;
      receivedAt: Date;
      senderEmail: string;
      summary: string | null;
      providerThreadId: string;
    }
  >();

  for (const message of inboundMessages) {
    const providerThreadId = message.providerThreadId?.trim();
    const senderEmail = normalizeEmail(message.senderEmail);

    if (!providerThreadId || !senderEmail) {
      continue;
    }

    const sentThread = sentThreads.get(providerThreadId);

    if (!sentThread) {
      continue;
    }

    if (senderEmail !== sentThread.senderEmail) {
      continue;
    }

    if (message.receivedAt.getTime() <= sentThread.sentAt.getTime()) {
      continue;
    }

    const existing = matches.get(sentThread.contactId);

    if (!existing || existing.receivedAt.getTime() < message.receivedAt.getTime()) {
      matches.set(sentThread.contactId, {
        contactId: sentThread.contactId,
        contactName: sentThread.contactName,
        providerThreadId,
        receivedAt: message.receivedAt,
        senderEmail,
        summary: message.summary?.trim() || null,
      });
    }
  }

  return Array.from(matches.values()).sort(
    (left, right) => right.receivedAt.getTime() - left.receivedAt.getTime(),
  );
}
