# النشر — Deployment

Three services, one app — two of them free:

| Piece | Service | What it runs |
| --- | --- | --- |
| Database + Auth + file storage | **Supabase** | Postgres 15, Supabase Auth, one Storage bucket |
| API | **Railway** | `server/` — plain Express, `npm start` |
| Frontend | **Vercel** | `client/` — Vite build, static |

Read [Plan limits and what breaks](#plan-limits-and-what-breaks) before
promising anything to institutional users.

---

## 1. Supabase — database

1. Create a project (any region close to your users; the API region should match).
2. **Connect** (top of the dashboard) → this is where `DATABASE_URL` comes from.
   On older projects it is under Project settings → Database → Connection string.

   **Use a pooler connection, not `db.<ref>.supabase.co`.** On current free-tier
   projects the direct host resolves to IPv6 only — the IPv4 address is a paid
   add-on — so it is simply unreachable from most clients, Railway included. The
   pooler is IPv4:

   ```
   postgresql://postgres.<PROJECT-REF>:<DB-PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

   Note the username carries the project ref (`postgres.abcdefgh`), which the
   pooler needs to identify the tenant.

   **Either pooler port works.** `6543` is transaction mode, `5432` session mode;
   some projects only accept one of them. The API binds `app.org_id` *inside a
   transaction* (`SET LOCAL`), and a pooler pins one backend for a transaction's
   duration, so the RLS policies see it under both modes. This is why
   `runInOrg` runs a request as one transaction rather than setting a
   session-level GUC — a session `SET` would silently vanish behind a
   transaction pooler and leave every policy matching nothing.

   The API verifies this at boot with `app_current_org()` and prints a loud
   warning if the context is not reaching the policies, so a wrong URL announces
   itself in the first deploy log.
3. Apply the schema:

   ```bash
   cd server
   DATABASE_URL='postgres://postgres:…@…supabase.com:5432/postgres' npm run migrate
   ```

   The runner applies everything in `server/migrations` in order and records each
   file in `schema_migrations`, so re-running it is a no-op. The API also runs it
   at boot, which means a plain redeploy is enough to ship a migration.

4. **Make RLS effective (recommended).** The policies in
   `migrations/002_rls.sql` compare `org_id` against the `app.org_id` setting the
   API puts on every request. A superuser bypasses RLS entirely, and Supabase's
   `postgres` role is one — so create a least-privilege login role and use *that*
   in `DATABASE_URL`:

   ```sql
   -- SQL editor, once:
   ALTER ROLE app_api WITH LOGIN PASSWORD 'a-long-random-password';
   ```

   `app_api` is created (without login) by `002_rls.sql` and already has
   `SELECT/INSERT/UPDATE/DELETE` on every table. Then:

   ```
   DATABASE_URL=postgresql://app_api.<PROJECT-REF>:a-long-random-password@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

   The `.<PROJECT-REF>` suffix on the username is required for every role, not
   just `postgres` — it is how the pooler identifies the tenant. Without it the
   connection fails with `no tenant identifier provided`.

   Check the string before deploying with it:

   ```bash
   cd server && DATABASE_URL='…' npm run doctor    # want: bypasses RLS: no
   ```

   Verify it worked — this must return `0` rows, not your data:

   ```sql
   SET ROLE app_api; SELECT count(*) FROM items;  -- 0
   ```

   Keep running migrations as `postgres`: `app_api` deliberately cannot change
   the schema.

5. **Auth:** Authentication → Providers → Email. Enable it. For a pilot, turn
   *Confirm email* off if you would rather not wire up SMTP yet; magic links and
   confirmations both need the built-in email service, which is rate-limited to a
   few messages an hour on the free plan (fine for a handful of staff, not for
   onboarding a hundred users in an afternoon).
6. **Storage:** create a **public** bucket named `item-images`. Product photos go
   there; the API redirects `/uploads/<file>` to it. Public means anyone with the
   URL can view a photo — the filenames are random UUIDs, which is the same
   exposure the desktop app had over LAN. If that is not acceptable, switch the
   bucket to private and serve signed URLs instead.

## 2. Railway — API

Railway does not sleep an idle service, so there is no cold start to warn users
about — but there is no free plan either: a trial credit, then Hobby
(~$5/month). This is the one paid piece of the stack.

1. **New Project → Deploy from GitHub repo**, pick this repository.
2. **Leave Root Directory empty** — Railway builds from the repository root and
   reads `railway.json` there, which installs `server/`'s dependencies and then
   runs the root `start` script (`npm --prefix server start`).

   This is the step that bites. The root `package.json` declares no runtime
   dependencies, so a build that only installs the root leaves the API without
   `express` and it dies at import with `ERR_MODULE_NOT_FOUND` — before
   `app.listen`, which the platform reports as a failed health check rather than
   as a crash. The build command in `railway.json` is what prevents that.

   Setting Root Directory to `server` also works: Railway then reads
   `server/railway.json` instead, and installs `server/package.json` on its own.
   Pick one — the two files exist so that either choice boots.
3. **Variables.** `railway.json` has no equivalent of a Blueprint's `envVars`
   block, so every one of these is set in the dashboard or with
   `railway variables --set 'KEY=value'`. All ten — the five secrets are the
   easy ones to forget, and a missing `DATABASE_URL` throws at boot *before*
   `app.listen`, which the platform again reports as a failed health check:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `AUTH_MODE` | `supabase` |
   | `DATABASE_URL` | from Supabase (prefer the `app_api` role — see step 1) |
   | `SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
   | `SUPABASE_JWT_SECRET` | Project settings → API → JWT keys (omit for asymmetric keys) |
   | `STORAGE_DRIVER` | `supabase` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Project settings → API (server-side only) |
   | `SUPABASE_STORAGE_BUCKET` | `item-images` |
   | `CORS_ORIGIN` | your exact Vercel URL |
   | `ALLOW_AUTO_PROVISION` | `1` |

   Do **not** add a Railway Postgres plugin. The database is Supabase, and the
   plugin would overwrite `DATABASE_URL` with its own.
4. **Settings → Networking → Generate Domain.** Railway injects `PORT` and the
   app binds `0.0.0.0` on it. If the domain answers 502, check that the
   generated domain's target port matches the port in the deploy log.
5. Put that domain in `VITE_API_URL` on Vercel, then set `CORS_ORIGIN` here to
   the Vercel URL and redeploy.

Nothing in the startup path expects a parent process: `server/src/server.js`
binds `0.0.0.0` on `$PORT`, serves, and *then* runs pending migrations. The old
Electron handshake (port announcement on stdout, `ELECTRON_RUN_AS_NODE`) is
gone, along with the `electron/` directory.

### When the deploy is unhappy, ask the health endpoint

`/api/v1/health` answers before the database is involved, and reports it:

```jsonc
{ "ok": true, "db": "ready" }                          // everything is fine
{ "ok": true, "db": "error",  "dbError":   "DATABASE_URL is not set. …" }
{ "ok": true, "db": "ready",  "authError": "Set SUPABASE_JWT_SECRET …" }
```

That ordering is deliberate. Configuration used to be validated at module load,
so *any* mistake — a missing variable, a wrong pooler username, an unreachable
host, a failed migration, no JWT secret — killed the process before the port
opened, and the platform could only say "health check failed". Unrelated causes,
one useless message, and you learn them one redeploy at a time. Now the
container stays up and names the problem, in the deploy log and here.

Safety is unchanged where it matters. `authError` means **every** request is
refused with 503 (`AUTH_NOT_CONFIGURED`) — including under `AUTH_MODE=none`, so
a production deployment that cannot verify a token still serves nothing.
`dbError` means requests that touch data fail with 500 immediately. Nothing
hangs, and nothing silently answers with empty results.

The cost: a misconfigured deploy no longer fails the health check, so it will
not roll itself back. Watch for `✖` in the deploy log, or read the fields above.

## 3. Vercel — frontend

- **Root directory:** `client`
- **Build command:** `npm run build`
- **Output directory:** `dist`

Environment variables (all three are build-time and public — Vite inlines them):

| Key | Value |
| --- | --- |
| `VITE_API_URL` | the Railway URL, no trailing slash, e.g. `https://inventory-api.up.railway.app` |
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Project settings → API → anon/public key |

Set `CORS_ORIGIN` on Railway to the Vercel URL *after* the first deploy, then
redeploy the API. For per-commit preview URLs, set `CORS_ORIGIN_REGEX` on
Railway (e.g. `^https://inventory-[a-z0-9-]+\.vercel\.app$`) — or leave previews unable
to reach the API, which is the safer default.

The app uses hash routing (`/#/items/…`), so no rewrite rules are needed and
there is no server-rendering assumption anywhere. RTL, the theme (stored in
`localStorage` by `public/theme.js` before first paint) and the `Ctrl/⌘+K`
command palette are all client-side and unaffected by static hosting.

---

## Local development

```bash
npm run setup          # install server + client
npm run db:up          # Postgres 15 in Docker on port 5433
cp server/.env.example server/.env
npm run migrate
npm run seed           # sample Arabic catalogue
npm run dev            # API on :4317, frontend on :5173
```

No Docker? Any PostgreSQL **15 or newer** works — point `DATABASE_URL` at it and
run `npm run migrate`. 15 is the floor because the composite tenant foreign keys
use the column-specific `ON DELETE SET NULL (col)` form.

With `AUTH_MODE=none` (the default in `.env.example`) there is no login screen
and every request runs as a single local development user with its own
organisation. The server refuses that mode when `NODE_ENV=production`.

To exercise the real login flow locally, set `SUPABASE_URL` +
`SUPABASE_JWT_SECRET` and `AUTH_MODE=supabase` in `server/.env`, and
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `client/.env.local`.

### Tests

```bash
npm run db:up
cd server && TEST_DATABASE_URL='postgres://inventory:inventory@127.0.0.1:5433/inventory?sslmode=disable' npm test
```

Each run creates its own organisation and drops it afterwards, so the suite can
run against any database — including a throwaway Supabase branch.

One caveat: a development database usually connects you as a superuser, which
bypasses RLS. The suite notices and skips its RLS assertion in that case, so the
policies are only really proven against a non-superuser role — see step 4 above
for the check that does prove them.

---

## Existing data from the desktop build

**There is no automated import from the old SQLite file.** This migration
converts the schema, not the data, so a customer already running v5.0 starts
empty unless someone writes that one-off script.

It is not difficult, but it is not nothing either — the shape of the job:

1. Create the target organisation, and read its `org_id`.
2. Copy the tables in dependency order — `categories`, `items`, `sub_barcodes`,
   `customers`, `suppliers`, `stock_counts`, `invoices`, `invoice_lines`,
   `stock_count_lines`, `counters`, `settings`, `item_images` — stamping each row
   with that `org_id`. Ids, timestamps and money all keep their SQLite
   representation, so the values transfer verbatim.
3. `stock_movements` last, and **with the ledger triggers disabled** (see the
   `wipeOrg` helper in `src/db/seed.js` for the pattern). Inserting them with the
   triggers live would double-count: the balance trigger would add each movement
   to an `items.quantity` that was already copied over. Re-enable them, then
   verify every `items.quantity` equals `SUM(IN) - SUM(OUT)` for that item.
4. Copy `server/data/uploads/*` into the Storage bucket under the same filenames.

---

## Plan limits and what breaks

Supabase and Vercel run on their free tiers; Railway does not have one. What
that costs you:

- **Railway is not free.** A trial credit, then Hobby at ~$5/month plus usage.
  What you buy is an always-on service: no sleep, so no multi-second cold start
  the first time someone opens the app each morning — which on a sleeping free
  host reads to an institutional user as "the system is down". This is the one
  line item in the stack that has to be paid, and it is the right one to pay.
- **Supabase pauses a project after 7 days with no activity.** It has to be
  resumed from the dashboard. Regular use avoids this; a pilot that sits idle for
  a fortnight will need a manual restore.
- **Supabase free storage:** 500 MB database + 1 GB file storage. This schema is
  small — the largest table is `stock_movements` at roughly 150 bytes a row, so
  500 MB is millions of movements. Product photos are what will hit the wall
  first: 1 GB is about 2,000 photos at 500 KB each.
- **Supabase Auth email** is rate-limited on the free plan. Bulk-onboarding
  users, or relying on magic links for daily sign-in, needs your own SMTP
  provider configured in Supabase (free options exist).
- **No backups on the free plan.** Supabase's point-in-time recovery is a paid
  feature. For real customer data, either take `pg_dump` snapshots on a schedule
  or budget for the Pro plan. This is the one limit I would not ship to a
  paying institutional customer without resolving.
- **Product photos are ephemeral if `STORAGE_DRIVER=local`** — Railway's
  container filesystem is wiped on every deploy, so use the Supabase Storage
  driver in production. A Railway volume would also work, but it is one more
  paid resource to back up, and Supabase Storage is already there.

Beyond the API host, nothing here *requires* a paid tier to work correctly. The
two things that would push the rest of the stack off free are backups and photo
volume.
