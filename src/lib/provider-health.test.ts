import { describe, expect, it } from "vitest";
import {
  applyProviderFailureMetadata,
  applyProviderSuccessMetadata,
  classifyProviderFailure,
  classifyOutboundProviderFailure,
  deriveProviderAccountStatus,
  getMetadataDate,
} from "@/lib/provider-health";

describe("classifyProviderFailure", () => {
  it("marks auth failures as reconnect required", () => {
    expect(classifyProviderFailure("Unable to refresh token (401)")).toMatchObject({
      accountStatus: "reconnect_required",
      category: "auth_reconnect_required",
      retryDelayMs: null,
    });
  });

  it("marks rate limits as degraded with retry", () => {
    expect(classifyProviderFailure("Provider quota exceeded (429)")).toMatchObject({
      accountStatus: "degraded",
      category: "rate_limited",
      retryDelayMs: 1000 * 60 * 15,
    });
  });

  it("marks cursor failures as degraded with short retry", () => {
    expect(
      classifyProviderFailure("Sync token expired. Reset cursor and retry."),
    ).toMatchObject({
      accountStatus: "degraded",
      category: "cursor_reset",
      retryDelayMs: 1000 * 60,
    });
  });
});

describe("getMetadataDate", () => {
  it("parses valid iso timestamps and rejects invalid values", () => {
    expect(
      getMetadataDate({ retryAt: "2026-03-09T12:00:00.000Z" }, "retryAt")?.toISOString(),
    ).toBe("2026-03-09T12:00:00.000Z");
    expect(getMetadataDate({ retryAt: "nope" }, "retryAt")).toBeNull();
  });
});

describe("classifyOutboundProviderFailure", () => {
  it("treats invalid recipients as a non-retryable delivery issue", () => {
    expect(
      classifyOutboundProviderFailure("Recipient address rejected by remote server"),
    ).toMatchObject({
      accountStatus: "degraded",
      category: "invalid_recipient",
      retryDelayMs: null,
    });
  });
});

describe("provider operation metadata", () => {
  it("writes failure and success state per operation", () => {
    const failed = applyProviderFailureMetadata(
      { existing: true },
      {
        classification: classifyProviderFailure("Provider quota exceeded (429)"),
        message: "Provider quota exceeded (429)",
        operation: "contactSync",
        timestamp: new Date("2026-03-09T12:00:00.000Z"),
      },
    );

    expect(failed).toMatchObject({
      contactSyncFailureCategory: "rate_limited",
      contactSyncLastError: "Provider quota exceeded (429)",
      contactSyncOperatorAction:
        "Wait for the backoff window or reduce sync pressure before retrying.",
      contactSyncStatus: "degraded",
      existing: true,
    });

    const recovered = applyProviderSuccessMetadata(failed, {
      operation: "contactSync",
      timestamp: new Date("2026-03-09T12:05:00.000Z"),
      values: {
        contactSyncLastResultCount: 42,
      },
    });

    expect(recovered).toMatchObject({
      contactSyncFailureCategory: null,
      contactSyncLastError: null,
      contactSyncLastResultCount: 42,
      contactSyncOperatorAction: null,
      contactSyncStatus: "connected",
    });
  });
});

describe("deriveProviderAccountStatus", () => {
  it("prefers missing scopes and operation-level reconnect requirements", () => {
    expect(
      deriveProviderAccountStatus({
        metadata: {
          replySyncStatus: "connected",
        },
        missingScopes: ["scope-a"],
        rawStatus: "connected",
      }),
    ).toBe("reconnect_required");

    expect(
      deriveProviderAccountStatus({
        metadata: {
          outboundSendStatus: "reconnect_required",
          replySyncStatus: "connected",
        },
        rawStatus: "connected",
      }),
    ).toBe("reconnect_required");
  });

  it("falls back to degraded when any operation is degraded", () => {
    expect(
      deriveProviderAccountStatus({
        metadata: {
          contactSyncStatus: "connected",
          outboundSendStatus: "degraded",
        },
        rawStatus: "connected",
      }),
    ).toBe("degraded");
  });

  it("returns connected once operational markers are clear", () => {
    expect(
      deriveProviderAccountStatus({
        metadata: {
          contactSyncStatus: "connected",
          outboundSendStatus: "connected",
          replySyncStatus: "connected",
        },
        rawStatus: "reconnect_required",
      }),
    ).toBe("connected");
  });
});
