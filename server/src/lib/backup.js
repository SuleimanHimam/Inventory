/**
 * Backup, export, import and restore — the SQL Server half.
 *
 * A "set" here is exactly what `deploy/windows/backup.ps1` has always written:
 * one folder per backup, named `2026-08-16_0200`, containing
 *
 *   database.bak   the whole database, compressed, with a page checksum
 *   uploads.zip    the product photos
 *   manifest.json  what this set is (added by this module; the PowerShell
 *                  script predates it, and its sets read fine without one)
 *
 * The two files have to travel together. `items.image_file` holds a bare
 * filename and the bytes live on disk, so a database restored without its
 * uploads is a catalogue of broken images, and uploads without the database
 * are a pile of UUIDs nobody can identify.
 *
 * Sharing the folder layout with the PowerShell scripts is the point: a set
 * made from the UI is pulled by `backup-pull.ps1` and restored by
 * `restore.ps1` unchanged, and a set made at 02:00 by the scheduled task shows
 * up in the UI. Neither half is a separate world with its own format.
 *
 * ---------------------------------------------------------------------------
 * Why this needs its own connection pool
 * ---------------------------------------------------------------------------
 * A RESTORE cannot run on a connection to the database being restored, and it
 * cannot run while any other connection is open to it either. So everything
 * here goes through `adminPool()` — same server, same credentials, bound to
 * `master` — while the application pool is closed and latched shut by
 * `beginMaintenance()`. The HTTP request survives because it is being served
 * from the master connection, which the restore never touches.
 *
 * ---------------------------------------------------------------------------
 * Why the app cannot simply be given these rights
 * ---------------------------------------------------------------------------
 * `app_api` is provisioned as db_datareader + db_datawriter + db_ddladmin
 * (provision-mssql.sql). That covers everything the application does and
 * nothing else — it can neither BACKUP nor RESTORE, by design.
 *
 * Rather than quietly widening that, `capabilities()` asks SQL Server what
 * this login may actually do and the API reports it. Backing up needs
 * db_backupoperator, which is narrow and safe. Restoring needs `dbcreator`,
 * which is a *server*-level role: it can drop any database on the instance,
 * not just this one. That is a real cost, so the app never grants it to
 * itself — the operator runs `deploy/windows/grant-backup.sql` if they want
 * restore-from-the-UI, and the screen says plainly what it buys and what it
 * costs until they do.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import archiver from 'archiver';
import unzipper from 'unzipper';
import {
  DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD, DB_OPTIONS, configError,
  beginMaintenance, endMaintenance, get, all as allRows, runWithoutOrg,
} from '../db/index.js';
import { UPLOADS_DIR, STORAGE_DRIVER } from './storage.js';
import { badRequest, conflict, notFound, unavailable, AppError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where sets live. The same default as `backup.ps1` when the app is installed
 * at D:\Inventory, so the scheduled task and the UI share one folder rather
 * than each keeping a private pile nobody reconciles.
 */
export const BACKUP_DIR = process.env.BACKUP_DIR
  ?? path.resolve(__dirname, '../../../backups');

/** Staging for an upload before it has been proven to be a real backup. */
const INCOMING_DIR = path.join(BACKUP_DIR, '.incoming');

export const MAX_UPLOAD_MB = Number(process.env.BACKUP_MAX_UPLOAD_MB ?? 2048);

/** A set folder name. Anything else in BACKUP_DIR (logs, notes) is left alone. */
const SET_NAME = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

/** Only these three files are ever read out of an uploaded archive — see `unpackZip`. */
const SET_FILES = new Set(['database.bak', 'uploads.zip', 'manifest.json']);

/**
 * `DB_NAME` reaches T-SQL as an identifier, which cannot be a bind parameter.
 * Every other value below is parameterised; this one is validated instead.
 */
function dbIdentifier() {
  if (configError) throw configError;
  if (!/^[A-Za-z_][A-Za-z0-9_$#]{0,127}$/.test(DB_NAME)) {
    throw new AppError(500, `اسم قاعدة البيانات غير صالح: ${DB_NAME}`, 'BAD_DB_NAME');
  }
  return `[${DB_NAME}]`;
}

/* ------------------------------------------------------------- admin pool */
let admin = null;
let adminPromise = null;

/**
 * A second pool, bound to `master`.
 *
 * `requestTimeout: 0` because a BACKUP or RESTORE is measured in minutes on a
 * large database and the application pool's 20-second ceiling would abort it
 * halfway. `max: 2` because only one maintenance operation runs at a time and
 * an idle pool here should cost nothing.
 */
async function adminPool() {
  if (configError) throw configError;
  if (!adminPromise) {
    admin = new sql.ConnectionPool({
      server: DB_SERVER,
      database: 'master',
      user: DB_USER,
      password: DB_PASSWORD,
      options: DB_OPTIONS,
      pool: { max: 2, idleTimeoutMillis: 30_000 },
      requestTimeout: 0,
      connectionTimeout: 15_000,
    });
    admin.on('error', (err) => console.error('[backup] admin pool error', err));
    adminPromise = admin.connect().catch((err) => {
      adminPromise = null;
      throw err;
    });
  }
  await adminPromise;
  return admin;
}

/** Run one statement on the master connection. `params` are bound, never interpolated. */
async function adminQuery(text, params = {}) {
  const pool = await adminPool();
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) request.input(name, value);
  return request.query(text);
}

