# Rentel

Rental operations app for tracking units, reservations, inspections, and tech/shop workflows. Single **Express** server with static HTML/CSS/JS in `public/` and **PostgreSQL** via Prisma.

## First-time setup (Windows — easiest)

You need **[Node.js LTS](https://nodejs.org/)** installed. The script walks you through creating a Supabase project in the browser and pasting its database URL (that step has to happen in your account).

1. Clone this repo.
2. In the repo root, double-click **`Setup-Rentel.cmd`** (or run `.\Setup-Rentel.ps1` in PowerShell).
3. Follow the prompts: create a project on [Supabase](https://supabase.com/dashboard), paste the **Database URI** when asked, then the script runs `npm install` and applies migrations to your cloud database.
4. Start the app with **`Launch-Rentel-Dev.cmd`** or `npm run dev` in the repo root, and open [http://localhost:4000](http://localhost:4000).

Use the **same** **`DATABASE_URL`** and **`DIRECT_URL`** in **`.env`** on every computer so everyone shares one database.

### Using Supabase as the database

**Supabase is PostgreSQL.** This app stores all persistent data in your Supabase Postgres database using **Prisma** with two connection strings in **`.env`** (see **`.env.example`**). You do **not** need the Supabase JavaScript client (`@supabase/supabase-js`) for normal reads/writes—that is only for features like Supabase Auth, Storage, or Realtime built against Supabase’s APIs.

**Connection strings (important):** Supabase’s **direct** host `db.<project>.supabase.co:5432` is often **IPv6-only**. Hosts that only use IPv4 outbound (including **Render**) cannot reach it. Use the **Supavisor pooler** strings from the dashboard **Connect** button instead—**Session** (port **5432**) and **Transaction** (port **6543**). Prisma is configured per the [Supabase + Prisma guide](https://supabase.com/docs/guides/database/prisma): **`DIRECT_URL`** = session pooler (migrations), **`DATABASE_URL`** = transaction pooler with **`?pgbouncer=true`** (app runtime).

1. In [Supabase](https://supabase.com/dashboard), open your project → **Connect** → **Connection string**.
2. Copy the **Session pooler** URI → **`DIRECT_URL`** in **`.env`**.
3. Copy the **Transaction pooler** URI → **`DATABASE_URL`**, and ensure the query string includes **`pgbouncer=true`** (the setup script adds it if missing).
4. Run **`npm run db:deploy`** once (or use **`Setup-Rentel.cmd`**) so tables are created in Supabase.

**Copy old data from `dev.db` into Supabase:** If you still have a local SQLite file (`prisma/dev.db` or `dev.db`) from before you switched to Postgres, run `npm run migrate:from-sqlite`. If Supabase already has Rentel rows you want to **replace**, run `npm run migrate:from-sqlite -- --force` (this deletes existing Rentel data in Supabase first). Optional: pass the path to your `.db` file as the last argument. Then restart the app.

**Supabase JS client (optional):** If you want it wired, add **`SUPABASE_URL`** and **`SUPABASE_ANON_KEY`** to **`.env`** (Supabase dashboard **Project Settings → API**: Project URL and **anon public** key). **`GET /health`** reports `supabaseJs: "configured"` when both are set.

## Quick Start

1. Open a terminal in the **repo root**.
2. **`npm install`**
3. Copy **`.env.example`** to **`.env`** and set **`DATABASE_URL`**, **`DIRECT_URL`**, and **`ADMIN_PASSWORD`**.
4. **`npm run db:deploy`**
5. **`npm run dev`** (or **`npm run build`** then **`npm start`**)
6. Open [http://localhost:4000](http://localhost:4000)

## Deploy on Render

1. Create a **Web Service** from this GitHub repo (or connect **`render.yaml`** as a Blueprint).
2. **Root Directory:** leave **empty** (repository root).
3. **Build Command:** `npm ci && npm run build`
4. **Pre-Deploy Command:** `npm run db:deploy` (applies Prisma migrations; requires **`DATABASE_URL`** and **`DIRECT_URL`**)
5. **Start Command:** `npm start`
6. **Environment:** **`DATABASE_URL`** (transaction pooler, port **6543**), **`DIRECT_URL`** (session pooler, port **5432**), **`ADMIN_PASSWORD`** (and optional Supabase keys as above). Do **not** use only the direct `db.*.supabase.co:5432` URL from older docs—it often fails from Render (IPv4).

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
