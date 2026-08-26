# Self-hosting on Windows Server

Running this on your own machine, reachable at `https://inventory.example.com`,
staying up without anyone watching it.

Files in this folder:

| File | What it is |
| --- | --- |
| `env.production.example` | copy to `server\.env` — all configuration |
| `Caddyfile` | TLS + reverse proxy + serves the frontend |
| `install-services.ps1` | registers both as Windows services, opens the firewall |
| `backup.ps1` | nightly `BACKUP DATABASE` + photos, for Task Scheduler |
| `backup-pull.ps1` | runs on a **second machine**: copies the primary's backups to it |
| `restore.ps1` | rebuilds the system from a backup set — database and photos |

The database itself is SQL Server, not Postgres — `..\..\server\provision-mssql.sql`
(one level up from this folder) creates the database and the app's login; see
step 1 below.

---

## Requirements

### Software

| | Version | Why that floor |
| --- | --- | --- |
| **Node.js** | **20.12+** | `--env-file`, which the service uses to load `server\.env` |
| **SQL Server** | **2022+** | native `IS DISTINCT FROM`, used across the service layer |
| **Caddy** | 2.x | TLS certificates issued and renewed automatically |
| **NSSM** | 2.24+ | runs `node.exe` as a real service |
| Git | any | to pull updates |

```powershell
winget install OpenJS.NodeJS.LTS
winget install CaddyServer.Caddy
winget install NSSM.NSSM
winget install Git.Git
```

SQL Server itself is not a winget package — download the Developer or Standard
edition media from Microsoft and run an unattended install as a **named
instance** dedicated to this app (so it does not collide with any other SQL
Server workload on the same box):

```powershell
# from the extracted installer media, elevated
.\setup.exe /Q /ACTION=Install /FEATURES=SQLEngine `
  /INSTANCENAME=INVENTORY /INSTANCEID=INVENTORY `
  /SQLSVCACCOUNT="NT AUTHORITY\NETWORK SERVICE" `
  /SQLSYSADMINACCOUNTS=BUILTIN\Administrators `
  /SECURITYMODE=SQL /SAPWD='a-strong-sa-password' `
  /TCPENABLED=1 /NPENABLED=0 /BROWSERSVCSTARTUPTYPE=Automatic `
  /IACCEPTSQLSERVERLICENSETERMS /UPDATEENABLED=0
```

`/SECURITYMODE=SQL` enables Mixed Mode — needed because the app connects with
a SQL login (`app_api`), not Windows Authentication. `BROWSERSVCSTARTUPTYPE`
is what lets the app connect with the plain `host\INSTANCE` form (see
`DB_SERVER` below) without pinning a static TCP port.

### Hardware

Modest. This is one Node process and one SQL Server instance, and the schema
is small — `stock_movements`, the largest table, is roughly 150 bytes a row.

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

The alternative that needs no third party at all is `AUTH_MODE=local` — a
users table, password hashing and token issuing built into the API itself
(`server/src/routes/auth.routes.js`). Needs `AUTH_SECRET`, a long random
string, and nothing else.

Whichever backend is active, the frontend also enforces an idle-session
timeout (mouse/keyboard/touch/scroll inactivity — see `useIdleTimer` under
`client/src/hooks`): a warning modal after `VITE_IDLE_TIMEOUT_MINUTES`
(default 15), then an automatic sign-out `VITE_IDLE_WARNING_SECONDS` later
(default 60) if nobody clicks "stay logged in". Both are build-time frontend
variables — set them alongside `VITE_API_URL` in step 5 below if the defaults
don't fit; unset, the defaults apply.

---

## Setup

### 1. Database

```powershell
# as sa, or another sysadmin login
sqlcmd -S "127.0.0.1\INVENTORY" -U sa -i server\provision-mssql.sql
```

