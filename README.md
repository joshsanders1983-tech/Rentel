# Rentel

Rental operations app for tracking units, reservations, inspections, and tech/shop workflows.

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

1. Clone this repo to your laptop (or download and extract it).
2. Open PowerShell in the repo root (the folder containing this `README.md`).
3. Run:
   - `.\Create-Rentel-Desktop-Icon.ps1`
4. Double-click the new `Rentel` icon on your desktop.

What the icon does:

- runs `Launch-Rentel.ps1`
- installs dependencies on first run
- applies database migrations
- starts the server (if not already running)
- opens the app in your browser at `http://localhost:4000`

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
