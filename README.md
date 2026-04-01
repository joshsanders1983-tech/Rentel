# Rentel

Rental operations app for tracking units, reservations, inspections, and tech/shop workflows. Single **Express** server with static HTML/CSS/JS in `public/` and **PostgreSQL** via Prisma.

## First-time setup (Windows — easiest)

You need **[Node.js LTS](https://nodejs.org/)** installed. The script walks you through creating a Supabase project in the browser and pasting its database URL (that step has to happen in your account).

1. Clone this repo.
2. In the repo root, double-click **`Setup-Rentel.cmd`** (or run `.\Setup-Rentel.ps1` in PowerShell).
3. Follow the prompts: create a project on [Supabase](https://supabase.com/dashboard), paste the **Database URI** when asked, then the script runs `npm install` and applies migrations to your cloud database.
4. Start the app with **`Launch-Rentel-Dev.cmd`** or `npm run dev` in the repo root, and open [http://localhost:4000](http://localhost:4000).

Use the **same** **`DATABASE_URL`** in **`.env`** on every computer so everyone shares one database.

### Using Supabase as the database

**Supabase is PostgreSQL.** This app stores all persistent data in your Supabase Postgres database using **Prisma** and a single **`DATABASE_URL`** in **`.env`** (see **`.env.example`**). You do **not** need the Supabase JavaScript client (`@supabase/supabase-js`) for normal reads/writes—that is only for features like Supabase Auth, Storage, or Realtime built against Supabase’s APIs.

**Connection string (verified against Supabase’s docs):** The [Supabase + Prisma guide](https://supabase.com/docs/guides/database/prisma) shows a **single** `DATABASE_URL` using the **Supavisor Session pooler** (URI ends with **port 5432** and the **pooler** hostname) for **both Prisma migrations and the application**. That is what this repo uses (`prisma/schema.prisma` has only `url`, no `directUrl`).

The same guide documents an **alternate** setup (transaction pooler on **6543** + `pgbouncer=true` plus `DIRECT_URL`) for **serverless** workloads. You do **not** need that on Render unless you switch to transaction mode for `DATABASE_URL`; if you ever use port **6543**, Prisma requires `pgbouncer=true` ([troubleshooting](https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting)).

**Why not the “direct” `db.<project>.supabase.co:5432` URL alone?** Supabase documents that [direct connections use IPv6 by default](https://supabase.com/docs/guides/database/connecting-to-postgres#direct-connection); many hosts (including typical IPv4-only outbound paths) should use the **pooler** instead.

1. In [Supabase](https://supabase.com/dashboard), open your project → **Connect** → **Connection string** → **Session pooler**.
2. Paste the full URI into **`DATABASE_URL`** in **`.env`** (dashboard strings usually include `sslmode=require`).
3. Run **`npm run db:deploy`** once (or use **`Setup-Rentel.cmd`**) so tables are created in Supabase.

**Copy old data from `dev.db` into Supabase:** If you still have a local SQLite file (`prisma/dev.db` or `dev.db`) from before you switched to Postgres, run `npm run migrate:from-sqlite`. If Supabase already has Rentel rows you want to **replace**, run `npm run migrate:from-sqlite -- --force` (this deletes existing Rentel data in Supabase first). Optional: pass the path to your `.db` file as the last argument. Then restart the app.

**Supabase JS client (optional):** If you want it wired, add **`SUPABASE_URL`** and **`SUPABASE_ANON_KEY`** to **`.env`** (Supabase dashboard **Project Settings → API**: Project URL and **anon public** key). **`GET /health`** reports `supabaseJs: "configured"` when both are set.

## Quick Start

1. Open a terminal in the **repo root**.
2. **`npm install`**
3. Copy **`.env.example`** to **`.env`** and set **`DATABASE_URL`** (Session pooler from Supabase **Connect**) and **`ADMIN_PASSWORD`**.
4. **`npm run db:deploy`**
5. **`npm run dev`** (or **`npm run build`** then **`npm start`**)
6. Open [http://localhost:4000](http://localhost:4000)

## Deploy on Render

1. Create a **Web Service** from this GitHub repo (or connect **`render.yaml`** as a Blueprint).
2. **Root Directory:** leave **empty** (repository root). Render’s default when unset is the repo root ([monorepo / root directory](https://render.com/docs/monorepo-support#setting-a-root-directory)). This project’s **`package.json` is at the repository root**, not inside a `src/` folder—if Root Directory is set to `src`, the service is misaligned with this repo layout.
3. **Build Command:** `npm ci && npm run build`
4. **Pre-Deploy Command:** `npm run db:deploy`
5. **Start Command:** `npm start`
6. **Environment:** **`DATABASE_URL`** = Supabase **Connect → Session pooler** URI (same as local; see [Supabase + Prisma](https://supabase.com/docs/guides/database/prisma)). **`ADMIN_PASSWORD`**.

After deploy, open your **`https://….onrender.com`** URL. **`GET /health`** should return `"ok": true`.

## Laptop / desktop shortcut (Windows)

1. In the repo root, run **`.\Create-Rentel-Desktop-Icon.ps1`** once.
2. Double-click **Rentel Dev** on the desktop to run migrations (if needed), then **`npm run dev`**, and open the browser when the server is ready.

Or double-click **`Launch-Rentel-Dev.cmd`** in the repo root.

## What It Includes

- Dashboard, Reservations, On Rent, Returned, Inventory, Admin, and Techs pages
- Admin-managed inspection forms and maintenance automation rules
- Tech-authenticated shop workflow (`/techs`)
- Admin-managed technician accounts (Tech Entry)
- Repair history tracking tied to signed-in technician name

## Default Access

- Admin:
  - Username: n/a
  - Password: `ADMIN_PASSWORD` from `.env`
  - If `ADMIN_PASSWORD` is not set, fallback is `admin`
- Tech:
  - Managed in **Admin > Tech Entry**
  - A default technician is auto-seeded on first run if none exists:
    - Tech Name: `Tech`
    - Username: `Tech`
    - Password: `Tech`

## Common Commands

Run from the **repo root**:

- `npm run dev` — dev server (tsx watch)
- `npm run build` — Prisma generate + TypeScript compile
- `npm start` — production server (`node dist/server.js`)
- `npm run db:deploy` — apply migrations
- `npm run db:studio` — Prisma Studio
