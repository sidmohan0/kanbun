import "server-only";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { env } from "@/lib/env";

const SESSION_COOKIE_NAME = "kanbun_session";
const SESSION_TTL_DAYS = 14;
const bypassUser = {
  id: "local-owner-bypass",
  email: "local@kanbun.dev",
  name: "Local Mode",
  role: "owner" as const,
};

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionExpiryDate() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isOwnerModeEnabled() {
  return env.OWNER_MODE_ENABLED;
}

export async function createSessionForPasswordLogin(
  email: string,
  password: string,
) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, normalizedEmail), eq(users.status, "active")),
  });

  if (!user) {
    return { ok: false as const, error: "invalid-credentials" as const };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    return { ok: false as const, error: "invalid-credentials" as const };
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(sessionToken);
  const expiresAt = sessionExpiryDate();

  await db.insert(sessions).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });

  return { ok: true as const };
}

export async function clearCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser() {
  if (!isOwnerModeEnabled()) {
    return bypassUser;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const [record] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, "active"),
      ),
    )
    .limit(1);

  if (!record) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    return null;
  }

  return record;
}

export async function getPersistentOwnerUserId() {
  const user = await getCurrentUser();

  if (user && user.id !== bypassUser.id) {
    return user.id;
  }

  const fallbackOwner = await db.query.users.findFirst({
    where: and(eq(users.role, "owner"), eq(users.status, "active")),
    columns: {
      id: true,
    },
  });

  if (!fallbackOwner) {
    throw new Error(
      "No persistent owner user exists. Run pnpm db:seed-owner before connecting accounts.",
    );
  }

  return fallbackOwner.id;
}

export async function requireUser() {
  if (!isOwnerModeEnabled()) {
    return bypassUser;
  }

  const user = await getCurrentUser();

  if (!user) {
    redirect("/signin");
  }

  return user;
}