/**
 * The message a failed RESTORE actually deserves.
 *
 * SQL Server reports these as a chain and the driver surfaces only the last
 * link, which is invariably the useless one: a `RESTORE HEADERONLY` refused
 * for lack of permission arrives as "RESTORE HEADERONLY is terminating
 * abnormally", with the real reason — "CREATE DATABASE permission denied in
 * database 'master'" — sitting in `precedingErrors` where nobody looks. Every
 * error surfaced from this module goes through here.
 */
function sqlDetail(err) {
  const chain = err?.precedingErrors ?? [];
  const causes = chain.map((e) => String(e.message).split('\n')[0]).filter(Boolean);
  const last = String(err?.message ?? '').split('\n')[0];
  return causes.length ? `${causes.join(' — ')} (${last})` : last;
}

/** True when SQL Server refused for lack of permission rather than a bad file. */
function isPermissionError(err) {
  const numbers = [err?.number, ...(err?.precedingErrors ?? []).map((e) => e.number)];
  // 262 CREATE DATABASE permission denied, 229/230 generic permission denied.
  return numbers.some((n) => n === 262 || n === 229 || n === 230)
    || /permission (was )?denied/i.test(sqlDetail(err));
}

export const closeAdminPool = () => (admin ? admin.close().catch(() => {}) : Promise.resolve());

/* ----------------------------------------------------------- capabilities */
/**
 * What this SQL login is actually permitted to do, asked of the server rather
 * than assumed. Used by the UI to explain a missing button instead of letting
 * it fail on click.
 */
export async function capabilities() {
  if (configError) {
    return {
      can_backup: false, can_restore: false, sysadmin: false,
      reason: configError.message,
    };
  }

  let row;
  try {
    // IS_ROLEMEMBER is evaluated in the current database, so this one runs on
    // the application pool (bound to the inventory database), not on master.
    row = await runWithoutOrg(() => get(`
      SELECT IS_ROLEMEMBER('db_backupoperator') AS backup_role,
             IS_ROLEMEMBER('db_owner')          AS db_owner,
             IS_SRVROLEMEMBER('dbcreator')      AS dbcreator,
             IS_SRVROLEMEMBER('sysadmin')       AS sysadmin`));
  } catch (err) {
    return {
      can_backup: false, can_restore: false, sysadmin: false,
      reason: `تعذّر الاتصال بقاعدة البيانات: ${err.message}`,
    };
  }

  const sysadmin = row?.sysadmin === 1;
  // RESTORE over an existing database is reserved to sysadmin, dbcreator and
  // the database owner. db_owner *membership* is not the same as being dbo, so
  // it deliberately does not count here — claiming the button works and having
  // it fail mid-restore is the worst of the available outcomes.
  const canRestore = sysadmin || row?.dbcreator === 1;

  return {
    // db_owner implies BACKUP on its own database; db_backupoperator is the
    // least-privilege way to get there and is what the grant script adds.
    can_backup: sysadmin || row?.backup_role === 1 || row?.db_owner === 1,
    can_restore: canRestore,
    /*
     * Reading a backup file's header — RESTORE HEADERONLY / FILELISTONLY /
     * VERIFYONLY — needs CREATE DATABASE permission, *not* db_backupoperator.
     * Confirmed here against this instance: as app_api all three fail with
     * error 262, "CREATE DATABASE permission denied in database 'master'".
     *
     * So it lands on the same side as restore, and an upload cannot be
     * verified without it. Import still works (see `importUpload`) — the set
     * is filed as unverified, and `restoreSet` verifies before it touches
     * anything regardless, so nothing unchecked can reach the database.
     */
    can_verify: canRestore,
    sysadmin,
    login: DB_USER,
    database: DB_NAME,
    // Photos are only in a set when they are on this disk to begin with.
    includes_uploads: STORAGE_DRIVER === 'local',
    reason: null,
  };
}

async function requireBackupRights() {
  const caps = await capabilities();
  if (!caps.can_backup) {
    throw unavailable(
      `حساب SQL المستخدم (${DB_USER}) لا يملك صلاحية النسخ الاحتياطي. `
      + 'شغّل deploy/windows/grant-backup.sql مرة واحدة كمسؤول على الخادم.',
      'NO_BACKUP_RIGHTS', { capabilities: caps },
    );
  }
  return caps;
}

/* ------------------------------------------------------------------ sets */
const setPath = (name) => path.join(BACKUP_DIR, name);

/** Reject anything that is not a bare set name — no traversal, no absolute paths. */
function validSetName(name) {
  if (!SET_NAME.test(String(name ?? ''))) {
    throw badRequest('اسم النسخة غير صالح', 'BAD_SET_NAME');
  }
  return name;
}

/** `yyyy-MM-dd_HHmm` in local time — the name `backup.ps1` has always used. */
function stampFor(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `_${p(date.getHours())}${p(date.getMinutes())}`;
}

