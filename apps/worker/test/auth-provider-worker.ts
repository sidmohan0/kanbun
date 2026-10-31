type CapturedEmail = { from: string; to: string[]; subject: string; text: string };
const emails: CapturedEmail[] = [];
let failDelivery = false;

/** Test-only service binding. It has no route and is never part of a shipped configuration. */
export default {
  async fetch(request: Request, env: { EXPECTED_HOSTNAME: string }) {
    const url = new URL(request.url);
    if (url.hostname === "fixture" && url.pathname === "/captured") return Response.json(emails);
    if (url.hostname === "fixture" && url.pathname === "/delivery-failure") {
      failDelivery = ((await request.json()) as { enabled: boolean }).enabled;
      return Response.json({ ok: true });
    }
    if (url.hostname === "api.resend.com" && url.pathname === "/emails" && request.method === "POST") {
      emails.push((await request.json()) as CapturedEmail);
      if (failDelivery) return new Response("fixture-private-provider-detail", { status: 503 });
      return Response.json({ id: crypto.randomUUID() });
    }
    if (url.hostname === "challenges.cloudflare.com" && url.pathname === "/turnstile/v0/siteverify") {
      const body = new URLSearchParams(await request.text());
      const response = body.get("response");
      const valid = body.get("secret") === "fixture-turnstile-secret" && response === "fixture-human-token";
      return Response.json({
        success: valid || response === "fixture-wrong-host" || response === "fixture-wrong-action",
        hostname: response === "fixture-wrong-host" ? "attacker.example.test" : env.EXPECTED_HOSTNAME,
        action: response === "fixture-wrong-action" ? "other_action" : "magic_link",
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
