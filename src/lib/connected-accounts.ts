import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { connectedAccounts } from "@/db/schema";

export async function listConnectedAccountsForUser(userId: string) {
  return db.query.connectedAccounts.findMany({
    where: eq(connectedAccounts.userId, userId),
    orderBy: [connectedAccounts.provider, desc(connectedAccounts.updatedAt)],
  });
}
