import assert from "node:assert/strict";
import test from "node:test";
import { appUrl, linkAction } from "../dist/policy.js";

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
