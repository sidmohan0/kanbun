import { afterEach, describe, expect, it, vi } from "vitest";
import { internalFailure } from "../src/reporting";

afterEach(() => vi.restoreAllMocks());
describe("privacy-safe unexpected request failures", () => {
  it("correlates a response with a bounded log event without serializing error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const privateValue = "private-description-and-credential-marker";
    const response = internalFailure(new Error(privateValue, { cause: { sql: privateValue, token: privateValue } }));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const value = (await response.json()) as { error: string; errorId: string };
    expect(value).toEqual({ error: "Internal workspace error", errorId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: "kanbun.request.failed",
      category: "internal",
      errorId: value.errorId,
    });
    expect(JSON.stringify(log.mock.calls) + JSON.stringify(value)).not.toContain(privateValue);
    expect(((await internalFailure({ message: privateValue }).json()) as { errorId: string }).errorId).not.toBe(
      value.errorId,
    );
  });
});
