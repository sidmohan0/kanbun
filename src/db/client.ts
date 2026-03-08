import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/lib/env";
import * as schema from "./schema";

declare global {
  var __kanbunSql: postgres.Sql | undefined;
}

const sql =
  globalThis.__kanbunSql ??
  postgres(env.DATABASE_URL, {
    max: 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__kanbunSql = sql;
}

export const db = drizzle(sql, { schema });
export { sql };
