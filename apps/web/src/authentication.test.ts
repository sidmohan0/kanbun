import { describe, expect, it } from "vitest";
import { authenticationConfig, returnDestination, signInRoute } from "./authentication";

const token = "a".repeat(43);
describe("email sign-in destinations", () => {
  it("round trips invitation and application hashes without opening a workspace first", () => {
    for (const returnTo of [
      "#issues",
      "#issues/legacy_issue-1",
      "#my-issues",
      "#inbox",
      "#settings",
      "#members",
      `#invite/${token}`,
    ]) {
      expect(signInRoute(`#signin/${token}/${encodeURIComponent(returnTo)}`)).toEqual({ token, returnTo });
      expect(returnDestination(returnTo)).toBe(returnTo);
    }
    expect(signInRoute("#issues")).toBeNull();
    expect(returnDestination("")).toBe("#issues");
  });
  it("refuses external, malformed, nested and unsupported callback destinations", () => {
    for (const returnTo of [
      "https://elsewhere.example",
      "//elsewhere.example",
      "#signin/again",
      "#issues/one?email=person@example.com",
      "#issues/%2Foutside",
      "#invite/short",
    ]) {
      expect(signInRoute(`#signin/${token}/${encodeURIComponent(returnTo)}`)).toEqual({ invalid: true });
      expect(returnDestination(returnTo)).toBe("#issues");
    }
    for (const hash of [`#signin/${token}/%`, `#signin/${token}/%23issues/extra`, "#signin/short/%23issues"])
      expect(signInRoute(hash)).toEqual({ invalid: true });
  });
});
it("requires a complete email gate while retaining method-only local and Access entry", () => {
  expect(authenticationConfig({ method: "email", authenticated: false, siteKey: "public-site-key" })).toMatchObject({
    method: "email",
    authenticated: false,
  });
  for (const method of ["local", "access"]) expect(authenticationConfig({ method })).toMatchObject({ method });
  for (const value of [
    null,
    { method: "other" },
    { method: "email", authenticated: true },
    { method: "email", siteKey: "public-site-key" },
  ])
    expect(() => authenticationConfig(value)).toThrow();
});
