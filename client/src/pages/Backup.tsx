import { useEffect, useRef, useState } from 'react';
import {
  DatabaseBackup, Download, Upload, RotateCcw, Trash2, Clock, HardDrive, ShieldAlert,
  Info, TriangleAlert, CheckCircle2, Copy, CalendarClock, Image as ImageIcon,
  Folder, FolderSearch, CornerUpRight, CornerDownLeft,
} from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader,
  Select, TableSkeleton, Toggle,
} from '@/components/ui';
import { useBackup, useBackupMutations, useBrowse, useDebounced } from '@/hooks';
import { api } from '@/lib/api';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import { cn } from '@/lib/cn';
import type { BackupSet, BackupStatus, RestoreResult } from '@/lib/types';

/**
 * Backups: take one, download it, bring one in from elsewhere, restore, and
 * set the whole thing running on a schedule.
 *
 * A backup here is a real SQL Server `BACKUP DATABASE` plus the product
 * photos — not an export of rows. That is the difference between something
 * that restores the system and something that restores a spreadsheet, and it
 * is why the buttons on this screen depend on what the SQL login is permitted
 * to do. `capabilities` comes back from the server on every load; where a
 * permission is missing the control is disabled and says which command grants
 * it, rather than failing on click.
 *
 * Layout follows the same rule as the items and users lists: cards wherever
 * there is no real pointer, the dense table where there is
 * (`.device-cards` / `.device-table` in index.css — a `pointer: fine` query,
 * not a width one).
 */
