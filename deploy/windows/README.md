# Self-hosting on Windows Server

Running this on your own machine, reachable at `https://inventory.example.com`,
staying up without anyone watching it.

Files in this folder:

| File | What it is |
| --- | --- |
| `env.production.example` | copy to `server\.env` — all configuration |
| `Caddyfile` | TLS + reverse proxy + serves the frontend |
| `install-services.ps1` | registers both as Windows services, opens the firewall |
| `backup.ps1` | nightly `pg_dump` + photos, for Task Scheduler |

---

## Requirements

### Software

| | Version | Why that floor |
| --- | --- | --- |
| **Node.js** | **20.12+** | `--env-file`, which the service uses to load `server\.env` |
| **PostgreSQL** | **15+** | the composite tenant foreign keys use `ON DELETE SET NULL (col)`, added in 15 |
| **Caddy** | 2.x | TLS certificates issued and renewed automatically |
| **NSSM** | 2.24+ | runs `node.exe` as a real service |
| Git | any | to pull updates |

```powershell
winget install OpenJS.NodeJS.LTS
winget install PostgreSQL.PostgreSQL.16
winget install CaddyServer.Caddy
winget install NSSM.NSSM
winget install Git.Git
```

### Hardware

Modest. This is one Node process and one Postgres instance, and the schema is
small — `stock_movements`, the largest table, is roughly 150 bytes a row.

- **2 vCPU / 4 GB RAM** is comfortable for a few dozen concurrent users
- **20 GB disk**, plus whatever the photos need — about **500 KB each**, so
  10,000 products with a photo each is ~5 GB
- The machine must **not sleep**. `powercfg /change standby-timeout-ac 0`

### Network

- A **domain** with an **A record** pointing at the server's public IP
- **Ports 80 and 443** forwarded from the router to this machine.
  Port 80 is not optional — Caddy uses it for the ACME challenge and for the
  HTTPS redirect
- A **static public IP**, or dynamic DNS. If the ISP rotates your IP, the domain
  stops resolving and nothing else here matters
- **Do not forward 4317.** The API binds `127.0.0.1`, so it is unreachable from
  the network by design; Caddy is the only way in, and therefore TLS is the only
  way in

### Before any of it: authentication

**The deployment currently has none.** `AUTH_MODE=none` serves every request as
one shared user, and on a public domain that means anyone who finds the host can
read and change all of your inventory. Scanners find new hosts on 443 within
hours — this is not a theoretical risk, and the URL being obscure is not a
control.

`env.production.example` therefore ships with `AUTH_MODE=supabase`. Supabase
Auth is free, needs **no** Supabase database, and the verification code on both
sides is intact and unchanged:

1. Create a Supabase project → Authentication → Providers → **Email**
2. `SUPABASE_URL=https://YOUR-PROJECT.supabase.co` in `server\.env`
3. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` when building the frontend

If you would rather not depend on Supabase at all, the alternative is building
email + password login into the API — a users table, hashing, token issuing, and
a rewritten login screen. That is real work, but it is bounded, and it is the
only other honest answer.

---

## Setup

### 1. Database

```powershell
# as the postgres superuser
psql -U postgres -c "CREATE DATABASE inventory;"
```

### 2. Code

```powershell
git clone https://github.com/SuleimanHimam/Inventory1.git C:\inventory
cd C:\inventory
npm run setup
```

### 3. Configure

```powershell
Copy-Item deploy\windows\env.production.example server\.env
notepad server\.env      # domain, database password, SUPABASE_URL
```

### 4. Schema, and the role that makes RLS work

```powershell
cd C:\inventory\server
npm run migrate                    # as postgres — creates the app_api role
psql -U postgres -d inventory -c "ALTER ROLE app_api WITH LOGIN PASSWORD 'a-long-random-password';"
# put that role in DATABASE_URL, then:
npm run doctor                     # want: bypasses RLS: no
```

`app_api` cannot change the schema — that is deliberate. Keep running migrations
as `postgres`.

### 5. Frontend

```powershell
cd C:\inventory\client
"VITE_API_URL=https://inventory.example.com`nVITE_SUPABASE_URL=…`nVITE_SUPABASE_ANON_KEY=…" |
  Set-Content .env.production -Encoding utf8
npm run build                      # → client\dist, which Caddy serves
```

### 6. Caddy

```powershell
New-Item -ItemType Directory C:\caddy -Force
Copy-Item C:\inventory\deploy\windows\Caddyfile C:\caddy\Caddyfile
notepad C:\caddy\Caddyfile         # replace inventory.example.com
```

### 7. Services

```powershell
# elevated
C:\inventory\deploy\windows\install-services.ps1
```

That covers the four separate things "runs all the time" actually means:

| Guarantee | What provides it |
| --- | --- |
| survives you logging off | a Windows service, not a console process |
| starts after a reboot | `Start = SERVICE_AUTO_START` |
| restarts after a crash | `AppExit Default Restart`, 5s delay, 10s throttle |
| waits for the database | `DependOnService postgresql-x64-16` |

### 8. Backups

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
             -Argument '-NoProfile -File C:\inventory\deploy\windows\backup.ps1'
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName 'Inventory backup' -Action $action `
  -Trigger $trigger -RunLevel Highest -User 'SYSTEM'
```

The database and the photos are backed up together because they are one thing:
`items.image_file` is a filename, so a database restored without its uploads
folder is a catalogue of broken images.

**Copy `C:\inventory\backups` off this machine.** A backup on the same disk
survives a bad migration and nothing else.

---

## Checking it

```powershell
curl.exe http://127.0.0.1:4317/api/v1/health    # the API directly
curl.exe https://inventory.example.com/api/v1/health   # through Caddy
```

Read the payload, not just the status:

```jsonc
{ "ok": true, "db": "ready" }                    // healthy
{ "ok": true, "db": "error", "dbError": "…" }    // listening, but no database
{ "ok": true, "insecure": true }                 // NO AUTHENTICATION — fix this
```

`ok: true` only means the process is serving. `insecure: true` means anyone can
read and write your data.

```powershell
Get-Service inventory-api, caddy
Get-Content C:\inventory\logs\api.log -Tail 40 -Wait
```

## Updating

```powershell
cd C:\inventory
git pull
npm run setup
cd client; npm run build; cd ..
Restart-Service inventory-api
```

Migrations apply themselves at boot, so a restart ships a schema change.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| `curl` to 127.0.0.1:4317 works, the domain does not | DNS, or ports 80/443 are not forwarded |
| Caddy will not get a certificate | port 80 blocked — ACME needs it |
| Service starts then stops | read `logs\api.err.log`; usually `.env` |
| `db: "error"` | `DATABASE_URL`, or Postgres is not running |
| `bypasses RLS: yes` | connected as `postgres`; use `app_api` |
