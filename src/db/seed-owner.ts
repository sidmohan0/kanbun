import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";
import { z } from "zod";
import { db, sql } from "./client";
import { users } from "./schema";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const ownerEnv = z
  .object({
    OWNER_EMAIL: z.email(),
    OWNER_PASSWORD: z.string().min(8),
  })
  .parse({
    OWNER_EMAIL: process.env.OWNER_EMAIL,
    OWNER_PASSWORD: process.env.OWNER_PASSWORD,
  });

async function seedOwner() {
  const normalizedEmail = ownerEnv.OWNER_EMAIL.toLowerCase();
  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });
  const passwordHash = await bcrypt.hash(ownerEnv.OWNER_PASSWORD, 12);

  if (existing) {
    await db
      .update(users)
      .set({
        passwordHash,
        role: "owner",
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));

    console.log(`Updated owner user ${normalizedEmail}`);
    await sql.end();
    return;
  }

  await db.insert(users).values({
    email: normalizedEmail,
    passwordHash,
    role: "owner",
    status: "active",
  });

  console.log(`Created owner user ${normalizedEmail}`);
  await sql.end();
}

seedOwner().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
