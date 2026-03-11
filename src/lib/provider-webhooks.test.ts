import { describe, expect, it } from "vitest";
import {
  getMicrosoftValidationToken,
  parseGoogleGmailPushEnvelope,
  parseMicrosoftNotifications,
} from "@/lib/provider-webhooks";

describe("parseGoogleGmailPushEnvelope", () => {
  it("parses a Gmail Pub/Sub push payload", () => {
    const payload = {
      message: {
        data: Buffer.from(
          JSON.stringify({
            emailAddress: "SidMohan001@gmail.com",
            historyId: "1234567890",
          }),
        ).toString("base64"),
      },
    };

    expect(parseGoogleGmailPushEnvelope(payload)).toEqual({
      emailAddress: "sidmohan001@gmail.com",
      historyId: "1234567890",
    });
  });

  it("returns null for malformed payloads", () => {
    expect(parseGoogleGmailPushEnvelope({})).toBeNull();
    expect(
      parseGoogleGmailPushEnvelope({
        message: {
          data: "not-json",
        },
      }),
    ).toBeNull();
  });
});

describe("Microsoft webhook helpers", () => {
  it("extracts validation tokens from the request url", () => {
    expect(
      getMicrosoftValidationToken(
        "https://kanbun.example/api/webhooks/microsoft/notifications?validationToken=abc123",
      ),
    ).toBe("abc123");
  });

  it("filters notifications by expected client state", () => {
    const notifications = parseMicrosoftNotifications(
      {
        value: [
          {
            changeType: "updated",
            clientState: "expected-state",
            resource: "me/contacts",
            subscriptionId: "contact-subscription",
          },
          {
            changeType: "created",
            clientState: "wrong-state",
            resource: "me/messages",
            subscriptionId: "message-subscription",
          },
        ],
      },
      "expected-state",
    );

    expect(notifications).toEqual([
      {
        changeType: "updated",
        clientState: "expected-state",
        resource: "me/contacts",
        subscriptionId: "contact-subscription",
      },
    ]);
  });
});