/** The inverse: a set's name back into the local moment it was taken. */
function timeFromName(name) {
  const [date, time] = name.split('_');
  return new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00`);
}

async function dirSize(dir) {
  let total = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.isFile()) total += (await fsp.stat(path.join(dir, entry.name))).size;
  }
  return total;
}

async function readManifest(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    // Sets written by backup.ps1 have no manifest, and that is not an error.
    return null;
  }
}

/** Every set on disk, newest first. */
export async function listSets() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
  const sets = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !SET_NAME.test(entry.name)) continue;
    const dir = setPath(entry.name);
    const files = await fsp.readdir(dir).catch(() => []);
    // A folder with no database.bak is a set still being written — by the
    // scheduled task, or by a copy in flight. Listing it as restorable is how
    // someone ends up restoring half a file.
    if (!files.includes('database.bak')) continue;

    const manifest = await readManifest(dir);
    sets.push({
      name: entry.name,
      /*
       * From the manifest, else from the folder name — never from the file
       * modification time. mtime is when these bytes arrived on *this* disk,
       * which is a different thing entirely the moment a set is copied: pull
       * last month's sets onto a standby and every one of them would claim to
       * have been taken the afternoon of the copy. The name is the timestamp
       * the backup was actually taken, and it survives being moved.
       */
      created_at: manifest?.created_at ?? timeFromName(entry.name).toISOString(),
      size: await dirSize(dir),
      has_uploads: files.includes('uploads.zip'),
      // 'auto' | 'manual' | 'imported' | 'external' — the last meaning a set
      // this API did not write (the 02:00 scheduled task, or a pull).
      source: manifest?.source ?? 'external',
      database: manifest?.database ?? null,
      counts: manifest?.counts ?? null,
      // Absent on anything this API did not import, which is correct: only an
      // import has a verification step that could have been skipped.
      ...(manifest?.verified === false
        ? { verified: false, unverified_reason: manifest.unverified_reason ?? null }
        : {}),
    });
  }

  return sets.sort((a, b) => b.name.localeCompare(a.name));
}

export async function getSet(name) {
  validSetName(name);
  const sets = await listSets();
  const found = sets.find((s) => s.name === name);
  if (!found) throw notFound('النسخة الاحتياطية غير موجودة', 'BACKUP_NOT_FOUND');
  return found;
}

/** Row counts, recorded in the manifest so a set can be identified before restoring it. */
async function currentCounts() {
  try {
    return await runWithoutOrg(() => get(`
      SELECT (SELECT COUNT(*) FROM items)           AS items,
             (SELECT COUNT(*) FROM invoices)        AS invoices,
             (SELECT COUNT(*) FROM stock_movements) AS movements,
             (SELECT COUNT(*) FROM users)           AS users`));
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- create */
/**
 * Take a backup now.
 *
 * `COMPRESSION` roughly halves the file; `CHECKSUM` makes a corrupt backup
 * fail at RESTORE VERIFYONLY instead of at 3am on the day it is needed.
 *
 * BACKUP DATABASE executes *inside* the SQL Server service process, not in
 * this one, so BACKUP_DIR has to be writable by the service account — not
 * merely by whoever the API runs as. That is the usual first failure, and the
 * error below names it rather than passing on "Operating system error 5".
 */
export async function createSet({ source = 'manual' } = {}) {
  await requireBackupRights();
  await fsp.mkdir(BACKUP_DIR, { recursive: true });

  const name = stampFor(new Date());
  const dir = setPath(name);
  // Two backups inside the same minute land on the same name. Replacing is the
  // honest outcome — the alternative is a name that no longer matches the
  // pattern `backup-pull.ps1` and `restore.ps1` parse.
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });

  const counts = await currentCounts();
  const bak = path.join(dir, 'database.bak');

  try {
    await adminQuery(
      `BACKUP DATABASE ${dbIdentifier()} TO DISK = @path WITH COMPRESSION, CHECKSUM, INIT, FORMAT;`,
      { path: bak },
    );
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    const detail = sqlDetail(err);
    // The usual first failure, and the one whose raw text explains nothing.
    if (/operating system error 5|Access is denied/i.test(detail)) {
      throw new AppError(500,
        `SQL Server لا يستطيع الكتابة في ${BACKUP_DIR}. النسخ تُكتب بحساب خدمة SQL Server `
        + '(عادةً NT AUTHORITY\\NETWORK SERVICE)، فامنح ذلك الحساب صلاحية الكتابة على المجلد.',
        'BACKUP_DIR_NOT_WRITABLE', { detail });
    }
    throw new AppError(500, `فشل النسخ الاحتياطي: ${detail}`, 'BACKUP_FAILED');
  }

  if (!fs.existsSync(bak)) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw new AppError(500,
      'انتهى أمر النسخ دون إنتاج ملف — راجع سجل أخطاء SQL Server.', 'BACKUP_NO_FILE');
  }

  if (STORAGE_DRIVER === 'local' && fs.existsSync(UPLOADS_DIR)) {
    await zipFolder(UPLOADS_DIR, path.join(dir, 'uploads.zip'));
  }

  const manifest = {
    created_at: new Date().toISOString(),
    source,
    database: DB_NAME,
    server: DB_SERVER,
    app_version: '6.0.0',
    includes_uploads: STORAGE_DRIVER === 'local',
    counts,
  };
  await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return {
    name,
    created_at: manifest.created_at,
    size: await dirSize(dir),
    has_uploads: fs.existsSync(path.join(dir, 'uploads.zip')),
    source,
    database: DB_NAME,
    counts,
  };
}

/* ------------------------------------------------------------------- zip */
/** Zip a folder's contents (not the folder itself), resolving when it is on disk. */
function zipFolder(folder, destination) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destination);
    const zip = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    out.on('error', reject);
    zip.on('error', reject);
    zip.pipe(out);
    zip.directory(folder, false);
    zip.finalize();
  });
}

/**
 * Stream a set to the client as one `.zip` — the "export to another device"
 * half of this feature.
 *
 * Streamed rather than assembled in memory: a set is tens to hundreds of
 * megabytes, and buffering one would take the API process down long before it
 * took the download anywhere.
 */
export async function streamSet(name, res) {
  const set = await getSet(name);
  const filename = `inventory-backup-${set.name}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

  const zip = archiver('zip', { zlib: { level: 0 } }); // .bak is already compressed
  zip.on('error', (err) => {
    console.error('[backup] download failed', err);
    res.destroy(err);
  });
  zip.pipe(res);
  zip.directory(setPath(set.name), false);
  await zip.finalize();
}

