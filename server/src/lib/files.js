/**
 * Files (ملفات) — one customer's whole world, in a database of its own.
 *
 * A file has its own items, its own invoices, its own users and its own
 * backups. Nothing is shared between two files except the SQL Server instance
 * they happen to sit on, which is the point: a file can be backed up, copied
 * to another machine, restored or deleted without any of those actions
 * touching another file.
 *
 * ---------------------------------------------------------------------------
 * Why a database each, and why `org_id` survives it
 * ---------------------------------------------------------------------------
 * The schema already carried `org_id` on every table, from the hosted build
 * where one database served many organisations. That column stays exactly as
 * it is — each file's database simply holds one org row. Removing it would
 * mean rewriting every query in `services/` for no behaviour a user could
 * see, and the existing predicates keep working untouched. So the tenancy
 * model did not change; only where the boundary is drawn did.
 *
 * ---------------------------------------------------------------------------
 * Naming
 * ---------------------------------------------------------------------------
 * The manager names a file in Arabic. That name cannot be a SQL Server
 * identifier, so the database is `inv_<random hex>` and the display name lives
 * in `file_info` inside the database (see migration 008). Two files may
 * therefore share a name without colliding, which is the manager's business
 * and not this module's to forbid.
 *
 * The database configured as `DB_NAME` is always a file too, whatever it is
 * called — on an existing deployment it is the one that already has all the
 * data, and it must appear in the picker like any other.
 *
 * ---------------------------------------------------------------------------
 * Permissions
 * ---------------------------------------------------------------------------
 * `app_api` is provisioned as db_datareader + db_datawriter + db_ddladmin on
 * one database and nothing else. Creating and dropping databases needs the
 * server-level `dbcreator` role, which can drop *any* database on the
 * instance. As with restore (see lib/backup.js), the app never grants itself
 * that: `capabilities()` asks SQL Server what it may actually do, the UI
 * explains a missing button instead of failing on click, and the operator runs
 * deploy/windows/grant-files.sql if they want the feature.
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  DB_NAME, DB_USER, configError, newId, bindFile, bindOrg, runWithoutOrg,
  get, run, all, forgetPool, ensureOrgDefaults, currentDb,
} from '../db/index.js';
import { adminQuery, sqlDetail, isPermissionError } from './adminSql.js';
import { migrate } from '../db/migrate.js';
import { hashPassword } from './password.js';
import { UPLOADS_DIR, STORAGE_DRIVER } from './storage.js';
import { MANAGER } from './roles.js';
import { autoConfigureAccounting } from '../services/accounts.service.js';
import { ensureDefaultParty } from '../services/parties.service.js';
import { AppError, badRequest, conflict, notFound, unavailable } from './errors.js';

/** Every database this app creates is prefixed, so it can find its own again. */
const PREFIX = 'inv_';

/**
 * A SQL Server identifier safe to interpolate. Database names reach T-SQL as
 * identifiers, which cannot be bind parameters — so every one of them is
 * checked against this before it is ever concatenated into a statement, and
 * the only names that get that far come from `sys.databases` or from
 * `newDbName()` below.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$#]{0,127}$/;

function quote(identifier, what = 'قاعدة البيانات') {
  if (!IDENTIFIER.test(identifier)) {
    throw new AppError(500, `اسم ${what} غير صالح: ${identifier}`, 'BAD_IDENTIFIER');
  }
  return `[${identifier}]`;
}

/** The same name as a T-SQL string literal, for `DB_ID('…')` and friends. */
function literal(identifier, what = 'قاعدة البيانات') {
  quote(identifier, what);
  return `'${identifier}'`;
}

/** A fresh database name. Random, not sequential: a deleted file never has its name reused. */
const newDbName = () => PREFIX + newId().replace(/-/g, '').slice(0, 16);

/** True for a database this app owns — the configured one, or one it created. */
export const isFileDb = (name) =>
  name === DB_NAME || (name.startsWith(PREFIX) && IDENTIFIER.test(name));

/** The display name a manager may give a file. */
export function cleanName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw badRequest('اسم الملف مطلوب', 'FILE_NAME_REQUIRED');
  if (name.length > 200) throw badRequest('اسم الملف طويل جداً', 'FILE_NAME_TOO_LONG');
  return name;
}

