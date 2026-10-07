# TEA AMO

Cafe operating system for Tea Amo. One Vercel address serves both roles. Supabase is the database.

- `/` sign in
- `/admin` Administration (the existing owner workspace)
- `/server` Server, the phone workspace for waiters

There is no public registration. An administrator creates every Server account.

## Roles

| Role | Database value | Opens |
| --- | --- | --- |
| Administration | `admin` | `/admin` |
| Server | `server_staff` | `/server` |

The role in `profiles` is what the Worker and the database trust. A Server who opens `/admin` is sent back to `/server`. Menu prices, inventory, payroll, reports, backups and account creation are not writable by a Server, including by calling the API directly.

## What stayed

The Administration screens are the current owner application: floor POS, billing, business day, menu, customers, inventory, recipes, wastage, vendors, staff and attendance, expenses, owner funds, reports, dining time, settings, backup, restore, payment correction and owner-password confirmations.

Servers is a new Administration section for phone logins. It does not replace Staff & Attendance.

The Server phone screen keeps table service: the TEA AMO floor, orders, served counts, guests, discounts, totals, payment methods, payment QR and completion.

## Data

Live tables and payments are rows in Supabase, with a version check on each order and one idempotent payment function. Two phones cannot silently overwrite the same order, and two payment attempts cannot create two sales.

The rest of the café record (menu editing, stock, bills already merged into the record, expenses, staff, attendance, settings) is still the Administration document, stored in `business_documents`. Payments, stock movements from those payments, and open orders are applied from the normalized tables whenever that document is read or saved.

`master-state.json` and `lan-state.json` stay in the repository as the legacy export. Do not delete them. They are not the live store after migration.

## Layout

```
src/index.js                         Request handler: routes, sessions, role checks
src/ops.js                           Orders, payments, catalog sync, Server accounts
supabase/migrations/                 Postgres schema, RLS, realtime, payment function
public/auth/                         Sign-in screen
public/server/                       Phone Server workspace
public/owner/                        Administration screens
public/js/admin/cloud-bridge.js      Connects the owner app to cloud orders and payments
public/js/admin/servers.js           Server account screen
scripts/migrate-master.mjs           Imports master-state.json and writes a count report
scripts/bootstrap-admin.mjs          Creates the first Administration account
scripts/verify-ops.mjs               Checks conflicts, one payment, and Server denial
server.cjs                           Retired laptop JSON/LAN server
```

## Environment

Copy `.env.example` to `.env`. Never commit that file.

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
TEA_AMO_ADMIN_USERNAME
TEA_AMO_ADMIN_EMAIL
TEA_AMO_ADMIN_PASSWORD
TEA_AMO_ADMIN_NAME
```

The anon key is public and is injected into the signed-in Administration page. The service-role key stays on the server and in the migration scripts. It is not placed in browser JavaScript.

## Local setup

1. Create a Supabase project and run `npx supabase link` then `npx supabase db push`.
2. Put the project URL, anon key, and service-role key in `.env`, plus the first Administration login.
3. `npm run auth:bootstrap`
4. `npm run data:migrate`
5. `npm run dev` and open `http://127.0.0.1:8788`

Sign in as Administration with `TEA_AMO_ADMIN_USERNAME` and `TEA_AMO_ADMIN_PASSWORD`. Create Server accounts from Administration → Servers.

The migration adds `live_orders`, `order_items`, `cafe_tables`, and `sales` to the `supabase_realtime` publication.

## Vercel deploy

Hosting is one Vercel project. Supabase remains the database.

1. `npx vercel login`
2. `npx vercel link`
3. Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the Vercel project settings. Use the hosted Supabase project, not `127.0.0.1`.
4. `npm run deploy`

The printed URL serves `/`, `/admin`, and `/server`.

## Server accounts

Administration → Servers → Create Server. The Worker creates the Auth user and the `profiles` row together. If the profile insert fails, the Auth user is deleted. Server users cannot create accounts.

A disabled account loses database access on the next request. Resetting a password signs out existing sessions.

Presence is online when `last_seen_at` is within 90 seconds. The phone sends that about every 30 seconds. On duty still means clocked in on the staff profile for the business day. Offline, off duty and disabled are different.

## Legacy laptop server

`node server.cjs` no longer accepts staff PIN login unless `TEA_AMO_LEGACY_LAN=1`. That flag is only a fallback while the cloud database is being checked. Do not expose the PIN listener on the public internet.

## Owner password

Signing in as Administration is separate from the existing owner password. Backup restore, reset, payment correction, historical dates, attendance corrections and non-chargeable orders still ask for that password.
