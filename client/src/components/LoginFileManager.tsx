import { useState, useEffect, type FormEvent } from 'react';
import {
  FolderOpen, Plus, Trash2, Pencil, ShieldAlert, ShieldCheck, ArrowRight, Check,
} from 'lucide-react';
import { Button, Field, Input, Modal, Select, Badge } from '@/components/ui';
import { signInForManagement, withToken, type FileChoice } from '@/lib/session';
import type { AppFile, FileList } from '@/lib/types';

/**
 * Creating and deleting files, from the login screen.
 *
 * ---------------------------------------------------------------------------
 * Why this asks for a password before it shows anything
 * ---------------------------------------------------------------------------
 * The login screen is the one part of this app a stranger can reach. Create
 * and delete cannot live there unguarded: create would let anyone fill the
 * server's disk with databases, and delete would let them destroy a business's
 * entire history from a screen that never asked who they were. No amount of
 * confirmation dialog fixes that, because a dialog only stops accidents.
 *
 * So the panel has two steps. First prove you manage *some* file on this
 * server -- which is exactly the credential the operator already has -- and
 * only then does it show the files and their controls. The token it gets is
 * held in this component's state and never persisted: unlocking the panel is
 * not signing in, and closing it forgets everything.
 *
 * The API enforces all of this independently (requireManager, and the password
 * again in the delete body). Nothing here is the security boundary; it is the
 * part that explains the boundary rather than letting a button fail.
 */
export default function LoginFileManager(
  { files, initialFileId, onClose, onChanged }:
  {
    files: FileChoice[];
    initialFileId: string;
    onClose: () => void;
    onChanged: () => void;
  },
) {
  const [token, setToken] = useState<string | null>(null);
  /** The file whose manager unlocked the panel — the API refuses to delete it. */
  const [unlockedFile, setUnlockedFile] = useState<string>('');

  return token
    ? (
      <ManagePanel
        token={token}
        unlockedFile={unlockedFile}
        onClose={onClose}
        onChanged={onChanged}
      />
    )
    : (
      <Unlock
        files={files}
        initialFileId={initialFileId}
        onClose={onClose}
        onUnlocked={(t, fileId) => { setToken(t); setUnlockedFile(fileId); }}
      />
    );
}