/* ---------------------------------------------------------------- import */
/**
 * Pull the three known files out of an uploaded archive.
 *
 * Only `SET_FILES` are extracted, and each is written to `basename(entry)`, so
 * a crafted archive containing `..\..\Windows\System32\…` writes nothing — the
 * classic zip-slip, and the reason this does not just call an extract-all.
 */
async function unpackZip(zipPath, destination) {
  const directory = await unzipper.Open.file(zipPath);
  let extracted = 0;

  for (const entry of directory.files) {
    if (entry.type !== 'File') continue;
    const base = path.basename(entry.path);
    if (!SET_FILES.has(base)) continue;
    await fsp.writeFile(path.join(destination, base), await entry.buffer());
    extracted += 1;
  }
  return extracted;
}

/**
 * Is this a SQL Server backup at all?
 *
 * Every `.bak` this engine writes opens with the eight ASCII bytes `MSSQLBAK`
 * — checked against the sets on this machine. Costs one 8-byte read and,
 * crucially, needs no SQL permission whatsoever, which matters because the
 * proper check (`RESTORE VERIFYONLY`) usually cannot run — see `capabilities`.
 *
 * It proves nothing about integrity; a truncated or corrupted backup still has
 * a good first eight bytes. What it catches is the mistake people actually
 * make: uploading the wrong file. Without it a 2 KB text file renamed `.bak`
 * is filed as a backup and sits in the list looking restorable.
 */
async function looksLikeBackup(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, 8, 0);
    return bytesRead === 8 && buffer.toString('latin1') === 'MSSQLBAK';
  } finally {
    await handle.close();
  }
}

/**
 * Ask the file what it is, and whether it is intact.
 *
 * Returns `{ header, verified }`, or `{ verified: false }` when this login is
 * not permitted to look — which is the common case, since both statements need
 * CREATE DATABASE permission rather than the backup role (see `capabilities`).
 * Throws only when the file itself is the problem.
 */
async function inspectBackup(bak) {
  try {
    const result = await adminQuery('RESTORE HEADERONLY FROM DISK = @path;', { path: bak });
    const header = result.recordset?.[0];
    if (!header) throw badRequest('الملف ليس نسخة احتياطية صالحة', 'NOT_A_BACKUP');
    await adminQuery('RESTORE VERIFYONLY FROM DISK = @path;', { path: bak });
    return { header, verified: true, unverified_reason: null };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isPermissionError(err)) {
      // Not a verdict on the file — we were not allowed to form one.
      return {
        header: null,
        verified: false,
        unverified_reason:
          'حساب SQL لا يملك صلاحية فحص ملفات النسخ (تحتاج CREATE DATABASE). '
          + 'الملف محفوظ كما هو، وسيُفحص قبل أي استعادة.',
      };
    }
    throw badRequest(
      `الملف ليس نسخة احتياطية صالحة أو أنه تالف: ${sqlDetail(err)}`, 'BACKUP_INVALID');
  }
}

/**
 * Accept a backup taken elsewhere: the other half of "export", and how a
 * second machine's set gets onto this one.
 *
 * Where permission allows, the file is proven before it is filed — an
 * unreadable file that sits in the list looking exactly like a good one until
 * the day it is needed is the whole failure this feature exists to prevent.
 * Where it does not, the set is filed and flagged rather than refused: the
 * operator asked for the file to be here, `restoreSet` verifies before it
 * touches anything regardless, and `restore.ps1` on the server verifies too.
 * So nothing unchecked can reach the database either way.
 */
