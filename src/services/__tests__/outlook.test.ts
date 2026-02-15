import { describe, it, expect } from "vitest";
import { OutlookService } from "../outlook.js";

describe("OutlookService", () => {
  it("generates an auth URL", () => {
    const url = OutlookService.getAuthUrl("client-id", "common", "http://localhost:7890/callback");
    expect(url).toContain("login.microsoftonline.com");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain("Mail.Send");
    expect(url).toContain("offline_access");
  });
});
