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

