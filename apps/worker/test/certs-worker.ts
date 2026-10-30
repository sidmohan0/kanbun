let requests = 0;

export default {
  fetch(request: Request, env: { JWKS: string }) {
    const path = new URL(request.url).pathname;
    if (path === "/__counts") return Response.json({ requests });
    if (path !== "/cdn-cgi/access/certs") return new Response("Not found", { status: 404 });
    requests++;
    return new Response(env.JWKS, { headers: { "content-type": "application/json" } });
  },
};
