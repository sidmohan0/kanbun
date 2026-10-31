import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { MutationError } from "@kanbun/sync";
import { githubRpc, githubRpcValue } from "../src/github-rpc";
import { RequestError } from "../src/requests";

afterEach(() => vi.restoreAllMocks());

it("preserves expected error status through a plain JSON RPC round trip", async () => {
  for (const error of [
    new RequestError("Link removed", 409),
    new MutationError("Access denied", "forbidden"),
    new MutationError("Missing link", "not_found"),
  ]) {
    const result = await githubRpc(async () => {
      throw error;
    });
    const transported = JSON.parse(JSON.stringify(result));
    await expect(githubRpcValue(Promise.resolve(transported))).rejects.toMatchObject({
      message: error.message,
      status: error instanceof RequestError ? 409 : error.code === "forbidden" ? 403 : 404,
    });
  }
});

it("never transports or logs unexpected provider content or validation inputs", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const secret = "provider-response-secret-token";
  const result = await githubRpc(async () => {
    throw new Error(secret);
  });
  expect(result).toMatchObject({
    ok: false,
    error: { status: 500, message: "Internal workspace error", errorId: expect.any(String) },
  });
  expect(JSON.stringify([result, log.mock.calls])).not.toContain(secret);
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({ event: "kanbun.github.rpc.failed", errorId: expect.any(String) }),
  );
  const invalid = await githubRpc(async () => z.literal("expected").parse(secret));
  expect(invalid).toEqual({ ok: false, error: { status: 400, message: "Invalid request" } });
});
