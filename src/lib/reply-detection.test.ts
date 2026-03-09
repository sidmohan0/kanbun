import { describe, expect, it } from "vitest";
import {
  buildLatestSentContactMap,
  extractEmailAddress,
  extractMessageReferenceIds,
  matchInboundReplies,
  matchThreadedInboundReplies,
  normalizeMessageReferenceId,
} from "@/lib/reply-detection";

describe("extractEmailAddress", () => {
  it("extracts and normalizes mailbox headers", () => {
    expect(extractEmailAddress("Jane Doe <Jane@example.com>")).toBe(
      "jane@example.com",
    );
    expect(extractEmailAddress("solo@example.com")).toBe("solo@example.com");
    expect(extractEmailAddress(null)).toBeNull();
  });
});

describe("matchThreadedInboundReplies", () => {
  it("matches replies only when provider thread ids and sender emails align", () => {
    const sentThreads = new Map([
      [
        "thread-1",
        {
          contactId: "contact-1",
          contactName: "Asha Patel",
          senderEmail: "asha@example.com",
          sentAt: new Date("2026-03-03T12:00:00.000Z"),
        },
      ],
    ]);

    const matches = matchThreadedInboundReplies(sentThreads, [
      {
        providerThreadId: "thread-1",
        receivedAt: new Date("2026-03-03T15:00:00.000Z"),
        senderEmail: "asha@example.com",
        summary: "Re: hello",
      },
      {
        providerThreadId: "thread-1",
        receivedAt: new Date("2026-03-03T16:00:00.000Z"),
        senderEmail: "someone-else@example.com",
        summary: "Wrong sender",
      },
    ]);

    expect(matches).toEqual([
      {
        contactId: "contact-1",
        contactName: "Asha Patel",
        providerThreadId: "thread-1",
        receivedAt: new Date("2026-03-03T15:00:00.000Z"),
        senderEmail: "asha@example.com",
        summary: "Re: hello",
      },
    ]);
  });

  it("prefers explicit message references when available", () => {
    const sentThreads = new Map([
      [
        "thread-older",
        {
          contactId: "contact-1",
          contactName: "Asha Patel",
          providerInternetMessageId: "older@example.test",
          senderEmail: "asha@example.com",
          sentAt: new Date("2026-03-03T12:00:00.000Z"),
        },
      ],
      [
        "thread-current",
        {
          contactId: "contact-2",
          contactName: "Bryn Carter",
          providerInternetMessageId: "current@example.test",
          senderEmail: "bryn@example.com",
          sentAt: new Date("2026-03-03T12:30:00.000Z"),
        },
      ],
    ]);

    const sentReferences = new Map([
      ["current@example.test", sentThreads.get("thread-current")!],
    ]);

    const matches = matchThreadedInboundReplies(
      sentThreads,
      [
        {
          inReplyTo: "<current@example.test>",
          providerThreadId: "thread-older",
          receivedAt: new Date("2026-03-03T13:00:00.000Z"),
          referenceMessageIds: ["older@example.test"],
          senderEmail: "bryn@example.com",
          summary: "Threaded reply",
        },
      ],
      sentReferences,
    );

    expect(matches).toEqual([
      {
        contactId: "contact-2",
        contactName: "Bryn Carter",
        providerThreadId: "thread-older",
        receivedAt: new Date("2026-03-03T13:00:00.000Z"),
        senderEmail: "bryn@example.com",
        summary: "Threaded reply",
      },
    ]);
  });
});

describe("message reference helpers", () => {
  it("normalizes single message references", () => {
    expect(normalizeMessageReferenceId("<ABC@example.com>")).toBe(
      "abc@example.com",
    );
    expect(normalizeMessageReferenceId("")).toBeNull();
  });

  it("extracts unique reference ids from header values", () => {
    expect(
      extractMessageReferenceIds(
        "<first@example.test> <second@example.test> <first@example.test>",
      ),
    ).toEqual(["first@example.test", "second@example.test"]);
  });
});

describe("matchInboundReplies", () => {
  it("matches inbound replies against the most recent sent contact email", () => {
    const sentContacts = buildLatestSentContactMap([
      {
        contactId: "contact-1",
        contactName: "Asha Patel",
        primaryEmail: "asha@example.com",
        sentAt: new Date("2026-03-01T12:00:00.000Z"),
      },
      {
        contactId: "contact-1",
        contactName: "Asha Patel",
        primaryEmail: "asha@example.com",
        sentAt: new Date("2026-03-03T12:00:00.000Z"),
      },
      {
        contactId: "contact-2",
        contactName: "Bryn Carter",
        primaryEmail: "bryn@example.com",
        sentAt: new Date("2026-03-02T12:00:00.000Z"),
      },
    ]);

    const matches = matchInboundReplies(sentContacts, [
      {
        receivedAt: new Date("2026-03-03T15:00:00.000Z"),
        senderEmail: "asha@example.com",
        summary: "Re: hello",
      },
      {
        receivedAt: new Date("2026-03-01T11:00:00.000Z"),
        senderEmail: "bryn@example.com",
        summary: "Too early",
      },
      {
        receivedAt: new Date("2026-03-04T10:00:00.000Z"),
        senderEmail: "unknown@example.com",
        summary: "Ignore",
      },
    ]);

    expect(matches).toEqual([
      {
        contactId: "contact-1",
        contactName: "Asha Patel",
        receivedAt: new Date("2026-03-03T15:00:00.000Z"),
        senderEmail: "asha@example.com",
        summary: "Re: hello",
      },
    ]);
  });
});
