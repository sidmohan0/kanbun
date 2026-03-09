import { normalizeEmail } from "@/lib/csv";

export type InboundReplyCandidate = {
  inReplyTo?: string | null;
  providerThreadId?: string | null;
  referenceMessageIds?: string[] | null;
  receivedAt: Date;
  senderEmail: string | null;
  summary?: string | null;
};

export type SentThreadCandidate = {
  contactId: string;
  contactName: string;
  providerInternetMessageId?: string | null;
  senderEmail: string;
  sentAt: Date;
};

export type SentContactCandidate = {
  contactId: string;
  contactName: string;
  primaryEmail: string | null;
  sentAt: Date | null;
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

export function normalizeMessageReferenceId(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return normalized || null;
}

export function extractMessageReferenceIds(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  const matches = value.match(/<[^>]+>/g) ?? value.split(/\s+/);
  return Array.from(
    new Set(
      matches
        .map((match) => normalizeMessageReferenceId(match))
        .filter((match): match is string => Boolean(match)),
    ),
  );
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
  sentThreads: Map<string, SentThreadCandidate>,
  inboundMessages: InboundReplyCandidate[],
  sentMessageReferences?: Map<string, SentThreadCandidate>,
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
    const referenceIds = [
      normalizeMessageReferenceId(message.inReplyTo),
      ...(message.referenceMessageIds ?? []),
    ].filter((referenceId): referenceId is string => Boolean(referenceId));

    if (!senderEmail) {
      continue;
    }

    const sentThread =
      referenceIds
        .map((referenceId) => sentMessageReferences?.get(referenceId) ?? null)
        .find((candidate): candidate is SentThreadCandidate => Boolean(candidate)) ??
      (providerThreadId ? sentThreads.get(providerThreadId) ?? null : null);

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
        providerThreadId:
          providerThreadId ??
          sentThread.providerInternetMessageId ??
          "reference-only",
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