export async function importUpload(uploadPath, originalName) {
  await fsp.mkdir(INCOMING_DIR, { recursive: true });

  const staging = path.join(INCOMING_DIR, `stage-${Date.now()}`);
  await fsp.mkdir(staging, { recursive: true });

  const cleanup = async () => {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(uploadPath, { force: true }).catch(() => {});
  };

  try {
    if (/\.zip$/i.test(originalName)) {
      const extracted = await unpackZip(uploadPath, staging);
      if (!extracted) {
        throw badRequest(
          'لم يُعثر على database.bak داخل الملف المضغوط. ارفع ملف نسخة صادر من هذا النظام.',
          'NO_BACKUP_IN_ZIP');
      }
    } else if (/\.bak$/i.test(originalName)) {
      await fsp.copyFile(uploadPath, path.join(staging, 'database.bak'));
    } else {
      throw badRequest('يُقبل ملف ‎.zip‎ أو ‎.bak‎ فقط', 'BAD_FILE_TYPE');
    }

    const bak = path.join(staging, 'database.bak');
    if (!fs.existsSync(bak)) {
      throw badRequest('الملف لا يحتوي على نسخة قاعدة بيانات', 'NO_DATABASE_FILE');
    }
    if (!await looksLikeBackup(bak)) {
      throw badRequest(
        'هذا الملف ليس نسخة قاعدة بيانات من SQL Server. '
        + 'ارفع ملف ‎.bak‎ أو ملف ‎.zip‎ صادراً من شاشة النسخ الاحتياطي.',
        'NOT_A_SQL_BACKUP');
    }

    const { header, verified, unverified_reason: unverifiedReason } = await inspectBackup(bak);
    const carried = await readManifest(staging);

    /*
     * Name the set after when the backup was *taken*, not when it was
     * uploaded, so an imported set sorts into the timeline where it belongs
     * instead of pretending to be today's. Three sources, in falling order of
     * authority: the backup header, a manifest that travelled with it, and —
     * when neither is available — now.
     */
    const stated = header?.BackupFinishDate ?? carried?.created_at ?? null;
    const takenAt = stated ? new Date(stated) : new Date();

    /*
     * A name taken from the backup itself identifies it, so a collision means
     * this exact backup is already here and saying so is the useful answer.
     *
     * A name taken from the clock identifies nothing — it is only a slot — so
     * a collision there means two unrelated files were uploaded in the same
     * minute, and refusing the second with "this backup already exists" would
     * be simply untrue. That one rolls forward to the next free minute.
     */
    let name = stampFor(takenAt);
    if (fs.existsSync(setPath(name))) {
      if (stated) throw conflict(`هذه النسخة موجودة بالفعل باسم ${name}`, 'BACKUP_ALREADY_HERE');
      const slot = new Date(takenAt);
      do {
        slot.setMinutes(slot.getMinutes() + 1);
        name = stampFor(slot);
      } while (fs.existsSync(setPath(name)));
    }
    const dir = setPath(name);

    const manifest = {
      ...(carried ?? {}),
      created_at: takenAt.toISOString(),
      source: 'imported',
      imported_at: new Date().toISOString(),
      imported_from: originalName,
      verified,
      unverified_reason: unverifiedReason,
      // Preferred from the file itself, so it is right even when the set has
      // no manifest of its own (a raw .bak, or one from an older version).
      database: header?.DatabaseName ?? carried?.database ?? null,
      server: header?.ServerName ?? carried?.server ?? null,
    };
    await fsp.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));

    await fsp.rename(staging, dir);
    await fsp.rm(uploadPath, { force: true }).catch(() => {});

    return {
      name,
      created_at: manifest.created_at,
      size: await dirSize(dir),
      has_uploads: fs.existsSync(path.join(dir, 'uploads.zip')),
      source: 'imported',
      database: manifest.database,
      counts: manifest.counts ?? null,
      verified,
      unverified_reason: unverifiedReason,
      // A backup of a differently-named database restores fine, but it is
      // worth saying out loud rather than discovering afterwards.
      foreign_database: !!manifest.database && manifest.database !== DB_NAME,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/* --------------------------------------------------------------- restore */
/**
 * Where the restored data and log files should land.
 *
 * Restoring in place must not relocate the database, so when it already exists
 * the answer is wherever its files are now. Only a database that is not there
 * — a first restore onto a fresh machine — goes to the instance defaults.
 */
async function moveTargets(bak) {
  let files;
  try {
    const list = await adminQuery('RESTORE FILELISTONLY FROM DISK = @path;', { path: bak });
    files = list.recordset ?? [];
  } catch (err) {
    throw badRequest(`تعذّر قراءة محتوى النسخة: ${sqlDetail(err)}`, 'BACKUP_UNREADABLE');
  }
  if (!files.length) throw badRequest('تعذّر قراءة محتوى النسخة', 'BACKUP_UNREADABLE');

  /*
   * Where the live database's files are right now.
   *
   * Read from `sys.database_files` inside the database itself, not from
   * `sys.master_files` on the master connection: master_files is filtered by
   * permission and returns *zero rows* for the application login — confirmed
   * against this instance. Silently getting nothing back is the dangerous
   * shape of that, because the fallback below then relocates a perfectly
   * healthy database into the instance default folder as a side effect of a
   * restore nobody asked to move anything.
   *
   * This runs before `beginMaintenance`, while the application pool is still
   * open — which is the only window in which it can run at all.
   */
  const inPlace = new Map();
  try {
    const rows = await runWithoutOrg(() => allRows(
      'SELECT physical_name, type_desc FROM sys.database_files;'));
    for (const row of rows) {
      if (!inPlace.has(row.type_desc)) inPlace.set(row.type_desc, row.physical_name);
    }
  } catch {
    // Falls through to the instance defaults below — correct for a database
    // that does not exist here yet, which is the other reason this can be empty.
  }

  const defaults = await adminQuery(`
    SELECT CONVERT(nvarchar(400), SERVERPROPERTY('InstanceDefaultDataPath')) AS data_path,
           CONVERT(nvarchar(400), SERVERPROPERTY('InstanceDefaultLogPath'))  AS log_path;`);
  const { data_path: dataPath, log_path: logPath } = defaults.recordset[0];

  const moves = [];
  const params = {};
  let dataSeen = 0;
  let logSeen = 0;

  for (const file of files) {
    const isLog = file.Type === 'L';
    const key = `move${moves.length}`;
    let target;

    if (isLog) {
      logSeen += 1;
      target = (logSeen === 1 && inPlace.get('LOG'))
        || path.join(logPath ?? dataPath, `${DB_NAME}${logSeen === 1 ? '' : `_${logSeen}`}_log.ldf`);
    } else {
      dataSeen += 1;
      target = (dataSeen === 1 && inPlace.get('ROWS'))
        || path.join(dataPath, `${DB_NAME}${dataSeen === 1 ? '' : `_${dataSeen}`}.mdf`);
    }

    // Logical names come out of the backup and can be anything, so they are
    // bound as parameters too — MOVE takes expressions on both sides.
    params[`${key}from`] = file.LogicalName;
    params[`${key}to`] = target;
    moves.push(`MOVE @${key}from TO @${key}to`);
  }

  return { moves, params };
}

/** Unpack a set's photos over the uploads folder. */
async function restoreUploads(dir) {
  const zip = path.join(dir, 'uploads.zip');
  if (STORAGE_DRIVER !== 'local' || !fs.existsSync(zip)) return null;

  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  const directory = await unzipper.Open.file(zip);
  let written = 0;

  for (const entry of directory.files) {
    if (entry.type !== 'File') continue;
    // Same zip-slip guard as the import path: the archive decides the name,
    // never the folder.
    const base = path.basename(entry.path);
    if (!base || base.startsWith('.')) continue;
    await fsp.writeFile(path.join(UPLOADS_DIR, base), await entry.buffer());
    written += 1;
  }
  // Deliberately additive: files already here are overwritten, files not in
  // the archive are left. Photos of items the restore removes become orphans,
  // which costs disk space; the alternative — emptying the folder first —
  // costs every photo if the archive turns out to be short.
  return written;
}

/**
 * Replace the live database with a set. Destructive and not undoable.
 *
 * The sequence matters, and each step is here because skipping it produces a
 * failure that looks like something else:
 *
 *  1. VERIFYONLY, before anything is touched. A corrupt file must be found
 *     while the current database is still intact.
 *  2. Close and latch the application pool, so nothing reconnects into the one
 *     slot single-user mode allows (see `beginMaintenance`).
 *  3. SINGLE_USER WITH ROLLBACK IMMEDIATE — evicts whatever is left.
 *  4. RESTORE … WITH REPLACE, RECOVERY.
 *  5. MULTI_USER, then re-point the app login (see `repointLogin`).
 *  6. Run migrations. A set older than the current code carries an older
 *     schema, and without this the app comes back up against columns it does
 *     not have.
 */
export async function restoreSet(name) {
  // Name first: it is the cheapest check, and a malformed one deserves to be
  // told it is malformed rather than shown a permissions message it did not
  // earn. `getSet` below validates too — this is about answering truthfully.
  validSetName(name);

  const caps = await capabilities();
  if (!caps.can_restore) {
    throw unavailable(
      `حساب SQL المستخدم (${DB_USER}) لا يملك صلاحية الاستعادة. `
      + 'شغّل deploy/windows/grant-backup.sql كمسؤول، أو استخدم deploy\\windows\\restore.ps1 على الخادم.',
      'NO_RESTORE_RIGHTS', { capabilities: caps },
    );
  }

  const set = await getSet(name);
  const dir = setPath(set.name);
  const bak = path.join(dir, 'database.bak');
  const db = dbIdentifier();
  const started = Date.now();

  // (1) Before anything is destroyed.
  try {
    await adminQuery('RESTORE VERIFYONLY FROM DISK = @path;', { path: bak });
  } catch (err) {
    throw badRequest(
      `النسخة تالفة أو غير قابلة للقراءة، ولم يُغيَّر شيء: ${sqlDetail(err)}`, 'BACKUP_CORRUPT');
  }

  const { moves, params } = await moveTargets(bak);

  // (2) From here on the application has no database.
  await beginMaintenance('جارٍ استعادة نسخة احتياطية — النظام غير متاح لدقائق');

  const warnings = [];
  try {
    // (3) A failure here has not changed anything yet, and leaves the database
    // in normal multi-user mode, so there is nothing to undo.
    await adminQuery(`ALTER DATABASE ${db} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;`)
      .catch((err) => {
        throw new AppError(500,
          `تعذّر إخلاء قاعدة البيانات قبل الاستعادة، ولم يُغيَّر شيء: ${sqlDetail(err)}`,
          'RESTORE_LOCK_FAILED');
      });

    // (4)
    try {
      await adminQuery(
        `RESTORE DATABASE ${db} FROM DISK = @path WITH ${moves.join(', ')}, REPLACE, RECOVERY;`,
        { path: bak, ...params },
      ).catch((err) => {
        throw new AppError(500, `فشلت الاستعادة: ${sqlDetail(err)}`, 'RESTORE_FAILED');
      });
    } finally {
      // (5) Always, even on failure: a database left in single-user mode is a
      // system that cannot come back up at all, which is strictly worse than a
      // failed restore.
      await adminQuery(`ALTER DATABASE ${db} SET MULTI_USER;`).catch((err) => {
        warnings.push(`تعذّرت إعادة قاعدة البيانات لوضع المستخدمين المتعددين: ${sqlDetail(err)}`);
      });
    }

    const repoint = await repointLogin();
    if (repoint) warnings.push(repoint);
  } finally {
    endMaintenance();
  }

  const photos = await restoreUploads(dir).catch((err) => {
    warnings.push(`تعذّر استرجاع الصور: ${err.message}`);
    return null;
  });
  if (photos === null && set.has_uploads) {
    warnings.push('لم تُسترجع صور الأصناف من هذه النسخة.');
  }

  // (6)
  let migrations = null;
  try {
    const { migrate } = await import('../db/migrate.js');
    migrations = await migrate({ log: () => {} });
  } catch (err) {
    warnings.push(
      `الاستعادة تمّت، لكن تحديث بنية قاعدة البيانات فشل: ${err.message}. `
      + 'شغّل `npm run migrate` على الخادم.');
  }

  const counts = await currentCounts();

  return {
    restored: set.name,
    took_ms: Date.now() - started,
    photos_restored: photos,
    migrations: migrations ?? null,
    counts,
    warnings,
  };
}

/**
 * Re-point the app's database user at the local login.
 *
 * A database carries its *users*; a server carries its *logins*; a SID joins
 * them. Restore a backup taken on another machine and this login's user inside
 * it points at a SID this server has never heard of — so the login exists, the
 * user exists, and every connection still fails with "Login failed for user",
 * with everything apparently configured correctly. Nothing in the restore
 * output mentions it.
 *
 * Returns null on success, or a message describing what the operator must run
 * by hand — this needs ALTER ANY USER inside the restored database, which the
 * app may not have. Restoring a set taken on *this* server never needs it at
 * all, because the SIDs already match.
 */
async function repointLogin() {
  const login = DB_USER.replace(/]/g, ']]');
  try {
    await adminQuery(
      `EXEC ${dbIdentifier()}.sys.sp_executesql N'`
      + `IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N''${login}'') `
      + `ALTER USER [${login}] WITH LOGIN = [${login}];';`,
    );
    return null;
  } catch (err) {
    return 'تمّت الاستعادة، لكن تعذّر ربط حساب التطبيق بتسجيل الدخول المحلي '
      + `(${sqlDetail(err)}). إن ظهر خطأ دخول، شغّل على الخادم: `
      + `USE ${DB_NAME}; ALTER USER [${DB_USER}] WITH LOGIN = [${DB_USER}];`;
  }
}