/* ------------------------------------------------------------ capabilities */
/**
 * What this SQL login may actually do with databases, asked of the server
 * rather than assumed — same contract as `backup.capabilities()`, and for the
 * same reason: a button that cannot work should say why before it is pressed.
 */
export async function capabilities() {
  if (configError) {
    return { can_create: false, can_delete: false, reason: configError.message };
  }
  try {
    const { recordset } = await adminQuery(`
      SELECT IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
             IS_SRVROLEMEMBER('dbcreator') AS dbcreator`);
    const row = recordset[0] ?? {};
    const allowed = !!(row.sysadmin || row.dbcreator);
    return {
      can_create: allowed,
      can_delete: allowed,
      reason: allowed ? null
        : 'إنشاء الملفات وحذفها يحتاج صلاحية dbcreator على الخادم — '
          + 'شغّل deploy/windows/grant-files.sql ثم أعد تشغيل الخدمة',
    };
  } catch (err) {
    return { can_create: false, can_delete: false, reason: sqlDetail(err) };
  }
}

async function assertAllowed() {
  const caps = await capabilities();
  if (!caps.can_create) {
    throw unavailable(caps.reason ?? 'إدارة الملفات غير متاحة على هذا الخادم', 'FILES_NOT_PERMITTED');
  }
}

/* ------------------------------------------------------------------ listing */
/**
 * Every file on this instance, by name.
 *
 * Read across databases from the master connection with three-part names
 * rather than by opening a pool per file: the login screen asks for this
 * before anyone has authenticated, and connecting to every database on the
 * instance to answer an unauthenticated request would be both slow and a gift
 * to anyone probing it.
 *
 * A database matching the prefix but carrying no `file_info` table is skipped
 * rather than reported broken — it may be a restore in progress, or somebody
 * else's database that happens to match. The same silence covers one this
 * login cannot see into, which is the correct answer to give a stranger.
 */
