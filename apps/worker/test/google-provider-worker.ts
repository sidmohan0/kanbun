type Fixture = { fail: boolean; blocked: boolean };
const requests: { url: string; body: string; authorization: string | null }[] = [];
let fixture: Fixture = { fail: false, blocked: false };
let release: (() => void) | undefined;
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.hostname === "fixture") {
      if (url.pathname === "/requests") return Response.json(requests);
      if (url.pathname === "/release") {
        release?.();
        return Response.json({ ok: true });
      }
      if (url.pathname === "/configure") {
        fixture = await request.json();
        return Response.json({ ok: true });
      }
    }
    if (url.protocol !== "https:" || !["oauth2.googleapis.com", "sheets.googleapis.com"].includes(url.hostname))
      return new Response("Unexpected Google origin", { status: 502 });
    requests.push({
      url: request.url,
      body: await request.text(),
      authorization: request.headers.get("Authorization"),
    });
    if (fixture.fail) return Response.json({ error: "fixture-private-provider-detail" }, { status: 403 });
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({
        access_token: "fixture-google-access",
        refresh_token: "fixture-google-refresh",
        scope: "https://www.googleapis.com/auth/drive.file",
      });
    if (url.pathname === "/v4/spreadsheets") return Response.json({ spreadsheetId: "fixture-spreadsheet" });
    if (fixture.blocked)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return Response.json({ replies: [] });
  },
};
