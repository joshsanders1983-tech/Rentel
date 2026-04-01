import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(backendRoot, "..", ".env") });

function fatalPostgresUrl(
  name: "DATABASE_URL" | "DIRECT_URL",
  url: string,
  renderExtra: string,
): void {
  if (!url) {
    const renderHint =
      process.env.RENDER === "true"
        ? ` On Render: Environment → add ${name} (${renderExtra}).`
        : ` Copy .env.example to .env and set ${name}.`;
    console.error(`[FATAL] ${name} is missing.${renderHint}`);
    process.exit(1);
  }

  if (name === "DATABASE_URL" && url.startsWith("file:")) {
    console.error(`[FATAL] DATABASE_URL still uses SQLite (${url}).
This project uses PostgreSQL. See .env.example for Supabase pooler URLs.`);
    process.exit(1);
  }

  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    console.error(
      `[FATAL] ${name} must start with postgresql:// or postgres:// (see .env.example).`,
    );
    process.exit(1);
  }

  if (url.includes("USER:PASSWORD") || url.includes("@HOST:")) {
    console.error(`[FATAL] ${name} is still a placeholder. Use real values from Supabase → Connect (see .env.example).`);
    process.exit(1);
  }
}

const url = process.env.DATABASE_URL?.trim() ?? "";
const directUrl = process.env.DIRECT_URL?.trim() ?? "";

fatalPostgresUrl(
  "DATABASE_URL",
  url,
  "transaction pooler URI, port 6543 — see .env.example",
);
fatalPostgresUrl(
  "DIRECT_URL",
  directUrl,
  "session pooler URI, port 5432 — required for prisma migrate",
);
