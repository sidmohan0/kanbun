import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudflareToken } from "./preview-credentials.mjs";

test("a pasted token with whitespace reaches HTTP as a single header-safe value", () => {
  const token = "test_token_012345678901234567890123456789";
  assert.equal(cloudflareToken(token), token);
  assert.equal(cloudflareToken(` \n${token.slice(0, 20)}\r\n  ${token.slice(20)}\t`), token);
  assert.equal(
    new Headers({ Authorization: `Bearer ${cloudflareToken(`\n${token}\n`)}` }).get("Authorization"),
    `Bearer ${token}`,
  );
});

test("missing or malformed credentials fail without exposing their value", () => {
  for (const raw of [
    undefined,
    "",
    " \n ",
    "private-value-with:invalid-header-content",
    'curl "https://example.test/verify" \\\n  -H "Authorization: Bearer test_token_012345678901234567890123456789"',
    "tiny",
  ]) {
    assert.throws(
      () => cloudflareToken(raw),
      (error) => {
        assert.equal(
          error.message,
          "CLOUDFLARE_API_TOKEN must contain a valid API token value; update the Actions secret.",
        );
        if (raw?.trim()) assert.equal(error.message.includes(raw.trim()), false);
        return true;
      },
    );
  }
});
