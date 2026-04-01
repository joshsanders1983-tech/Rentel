import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(backendRoot, "..", ".env") });

const url = process.env.DATABASE_URL?.trim() ?? "";

if (!url) {
  console.error(
    "[FATAL] DATABASE_URL is missing. Copy .env.example to .env and set DATABASE_URL (Supabase: Project Settings → Database → URI).",
  );
  process.exit(1);
}

if (url.startsWith("file:")) {
  console.error(`[FATAL] DATABASE_URL still uses SQLite (${url}).
This project uses PostgreSQL. Paste your Supabase connection string into .env
(Project Settings → Database → Connection string → URI), or run Setup-Rentel.cmd from the repo root.`);
  process.exit(1);
}

if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
  console.error(
    "[FATAL] DATABASE_URL must start with postgresql:// or postgres:// (see .env.example).",
  );
  process.exit(1);
}

if (url.includes("USER:PASSWORD") || url.includes("@HOST:")) {
  console.error(`[FATAL] DATABASE_URL is still the example placeholder.
Run Setup-Rentel.cmd from the repo root and paste your real Supabase URI when prompted,
or edit .env and replace DATABASE_URL with the URI from Supabase (include your database password).`);
  process.exit(1);
}
