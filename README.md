# Rentel

Rental operations app for tracking units, reservations, inspections, and tech/shop workflows.

## First-time setup (Windows — easiest)

You need **[Node.js LTS](https://nodejs.org/)** installed. The script walks you through creating a Supabase project in the browser and pasting its database URL (that step has to happen in your account).

1. Clone this repo.
2. In the repo root, double-click **`Setup-Rentel.cmd`** (or run `.\Setup-Rentel.ps1` in PowerShell).
3. Follow the prompts: create a project on [Supabase](https://supabase.com/dashboard), paste the **Database URI** when asked, then the script runs `npm install` and applies migrations to your cloud database.
4. Start the app with **`Launch-Rentel-Dev.cmd`** or `cd rental-backend` then `npm run dev`, and open [http://localhost:4000](http://localhost:4000).

Use the **same** `DATABASE_URL` in `rental-backend/.env` on every computer so everyone shares one database.

### Using Supabase as the database

**Supabase is PostgreSQL.** This app stores all persistent data in your Supabase Postgres database using **Prisma** and the **`DATABASE_URL`** in `rental-backend/.env`. You do **not** need the Supabase JavaScript client (`@supabase/supabase-js`) for normal reads/writes—that is only for features like Supabase Auth, Storage, or Realtime built against Supabase’s APIs.

1. In [Supabase](https://supabase.com/dashboard), open your project → **Project Settings** → **Database**.
2. Copy the **URI** connection string (set the database password if prompted).
3. Paste it as **`DATABASE_URL`** in `rental-backend/.env`.
4. From `rental-backend`, run **`npm run db:deploy`** once (or use **`Setup-Rentel.cmd`** at the repo root) so tables are created in Supabase.

**Copy old data from `dev.db` into Supabase:** If you still have a local SQLite file (`prisma/dev.db` or `dev.db`) from before you switched to Postgres, from `rental-backend` run `npm run migrate:from-sqlite`. If Supabase already has Rentel rows you want to **replace**, run `npm run migrate:from-sqlite -- --force` (this deletes existing Rentel data in Supabase first). Optional: pass the path to your `.db` file as the last argument. Then restart the app.

**Supabase JS client (optional):** This repo is **Express**, not Next.js — do not add `page.tsx` or Next middleware here. The package **`@supabase/supabase-js`** is installed for future use (Auth, Storage, Realtime). If you want it wired, add **`SUPABASE_URL`** and **`SUPABASE_ANON_KEY`** to `rental-backend/.env` (same values as the Supabase dashboard **Project Settings → API**: Project URL and **anon public** key). **`GET /health`** reports `supabaseJs: "configured"` when both are set. Day-to-day data still flows through **Prisma + `DATABASE_URL`**.

## Project Location

The app source is in:

`rental-backend/`

## What It Includes

- Dashboard, Reservations, On Rent, Returned, Inventory, Admin, and Techs pages
- Admin-managed inspection forms and maintenance automation rules
- Tech-authenticated shop workflow (`/techs`)
- Admin-managed technician accounts (Tech Entry)
- Repair history tracking tied to signed-in technician name

## Quick Start

1. Open a terminal in:
   - `rental-backend`
2. Install dependencies:
   - `npm install`
3. Configure environment:
   - Copy `.env.example` to `.env`
   - Set **`DATABASE_URL`** to your PostgreSQL database (for example Supabase: **Project Settings → Database → Connection string**). All machines should use the **same** URL so everyone shares one dataset.
4. Apply database migrations:
   - `npm run db:deploy`
5. Start the app:
   - `npm run dev`
   - If `tsx` is blocked in your environment, use:
     - `npm run build`
     - `npm start`
6. Open:
   - [http://localhost:4000](http://localhost:4000)

## Laptop Install + One-Click Desktop Icon (Windows)

You do **not** need to open PowerShell and type `npm run dev` every time. Use one of these:

### Desktop shortcuts (recommended)

1. Clone this repo to your laptop (or download and extract it).
2. Open PowerShell in the repo root (the folder containing this `README.md`) **once**, and run:
   - `.\Create-Rentel-Desktop-Icon.ps1`
3. On your desktop you will have:
   - **Rentel Dev** — runs `npm run dev` in `rental-backend` (hot reload for day-to-day work). Double-click to start; a console window shows server logs. The script opens your browser when the server is ready.
   - **Rentel** — builds if needed, runs the compiled server (`node dist/server.js`), and opens the browser (closer to production).

Both shortcuts install dependencies on first run and run database migrations before starting.

### No desktop shortcut

In the repo root, you can double-click **`Launch-Rentel-Dev.cmd`** (development) or **`Launch-Rentel.cmd`** (compiled server) in File Explorer — same behavior as the shortcuts.

## Build a Windows Installer (.exe)

If you want a normal installable desktop program for CSRs/Admins/Techs:

1. Open a terminal in the repo root (`J:\Rentel`).
2. Install desktop wrapper dependencies:
   - `npm install`
3. Build installer:
   - `npm run dist:win`
4. Find installer in:
   - `release\Rentel-Setup-1.0.0.exe`

Install outcome:

- Start Menu shortcut
- Desktop icon
- Launches as a desktop app window (no browser needed)
- Uses local app data storage per computer

## Auto-Update (No Manual Reinstall)

Auto-update is now enabled through GitHub Releases for installed desktop users.

How to publish an update:

1. Bump version in root `package.json` (for example `1.0.0` -> `1.0.1`).
2. Commit and push code to `main`.
3. Build and publish release artifacts:
   - `npm run publish:win`
   - Requires `GH_TOKEN` environment variable with repo release permission.

End-user experience:

- App checks for updates automatically after launch.
- If an update is found, it downloads in the background.
- User gets a prompt to restart and apply the update.

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

Run these in `rental-backend/`:

- `npm run dev` - start dev server
- `npm run build` - generate Prisma client + compile TypeScript
- `npm start` - run compiled server from `dist/`
- `npm run db:deploy` - apply migrations
- `npm run db:studio` - open Prisma Studio
