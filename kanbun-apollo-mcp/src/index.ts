import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { ApolloClient } from "./apolloClient.js";

const app = new Hono();
const port = Number(process.env.PORT ?? 3001);

if (!process.env.APOLLO_API_KEY) {
  throw new Error("APOLLO_API_KEY is not set in .env");
}

const client = new ApolloClient(process.env.APOLLO_API_KEY);

app.post("/search", async (c) => {
  try {
    const { query, limit } = await c.req.json();
    const results = await client.searchPeople(query, limit ?? 25);
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post("/enrich", async (c) => {
  try {
    const { email } = await c.req.json();
    const result = await client.enrich(email);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post("/enrich-org", async (c) => {
  try {
    const { domain } = await c.req.json();
    const result = await client.enrichOrg(domain);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post("/import", async (c) => {
  try {
    const { listId } = await c.req.json();
    const results = await client.importList(listId);
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/health", (c) => c.json({ status: "ok" }));

serve({ fetch: app.fetch, port }, () => {
  console.log(`kanbun-apollo-mcp running on http://localhost:${port}`);
});
