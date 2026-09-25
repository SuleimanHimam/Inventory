import { useState, type FormEvent } from 'react';
import { FolderOpen, Plus, Trash2, Pencil, ShieldAlert, Check } from 'lucide-react';
import {
  Button, Card, Field, Input, Modal, PageHeader, EmptyState, Skeleton, Badge,
} from '@/components/ui';
import { useFiles, useFileMutations } from '@/hooks';
import { toast } from '@/store/toast';
import type { AppFile } from '@/lib/types';
import { fmtDateShort } from '@/lib/format';

/**
 * Files (ملفات) — separate businesses on one server.
 *
 * Each file is its own database: its own items, invoices, users and backups.
 * Nothing crosses between them, which is why this screen can only create a
 * file and delete one. There is no "switch to" button: a file's users are its
 * own, so moving between them means signing out and signing in again, with
 * that file's credentials. Offering a shortcut here would suggest the boundary
 * is softer than it is.
 */
export default function Files() {
  const { data, isLoading } = useFiles();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<AppFile | null>(null);
  const [deleting, setDeleting] = useState<AppFile | null>(null);

  const files = data?.data ?? [];
  const canManage = !!data?.can_create;

  return (
    <>
      <PageHeader
        title="الملفات"
        subtitle="كل ملف منشأة مستقلة — بياناته ومستخدموه ونسخه الاحتياطية خاصة به وحده"
        actions={canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> ملف جديد
          </Button>
        )}
      />

      {/* A capability the server does not have is explained once, here, rather
          than as a failure when a button is pressed. */}
      {data && !canManage && (
        <Card className="mb-4 flex items-start gap-3 border-amber-500/40 bg-amber-50/60 p-4 dark:bg-amber-950/20">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">إنشاء الملفات وحذفها غير متاح على هذا الخادم</p>
            <p className="mt-1 leading-relaxed text-muted">{data.reason}</p>
          </div>
        </Card>
      )}

      <Card className="p-2">
        {isLoading ? <Skeleton className="h-32" /> : files.length === 0 ? (
          <EmptyState icon={<FolderOpen className="size-6" />} title="لا توجد ملفات" />
        ) : (
          <ul className="divide-y divide-line">
            {files.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
                    <FolderOpen className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      <span className="truncate">{file.name}</span>
                      {file.is_current && (
                        <Badge tone="success"><Check className="size-3" /> مفتوح الآن</Badge>
                      )}
                    </p>
                    {file.created_at && (
                      <p className="nums mt-0.5 text-xs text-muted">
                        أُنشئ في {fmtDateShort(file.created_at)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="icon" variant="ghost" title="إعادة التسمية"
                    onClick={() => setRenaming(file)}>
                    <Pencil className="size-4" />
                  </Button>
                  {/* A file cannot be deleted from inside itself — the API
                      refuses it too, this only avoids offering it. */}
                  {canManage && !file.is_current && (
                    <Button size="icon" variant="ghost" title="حذف الملف"
                      onClick={() => setDeleting(file)}
                      className="hover:bg-accent-500/10 hover:text-accent-600 dark:hover:text-accent-400">
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && <CreateFile onClose={() => setCreating(false)} />}
      {renaming && <RenameFile file={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteFile file={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

/**
 * Creating a file also creates the one account that can get into it.
 *
 * Those credentials are handed over, not kept: the manager creating the file
 * gets no account in it. That is the whole point of a file being separate, and
 * the dialog says so rather than leaving it to be discovered at the login
 * screen.
 */
function CreateFile({ onClose }: { onClose: () => void }) {
  const { create } = useFileMutations();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name: name.trim(), manager_username: username.trim(), manager_password: password },
      {
        onSuccess: (file) => {
          toast.success(`أُنشئ الملف ${file.name}`,
            `يدخل إليه المدير باسم ${username.trim()} من شاشة الدخول.`);
          onClose();
        },
        onError: (err: Error) => toast.error('تعذّر إنشاء الملف', err.message),
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="ملف جديد"
      description="قاعدة بيانات مستقلة تماماً — لا يرى هذا الملف شيئاً من الملفات الأخرى ولا العكس."
      footer={(
        <>
          <Button onClick={onClose} disabled={create.isPending}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending}
            disabled={!name.trim() || !username.trim()}>
            إنشاء
          </Button>
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
      </form>
    </Modal>
  );
}

function RenameFile({ file, onClose }: { file: AppFile; onClose: () => void }) {
  const { rename } = useFileMutations();
  const [name, setName] = useState(file.name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    rename.mutate({ id: file.id, name: name.trim() }, {
      onSuccess: () => { toast.success('تم تغيير اسم الملف'); onClose(); },
      onError: (err: Error) => toast.error('تعذّر تغيير الاسم', err.message),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="إعادة تسمية الملف"
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={rename.isPending}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={rename.isPending}
            disabled={!name.trim()}>حفظ</Button>
        </>
      )}
    >
      <form onSubmit={submit}>
        <Field label="اسم الملف">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
      </form>
    </Modal>
  );
}

/**
 * Deleting a file.
 *
 * Two things stand between the button and the data: the manager's own password,
 * typed again here, and a backup the server takes of this file immediately
 * before it drops the database. The backup is worth stating plainly in the
 * dialog, because it is the difference between "gone" and "restorable" — and
 * because each file has its own backups, restoring it later costs no other
 * file anything.
 */
function DeleteFile({ file, onClose }: { file: AppFile; onClose: () => void }) {
  const { remove } = useFileMutations();
  const [password, setPassword] = useState('');
  const [confirmName, setConfirmName] = useState('');

  const nameMatches = confirmName.trim() === file.name;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    remove.mutate({ id: file.id, password }, {
      onSuccess: (result) => {
        toast.success(`حُذف الملف ${result.name}`, result.backup
          ? `أُخذت نسخة احتياطية قبل الحذف: ${result.backup}`
          : 'حُذف دون نسخة احتياطية.');
        onClose();
      },
      onError: (err: Error) => toast.error('تعذّر حذف الملف', err.message),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`حذف الملف «${file.name}»`}
      footer={(
        <>
          <Button onClick={onClose} disabled={remove.isPending}>إلغاء</Button>
          <Button variant="danger" onClick={submit} loading={remove.isPending}
            disabled={!nameMatches || !password}>
            حذف نهائي
          </Button>
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
      </form>
    </Modal>
  );
}
