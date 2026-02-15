import { Hono } from "hono";
import type Database from "better-sqlite3";
import { EmailAccountService } from "../../services/email-account.js";

export function accountRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new EmailAccountService(db);

  router.get("/", (c) => {
    return c.json(svc.list());
  });

  router.get("/:id", (c) => {
    const account = svc.getById(Number(c.req.param("id")));
    if (!account) return c.json({ error: "Not found" }, 404);
    return c.json(account);
  });

  router.post("/", async (c) => {
    const { provider, email_address, display_name, credentials } =
      await c.req.json();
    const account = svc.add(provider, email_address, display_name, credentials);
    return c.json(account, 201);
  });

  return router;
}
