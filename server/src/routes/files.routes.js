/**
 * File administration — manager only.
 *
 * A file (ملف) is a whole database of its own: its own items, its own users,
 * its own backups. See lib/files.js for why, and for the `dbcreator` right
 * this needs on the SQL Server instance.
 *
 * Mounted inside the authenticated chain, so `req.auth` is resolved and
 * `requireManager` answers from the verified membership. A manager of one
 * file may create and delete *other* files — there is no rank above manager
 * in this app, and somebody has to be able to. What they cannot do is reach
 * into another file's data: creating one hands over its first manager's
 * credentials rather than keeping an account in it, and after that the only
 * way in is the login screen like anyone else.
 */
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { get, runWithoutOrg, bindFile, currentDb } from '../db/index.js';
import { verifyPassword, hasNoPassword } from '../lib/password.js';
import { AUTH_MODE } from '../lib/auth.js';
import { requireManager } from '../lib/roles.js';
import {
  listFiles, createFile, deleteFile, renameFile, capabilities, fileOr404,
} from '../lib/files.js';
import { createSet } from '../lib/backup.js';
import { unauthorized, unavailable, badRequest } from '../lib/errors.js';

const router = Router();
router.use(requireManager);

/**
 * Creating a file means creating an account inside it, and an account needs
 * somewhere to put a password — which only exists under local auth.
 */
function requireLocalAccounts() {
  if (AUTH_MODE !== 'local') {
    throw unavailable(
      'إدارة الملفات متاحة فقط عندما يكون الدخول محلياً (AUTH_MODE=local)',
      'LOCAL_ACCOUNTS_ONLY',
    );
  }
}

/**
 * Re-authenticate the caller, right now, for the irreversible action.
 *
 * Not "are you a manager" — `requireManager` already answered that from the
 * token, and a token is whoever picked the tablet up. This asks for the
 * password again at the moment of the deletion, which is the only thing that
 * distinguishes the manager from someone holding their unlocked session.
 *
 * An account with no password (a deliberate option — see users.routes.js)
 * cannot confirm anything, so it is refused outright rather than waved
 * through. Deleting a file is precisely where "the username is the whole
 * credential" stops being an acceptable trade, and the message says so
 * instead of just failing.
 */
async function confirmPassword(req, password) {
  const user = await bindFile(req.auth.file, () => runWithoutOrg(() => get(
    'SELECT id, password_hash FROM users WHERE id = @id', { id: req.auth.userId },
  )));
  if (!user) throw badRequest('حساب محلي غير موجود لهذا المستخدم', 'NOT_LOCAL_USER');
  if (hasNoPassword(user.password_hash)) {
    throw badRequest(
      'هذا الحساب بلا كلمة مرور — عيّن كلمة مرور لحسابك قبل حذف أي ملف',
      'PASSWORD_REQUIRED_ON_ACCOUNT',
    );
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    throw unauthorized('كلمة المرور غير صحيحة', 'INVALID_CREDENTIALS');
  }
}

router.get('/', wrap(async (req, res) => {
  const [files, caps] = await Promise.all([listFiles(), capabilities()]);
  res.json({
    data: files.map((f) => ({
      ...f,
      // The file this session is signed into. It cannot be deleted from
      // inside itself, and the UI needs to say which one "here" is.
      is_current: f.id === req.auth.file,
    })),
    ...caps,
  });
}));

router.post('/', wrap(async (req, res) => {
  requireLocalAccounts();
  const { name, manager_username: username, manager_password: password } = parse(z.object({
    name: z.string().trim().min(1, 'اسم الملف مطلوب').max(200),
    manager_username: z.string().trim().toLowerCase().min(1, 'اسم مستخدم المدير مطلوب').max(320),
    /*
     * No minimum, and omitting it creates the new file's manager with no
     * password at all — the same freedom users.routes.js gives, and the same
     * reasoning: a warehouse tablet is a real setup and an 8-character rule
     * on it produces a sticky note, not a secret. The consequence is shown
     * rather than hidden: such an account cannot confirm a file deletion
     * (see `confirmPassword`), and the UI says so as it is created.
     */
    manager_password: z.string().max(200).optional().default(''),
  }), req.body);

  const file = await createFile({ name, username, password });
  res.status(201).json(file);
}));

router.patch('/:id', wrap(async (req, res) => {
  const { name } = parse(z.object({
    name: z.string().trim().min(1, 'اسم الملف مطلوب').max(200),
  }), req.body);
  await fileOr404(req.params.id);
  res.json(await renameFile(req.params.id, name));
}));

/**
 * Delete a file, and everything that was ever in it.
 *
 * The order is the point, and it is why the backup is taken here rather than
 * inside `deleteFile`: back up first, drop second. A set written a moment
 * before the drop is the only undo this action has, and because every file is
 * its own database that set restores this file alone — no other file loses so
 * much as a row to get this one back. That is the whole reason the separation
 * was worth doing.
 *
 * `force` exists for the case the backup cannot be written at all — an
 * instance without `db_backupoperator`, a full disk. It is the manager's call
 * to make, in front of a dialog that says there will be no way back, and the
 * default is to refuse.
 */
router.delete('/:id', wrap(async (req, res) => {
  requireLocalAccounts();
  const { password, force } = parse(z.object({
    password: z.string().min(1, 'كلمة المرور مطلوبة'),
    force: z.boolean().optional().default(false),
  }), req.body ?? {});

  const target = req.params.id;
  if (target === currentDb()) {
    // Checked again inside `deleteFile`; caught here so the password is not
    // demanded for an action that was never going to be allowed.
    throw badRequest('لا يمكن حذف الملف الذي تعمل بداخله الآن', 'FILE_IN_USE');
  }
  const file = await fileOr404(target);
  await confirmPassword(req, password);

  let backup = null;
  try {
    // Bound to the file being deleted, so `createSet` backs up that database
    // into that file's own folder of sets.
    backup = await bindFile(target, () => createSet({ source: 'pre-delete' }));
  } catch (err) {
    if (!force) throw err;
  }

  await deleteFile(target);
  res.json({ id: target, name: file.name, backup: backup?.name ?? null });
}));

export default router;
