import { describe, it, expect } from "vitest";
import { GmailService } from "../gmail.js";

describe("GmailService", () => {
  it("generates an auth URL", () => {
    const url = GmailService.getAuthUrl("client-id", "client-secret", "http://localhost:7890/callback");
    expect(url).toContain("accounts.google.com");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("gmail.send");
    expect(url).toContain("calendar");
  });
});
