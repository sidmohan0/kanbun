import { describe, expect, it, vi } from "vitest";
import { planOutboundAutoRetry } from "@/lib/outbound-retry";
import { classifyOutboundProviderFailure } from "@/lib/provider-health";

describe("planOutboundAutoRetry", () => {
  it("schedules automatic retries for safe transient failures", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00.000Z"));

    const plan = planOutboundAutoRetry({
      attemptCount: 1,
      classification: classifyOutboundProviderFailure(
        "Provider quota exceeded (429)",
      ),
    });

    expect(plan.autoRetry).toBe(true);
    expect(plan.retryable).toBe(true);
    expect(plan.retryAt?.toISOString()).toBe("2026-03-09T12:15:00.000Z");

    vi.useRealTimers();
  });

  it("blocks auto retry after too many attempts", () => {
    const plan = planOutboundAutoRetry({
      attemptCount: 3,
      classification: classifyOutboundProviderFailure("Gateway timeout (504)"),
    });

    expect(plan.autoRetry).toBe(false);
    expect(plan.retryable).toBe(true);
  });

  it("does not auto retry reconnect or invalid-recipient failures", () => {
    expect(
      planOutboundAutoRetry({
        attemptCount: 1,
        classification: classifyOutboundProviderFailure(
          "Unable to refresh token (401)",
        ),
      }),
    ).toMatchObject({
      autoRetry: false,
      retryable: false,
    });

    expect(
      planOutboundAutoRetry({
        attemptCount: 1,
        classification: classifyOutboundProviderFailure(
          "Recipient address rejected by remote server",
        ),
      }),
    ).toMatchObject({
      autoRetry: false,
      retryable: false,
    });
  });
});
