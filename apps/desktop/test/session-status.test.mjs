import assert from "node:assert/strict";
import test from "node:test";
import { applyHook, statusAt } from "../dist/session-status.js";

test("observations become stale and a newer event restores a supported state", () => {
  const make = (event, observedAt) => ({ provider: "claude", sessionId: "a", event, observedAt });
  assert.equal(statusAt(undefined, 100, 30), "unknown");
  let state = applyHook(undefined, make("UserPromptSubmit", 100));
  assert.equal(statusAt(state, 110, 30), "running");
  state = applyHook(state, make("PermissionRequest", 120));
  assert.equal(statusAt(state, 121, 30), "waiting");
  state = applyHook(state, make("Stop", 119));
  assert.equal(statusAt(state, 121, 30), "waiting");
  assert.equal(statusAt(state, 151, 30), "stale");
  state = applyHook(state, make("Stop", 152));
  assert.equal(statusAt(state, 153, 30), "idle");
  assert.equal(statusAt(state, 151, 30), "unknown");
  state = applyHook(state, make("SessionStart", 154));
  assert.equal(statusAt(state, 155, 30), "unknown");
});