export default function Backup() {
  const { data, isLoading } = useBackup();
  const mutations = useBackupMutations();

  const [restoreTarget, setRestoreTarget] = useState<BackupSet | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BackupSet | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const caps = data?.capabilities;
  const sets = data?.sets ?? [];

  const takeBackup = async () => {
    try {
      const set = await mutations.create.mutateAsync();
      toast.success('تم إنشاء نسخة احتياطية', `${set.name} — ${fmtSize(set.size)}`);
    } catch (err) {
      toastError(err, 'تعذّر إنشاء النسخة');
    }
  };

  const download = async (set: BackupSet) => {
    try {
      await api.download(`/backup/${encodeURIComponent(set.name)}/download`,
        `inventory-backup-${set.name}.zip`);
    } catch (err) {
      toastError(err, 'تعذّر تنزيل النسخة');
    }
  };

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately: picking the same file twice in a row fires no change
    // event otherwise, and a retry after a failed upload silently does nothing.
    event.target.value = '';
    if (!file) return;
    try {
      const set = await mutations.import.mutateAsync(file);
      toast.success('تم استيراد النسخة', `${set.name} — ${fmtSize(set.size)}`);
    } catch (err) {
      toastError(err, 'تعذّر استيراد الملف');
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    const name = restoreTarget.name;
    setRestoreTarget(null);
    try {
      setResult(await mutations.restore.mutateAsync(name));
    } catch (err) {
      toastError(err, 'تعذّرت الاستعادة');
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    try {
      await mutations.remove.mutateAsync(removeTarget.name);
      toast.success('تم حذف النسخة', removeTarget.name);
      setRemoveTarget(null);
    } catch (err) {
      toastError(err, 'تعذّر حذف النسخة');
    }
  };

  return (
    <>
      <PageHeader
        title="النسخ الاحتياطي"
        subtitle="نسخة كاملة من قاعدة البيانات وصور الأصناف — إنشاء، تنزيل، استيراد واستعادة"
        actions={(
          <>
            <input
              ref={fileRef} type="file" accept=".zip,.bak" className="hidden"
              onChange={pickFile}
            />
            <Button
              icon={<Upload className="size-4" />}
              loading={mutations.import.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <span className="max-sm:hidden">استيراد نسخة</span>
              <span className="sm:hidden">استيراد</span>
            </Button>
            {/* Wrapped for the tooltip — see RowActions for why a disabled
                button cannot carry its own. */}
            <span title={caps?.can_backup ? undefined
              : 'حساب SQL لا يملك صلاحية النسخ الاحتياطي — شغّل grant-backup.sql'}>
              <Button
                variant="primary"
                icon={<DatabaseBackup className="size-4" />}
                loading={mutations.create.isPending}
                disabled={!caps?.can_backup}
                onClick={takeBackup}
              >
                <span className="max-sm:hidden">نسخة احتياطية الآن</span>
                <span className="sm:hidden">نسخة الآن</span>
              </Button>
            </span>
          </>
        )}
      />

      {isLoading ? (
        <Card className="overflow-hidden"><TableSkeleton cols={4} /></Card>
      ) : !data ? null : (
        <>
          <PermissionNotice status={data} />

          <div className="mb-4 grid gap-3 lg:grid-cols-3">
            <ScheduleCard status={data} onEdit={() => setShowSchedule(true)} />
            <StorageCard status={data} />
          </div>

          <Card className="overflow-hidden">
            {sets.length === 0 ? (
              <div className="grid min-h-[16rem] place-items-center p-4">
                <EmptyState
                  icon={<DatabaseBackup className="size-8" />}
                  title="لا توجد نسخ احتياطية"
                  message="أنشئ نسخة الآن، أو ارفع نسخة من جهاز آخر."
                  action={caps?.can_backup && (
                    <Button variant="primary" icon={<DatabaseBackup className="size-4" />}
                      loading={mutations.create.isPending} onClick={takeBackup}>
                      نسخة احتياطية الآن
                    </Button>
                  )}
                />
              </div>
            ) : (
              <>
                <div className="device-cards grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                  {sets.map((set) => (
                    <SetCard
                      key={set.name}
                      set={set}
                      canRestore={!!caps?.can_restore}
                      onDownload={() => download(set)}
                      onRestore={() => setRestoreTarget(set)}
                      onRemove={() => setRemoveTarget(set)}
                    />
                  ))}
                </div>

                <table className="data-table device-table">
                  <thead>
                    <tr>
                      <th>النسخة</th>
                      <th className="w-32">المحتوى</th>
                      <th className="w-28">الحجم</th>
                      <th className="w-px" />
                    </tr>
                  </thead>
                  <tbody>
                    {sets.map((set) => (
                      <tr key={set.name}>
                        <td data-primary>
                          <div className="flex items-center gap-2">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-muted">
                              <DatabaseBackup className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-1.5">
                                <SetName name={set.name} className="truncate font-semibold" />
                                <SourceBadge set={set} />
                              </p>
                              <p className="nums mt-0.5 text-[11px] text-subtle">
                                {fmtDateTime(set.created_at)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td data-label="المحتوى" className="text-xs text-muted">
                          <Contents set={set} />
                        </td>
                        <td data-label="الحجم" className="nums text-xs text-muted">
                          {fmtSize(set.size)}
                        </td>
                        <td>
                          <RowActions
                            canRestore={!!caps?.can_restore}
                            onDownload={() => download(set)}
                            onRestore={() => setRestoreTarget(set)}
                            onRemove={() => setRemoveTarget(set)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
        </>
      )}

      {/* Mounted only while open, so its form state is initialised from the
          current config every time rather than kept from the first render —
          otherwise cancelling out of a change and reopening shows the
          abandoned edits as though they had been saved. */}
      {data && showSchedule && (
        <ScheduleModal
          open
          status={data}
          onClose={() => setShowSchedule(false)}
          onSave={mutations.saveConfig.mutateAsync}
          busy={mutations.saveConfig.isPending}
        />
      )}

      <RestoreConfirm
        set={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={confirmRestore}
        loading={mutations.restore.isPending}
      />

      <RestoreReport result={result} onClose={() => setResult(null)} />

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        title="حذف النسخة"
        message={(
          <>
            سيُحذف {removeTarget && <SetName name={removeTarget.name} />} نهائياً من الخادم.
            إن كنت قد نزّلتها على جهازك فهي ما تزال عندك.
          </>
        )}
        confirmLabel="حذف"
        tone="danger"
        loading={mutations.remove.isPending}
      />
    </>
  );
}

/* -------------------------------------------------------------- fragments */

/** Bytes as the units people read them in. */
function fmtSize(bytes: number) {
  if (!bytes) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} غيغابايت`;
  if (mb >= 1) return `${mb.toFixed(1)} ميغابايت`;
  return `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`;
}

/**
 * A set's name, forced left-to-right.
 *
 * `2026-08-16_0200` is a run of digits and neutral separators, which the
 * bidirectional algorithm resolves against the paragraph's RTL direction — so
 * inside this Arabic page it renders as `0200_2026-08-16`, reading as a
 * different date entirely. `dir="ltr"` pins it, and the isolation keeps it
 * from disturbing the badge sitting next to it.
 */
function SetName({ name, className }: { name: string; className?: string }) {
  return (
    <span dir="ltr" className={cn('nums inline-block', className)}>{name}</span>
  );
}

/** Retention windows offered in the schedule dialog. */
const KEEP_DAY_OPTIONS = [7, 14, 30, 90, 365];

const SOURCE_LABEL: Record<BackupSet['source'], string> = {
  auto: 'تلقائية',
  manual: 'يدوية',
  imported: 'مستوردة',
  external: 'مجدولة',
};

function SourceBadge({ set }: { set: BackupSet }) {
  if (set.verified === false) {
    return <Badge tone="warning" icon={<TriangleAlert className="size-3" />}>لم تُفحص</Badge>;
  }
  return <Badge tone={set.source === 'imported' ? 'info' : 'neutral'}>{SOURCE_LABEL[set.source]}</Badge>;
}

function Contents({ set }: { set: BackupSet }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="inline-flex items-center gap-1">
        <HardDrive className="size-3" /> قاعدة البيانات
      </span>
      {set.has_uploads && (
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="size-3" /> الصور
        </span>
      )}
      {set.counts && (
        <span className="nums text-[11px] text-subtle">
          {fmtInt(set.counts.items)} صنف · {fmtInt(set.counts.invoices)} فاتورة
        </span>
      )}
    </span>
  );
}

/**
 * What this deployment's SQL login may do, and the exact command that changes
 * it. Silence here would be worse than the notice: a disabled button with no
 * explanation reads as a broken feature.
 */
function PermissionNotice({ status }: { status: BackupStatus }) {
  const { can_backup: canBackup, can_restore: canRestore, login } = status.capabilities;
  if (canBackup && canRestore) return null;

  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-3 text-xs leading-relaxed text-muted">
      {canBackup
        ? <Info className="mt-0.5 size-3.5 shrink-0" />
        : <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-accent-600 dark:text-accent-400" />}
      <div className="min-w-0 space-y-1.5">
        {!canBackup && (
          <p>
            <strong className="text-ink">النسخ الاحتياطي معطّل.</strong>{' '}
            حساب SQL <code className="font-mono">{login}</code> لا يملك الصلاحية.
            شغّل مرة واحدة على الخادم:{' '}
            <code className="font-mono" dir="ltr">deploy\windows\grant-backup.sql</code>
          </p>
        )}
        {canBackup && !canRestore && (
          <p>
            <strong className="text-ink">الاستعادة من هذه الشاشة معطّلة.</strong>{' '}
            الاستعادة تتطلب صلاحية على مستوى الخادم كاملاً (<code className="font-mono">dbcreator</code>)،
            وهي أوسع مما يحتاجه التطبيق، فلم تُمنح تلقائياً.
          </p>
        )}
        <p>
          {/* Not a workaround — for an operation that replaces the entire
              database, an elevated prompt on the server is arguably where it
              belongs anyway. */}
          الاستعادة تعمل دائماً من الخادم نفسه:{' '}
          <code className="font-mono" dir="ltr">deploy\windows\restore.ps1</code>{' '}
          — وكل نسخة تظهر هنا صالحة له.
        </p>
      </div>
    </div>
  );
}

/*
 * Both cards below carry `min-w-0` on the Card itself, not only on the text
 * inside them. A grid child defaults to `min-width: auto`, so it refuses to
 * shrink below its content however many `min-w-0`s are nested further down —
 * which is what let the long backup path stretch the page to 841px against a
 * 390px phone, and why `truncate` on that line appeared to do nothing.
 */
function ScheduleCard({ status, onEdit }: { status: BackupStatus; onEdit: () => void }) {
  const { config, next_run_at: nextRun, last_auto_run: last } = status;

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl',
            config.auto ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'bg-surface-3 text-muted',
          )}>
            <CalendarClock className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">النسخ التلقائي</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {config.auto ? (
                <>
                  كل يوم الساعة <span className="nums font-semibold">{config.time}</span>،
                  ويُحتفظ بـ <span className="nums font-semibold">{config.keep_days}</span> يوماً.
                  {nextRun && <> التالية: <span className="nums">{fmtDateTime(nextRun)}</span>.</>}
                </>
              ) : 'متوقّف — لا تُؤخذ نسخة إلا عند الضغط على الزر.'}
            </p>
          </div>
        </div>
        <Button size="sm" icon={<Clock className="size-3.5" />} onClick={onEdit}>ضبط</Button>
      </div>

      {config.copy_to && (
        <p className="flex items-start gap-1.5 border-t border-line pt-2.5 text-[11px] leading-relaxed text-muted">
          <Copy className="mt-0.5 size-3 shrink-0" />
          <span>
            وتُنسخ أيضاً إلى <code className="font-mono" dir="ltr">{config.copy_to}</code>
          </span>
        </p>
      )}

      {last && (
        <p className={cn(
          'flex items-start gap-1.5 border-t border-line pt-2.5 text-[11px] leading-relaxed',
          last.ok ? 'text-muted' : 'text-accent-700 dark:text-accent-400',
        )}>
          {last.ok
            ? <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
            : <TriangleAlert className="mt-0.5 size-3 shrink-0" />}
          <span>
            آخر تشغيل تلقائي <span className="nums">{fmtDateTime(last.at)}</span>
            {last.ok ? ` — ${last.set}` : ` — فشل: ${last.error}`}
            {last.copy_error && ` (تعذّر النسخ إلى الجهاز الآخر: ${last.copy_error})`}
          </span>
        </p>
      )}
    </Card>
  );
}

function StorageCard({ status }: { status: BackupStatus }) {
  const total = status.sets.reduce((sum, s) => sum + s.size, 0);
  const newest = status.sets[0];

  return (
    <Card className="flex min-w-0 items-start gap-3 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-muted">
        <HardDrive className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="nums text-sm font-bold">
          {status.sets.length === 0
            ? 'لا توجد نسخ'
            : `${status.sets.length} نسخة · ${fmtSize(total)}`}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted" dir="ltr" title={status.directory}>
          {status.directory}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-subtle">
          {newest
            ? <>الأحدث <span className="nums">{fmtDateTime(newest.created_at)}</span></>
            : 'لا توجد نسخ بعد'}
        </p>
      </div>
    </Card>
  );
}

function RowActions({
  canRestore, onDownload, onRestore, onRemove,
}: { canRestore: boolean; onDownload: () => void; onRestore: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="icon" variant="ghost" title="تنزيل على جهازك" onClick={onDownload}>
        <Download className="size-4" />
      </Button>
      {/* The title sits on the wrapper, not the button: `Button` sets
          `disabled:pointer-events-none`, so a disabled button never receives
          the hover that would show its own tooltip — and the tooltip is the
          only place that explains why it is disabled. */}
      <span title={canRestore
        ? 'استعادة هذه النسخة'
        : 'الاستعادة تتطلب صلاحية dbcreator على الخادم — أو استخدم restore.ps1'}>
        <Button size="icon" variant="ghost" disabled={!canRestore} onClick={onRestore}>
          <RotateCcw className="size-4" />
        </Button>
      </span>
      <Button
        size="icon" variant="ghost"
        className="hover:text-accent-600 dark:hover:text-accent-400"
        title="حذف النسخة" onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function SetCard({
  set, canRestore, onDownload, onRestore, onRemove,
}: {
  set: BackupSet; canRestore: boolean;
  onDownload: () => void; onRestore: () => void; onRemove: () => void;
}) {
  return (
    <Card className="flex flex-col p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-muted">
          <DatabaseBackup className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <SetName name={set.name} className="truncate text-sm font-bold" />
            <SourceBadge set={set} />
          </p>
          <p className="nums mt-0.5 text-[11px] text-subtle">{fmtDateTime(set.created_at)}</p>
        </div>
        <span className="nums shrink-0 text-[11px] text-muted">{fmtSize(set.size)}</span>
      </div>

      <div className="mt-2.5 text-xs text-muted"><Contents set={set} /></div>

      {set.verified === false && set.unverified_reason && (
        <p className="mt-2 rounded-lg bg-accent-50 px-2.5 py-2 text-[11px] leading-relaxed text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
          {set.unverified_reason}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end border-t border-line pt-3">
        <RowActions
          canRestore={canRestore}
          onDownload={onDownload} onRestore={onRestore} onRemove={onRemove}
        />
      </div>
    </Card>
  );
}

/**
 * Restore is the one irreversible button on this screen, so it is the one
 * confirmation that spells out the consequence in full rather than asking
 * "are you sure?".
 *
 * The checkbox exists because this screen is reachable from a phone. On a
 * pointer device the restore icon is a deliberate click on a small target; on
 * a phone card it is a thumb-sized button a finger-width from "download", and
 * the cost of catching the wrong one is every invoice entered since that
 * backup. One extra tap is a cheap price for making the mis-tap impossible,
 * and it costs the deliberate case almost nothing.
 */
function RestoreConfirm({
  set, onClose, onConfirm, loading,
}: { set: BackupSet | null; onClose: () => void; onConfirm: () => void; loading: boolean }) {
  const [understood, setUnderstood] = useState(false);

  // Re-arm for each set: leaving it ticked would defeat the point the second
  // time the dialog is opened.
  useEffect(() => { if (!set) setUnderstood(false); }, [set]);

  const close = () => { setUnderstood(false); onClose(); };

  return (
    <Modal
      open={!!set}
      onClose={close}
      title="استعادة نسخة احتياطية"
      description={set && <SetName name={set.name} />}
      size="sm"
      footer={(
        <>
          <Button onClick={close} disabled={loading}>إلغاء</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading} disabled={!understood}>
            استعادة واستبدال البيانات
          </Button>
        </>
      )}
    >
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          سيُستبدل محتوى النظام بالكامل بما كان عليه في{' '}
          <span className="nums font-semibold">{set && fmtDateTime(set.created_at)}</span>.
        </p>
        <div className="flex items-start gap-2.5 rounded-lg bg-accent-50 px-3 py-2.5 text-xs leading-relaxed text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <div className="space-y-1">
            <p>
              <strong>كل ما أُدخل بعد ذلك التاريخ سيضيع</strong> — الأصناف والفواتير
              والحركات والمستخدمون. لا يمكن التراجع.
            </p>
            <p>
              إن كان في النظام بيانات تريد الاحتفاظ بها، أغلق هذه النافذة وخذ نسخة
              احتياطية الآن أولاً.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted">
          سيتوقّف النظام عن العمل لدقائق أثناء الاستعادة، وسيحتاج كل من هو داخل النظام
          إلى إعادة تحميل الصفحة بعدها.
        </p>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-red-600"
          />
          <span className="text-xs font-semibold leading-relaxed">
            أفهم أن بيانات النظام الحالية ستُستبدل نهائياً، ولا يمكن التراجع.
          </span>
        </label>
      </div>
    </Modal>
  );
}

/** What the restore actually did — including anything that did not go to plan. */
function RestoreReport({ result, onClose }: { result: RestoreResult | null; onClose: () => void }) {
  return (
    <Modal
      open={!!result}
      onClose={onClose}
      title="تمّت الاستعادة"
      description={result && <SetName name={result.restored} />}
      size="sm"
      footer={(
        // A full reload, not a router navigation: every cached query, and the
        // whole in-memory view of a database that has just been replaced,
        // has to go.
        <Button variant="primary" onClick={() => window.location.reload()}>
          إعادة تحميل النظام
        </Button>
      )}
    >
      <div className="space-y-3 text-sm leading-relaxed">
        <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" />
          استُعيدت البيانات في {result ? Math.max(1, Math.round(result.took_ms / 1000)) : 0} ثانية
        </p>

        {result?.counts && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 text-xs">
            <Line label="الأصناف" value={result.counts.items} />
            <Line label="الفواتير" value={result.counts.invoices} />
            <Line label="الحركات" value={result.counts.movements} />
            <Line label="المستخدمون" value={result.counts.users} />
          </div>
        )}

        {result?.photos_restored != null && (
          <p className="text-xs text-muted">
            استُرجعت <span className="nums">{fmtInt(result.photos_restored)}</span> صورة صنف.
          </p>
        )}

        {!!result?.warnings.length && (
          <div className="space-y-1.5 rounded-lg bg-accent-50 px-3 py-2.5 text-xs leading-relaxed text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {result.warnings.map((warning) => (
              <p key={warning} className="flex items-start gap-1.5">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                <span>{warning}</span>
              </p>
            ))}
          </div>
        )}

        <p className="text-xs text-muted">
          كلمات المرور أيضاً عادت إلى ما كانت عليه في تاريخ النسخة — إن غيّرت كلمة
          مرور بعده، استخدم القديمة.
        </p>
      </div>
    </Modal>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <p className="flex items-baseline justify-between gap-2">
      <span className="text-subtle">{label}</span>
      <span className="nums font-bold">{fmtInt(value)}</span>
    </p>
  );
}

function ScheduleModal({
  open, status, onClose, onSave, busy,
}: {
  open: boolean;
  status: BackupStatus;
  onClose: () => void;
  onSave: (patch: Partial<BackupStatus['config']>) => Promise<unknown>;
  busy: boolean;
}) {
  const [auto, setAuto] = useState(status.config.auto);
  const [time, setTime] = useState(status.config.time);
  const [keepDays, setKeepDays] = useState(String(status.config.keep_days));
  const [copyTo, setCopyTo] = useState(status.config.copy_to);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onSave({ auto, time, keep_days: Number(keepDays), copy_to: copyTo.trim() });
      toast.success(auto ? 'تم تفعيل النسخ التلقائي' : 'تم إيقاف النسخ التلقائي',
        auto ? `كل يوم الساعة ${time}` : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر حفظ الإعدادات');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ضبط النسخ التلقائي"
      size="sm"
      footer={(
        <>
          <Button type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" form="backup-schedule-form" variant="primary" loading={busy}>
            حفظ
          </Button>
        </>
      )}
    >
      <form id="backup-schedule-form" onSubmit={submit} className="space-y-4">
        <Toggle
          checked={auto}
          onChange={setAuto}
          label="نسخة احتياطية يومية تلقائية"
          hint="تُؤخذ في الوقت المحدد، وإن كان الخادم مطفأً وقتها تُؤخذ فور تشغيله."
        />

        {auto && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="الوقت" hint="بتوقيت الخادم">
                <Input type="time" value={time} dir="ltr" className="nums"
                  onChange={(e) => setTime(e.target.value)} required />
              </Field>
              <Field label="مدة الاحتفاظ" hint="تُحذف الأقدم">
                {/* The presets, plus whatever this deployment is actually set
                    to. Without that last part a value the API allows but this
                    list does not offer (it accepts 1–3650) would not match any
                    option, the select would show the first one instead, and
                    simply opening this dialog and pressing save would change
                    the retention window without anyone asking it to. */}
                <Select value={keepDays} onChange={(e) => setKeepDays(e.target.value)}>
                  {KEEP_DAY_OPTIONS.includes(status.config.keep_days) ? null : (
                    <option value={status.config.keep_days}>
                      {status.config.keep_days} يوماً
                    </option>
                  )}
                  {KEEP_DAY_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {days === 365 ? 'سنة' : `${days} يوماً`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div>
              <Field
                label="نسخ إلى مكان آخر (اختياري)"
                // The path is wrapped in LTR isolates (U+2066 … U+2069). `hint`
                // renders as plain text inside this RTL page, and a Windows path
                // is all neutral characters to the bidirectional algorithm — so
                // unisolated it displays as `SERVER2\Backups\\`, which is not a
                // path anyone can type back in.
                hint={'مجلد على الخادم أو على جهاز آخر — مثال: ⁦\\\\SERVER2\\Backups⁩'}
              >
                <Input value={copyTo} dir="ltr" placeholder="\\SERVER2\Backups"
                  onChange={(e) => setCopyTo(e.target.value)} />
              </Field>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button" size="sm"
                  icon={<FolderSearch className="size-3.5" />}
                  onClick={() => setPicking(true)}
                >
                  استعراض مجلدات الخادم
                </Button>
                <DestinationStatus path={copyTo} />
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                نسخة على نفس القرص تحميك من خطأ في البيانات، لا من عطل في القرص نفسه.
                حدِّد مكاناً ثانياً هنا، أو استخدم{' '}
                <code className="font-mono" dir="ltr">backup-pull.ps1</code> على الجهاز
                الآخر ليسحب النسخ بنفسه.
              </span>
            </div>
          </>
        )}

        {!status.capabilities.can_backup && (
          <p className="flex items-start gap-2 rounded-lg bg-accent-50 px-3 py-2.5 text-[11px] leading-relaxed text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              يمكنك حفظ الجدولة الآن، لكنها ستفشل كل ليلة حتى تُمنح صلاحية النسخ
              الاحتياطي لحساب SQL.
            </span>
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {error}
          </p>
        )}
      </form>

      {picking && (
        <FolderPicker
          initialPath={copyTo}
          onClose={() => setPicking(false)}
          onPick={(chosen) => { setCopyTo(chosen); setPicking(false); }}
        />
      )}
    </Modal>
  );
}

/**
 * Whether the API can actually write to the destination as it stands.
 *
 * Answered now rather than at 02:00 tomorrow. The copy is made by the API's
 * service account — not by SQL Server, and not by whoever is looking at this
 * screen — so "it opens fine in Explorer" proves nothing, and the usual way to
 * discover that is a month of backups that were never copied anywhere.
 *
 * The check is the same probe the folder picker uses: the server writes a file
 * and deletes it, as itself. Debounced, because this runs while the path is
 * still being typed and every keystroke would otherwise reach for a network
 * share.
 */
function DestinationStatus({ path }: { path: string }) {
  const trimmed = path.trim();
  const debounced = useDebounced(trimmed, 700);
  // While the two disagree the user is still typing, and the last answer
  // belongs to a different path — showing it would be worse than showing none.
  const settled = debounced === trimmed;
  const { data, error, isFetching } = useBrowse(debounced || null, settled && !!debounced);

  if (!trimmed) return null;
  if (!settled || isFetching) {
    return <span className="text-[11px] text-subtle">…جارٍ الفحص</span>;
  }
  if (error) {
    return (
      <Badge tone="danger" icon={<TriangleAlert className="size-3" />}>
        {error instanceof Error && error.message.length < 60 ? error.message : 'تعذّر الوصول'}
      </Badge>
    );
  }
  if (!data) return null;

  return data.writable
    ? <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>يمكن الكتابة هنا</Badge>
    : (
      <Badge tone="warning" icon={<TriangleAlert className="size-3" />}>
        المجلد موجود لكن لا يمكن الكتابة فيه
      </Badge>
    );
}

/**
 * Pick a folder **on the server**.
 *
 * Not a file input. `<input type="file" webkitdirectory>` browses the device in
 * the manager's hand — a phone, most of the time — and returns relative names,
 * never a server path. It would produce a value that looks like an answer and
 * copies nothing. So the server lists its own folders (`GET /backup/browse`,
 * directory names only) and this walks them.
 *
 * The typed path stays: a network share cannot be discovered by browsing, only
 * entered. Browsing is for getting to a local folder without spelling it, and
 * for confirming a typed share is actually reachable — which is what the
 * writable check answers, by writing a probe file rather than asking.
 */
function FolderPicker({
  initialPath, onClose, onPick,
}: { initialPath: string; onClose: () => void; onPick: (path: string) => void }) {
  // `null` means the drive list — there is nothing above a drive letter.
  const [current, setCurrent] = useState<string | null>(initialPath.trim() || null);
  const [typed, setTyped] = useState(initialPath.trim());
  const { data, isFetching, error } = useBrowse(current);

  // Keep the address bar in step with navigation, but never fight the typing:
  // only the *result* of a successful load writes back into it.
  useEffect(() => { if (data?.path) setTyped(data.path); }, [data?.path]);

  const go = (path: string | null) => setCurrent(path);

  return (
    <Modal
      open
      onClose={onClose}
      title="اختيار مجلد على الخادم"
      description="مجلدات الخادم — لا مجلدات هذا الجهاز"
      size="sm"
      footer={(
        <>
          <Button type="button" onClick={onClose}>إلغاء</Button>
          <Button
            type="button" variant="primary"
            disabled={!typed.trim()}
            onClick={() => onPick(typed.trim())}
          >
            اختيار هذا المجلد
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        {/* Address bar. Doubles as the way in for a network share, which
            cannot be reached by browsing from a drive letter. */}
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); go(typed.trim() || null); }}
        >
          <Input
            value={typed}
            dir="ltr"
            placeholder="\\SERVER2\Backups"
            className="flex-1"
            onChange={(e) => setTyped(e.target.value)}
          />
          <Button type="submit" size="icon" title="فتح هذا المسار">
            <CornerDownLeft className="size-4" />
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="subtle" icon={<HardDrive className="size-3.5" />}
            onClick={() => go(null)}>
            الأقراص
          </Button>
          {data?.parent && (
            <Button size="sm" variant="subtle" icon={<CornerUpRight className="size-3.5" />}
              onClick={() => go(data.parent)}>
              للأعلى
            </Button>
          )}
          {data?.path && (
            <Badge tone={data.writable ? 'success' : 'warning'}>
              {data.writable ? 'قابل للكتابة' : 'غير قابل للكتابة'}
            </Badge>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2.5 text-xs leading-relaxed text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {error instanceof Error ? error.message : 'تعذّر فتح المجلد'}
          </p>
        )}

        {/* A fixed-height scroller: the list length varies wildly between a
            drive root and a deep folder, and a modal that jumps size on every
            navigation is unusable on a phone. */}
        <div className="h-64 overflow-y-auto rounded-lg border border-line">
          {isFetching ? (
            <div className="grid h-full place-items-center text-xs text-muted">…جارٍ القراءة</div>
          ) : !data?.entries.length ? (
            <div className="grid h-full place-items-center px-4 text-center text-xs text-muted">
              {data ? 'لا مجلدات فرعية هنا — يمكنك اختيار هذا المجلد نفسه.' : ''}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => go(entry.path)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm hover:bg-surface-2"
                  >
                    <Folder className="size-4 shrink-0 text-muted" />
                    <span className="truncate" dir="auto">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-subtle">
          النسخ يتم بحساب خدمة النظام على الخادم، لا بحسابك — فمجلد على جهاز آخر
          يحتاج أن يكون مشارَكاً لذلك الحساب. علامة «قابل للكتابة» أعلاه تختبر ذلك فعلياً.
        </p>
      </div>
    </Modal>
  );
}
