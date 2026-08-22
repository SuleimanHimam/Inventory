# نظام إدارة المخزون — Inventory Management System

Multi-user inventory management with an Arabic-first, right-to-left interface,
self-hosted on Windows Server (API + SQL Server, behind Caddy for TLS) — see
[`deploy/windows/README.md`](deploy/windows/README.md).

Version 6.0 · React + TypeScript · Node/Express · SQL Server

> **Migrated from PostgreSQL.** The database layer moved from Postgres (with
> Row-Level-Security tenant isolation) to SQL Server, to consolidate onto the
> database engine already running on the host server. Tenant isolation is
> application-level only now — every service query carries an explicit
> `org_id` predicate; see `server/src/db/index.js`'s file header for why the
> RLS equivalent was dropped rather than ported. `DEPLOYMENT.md`'s
> Railway/Vercel/Postgres instructions describe a path the code no longer
> supports.

> **The hosted deployment currently runs with `AUTH_MODE=none` — it has no
> login.** Supabase Auth was dropped along with the Supabase database, and
> nothing replaced it, so anyone with the API URL can read and change every row.
> The verification code is intact and re-enabled by configuration alone; see
> [DEPLOYMENT.md](DEPLOYMENT.md#1b-authentication--there-is-none).

> **Migrated from the offline desktop build (v5.0).** The Electron shell and the
> embedded SQLite database are gone; the business rules, the service layer and
> the API contract are unchanged. What changed and why is summarised in
> [Migration notes](#migration-notes-from-v50).

---

## Quick start

```bash
npm run setup          # install server + client dependencies
npm run db:up          # local SQL Server 2022 in Docker (host port 14330)
sqlcmd -S 127.0.0.1,14330 -U sa -P 'DevPassw0rd!' -i server/provision-mssql.sql
cp server/.env.example server/.env   # fill in DB_PASSWORD (app_api's, from provision-mssql.sql)
npm run migrate        # apply server/migrations-mssql
npm run seed           # load realistic Arabic sample data (optional)
npm run dev            # API on :4317, UI on :5173
```

Open <http://127.0.0.1:5173>.

The example env sets `AUTH_MODE=none`, so development needs no Supabase project:
there is no login screen and every request runs as one local development user
with its own organisation. The server refuses that mode when
`NODE_ENV=production`.

To exercise the real login flow locally, put `SUPABASE_URL` +
`SUPABASE_JWT_SECRET` and `AUTH_MODE=supabase` in `server/.env`, and
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `client/.env.local`.

### Deploying

See **[`deploy/windows/README.md`](deploy/windows/README.md)** for the current,
supported path: a self-hosted Windows Server running the API and SQL Server
together behind Caddy for TLS. (`DEPLOYMENT.md`'s Railway/Vercel walkthrough
predates the SQL Server migration and no longer applies to the database half.)

### Tests

```bash
npm run db:up
cd server && DB_SERVER=127.0.0.1,14330 TEST_DB_NAME=inventory_test DB_USER=app_api DB_PASSWORD='…' npm test
```

31 end-to-end business-rule tests: barcode uniqueness across primary/sub/unit
barcodes, the negative-stock guard, ledger immutability, invoice posting and
price propagation, units of measure and conversion factors, the full
stocktaking lifecycle including transactional rollback, tenant isolation, and
per-organisation settings. Each run creates its own organisation and drops it
afterwards, so the suite is safe against any database — `TEST_DB_NAME` lets it
target a separate database from the one `npm run dev` uses.

---

## Architecture

```
server/            Express API + SQL Server
  migrations/        historical — the PostgreSQL-era schema (001-007), superseded
  migrations-mssql/  001_core.sql (schema + triggers), 002_triggers.sql
  provision-mssql.sql  one-time setup: database, app_api login, its grants
  src/db/            pool, query helpers, transactions, org context, migrate, seed
  src/lib/           auth (JWT + org resolution), errors, storage, http
  src/services/      business logic — the single source of truth for rules
  src/routes/        thin HTTP handlers, zod-validated
  test/              business-rule test suite

client/            React + TypeScript + Vite + Tailwind v4
  src/pages/         one file per screen (+ Login)
  src/components/    ui/ primitives, domain badges, layout, modals
  src/hooks/         React Query hooks + the query-key registry
  src/lib/           API client, Supabase session, formatting, types
```

The frontend is a static bundle. It knows the API by `VITE_API_URL`. When the
`VITE_SUPABASE_*` variables are set it signs in against Supabase Auth directly
and sends the resulting access token as a bearer token — no password or refresh
token ever passes through our API. Unset, as on the current deployment, it skips
the login screen entirely and every request is anonymous. Hash routing
(`/#/items/…`) means deep links resolve on static hosting with no rewrite rules
and no server-rendering assumptions.

---

## Key design decisions

**Every stock movement belongs to an invoice.** The ledger has exactly one write
path, so the movement history, the invoices list, and any report can never
disagree. The quick "stock movement" modal still looks like a one-step action to
the user — behind it, a single-line `STOCK_IN`/`STOCK_OUT` document is created
and posted in one transaction. Stocktaking corrections and Excel opening
balances flow through the same path, tagged with their origin so the UI can badge
them as system-generated.

**The ledger is append-only, enforced by the database.** `BEFORE UPDATE` and
`BEFORE DELETE` triggers on `stock_movements` raise `LEDGER_IMMUTABLE`.
Corrections are new movements, never edits. A companion `AFTER INSERT` trigger
maintains the cached `items.quantity`, so the running balance is O(1) to read and
mathematically cannot drift from the ledger.

**Barcode uniqueness spans two tables — within an organisation.** A barcode must
be unique across both `items.barcode` and `sub_barcodes.barcode`; cross-table
triggers enforce it, so no code path — API, importer, or seed — can create an
ambiguous scan. Scoping it per organisation is new: two customers of the hosted
app may legitimately stock the same manufacturer barcode.

**Posting is the only side effect.** A draft invoice is inert. `POST
/invoices/:id/post` runs one transaction that writes movements, propagates
prices, and flips the status. The outbound-stock guard aggregates demand *per
item across all lines*, so two lines of 30 against a balance of 55 are correctly
rejected — a per-line check would have let that through.

**Stocktaking apply is all-or-nothing.** Applying a session generates and posts a
Stock-In invoice for surpluses and a Stock-Out for shortages inside a single
transaction. If any line would drive stock negative, the entire apply rolls back
and the session stays `SUBMITTED` for the user to correct. Because sessions
snapshot expected quantities at creation, lines whose stock moved afterwards are
flagged `is_stale`, with a one-click refresh before submitting.

**Tenant isolation is enforced twice.** Every query in the service layer carries
an explicit `org_id` predicate, and the organisation comes from the verified JWT
subject via the `memberships` table — never from client input. Underneath,
Row Level Security policies compare `org_id` against the `app.org_id` setting the
API puts on each request's connection, so a query that *forgets* the predicate
still returns nothing. See `server/migrations/002_rls.sql` for the one
configuration step that makes that second layer real.

**The organisation travels in AsyncLocalStorage, not in signatures.** Adding
multi-tenancy did not change a single service function's parameters: the request
context carries the org id and the dedicated connection, which is what let the
19 existing tests keep describing the same behaviour.

---

## Migration notes (from v5.0)

| v5.0 (offline desktop) | v6.0 (hosted web) |
| --- | --- |
| Electron shell spawns the API on a loopback port | plain `node src/server.js` on `$PORT` |
| `window.inventory.apiBase` from the preload bridge | `VITE_API_URL` baked in at build time |
| SQLite + `better-sqlite3`, synchronous | PostgreSQL + `pg`, async/await throughout |
| `schema.sql` run at startup | tracked migrations in `server/migrations` |
| SQLite triggers | PL/pgSQL `CREATE FUNCTION … RETURNS TRIGGER` |
| WAL mode for concurrent reads | MVCC — nothing to configure |
| No authentication, single user | `org_id` on every tenant table + RLS (login: see the note above) |
| Photos on the local disk | still the local disk — now ephemeral, since the container is rebuilt each deploy |
| `ORDER BY … COLLATE NOCASE` | `lower(…)` / `ILIKE` |
| `rowid` as insertion-order tie-break | explicit `seq` identity column |

Three details preserved deliberately, because the API contract and the tests
depend on them: ids stay `text` UUIDs minted by the API, timestamps stay
ISO-8601 UTC `text` (so every comparison and JSON response is byte-identical to
the SQLite build), and money stays `double precision` rounded to two decimals by
the service layer — `numeric` would be more correct but node-postgres returns it
as a string, which would change every response shape.

Two Postgres-specific traps the port had to handle, both of which are covered by
tests:

- **A failed statement poisons a Postgres transaction.** The importer catches a
  per-row barcode collision and carries on, which SQLite allowed; each row's
  insert now runs in its own savepoint.
- **Nested transactions.** Invoice posting is transactional and is called from
  inside the stocktaking apply and the importer. `tx()` turns a nested call into
  a savepoint, so the inner failure rolls back only its own work and the outer
  operation still rolls back as a whole.

---

## Deviations from the specification

- **`pg` instead of an ORM.** The business rules live in database triggers and in
  a service layer of hand-written SQL; a query builder would add a layer without
  removing one. The `@name` bind-parameter style of the SQLite build is kept, so
  the SQL reads as it did before the port.
- **`POST /items/:id/movements` is gone.** §6.4 asked for a direct movement
  endpoint; it existed, satisfied §3.4's "every movement has an `invoice_id`"
  by posting a one-line document, and has now been removed at the owner's
  request along with the item-card button that was its only caller. Stock
  changes through one user-facing path: build an invoice, post it.
- **Extras beyond the spec, all additive:** a per-organisation `settings` table
  (low-stock threshold, currency, digit system, import limits), a
  `GET /invoices/:id/validate` endpoint that powers the Post button's inline "why
  is this disabled" reason, `POST /stock-counts/:id/refresh-expected` for the §7
  concurrency rule, party restore endpoints, and `GET /me`.

---

## Interface notes

Arabic is the primary language and the layout is mirrored throughout: the header
runs right-to-left, and logical CSS properties handle direction so a future LTR
locale needs no layout rewrite. Dates use the Gregorian calendar with Arabic
month names; digits default to Western `0-9` for readability in financial columns
and can be switched to Arabic-Indic in Settings.

Primary navigation lives in the header rather than a sidebar — a second row under
the brand and search, with thin dividers standing in for the group headings. All
eleven destinations fit without overflow at the 1280 px minimum viewport, and the
full window width goes to the content, which matters for the wide tables this
application is mostly made of.

The workflows people repeat all day are keyboard-first. Item search — by name,
primary barcode, or any sub-barcode — lives in the search field on the Items
screen. On the invoice screen the barcode field is always focused, so a
handheld scanner adds lines back to back without touching the mouse; an
unrecognised code opens a quick-create modal with the scanned value locked in,
and returns focus to the scanner on save. In stocktaking, `Enter` and the arrow
keys move between quantity cells, and rows colour live — green surplus, red
shortage — before anything is saved.

Both light and dark themes are supported and the preference persists locally.

> **Known gap, pre-dating this migration:** `components/layout/GlobalSearch.tsx`
> implements a `Ctrl/⌘+K` command palette, but nothing renders it — the ribbon
> refactor that replaced `TopNav.tsx` dropped both. The keyboard shortcut
> therefore does nothing today. Restoring it is a two-line mount plus a decision
> about where its trigger button belongs in the ribbon; `TopNav.tsx` is likewise
> orphaned and can be deleted.
