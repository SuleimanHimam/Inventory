# النشر — Deployment

Two services, one app:

| Piece | Service | What it runs |
| --- | --- | --- |
| API + database | **Railway** | `server/` — plain Express, plus a Postgres service |
| Frontend | **Vercel** | `client/` — Vite build, static |

Supabase is no longer part of this. The cost is that **there is no login and no
durable photo storage** — read [Authentication — there is
none](#1b-authentication--there-is-none) and [Plan limits and what
breaks](#plan-limits-and-what-breaks) before this holds anyone's real data.

> **Self-hosting instead?** [`deploy/windows/`](deploy/windows/README.md) covers
> running this on your own Windows Server behind a domain: requirements,
> services that survive a reboot, TLS, firewall and backups. Photos become
> durable there — a real disk, not a container filesystem — but a public port
> makes the missing login urgent rather than theoretical.

---

## 1. Railway — Postgres

1. In the Railway project: **New → Database → Add PostgreSQL**.
2. In the **API service**'s Variables, reference it rather than pasting a URL:

   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   ```

   A reference keeps working when Railway rotates the credentials. Both services
   must be in the same project for the private network to resolve.
3. That is the whole database setup. The schema applies itself: the API runs
   `server/migrations` in order at boot and records each file in
   `schema_migrations`, so a plain redeploy ships a migration. To apply them from
   your machine instead:

   ```bash
   cd server
   DATABASE_URL='postgres://…' npm run migrate
   ```

   Nothing in the schema is Supabase-specific — `pgcrypto` is the only extension,
   and `memberships.user_id` is a plain `uuid` with no foreign key into an
   external auth table.

### Row Level Security

`migrations/002_rls.sql` compares `org_id` against the `app.org_id` setting the
API puts on every request. **A superuser bypasses RLS entirely**, and Railway's
default `postgres` role is one — so with the reference variable above, the
policies are inert. Application-level scoping still holds (every service query
carries an `org_id` predicate, and the test suite covers it), but the second
layer is off.

To make it effective, create the least-privilege login role and point
`DATABASE_URL` at it instead:

```sql
-- once, against the Railway database:
ALTER ROLE app_api WITH LOGIN PASSWORD 'a-long-random-password';
```

`app_api` is created (without login) by `002_rls.sql` and already holds
`SELECT/INSERT/UPDATE/DELETE` on every table. Then set `DATABASE_URL` to that
role — by hand this time, since a reference variable always resolves to
`postgres`. Check it before trusting it:

```bash
cd server && DATABASE_URL='…' npm run doctor    # want: bypasses RLS: no
```

Keep running migrations as `postgres`: `app_api` deliberately cannot change the
schema.

> **On pooling.** `runInOrg` sets `app.org_id` with `SET LOCAL` inside a
> transaction rather than as a session GUC. That was written for Supabase's
> transaction pooler, where a session `SET` silently vanishes between statements.
> Railway hands out a direct connection, so it is not strictly required here —
> but it is correct under both, and the API verifies at boot with
> `app_current_org()` that the context reaches the policies.

## 1b. Authentication — there is none

This deployment runs `AUTH_MODE=none`. The API verifies no one: every request is
served as a single fixed user in a single organisation, and **anyone who knows
the URL can read and change all of the data**. The URL is the only thing
protecting it.

That used to be refused outright when `NODE_ENV=production`. The guard existed
so a hosted deployment could not end up open *by accident*; it is gone because
without Supabase Auth nothing issues tokens, so the openness is a decision
instead. What replaces it is visibility — `insecure: true` on
`/api/v1/health`, and a warning on every boot.

Before this holds real inventory data for a real organisation, it needs a login.
The two honest routes:

- **Supabase Auth on its own.** Free, needs only `SUPABASE_URL` on the API and
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` on the frontend, and does not
  require the Supabase *database*. The verification code in
  `server/src/lib/auth.js` and `client/src/lib/session.ts` is still there and
  still works — set the variables and it comes back.
- **Build it into the API.** A users table, password hashing, token issuing, and
  a rewritten login screen. Then you own resets, lockout and email delivery.

## 1c. Product photos

`STORAGE_DRIVER=local` writes them to the container filesystem, **which Railway
wipes on every deploy.** Photos uploaded today are gone after the next push.
Acceptable while evaluating; not acceptable once anyone relies on them.

The durable options are a Railway volume mounted at `server/data/uploads`, or
setting `STORAGE_DRIVER=supabase` with a bucket (that code path is intact and
needs no Supabase database either).

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
   `railway variables --set 'KEY=value'`. All six:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — see step 1 |
   | `AUTH_MODE` | `none` — **the API is open; see 1b** |
   | `STORAGE_DRIVER` | `local` — photos do not survive a deploy; see 1c |
   | `CORS_ORIGIN` | your exact Vercel URL |
   | `ALLOW_AUTO_PROVISION` | `1` |

   Delete any `SUPABASE_*` variables left over from an earlier setup. They are
   read only when `AUTH_MODE=supabase` or `STORAGE_DRIVER=supabase`, so they do
   nothing here except mislead the next person reading the dashboard.
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
{ "ok": true, "db": "ready", "insecure": true }        // as configured here
{ "ok": true, "db": "error", "dbError":   "DATABASE_URL is not set. …" }
{ "ok": true, "db": "ready", "authError": "Set SUPABASE_JWT_SECRET …" }
```

`insecure: true` is `AUTH_MODE=none` announcing itself. It is not an error and
will not go away until this deployment has a login.

That ordering is deliberate. Configuration used to be validated at module load,
so *any* mistake — a missing variable, a wrong pooler username, an unreachable
host, a failed migration, no JWT secret — killed the process before the port
opened, and the platform could only say "health check failed". Unrelated causes,
one useless message, and you learn them one redeploy at a time. Now the
container stays up and names the problem, in the deploy log and here.

`authError` means every request is refused with 503 (`AUTH_NOT_CONFIGURED`) —
that is `AUTH_MODE=supabase` with no way to verify a token, which serves nothing
rather than serving everything. `dbError` means requests that touch data fail
with 500 immediately. Nothing hangs, and nothing silently answers with empty
results.

The cost: a misconfigured deploy no longer fails the health check, so it will
not roll itself back. Watch for `✖` in the deploy log, or read the fields above.

## 3. Vercel — frontend

- **Root directory:** `client`
- **Build command:** `npm run build`
- **Output directory:** `dist`

Environment variables (build-time and public — Vite inlines them):

| Key | Value |
| --- | --- |
| `VITE_API_URL` | the Railway URL, no trailing slash, e.g. `https://inventory-api.up.railway.app` |

That is the only one needed here. `client/src/lib/session.ts` shows no login
screen when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are absent, which is
the frontend half of `AUTH_MODE=none` — leave them unset. Setting all three is
how you turn the login back on later; no code changes, on either side.

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
organisation — the same mode the hosted deployment currently runs in.

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

Vercel runs on its free tier; Railway does not have one. What that costs you —
the first two are consequences of dropping Supabase, and they are the ones that
matter:

- **Railway is not free.** A trial credit, then Hobby at ~$5/month plus usage.
  What you buy is an always-on service: no sleep, so no multi-second cold start
  the first time someone opens the app each morning — which on a sleeping free
  host reads to an institutional user as "the system is down". This is the one
  line item in the stack that has to be paid, and it is the right one to pay.
- **There is no authentication.** Anyone with the API URL can read and change
  every row. This is the limit that should stop a rollout, not the plan prices.
  See [1b](#1b-authentication--there-is-none).
- **Product photos do not survive a deploy.** `STORAGE_DRIVER=local` writes to
  the container filesystem, which Railway rebuilds on every push. A Railway
  volume fixes it; so does the Supabase Storage driver, which still works and
  needs no Supabase database.
- **Backups are yours to arrange.** Railway Postgres has no point-in-time
  recovery on the starter plans. Schedule `pg_dump` somewhere off-platform. For
  real customer data this is the one I would not ship without resolving.
- **Railway bills for the database too.** Postgres is a second service with its
  own usage, on top of the API. Still small for this workload — the largest
  table is `stock_movements` at roughly 150 bytes a row — but it is no longer a
  free 500 MB.

Nothing here is a limitation of the *code*: auth and durable storage both exist
and are switched off by configuration, not deleted.
