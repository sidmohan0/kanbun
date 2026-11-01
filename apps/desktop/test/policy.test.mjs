import assert from "node:assert/strict";
import test from "node:test";
import { appUrl, linkAction, signInDestination } from "../dist/policy.js";

test("sign-in handoff only accepts valid callbacks and known return destinations", () => {
  const application = appUrl();
  const token = "a".repeat(43);
  for (const returnTo of ["#issues", "#issues/one-1", "#members", `#invite/${token}`]) {
    const route = `signin/${token}/${encodeURIComponent(returnTo)}`;
    const target = `https://kanbun.ai/#${route}`;
    assert.equal(signInDestination(`kanbun://${route}`, application), target);
    assert.equal(signInDestination(target, application), target);
  }
  for (const value of [
    `kanbun://other/${token}/%23issues`,
    `kanbun://signin/${token}/%23issues?extra=1`,
    `kanbun://user:password@signin/${token}/%23issues`,
    `kanbun://signin/${token}/%23issues#extra`,
    `kanbun://signin:443/${token}/%23issues`,
    `kanbun://signin/short/%23issues`,
    `kanbun://signin/${token}/%`,
    `kanbun://signin/${token}/%23signin%2Fagain`,
    `kanbun://signin/${token}/https%3A%2F%2Fevil.example`,
    `https://evil.example/#signin/${token}/%23issues`,
    `https://kanbun.ai/other#signin/${token}/%23issues`,
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])
    assert.equal(signInDestination(value, application), null);
});

test("application URL allows HTTPS and loopback development only", () => {
  assert.equal(appUrl().origin, "https://kanbun.ai");
  assert.equal(appUrl("http://127.0.0.1:5173").origin, "http://127.0.0.1:5173");
  for (const value of ["http://example.com", "file:///tmp/app.html", "https://user:secret@kanbun.ai", "bad"]) {
    assert.throws(() => appUrl(value));
  }
});

test("links stay on the application origin or open safe protocols externally", () => {
  const application = appUrl();
  assert.equal(linkAction("https://kanbun.ai/#issues/123", application), "internal");
  for (const value of ["https://github.com", "mailto:hello@example.com", "https://kanbun.ai.evil.test"]) {
    assert.equal(linkAction(value, application), "external");
  }
  for (const value of ["javascript:alert(1)", "file:///tmp/a", "kanbun://issue", "bad", "https://u:p@kanbun.ai"]) {
    assert.equal(linkAction(value, application), "deny");
  }
});