/* ----------------------------------------------------------------- prune */
export async function deleteSet(name) {
  await getSet(name);
  await fsp.rm(setPath(name), { recursive: true, force: true });
}

/**
 * Drop sets older than `keepDays`, by set *name* rather than file date — a
 * copy made today of a set from three weeks ago is three weeks old.
 */
export async function pruneSets(keepDays) {
  if (!keepDays || keepDays <= 0) return [];
  const cutoff = Date.now() - keepDays * 86_400_000;
  const removed = [];

  for (const set of await listSets()) {
    if (timeFromName(set.name).getTime() >= cutoff) continue;
    await fsp.rm(setPath(set.name), { recursive: true, force: true });
    removed.push(set.name);
  }
  return removed;
}

/**
 * Copy a set to a second location — a UNC share, an external drive, whatever
 * `copy_to` names. This is the "export automatically" half.
 *
 * A backup on the same disk as the data protects against a bad migration, not
 * against the disk dying, so a schedule that never leaves the machine is only
 * half a backup. Failure is reported, never fatal: a standby that is switched
 * off tonight must not cost you tonight's local backup as well.
 *
 * The push direction is the trade-off. `deploy/windows/backup-pull.ps1` has
 * the standby pull instead, which survives this machine being compromised;
 * this one needs no second machine to be set up at all. Both are offered.
 */
