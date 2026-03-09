import { describe, expect, it } from "vitest";
import {
  classifyProviderFailure,
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
