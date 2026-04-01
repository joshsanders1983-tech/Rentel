import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(backendRoot, "..", ".env") });

const url = process.env.DATABASE_URL?.trim() ?? "";

if (!url) {
  const renderHint =
    process.env.RENDER === "true"
      ? " On Render: Environment → add DATABASE_URL (Supabase Dashboard → Connect → Session pooler, port 5432). See https://supabase.com/docs/guides/database/prisma"
      : " Copy .env.example to .env and set DATABASE_URL per https://supabase.com/docs/guides/database/prisma";
  console.error(`[FATAL] DATABASE_URL is missing.${renderHint}`);
  process.exit(1);
}

if (url.startsWith("file:")) {
  console.error(`[FATAL] DATABASE_URL still uses SQLite (${url}).
This project uses PostgreSQL. See .env.example for Supabase pooler URLs.`);
  process.exit(1);
}

if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
  console.error(
    "[FATAL] DATABASE_URL must start with postgresql:// or postgres:// (see .env.example).",
  );
  process.exit(1);
}

if (url.includes("USER:PASSWORD") || url.includes("@HOST:")) {
  console.error(`[FATAL] DATABASE_URL is still a placeholder.
Use the real Session pooler URI from Supabase → Connect (see .env.example).`);
  process.exit(1);
}