export async function copySetTo(name, destinationRoot) {
  const set = await getSet(name);
  const target = path.join(destinationRoot, set.name);
  const staging = `${target}.partial`;

  await fsp.mkdir(destinationRoot, { recursive: true });
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });

  const source = setPath(set.name);
  for (const file of await fsp.readdir(source)) {
    await fsp.copyFile(path.join(source, file), path.join(staging, file));
  }

  // Renamed only once every file is down, so an interrupted copy never leaves
  // something that looks like a complete set.
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.rename(staging, target);
  return target;
}

/* --------------------------------------------------------------- browsing */
/**
 * List the folders on **the server**, so a destination can be picked instead
 * of typed.
 *
 * This has to exist server-side, and it is worth being clear why: `copy_to` is
 * a path on the machine running this API. A browser's own folder picker
 * (`<input type="file" webkitdirectory>`) chooses a folder on whichever device
 * the manager is holding — a phone, usually — and hands back relative names,
 * never an absolute path. It would produce a value that looks right and copies
 * nothing.
 *
 * What is exposed: directory *names* only. No files are listed, nothing is
 * read, nothing is written except the write probe below. The route is
 * manager-only, and a manager can already replace the whole database from this
 * screen, so enumerating folder names is not the widest thing they can do —
 * but it is deliberately the narrowest shape that answers the question.
 */
/**
 * How long to wait for a folder to answer before giving up on it.
 *
 * A local path answers in microseconds. A network path pointed at a machine
 * that is switched off does not answer at all — it waits for SMB's own TCP
 * timeout, measured here at **21 seconds** against an unresponsive IP on the
 * LAN. (A hostname that does not resolve fails in 8ms, which is why this is
 * easy to miss: it only bites on the plausible-looking address.)
 *
 * Twenty-one seconds of a spinner and then a generic failure is a much worse
 * answer than eight seconds and a sentence naming the cause. The abandoned
 * operation completes in the background and is discarded; nothing leaks but
 * one pending fs call.
 */
const BROWSE_TIMEOUT_MS = Number(process.env.BACKUP_BROWSE_TIMEOUT_MS ?? 8000);