/* ------------------------------------------------------------------ step 1 */
function Unlock(
  { files, initialFileId, onClose, onUnlocked }:
  {
    files: FileChoice[];
    initialFileId: string;
    onClose: () => void;
    onUnlocked: (token: string, fileId: string) => void;
  },
) {
  const [fileId, setFileId] = useState(initialFileId || files[0]?.id || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await signInForManagement(fileId, username.trim(), password);
      // The account exists, but only a manager may list or change files. Asked
      // here rather than after opening the panel, so a staff account is told
      // plainly instead of meeting an empty screen.
      await withToken<FileList>(token, '/files');
      onUnlocked(token, fileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر التحقق');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="إدارة الملفات"
      description="أدخل بيانات مدير أحد الملفات — إنشاء الملفات وحذفها صلاحية مدير، لا تُفتح من شاشة الدخول دون تحقق."
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={busy}
            disabled={!fileId || !username.trim()}>
            <ShieldCheck className="size-4" /> متابعة
          </Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="الملف" hint="أي ملف تديره">
          <Select value={fileId} onChange={(e) => setFileId(e.target.value)}>
            {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
        </Field>
        <Field label="اسم المستخدم">
          <Input value={username} onChange={(e) => setUsername(e.target.value)}
            dir="auto" autoComplete="username" autoFocus required />
        </Field>
        <Field label="كلمة المرور">
          <Input type="password" value={password} dir="ltr" autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ step 2 */
function ManagePanel(
  { token, unlockedFile, onClose, onChanged }:
  { token: string; unlockedFile: string; onClose: () => void; onChanged: () => void },
) {
  const [list, setList] = useState<FileList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<AppFile | null>(null);
  const [deleting, setDeleting] = useState<AppFile | null>(null);

  const reload = () => withToken<FileList>(token, '/files')
    .then((data) => { setList(data); onChanged(); })
    .catch((err: Error) => setError(err.message));

  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [token]);

  const canManage = !!list?.can_create;

  return (
    <>
      <Modal
        open={!creating && !renaming && !deleting}
        onClose={onClose}
        title="الملفات"
        description="كل ملف منشأة مستقلة — بياناته ومستخدموه ونسخه الاحتياطية خاصة به وحده."
        footer={(
          <>
            <Button onClick={onClose}>إغلاق</Button>
            {canManage && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> ملف جديد
              </Button>
            )}
          </>
        )}
      >
        {/* A capability the server does not have is explained once, here,
            rather than as a failure when a button is pressed. */}
        {list && !canManage && (
          <div className="mb-3 flex items-start gap-2.5 rounded-lg bg-amber-50/70 p-3 text-xs leading-relaxed dark:bg-amber-950/25">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="font-semibold">إنشاء الملفات وحذفها غير متاح على هذا الخادم</p>
              <p className="mt-1 text-muted">{list.reason}</p>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {error}
          </p>
        )}

        <ul className="divide-y divide-line">
          {(list?.data ?? []).map((file) => {
            // The API refuses to drop the database the caller is bound to, and
            // this panel is bound to the file its manager unlocked with.
            const isUnlocked = file.id === unlockedFile;
            return (
              <li key={file.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
                    <FolderOpen className="size-4" />
                  </span>
                  <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                    <span className="min-w-0 truncate">{file.name}</span>
                    {isUnlocked && (
                      <Badge tone="success" className="shrink-0">
                        <Check className="size-3" /> دخلت به
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="icon" variant="ghost" title="إعادة التسمية"
                    onClick={() => setRenaming(file)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={!canManage || isUnlocked}
                    title={isUnlocked
                      ? 'لا يمكن حذف الملف الذي دخلت به — ادخل بمدير ملف آخر لحذفه'
                      : 'حذف الملف'}
                    onClick={() => setDeleting(file)}
                    className="hover:bg-accent-500/10 hover:text-accent-600 dark:hover:text-accent-400"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Modal>

      {creating && (
        <CreateFile token={token}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); void reload(); }} />
      )}
      {renaming && (
        <RenameFile token={token} file={renaming}
          onClose={() => setRenaming(null)}
          onDone={() => { setRenaming(null); void reload(); }} />
      )}
      {deleting && (
        <DeleteFile token={token} file={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => { setDeleting(null); void reload(); }} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ create */
function CreateFile(
  { token, onClose, onDone }: { token: string; onClose: () => void; onDone: () => void },
) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await withToken<AppFile>(token, '/files', {
        method: 'POST',
        body: {
          name: name.trim(),
          manager_username: username.trim(),
          manager_password: password,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء الملف');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="ملف جديد"
      description="قاعدة بيانات مستقلة تماماً — لا يرى هذا الملف شيئاً من الملفات الأخرى ولا العكس."
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={busy}
            disabled={!name.trim() || !username.trim()}>إنشاء</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="اسم الملف" hint="الاسم الذي يظهر في شاشة الدخول">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="mb-3 text-xs font-semibold text-muted">
            حساب المدير الأول لهذا الملف — سلّمه لمن سيديره؛ حسابك أنت لا يعمل بداخله.
          </p>
          <div className="space-y-3">
            <Field label="اسم المستخدم">
              <Input value={username} onChange={(e) => setUsername(e.target.value)}
                dir="auto" autoComplete="off" required />
            </Field>
            <Field label="كلمة المرور"
              hint="اتركها فارغة لحساب بلا كلمة مرور — لكنه عندها لن يستطيع حذف أي ملف">
              <Input type="password" value={password} dir="ltr" autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ rename */
function RenameFile(
  { token, file, onClose, onDone }:
  { token: string; file: AppFile; onClose: () => void; onDone: () => void },
) {
  const [name, setName] = useState(file.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await withToken<AppFile>(token, `/files/${file.id}`,
        { method: 'PATCH', body: { name: name.trim() } });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تغيير الاسم');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="إعادة تسمية الملف"
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={busy}
            disabled={!name.trim()}>حفظ</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="اسم الملف">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ delete */
/**
 * The password is asked for again here, seconds after unlocking the panel.
 *
 * That is deliberate. Unlocking proves a manager opened this screen; it does
 * not prove a manager is the one pressing *this* button, on a phone that has
 * been sitting unlocked on a counter. The API demands it in the request body
 * for the same reason, so this is the honest shape of the call rather than a
 * second gate invented by the UI.
 */
function DeleteFile(
  { token, file, onClose, onDone }:
  { token: string; file: AppFile; onClose: () => void; onDone: () => void },
) {
  const [password, setPassword] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameMatches = confirmName.trim() === file.name;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await withToken(token, `/files/${file.id}`, { method: 'DELETE', body: { password } });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر حذف الملف');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`حذف الملف «${file.name}»`}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button variant="danger" onClick={submit} loading={busy}
            disabled={!nameMatches || !password}>حذف نهائي</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-accent-50 p-3 text-sm leading-relaxed text-accent-800 dark:bg-accent-950/30 dark:text-accent-200">
          يُحذف هذا الملف بالكامل: أصنافه وفواتيره وحركاته ومستخدموه وصوره.
          تُؤخذ نسخة احتياطية له وحده قبل الحذف، ويمكن استرجاعه منها لاحقاً دون
          أن يتأثر أي ملف آخر.
        </div>
        <Field label="اكتب اسم الملف للتأكيد" hint={file.name}>
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
            autoFocus autoComplete="off" />
        </Field>
        <Field label="كلمة مرور حسابك" hint="تأكيد أنك أنت من يحذف، لا من وجد الجهاز مفتوحاً">
          <Input type="password" value={password} dir="ltr" autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** The affordance that opens all of this, for the login screen to place. */
export function ManageFilesButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-brand-600 dark:hover:text-brand-400"
    >
      <FolderOpen className="size-3.5" />
      إدارة الملفات
      <ArrowRight className="size-3 rotate-180" />
    </button>
  );
}