export async function listFiles() {
  if (configError) return [];
  const { recordset } = await adminQuery(
    `SELECT name FROM sys.databases
      WHERE state_desc = 'ONLINE' AND (name = @current OR name LIKE @pattern)`,
    { current: DB_NAME, pattern: `${PREFIX}%` },
  );

  const names = recordset.map((r) => r.name).filter(isFileDb);
  if (!names.length) return [];

  // One batch, one result set per file that actually has the table.
  const batch = names.map((db) => {
    // Both helpers validate `db` as an identifier before returning anything,
    // so the three-part name below cannot carry more than a database name —
    // and it came from `sys.databases` in the first place.
    const quoted = quote(db);
    const asString = literal(db);
    return `IF OBJECT_ID('${db}.dbo.file_info') IS NOT NULL `
      + `SELECT ${asString} AS id, name, created_at FROM ${quoted}.dbo.file_info;`;
  }).join('\n');

  const { recordsets } = await adminQuery(batch);
  return (recordsets ?? [])
    .flat()
    .map((r) => ({ id: r.id, name: r.name, created_at: r.created_at }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/** One file, or 404. */
export async function fileOr404(id) {
  const found = (await listFiles()).find((f) => f.id === id);
  if (!found) throw notFound('هذا الملف غير موجود', 'FILE_NOT_FOUND');
  return found;
}

/**
 * The photos one file's rows reference.
 *
 * Files share the uploads folder on disk — `items.image_file` is a bare
 * filename and `/uploads/<name>` is served without authentication, because an
 * `<img>` tag cannot send a bearer token. Subfoldering would change every
 * image URL and move the photos an existing deployment already has, for no
 * gain: the names are UUIDs, so two files cannot collide.
 *
 * What does have to be per-file is *which* photos belong to a file, and this
 * is that question. Backing up asks it (see lib/backup.js) and so does
 * deleting, which must take its own images with it and leave every other
 * file's alone.
 */
async function ownImages(dbName) {
  return bindFile(dbName, () => runWithoutOrg(() => all(
    "SELECT DISTINCT image_file FROM items WHERE image_file IS NOT NULL AND image_file <> ''", {},
  ))).catch(() => []);
}

/* ----------------------------------------------------------------- creating */
/**
 * Give the API's own login access to a database it just created.
 *
 * A `dbcreator` login owns what it creates and is already dbo there, so this
 * is usually a no-op — but it is not when the instance is reached through a
 * sysadmin login, or when the API is later reconfigured to connect as someone
 * narrower. Written so that either way the database ends up reachable by the
 * account in `DB_USER`, and silent when it is already the owner.
 */
async function grantAppAccess(dbName) {
  const db = quote(dbName);
  const user = quote(DB_USER, 'المستخدم');
  const userLiteral = literal(DB_USER, 'المستخدم');
  await adminQuery(`
    USE ${db};
    /*
     * Check by SID, not by name. When app_api is dbcreator it OWNS the
     * database it just made, which maps its login into that database as dbo --
     * a principal whose name is 'dbo', not 'app_api'. A name check
     * (DATABASE_PRINCIPAL_ID('app_api')) sees no such principal, decides the
     * user is missing, and runs CREATE USER -- which SQL Server refuses with
     * "the login already has an account under a different user name", because
     * the login's SID is already mapped to dbo. Matching on SUSER_SID finds
     * that dbo mapping and correctly does nothing: dbo already has every right
     * this block would grant.
     */
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE sid = SUSER_SID(${userLiteral}))
       AND EXISTS (SELECT 1 FROM sys.server_principals WHERE name = ${userLiteral})
    BEGIN
      CREATE USER ${user} FOR LOGIN ${user};
      ALTER ROLE db_datareader ADD MEMBER ${user};
      ALTER ROLE db_datawriter ADD MEMBER ${user};
      ALTER ROLE db_ddladmin   ADD MEMBER ${user};
    END`);
}

/** Seed the settings a new file needs, including the name on its documents. */
async function seedOrg(orgId, displayName) {
  await bindOrg(orgId, async () => {
    await ensureOrgDefaults();
    await run(
      "UPDATE settings SET value = @value WHERE org_id = @org AND [key] = 'company_name'",
      { org: orgId, value: displayName },
    );
    // A new file is ready to keep books on day one: seed the chart, map the
    // well-known accounts into settings, and create the walk-in cash parties.
    await autoConfigureAccounting();
    await ensureDefaultParty('customers');
    await ensureDefaultParty('suppliers');
  });
}

/**
 * Create a file: a database, its schema, and its first manager account.
 *
 * The manager creating it gets **no** account in the new file — it is a
 * separate world with separate people, and the credentials set here are handed
 * over rather than kept. That is why `username`/`password` are arguments and
 * not copied from the caller's own account.
 *
 * Every failure drops the half-built database before it rethrows. A database
 * that exists but has no schema would appear in nobody's list (no
 * `file_info`), which is the worst of both outcomes: invisible in the UI and
 * still occupying its name.
 */
export async function createFile({ name, username, password }) {
  await assertAllowed();
  const displayName = cleanName(name);
  const login = String(username ?? '').trim().toLowerCase();
  if (!login) throw badRequest('اسم المستخدم للمدير مطلوب', 'USERNAME_REQUIRED');

  const dbName = newDbName();
  const db = quote(dbName);

  try {
    // Arabic_CI_AS matches what provision-mssql.sql gives the first database:
    // it decides how Arabic names sort and compare, and a file that sorted
    // differently from its neighbours would be a puzzle nobody could explain.
    await adminQuery(`CREATE DATABASE ${db} COLLATE Arabic_CI_AS`);
  } catch (err) {
    if (isPermissionError(err)) {
      throw unavailable(
        'الخادم رفض إنشاء قاعدة بيانات جديدة — صلاحية dbcreator غير ممنوحة',
        'FILES_NOT_PERMITTED',
      );
    }
    throw new AppError(500, `تعذّر إنشاء الملف: ${sqlDetail(err)}`, 'FILE_CREATE_FAILED');
  }

  try {
    await grantAppAccess(dbName);
    await migrate({ database: dbName, log: () => {} });

    await bindFile(dbName, () => runWithoutOrg(async () => {
      // `file_info` is seeded by migration 008 from settings.company_name,
      // which a brand-new database does not have — so it names itself here.
      await run('UPDATE file_info SET name = @name WHERE id = 1', { name: displayName });

      const org = await get('INSERT INTO orgs (name) OUTPUT INSERTED.id VALUES (@name)',
        { name: displayName });
      const userId = newId();
      await run(
        'INSERT INTO users (id, email, password_hash) VALUES (@id, @email, @hash)',
        { id: userId, email: login, hash: await hashPassword(password ?? '') },
      );
      await run(
        `INSERT INTO memberships (id, org_id, user_id, email, role)
         VALUES (@id, @org, @user, @email, @role)`,
        { id: newId(), org: org.id, user: userId, email: login, role: MANAGER },
      );
      await seedOrg(org.id, displayName);
    }));

  } catch (err) {
    // Nothing usable was built, so leave nothing behind.
    await forgetPool(dbName);
    await adminQuery(`
      IF DB_ID(${literal(dbName)}) IS NOT NULL
      BEGIN
        ALTER DATABASE ${db} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE ${db};
      END`).catch(() => {});
    if (err instanceof AppError) throw err;
    throw new AppError(500, `تعذّر تجهيز الملف: ${sqlDetail(err)}`, 'FILE_CREATE_FAILED');
  }

  return { id: dbName, name: displayName };
}

/* ----------------------------------------------------------------- deleting */
/**
 * Drop a file and everything in it.
 *
 * Three guards, because this is the one irreversible action in the app:
 *
 *  1. The caller may not delete the file they are signed into. Deleting the
 *     ground you are standing on leaves a session holding a token for a
 *     database that no longer exists, and every later request failing in a way
 *     that looks like a server fault rather than a thing they did.
 *  2. The last file cannot be deleted — an instance with no files has no way
 *     back in through the UI at all.
 *  3. The caller's own password, checked by the route before this is called.
 *
 * The backup is taken by the route rather than here, so that the order —
 * always back up, then drop — is visible at the place a reader goes looking
 * for it.
 */
export async function deleteFile(dbName) {
  await assertAllowed();
  if (dbName === currentDb()) {
    throw conflict('لا يمكن حذف الملف الذي تعمل بداخله الآن', 'FILE_IN_USE');
  }
  await fileOr404(dbName);
  const remaining = (await listFiles()).filter((f) => f.id !== dbName);
  if (!remaining.length) {
    throw conflict('لا يمكن حذف آخر ملف', 'LAST_FILE');
  }

  // Read the photo list while the database still exists — afterwards there is
  // nothing left to ask, and the files would stay on disk forever.
  const images = await ownImages(dbName);

  const db = quote(dbName);
  await forgetPool(dbName);
  try {
    // SINGLE_USER evicts anyone still connected — another operator with the
    // file open in SSMS, or a session of this API that has not timed out yet.
    // Without it, DROP fails with "database is currently in use" and the
    // manager is told nothing they can act on.
    await adminQuery(`
      ALTER DATABASE ${db} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE ${db};`);
  } catch (err) {
    // Put it back in multi-user mode: a failed drop must not leave the file
    // locked to a single connection for everybody else.
    await adminQuery(`IF DB_ID(${literal(dbName)}) IS NOT NULL ALTER DATABASE ${db} SET MULTI_USER`)
      .catch(() => {});
    if (isPermissionError(err)) {
      throw unavailable('الخادم رفض حذف قاعدة البيانات — صلاحية dbcreator غير ممنوحة',
        'FILES_NOT_PERMITTED');
    }
    throw new AppError(500, `تعذّر حذف الملف: ${sqlDetail(err)}`, 'FILE_DELETE_FAILED');
  }

  // The photos go with it — this file's own, named one by one, never the
  // folder, which other files are still using. Best-effort: a database that is
  // gone must not be reported as still there because a file could not be
  // unlinked.
  if (STORAGE_DRIVER === 'local') {
    await Promise.all(images.map(({ image_file: name }) => (
      fsp.rm(path.join(UPLOADS_DIR, name), { force: true }).catch(() => {})
    )));
  }
  return { id: dbName, images_removed: images.length };
}

/** Rename a file — the one property of it a manager can change afterwards. */
export async function renameFile(dbName, name) {
  const displayName = cleanName(name);
  await fileOr404(dbName);
  await bindFile(dbName, () => runWithoutOrg(async () => {
    await run('UPDATE file_info SET name = @name WHERE id = 1', { name: displayName });
    const org = await get('SELECT TOP 1 id FROM orgs ORDER BY created_at', {});
    if (org) {
      await run('UPDATE orgs SET name = @name WHERE id = @id', { name: displayName, id: org.id });
    }
  }));
  return { id: dbName, name: displayName };
}