This creates the `inventory` database (with an Arabic-aware collation — spot
check it against real sample data before trusting it long-term, since changing
a database's collation later means rebuilding every affected index) and the
least-privilege `app_api` login the app connects as. It also grants
`db_ddladmin`: unlike a typical least-privilege app role, this one runs its own
migrations (`npm run migrate`), so it needs to create/alter tables, triggers
and functions — not just read and write rows.

### 2. Code

```powershell
git clone https://github.com/SuleimanHimam/Inventory.git C:\inventory
cd C:\inventory
npm run setup
```

### 3. Configure

```powershell
Copy-Item deploy\windows\env.production.example server\.env
notepad server\.env      # domain, DB_PASSWORD, SUPABASE_URL
```

### 4. Schema

```powershell
cd C:\inventory\server
npm run migrate
npm run doctor           # want: "can run migrations (db_ddladmin): yes"
```

There is no Row-Level-Security layer to verify here, unlike the Postgres
build — tenant isolation is application-level only (every service query
carries an explicit `org_id` predicate; see `server/src/db/index.js`'s file
header for why the RLS equivalent was dropped rather than ported).

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
| waits for the database | `DependOnService MSSQL$INVENTORY` |

### 8. Backups

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
             -Argument '-NoProfile -File C:\inventory\deploy\windows\backup.ps1'
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName 'Inventory backup' -Action $action `
  -Trigger $trigger -RunLevel Highest -User 'SYSTEM'
```

The task runs as SYSTEM, which authenticates to SQL Server via Windows
Authentication — no password stored anywhere for it. Grant it backup rights
once, as sa:

```sql
CREATE LOGIN [NT AUTHORITY\SYSTEM] FROM WINDOWS;
USE inventory;
CREATE USER [NT AUTHORITY\SYSTEM] FOR LOGIN [NT AUTHORITY\SYSTEM];
ALTER ROLE db_backupoperator ADD MEMBER [NT AUTHORITY\SYSTEM];
```

`BACKUP DATABASE` runs inside the SQL Server *service* process, so the backup
folder also needs to be writable by the SQL Server service account (`NT
AUTHORITY\NETWORK SERVICE` for a default install), not just by SYSTEM.

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

## Working on the code

The server is not the place to write features. It holds the live database, the
uploads and the backups; a half-finished migration or a broken build there is an
outage, not a failed test. Develop in a clone instead:

```powershell
git clone https://github.com/SuleimanHimam/Inventory.git C:\dev\Inventory
cd C:\dev\Inventory
npm run setup
Copy-Item server\.env.example server\.env    # DB_* pointing at a LOCAL instance
npm run migrate; npm run seed                # sample Arabic data
npm run dev                                  # client + server together
npm test
```

The one rule that protects the customer: the clone's `server\.env` never points
at the production SQL instance. A dev database, or `inventory_dev` on a separate
one.

Then one branch per change, reviewed as a pull request before it can reach
anyone:

```powershell
git switch -c feature/short-name
git commit -am "…"
git push -u origin feature/short-name        # open the PR on GitHub, merge to main
```

Two things to respect when a change touches data:

- A schema change is a **new** numbered file in `server/migrations-mssql/`, its
  batches separated by a line containing only `GO` — `server/src/db/migrate.js`
  splits on that. Never edit a migration that has already run on the server.
- Everything user-facing is Arabic and RTL; follow the strings already in
  `client/src/pages/`.

## Updating the server

In this order. The backup first is not ceremony — it is the only thing that
makes step 4 reversible.

```powershell
# 1. take a backup (the app's backup screen does the same thing)
D:\Inventory\deploy\windows\backup.ps1

# 2. the working tree has to be clean or the pull refuses
cd D:\Inventory
git status
git pull

# 3. dependencies and the frontend bundle
npm run setup
cd client; npm run build; cd ..

# 4. schema — this deployment sets SKIP_MIGRATIONS=1, so migrations do NOT
#    apply themselves at boot. Run them when the release carries one.
cd server; npm run migrate; npm run doctor; cd ..

# 5. restart, then read the payload
Restart-Service inventory-api
curl.exe http://127.0.0.1:4317/api/v1/health     # want "db":"ready"
```

`git pull` cannot touch the customer's data: `server\.env`, `data\uploads\`,
`backups\`, `logs\` and `secrets\` are all ignored, so Git neither tracks nor
overwrites them.

Rolling back: `git checkout <previous tag>`, rebuild the client, restart the
service. If the migration is what broke, restore the backup from step 1 with
`restore.ps1`.

## Backups from the app itself

There is a backup screen in the app now (**الإعدادات → النسخ الاحتياطي**,
manager only). It takes a real `BACKUP DATABASE` plus the product photos, lists
every set on disk, downloads one as a `.zip`, accepts one uploaded from
elsewhere, restores, and runs the whole thing on a daily schedule.

It writes into the same `D:\Inventory\backups` folder in the same layout as
`backup.ps1`, so the two see each other's work: a set taken from the screen is
pulled by `backup-pull.ps1` and restored by `restore.ps1` unchanged, and the
02:00 scheduled task's sets appear in the list. Only avoid scheduling both at
the same minute.

**One command to enable it.** The application's SQL login is deliberately
provisioned with no backup rights at all (see `provision-mssql.sql`), so the
screen starts disabled and says so. Once, from an **elevated** PowerShell on
the server, signed in as an account that is a sysadmin on the SQL instance
(normally whoever installed SQL Server):

```powershell
D:\Inventory\deploy\windows\enable-backup.ps1
```

That grants the backup right, grants the SQL Server **service account** write
access to the backup folder, writes and deletes a real test backup to prove the
whole path works, and restarts the API. After it, backup, download, import and
restore all work from any device that can reach the app — a phone included.

The folder permission is the step people skip and the one that bites: `BACKUP
DATABASE` executes inside the SQL Server service process, not inside the API,
so the folder must be writable by *that* account. The script reads which
account the service actually runs as rather than assuming `NETWORK SERVICE`,
because a domain install often runs it as a domain user and granting the wrong
one fails silently — every backup just keeps returning "Operating system error
5".

### The one judgement call in it

Backing up needs `db_backupoperator`, scoped to this database. Restoring has no
database-scoped role at all — SQL Server reserves it to sysadmin, dbcreator and
the database owner — so enabling the restore button means adding the app's login
to the **server-level** `dbcreator` role, which can drop any database on the
instance.

On an instance that hosts only this application, that reaches nothing `app_api`
could not already destroy through the app itself, and it is a fair trade. On a
shared instance it is not. The script checks: it lists any other application
databases it finds and **refuses to grant `dbcreator`** unless you pass
`-Force`.

```powershell
.\enable-backup.ps1 -BackupOnly    # backups from any device; restore stays here
.\enable-backup.ps1 -Force         # grant anyway on a shared instance
```

With `-BackupOnly` the restore button stays disabled and explains itself, and
`restore.ps1` below still restores any set the screen produced.

`grant-backup.sql` is the same grants as plain SQL, for SSMS or an instance
without PowerShell — but it cannot do the folder permission or the check above,
so prefer the script.

### Scheduling it

The screen's daily schedule is stored in `D:\Inventory\backups\backup-config.json`
— outside the database on purpose, so that restoring an old backup cannot
quietly reinstate that backup's idea of the schedule.

It answers "has today's backup been taken?" by looking at the newest set on
disk rather than by keeping a last-run record, which means a machine that was
switched off at 02:00 takes its backup when it is switched on instead of
skipping the day.

Set `نسخ إلى مكان آخر` and every backup is also copied there — another drive, a
USB disk, or a share on a second machine. **استعراض مجلدات الخادم** browses the
*server's* folders to pick one, and reports whether that folder is actually
writable by testing it, not by asking the filesystem (which lies about
directories on Windows). A network share has to be typed in — a share cannot be
discovered by browsing — but the same writable check confirms it once entered.

The field shows, as you type, whether the API can actually write there — the
server writes a probe file and deletes it, as itself.

### Giving the service access to the device

That copy runs as the **API's** service account. Not SQL Server's — that one
only matters for the backup folder — and not yours. A drive that opens fine in
Explorer under your login can still be unwritable for the service.

```powershell
D:\Inventory\deploy\windows\grant-destination.ps1 -Destination E:\InventoryBackups
```

It reads which account the service actually runs as, grants it access, then
proves it by writing a file there **as that account** (through a one-shot
scheduled task — the only honest way, since checking the ACL answers for you,
not for the service).

**A local device — USB stick, external disk, second drive — usually works
already.** The service is installed as `LocalSystem`, which has full rights to
everything on this machine. The one thing to watch is that a removable drive's
letter is assigned when it is plugged in: if `E:` comes back as `F:`, the copy
stops and only the schedule card on the backup screen will say so. The script
warns when the destination is removable; pin the letter in Disk Management.

**A folder on another computer is a different problem, and permissions on that
computer will not fix it.** `LocalSystem` has no network identity: on a machine
that is not domain-joined — this one is in a workgroup — it reaches other
computers as `ANONYMOUS LOGON`, which shares refuse. The script detects this and
refuses rather than granting something that cannot work. Two ways forward:

```powershell
# 1. Run the API as a real account that exists on BOTH machines, same password.
.\grant-destination.ps1 -Destination \\OFFICE-PC\Backups `
  -ServiceAccount OFFICE-PC\inventory -ServicePassword '...'

# 2. Or don't push at all — let the other machine pull. See below.
```

Option 2 is the better one where it is available, for the reason the next
section describes. Option 1 also needs "Log on as a service" granted to that
account (`secpol.msc` → Local Policies → User Rights Assignment), or the
service will not start.

## A second machine

A backup on the same disk as the data protects against a bad migration. It does
not protect against the disk dying, the machine being stolen, or ransomware —
all three take the backup with them.

The fix is a second machine that holds its own copy and can be brought up as the
system if the first one is gone.

### Which machine copies

The **standby pulls**; the primary does not push. That ordering matters:

- Pushing means the primary holds a credential that can write to the standby.
  Anything that compromises the primary reaches the backups too, and one event
  destroys both copies.
- Pulling means the standby holds the credential and the primary has no write
  path to the copies at all.

### On the primary, once

Share the backup folder read-only to the account the standby will use:

```powershell
# elevated, on the primary
New-SmbShare -Name 'InventoryBackups' -Path 'D:\Inventory\backups' `
  -ReadAccess 'standby-account'
```

In a workgroup (no domain), create the same local username and password on both
machines, and pass `-Credential` to the pull script.

### On the standby

Install the same prerequisites as the primary — SQL Server, Node, the repo —
but do **not** run the app. It sits idle holding copies until it is needed.

```powershell
# fetch tonight's backup now, to prove the path works
.\backup-pull.ps1 -PrimaryShare \\PRIMARY-NAME\InventoryBackups

# then register it for 04:00 — two hours after the primary's 02:00 backup,
# so the set is closed before it is copied
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
             -Argument '-NoProfile -ExecutionPolicy Bypass -File D:\Inventory\deploy\windows\backup-pull.ps1 -PrimaryShare \\PRIMARY-NAME\InventoryBackups'
$trigger = New-ScheduledTaskTrigger -Daily -At 4am
Register-ScheduledTask -TaskName 'Inventory backup pull' -Action $action `
  -Trigger $trigger -RunLevel Highest -User 'SYSTEM'
```

The script copies only what it does not already have, stages each set under a
`.partial` name so an interrupted copy is never mistaken for a complete one,
runs `RESTORE VERIFYONLY` on the newest set, prunes past `-KeepDays`, and exits
non-zero on failure so Task Scheduler's *Last Run Result* means something.

### Taking over

```powershell
Stop-Service inventory-api          # if it is running at all
.
estore.ps1                       # newest set; add -Force to replace a database
Start-Service inventory-api
```

`restore.ps1` restores the database and unpacks the photos, then re-points the
`app_api` **user** at this machine's `app_api` **login**.

That last step is the one to understand. A database carries its users; a server
carries its logins; a SID joins them. Restore onto a different machine and that
SID means nothing there — the login exists, the user exists, and the API still
fails with *Login failed for user 'app_api'*. Nothing in the restore output
mentions it. The script runs `ALTER USER … WITH LOGIN` to fix it, and warns you
if the login is missing entirely.

Two more things the standby needs before it can serve:

- `server\.env` pointing at its own SQL instance, carrying the **same
  `AUTH_SECRET`** as the primary — a different secret invalidates every
  signed-in session.
- The same migrations applied. `SKIP_MIGRATIONS=1` is set on this deployment,
  so they are applied by hand; a restored database already contains them.

### Test it before you need it

A backup nobody has restored is a hope. Once, on the standby:

```powershell
.
estore.ps1 -Database inventory_restore_test
```

It prints the row counts it restored — items, invoices, movements, users. If
those look like your data, the chain works end to end.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| `curl` to 127.0.0.1:4317 works, the domain does not | DNS, or ports 80/443 are not forwarded |
| Caddy will not get a certificate | port 80 blocked — ACME needs it |
| Service starts then stops | read `logs\api.err.log`; usually `.env` |
| `db: "error"` | `DB_SERVER`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, or the SQL Server service is not running |
| `Login failed for user 'app_api'` | wrong `DB_PASSWORD`, or `server\provision-mssql.sql` was never run |
| connection times out on a `host\INSTANCE` server name | the SQL Server Browser service (UDP 1434) is not running — `Start-Service SQLBrowser` |