const TIMED_OUT = Symbol('timed out');

/** Resolve `promise`, or the TIMED_OUT sentinel if it takes too long. */
function withTimeout(promise, ms = BROWSE_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); }),
  ]);
}

export async function listDirectory(target) {
  const drives = await listDrives();

  // No path: offer the drives. Nothing above a drive letter exists to browse.
  if (!target) {
    return { path: null, parent: null, writable: false, entries: drives, drives };
  }

  // `resolve` normalises `..`, mixed separators and a bare `D:`. It keeps UNC
  // paths intact, which matters — a second machine is the whole point.
  const full = path.resolve(target);

  const isUnc = full.startsWith('\\\\');

  let dirents;
  try {
    dirents = await withTimeout(fsp.readdir(full, { withFileTypes: true }));
    if (dirents === TIMED_OUT) {
      throw new AppError(504,
        `لم يستجب ${full} خلال ${Math.round(BROWSE_TIMEOUT_MS / 1000)} ثوانٍ. `
        + (isUnc
          ? 'تأكد أن الجهاز يعمل وأن اسمه أو عنوانه صحيح.'
          : 'قد يكون القرص غير متصل.'),
        'DIR_TIMEOUT');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.code === 'ENOENT' && !isUnc) throw notFound('المجلد غير موجود', 'DIR_NOT_FOUND');
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw new AppError(403, 'لا صلاحية لفتح هذا المجلد', 'DIR_FORBIDDEN');
    }
    if (err.code === 'ENOTDIR') throw badRequest('هذا ملف وليس مجلداً', 'NOT_A_DIR');
    /*
     * A network path is the case this whole feature exists for, and it is the
     * one whose raw error says least: an unreachable share surfaces as
     * "UNKNOWN: unknown error, scandir" with no hint of a cause. The three
     * causes are all worth naming, because the fix differs for each — and the
     * third is the one people miss, since the API runs as a service account
     * that has none of the network credentials the signed-in person does.
     */
    if (isUnc) {
      throw badRequest(
        `تعذّر الوصول إلى ${full} — تأكد أن الجهاز الآخر يعمل، وأن المجلد مشارَك، `
        + 'وأن حساب خدمة النظام على هذا الخادم يملك صلاحية الكتابة عليه '
        + '(الصلاحية تُمنح لحساب الخدمة، لا لحسابك أنت).',
        'SHARE_UNREACHABLE');
    }
    throw badRequest(`تعذّر فتح المجلد: ${err.message}`, 'DIR_UNREADABLE');
  }

  const entries = [];
  for (const entry of dirents) {
    if (!entry.isDirectory()) continue;         // folders only
    if (entry.name.startsWith('$')) continue;   // $Recycle.Bin, $WinREAgent
    entries.push({ name: entry.name, path: path.join(full, entry.name) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  const parent = path.dirname(full);
  return {
    path: full,
    // `dirname` of a root returns the root itself; that is the signal there is
    // nowhere further up, and the client shows the drive list instead.
    parent: parent === full ? null : parent,
    writable: await isWritable(full),
    entries,
    drives,
  };
}

/**
 * Can this process actually write here?
 *
 * By writing, not by asking. `fs.access(W_OK)` is close to meaningless for a
 * directory on Windows — it consults the read-only attribute rather than the
 * ACL, and happily reports success on a share the account cannot write to. The
 * copy itself runs as this Node process (unlike BACKUP, which runs inside SQL
 * Server), so a probe file created and removed by this process is the exact
 * question that matters.
 */
async function isWritable(dir) {
  const probe = path.join(dir, `.inventory-write-test-${process.pid}-${Date.now()}`);
  try {
    // Timed out for the same reason as the listing: a share can accept the
    // directory read and then stall on the write.
    const done = await withTimeout(fsp.writeFile(probe, ''));
    return done !== TIMED_OUT;
  } catch {
    return false;
  } finally {
    await fsp.rm(probe, { force: true }).catch(() => {});
  }
}

/**
 * The drive letters that currently exist.
 *
 * Node has no API for this, and the usual alternatives shell out. Probing the
 * 26 letters is dependency-free and, being `stat` calls on local roots, is not
 * worth optimising — they run in parallel, and a letter that is not mounted
 * fails immediately rather than timing out.
 */
async function listDrives() {
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  const found = await Promise.all(letters.map(async (letter) => {
    const root = `${letter}:\\`;
    try {
      await fsp.stat(root);
      return { name: root, path: root };
    } catch {
      return null;
    }
  }));
  return found.filter(Boolean);
}

/* ---------------------------------------------------------------- config */
/**
 * The schedule lives in a file next to the backups, *not* in the settings
 * table.
 *
 * Put it in the database and restoring last month's backup silently reinstates
 * last month's backup schedule — including turning it off, if it was off then.
 * A system's own recovery configuration must not be one of the things its
 * recovery can overwrite.
 */
const CONFIG_FILE = path.join(BACKUP_DIR, 'backup-config.json');

export const DEFAULT_CONFIG = {
  auto: false,
  /** Local 24-hour `HH:MM`. */
  time: '02:00',
  keep_days: 30,
  /** Optional second destination for every automatic backup. */
  copy_to: '',
};

export async function readConfig() {
  try {
    const raw = JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(patch) {
  const next = { ...await readConfig(), ...patch };
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  await fsp.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}
