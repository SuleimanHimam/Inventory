import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, RefreshCw, Ban, ClipboardList, Loader2, TriangleAlert,
  SkipForward, ArrowDownLeft, ArrowUpRight, PartyPopper, Printer, Search,
} from 'lucide-react';
import {
  Button, Card, PageHeader, Badge, EmptyState, ConfirmDialog, Stat, SearchInput,
} from '@/components/ui';
import { BarcodeChip, COUNT_STATUS, VarianceCell } from '@/components/domain';
import { useStockCount, useStockCountMutations } from '@/hooks';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import { cn } from '@/lib/cn';
import type { StockCountLine } from '@/lib/types';

export default function StockCountDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading } = useStockCount(id);
  const mutations = useStockCountMutations();

  const [filter, setFilter] = useState('');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [applied, setApplied] = useState<{ number: string; id: string; type: string }[] | null>(null);

  const lines = session?.lines ?? [];
  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return lines;
    return lines.filter((line) =>
      line.item_name.toLowerCase().includes(term) || line.item_barcode.includes(term));
  }, [lines, filter]);

  const staleCount = lines.filter((line) => line.is_stale).length;

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (!session) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title="جلسة الجرد غير موجودة"
          action={<Link to="/stock-counts"><Button variant="primary">العودة إلى الجرد</Button></Link>}
        />
      </Card>
    );
  }

  const summary = session.summary!;
  const progress = session.line_count ? Math.round((summary.entered / session.line_count) * 100) : 0;
  const editable = session.status === 'OPEN' || session.status === 'SUBMITTED';

  const submit = async () => {
    try {
      await mutations.submit.mutateAsync(session.id);
      setConfirmSubmit(false);
      toast.success('تم تسليم الجلسة للمراجعة', 'راجع الفروقات ثم اعتمد التسوية');
    } catch (error) {
      setConfirmSubmit(false);
      toastError(error, 'تعذّر تسليم الجلسة');
    }
  };

  const apply = async () => {
    try {
      const result = await mutations.apply.mutateAsync(session.id);
      setConfirmApply(false);
      setApplied(result.invoices.map((i) => ({ id: i.id, number: i.number, type: i.type })));
      toast.success('تم اعتماد الجرد', result.invoices.length
        ? `أُنشئت ${result.invoices.length} فاتورة تسوية`
        : 'لا توجد فروقات — لم تُنشأ فواتير');
    } catch (error) {
      setConfirmApply(false);
      toastError(error, 'تعذّر اعتماد الجرد');
    }
  };

  const refresh = async () => {
    try {
      await mutations.refreshExpected.mutateAsync(session.id);
      toast.success('تم تحديث الكميات المتوقعة من الأرصدة الحالية');
    } catch (error) {
      toastError(error, 'تعذّر التحديث');
    }
  };

  const cancel = async () => {
    try {
      await mutations.cancel.mutateAsync(session.id);
      setConfirmCancel(false);
      toast.info('تم إلغاء الجلسة', 'لم يتأثر المخزون');
    } catch (error) {
      setConfirmCancel(false);
      toastError(error, 'تعذّر إلغاء الجلسة');
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/stock-counts" className="inline-flex items-center gap-1 hover:text-brand-500">
            <ArrowRight className="size-3" /> الجرد
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            جلسة جرد
            <span className="nums font-mono text-base text-subtle">{session.number}</span>
            <Badge tone={COUNT_STATUS[session.status].tone}>{COUNT_STATUS[session.status].label}</Badge>
          </span>
        }
        subtitle={
          session.scope === 'ALL' ? 'النطاق: كل الأصناف'
            : session.scope === 'CATEGORY' ? `النطاق: تصنيف ${session.category_name}`
              : `النطاق: صنف ${session.item_name}`
        }
        actions={
          <>
            {editable && staleCount > 0 && (
              <Button icon={<RefreshCw className="size-4" />} onClick={refresh} loading={mutations.refreshExpected.isPending}>
                تحديث المتوقع
              </Button>
            )}
            {session.status !== 'APPLIED' && session.status !== 'CANCELLED' && (
              <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setConfirmCancel(true)}>
                إلغاء الجلسة
              </Button>
            )}
            {session.status === 'OPEN' && (
              <Button
                variant="primary"
                icon={<CheckCircle2 className="size-4" />}
                disabled={summary.entered < session.line_count}
                title={summary.entered < session.line_count
                  ? `تبقّى ${session.line_count - summary.entered} صنف بلا كمية` : undefined}
                onClick={() => setConfirmSubmit(true)}
              >
                تسليم للمراجعة
              </Button>
            )}
            {session.status === 'SUBMITTED' && (
              <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => setConfirmApply(true)}>
                اعتماد وتسوية المخزون
              </Button>
            )}
            {session.status === 'APPLIED' && (
              <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>طباعة</Button>
            )}
          </>
        }
      />

      {/* Success panel right after applying */}
      {applied && (
        <Card className="mb-4 border-emerald-500/30 bg-emerald-500/8 p-5 no-print">
          <div className="flex items-start gap-3.5">
            <PartyPopper className="mt-0.5 size-6 shrink-0 text-emerald-500" />
            <div className="flex-1">
              <h2 className="font-bold">تمت تسوية المخزون بنجاح</h2>
              <p className="mt-1 text-sm text-muted">
                {applied.length
                  ? 'أُنشئت الفواتير التالية ورُحّلت تلقائياً. يمكنك عرضها أو طباعتها كأي فاتورة أخرى.'
                  : 'لم تكن هناك أي فروقات، لذلك لم تُنشأ أي فاتورة.'}
              </p>
              {!!applied.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {applied.map((invoice) => (
                    <Link key={invoice.id} to={`/invoices/${invoice.id}`}>
                      <Button size="sm" variant="secondary"
                        icon={invoice.type === 'STOCK_IN'
                          ? <ArrowDownLeft className="size-3.5 text-emerald-500" />
                          : <ArrowUpRight className="size-3.5 text-rose-500" />}>
                        <span className="nums font-mono">{invoice.number}</span>
                      </Button>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Progress + summary */}
      <div className="mb-4 grid gap-4 lg:grid-cols-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">تقدّم الإدخال</h2>
            <span className="nums text-sm font-bold text-brand-600 dark:text-brand-400">{progress}٪</span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn('h-full rounded-full transition-all duration-300',
                progress === 100 ? 'bg-emerald-500' : 'bg-brand-500')}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="تم إدخالها" value={`${fmtInt(summary.entered)} / ${fmtInt(session.line_count)}`} />
            <Stat label="غير مجرودة" value={fmtInt(summary.skipped)} />
            <Stat label="بلا تغيير" value={fmtInt(summary.unchanged)} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <ArrowDownLeft className="size-4" />
            <h2 className="text-sm font-bold">زيادة</h2>
          </div>
          <p className="nums mt-2 text-3xl font-bold text-emerald-600 dark:text-emerald-400">
            {fmtInt(summary.surplus.length)}
          </p>
          <p className="nums mt-1 text-xs text-muted">{fmtInt(summary.surplus_units)} وحدة ← فاتورة إدخال</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <ArrowUpRight className="size-4" />
            <h2 className="text-sm font-bold">نقص</h2>
          </div>
          <p className="nums mt-2 text-3xl font-bold text-rose-600 dark:text-rose-400">
            {fmtInt(summary.shortage.length)}
          </p>
          <p className="nums mt-1 text-xs text-muted">{fmtInt(summary.shortage_units)} وحدة ← فاتورة إخراج</p>
        </Card>
      </div>

      {staleCount > 0 && editable && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm no-print">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="font-semibold text-amber-700 dark:text-amber-400">
              تغيّرت أرصدة {fmtInt(staleCount)} صنف بعد بدء الجلسة
            </p>
            <p className="mt-0.5 text-xs text-muted">
              حدثت حركات مخزون على هذه الأصناف بعد التقاط الصورة الأولية. حدّث الكميات المتوقعة
              قبل الاعتماد لتفادي تسوية خاطئة.
            </p>
          </div>
          <Button size="sm" onClick={refresh} loading={mutations.refreshExpected.isPending}>تحديث الآن</Button>
        </div>
      )}

      {/* Count table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3.5">
          <SearchInput value={filter} onValueChange={setFilter}
            placeholder="تصفية داخل قائمة الجرد…" className="min-w-56 flex-1 max-w-sm" />
          <div className="flex items-center gap-3 text-[11px] text-muted no-print">
            <Legend className="bg-emerald-500" label="زيادة" />
            <Legend className="bg-rose-500" label="نقص" />
            <Legend className="bg-slate-400" label="مطابق" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table stacked">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الباركود</th>
                <th className="text-center">المتوقع</th>
                <th className="w-32 text-center">الكمية الفعلية</th>
                <th className="text-center">الفرق</th>
                <th>ملاحظة</th>
                {editable && <th className="w-px" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((line, index) => (
                <CountRow
                  key={line.id}
                  line={line}
                  sessionId={session.id}
                  editable={editable}
                  autoFocus={index === 0 && !filter}
                />
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <EmptyState icon={<Search className="size-6" />} title="لا توجد أصناف مطابقة للتصفية" />
        )}
      </Card>

      {session.applied_at && (
        <p className="nums mt-3 text-center text-xs text-subtle">
          اعتُمدت في {fmtDateTime(session.applied_at)} — بواسطة {session.created_by}
        </p>
      )}

      <ConfirmDialog
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        onConfirm={submit}
        loading={mutations.submit.isPending}
        tone="primary"
        title="تسليم الجلسة للمراجعة"
        confirmLabel="تسليم"
        message="ستنتقل الجلسة إلى مرحلة المراجعة لعرض ملخص الفروقات قبل التسوية. يمكنك العودة والتعديل قبل الاعتماد."
      />

      <ConfirmDialog
        open={confirmApply}
        onClose={() => setConfirmApply(false)}
        onConfirm={apply}
        loading={mutations.apply.isPending}
        tone="success"
        title="اعتماد الجرد وتسوية المخزون"
        confirmLabel="اعتماد نهائي"
        message={
          <>
            سينشئ النظام ويُرحّل تلقائياً:
            <ul className="mt-2 space-y-1.5">
              {summary.surplus.length > 0 && (
                <li className="flex items-center gap-2">
                  <ArrowDownLeft className="size-3.5 text-emerald-500" />
                  فاتورة إدخال بـ {fmtInt(summary.surplus.length)} صنف ({fmtInt(summary.surplus_units)} وحدة)
                </li>
              )}
              {summary.shortage.length > 0 && (
                <li className="flex items-center gap-2">
                  <ArrowUpRight className="size-3.5 text-rose-500" />
                  فاتورة إخراج بـ {fmtInt(summary.shortage.length)} صنف ({fmtInt(summary.shortage_units)} وحدة)
                </li>
              )}
              {!summary.surplus.length && !summary.shortage.length && (
                <li className="text-muted">لا توجد فروقات — لن تُنشأ أي فاتورة.</li>
              )}
            </ul>
            <p className="mt-3 text-xs">
              العملية كاملة أو لا شيء: إذا فشل أي سطر يُلغى الاعتماد بالكامل وتبقى الجلسة قابلة للتصحيح.
              بعد الاعتماد تصبح الجلسة وفواتيرها غير قابلة للتعديل.
            </p>
          </>
        }
      />

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancel}
        loading={mutations.cancel.isPending}
        title="إلغاء جلسة الجرد"
        confirmLabel="إلغاء الجلسة"
        message="ستُحفظ الجلسة كسجل ملغى ولن تؤثر على المخزون إطلاقاً."
      />
    </>
  );
}

/**
 * One count line. The actual-quantity input commits on blur; Enter jumps to
 * the next row so a whole shelf can be counted without touching the mouse.
 */
function CountRow({
  line, sessionId, editable, autoFocus,
}: { line: StockCountLine; sessionId: string; editable: boolean; autoFocus: boolean }) {
  const mutations = useStockCountMutations();
  const [value, setValue] = useState(line.counted_quantity === null ? '' : String(line.counted_quantity));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(line.counted_quantity === null ? '' : String(line.counted_quantity));
  }, [line.counted_quantity]);

  const commit = () => {
    const raw = value.trim();
    const next = raw === '' ? null : Number(raw);
    if (next !== null && (!Number.isInteger(next) || next < 0)) {
      setValue(line.counted_quantity === null ? '' : String(line.counted_quantity));
      return;
    }
    if (next === line.counted_quantity) return;
    mutations.updateLine.mutate(
      { id: sessionId, lineId: line.id, counted_quantity: next },
      { onError: (error) => toastError(error, 'تعذّر حفظ الكمية') },
    );
  };

  const toggleSkip = () => {
    mutations.updateLine.mutate(
      { id: sessionId, lineId: line.id, skipped: !line.skipped },
      { onError: (error) => toastError(error, 'تعذّر تحديث السطر') },
    );
  };

  // Live variance while typing, so the row colours before the value is saved.
  const typed = value.trim() === '' ? null : Number(value);
  const variance = typed === null || Number.isNaN(typed) ? line.variance : typed - line.expected_quantity;

  const rowTone =
    line.skipped ? 'opacity-50'
      : variance === null ? ''
        : variance > 0 ? 'bg-emerald-500/6'
          : variance < 0 ? 'bg-rose-500/6' : '';

  return (
    <tr className={rowTone}>
      <td data-primary className="max-w-xs">
        <Link to={`/items/${line.item_id}`} className="font-semibold hover:text-brand-600 dark:hover:text-brand-400">
          {line.item_name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {line.category_name && <span className="text-[11px] text-subtle">{line.category_name}</span>}
          {line.is_stale && <Badge tone="warning">تغيّر الرصيد</Badge>}
          {line.skipped && <Badge tone="neutral">غير مجرودة</Badge>}
        </div>
      </td>
      <td data-label="الباركود"><BarcodeChip code={line.item_barcode} /></td>
      <td data-label="المتوقع" className="nums text-center font-semibold text-muted">
        {fmtInt(line.expected_quantity)}
        {line.is_stale && (
          <span className="nums block text-[10px] text-amber-500">الآن {fmtInt(line.live_quantity)}</span>
        )}
      </td>
      <td data-label="الكمية الفعلية">
        {editable ? (
          <input
            ref={inputRef}
            value={value}
            autoFocus={autoFocus}
            disabled={line.skipped}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              commit();
              // Move focus to the same input in the adjacent row.
              const row = e.currentTarget.closest('tr');
              const sibling = e.key === 'ArrowUp' ? row?.previousElementSibling : row?.nextElementSibling;
              sibling?.querySelector<HTMLInputElement>('input[type=number]')?.focus();
            }}
            type="number" min="0" step="1" inputMode="numeric"
            placeholder="—"
            className="field nums h-9 py-0 text-center text-base font-bold"
            aria-label={`الكمية الفعلية لـ ${line.item_name}`}
          />
        ) : (
          <p className="nums text-center text-base font-bold">
            {line.counted_quantity === null ? '—' : fmtInt(line.counted_quantity)}
          </p>
        )}
      </td>
      <td data-label="الفرق" className="text-center"><VarianceCell variance={line.skipped ? null : variance} /></td>
      <td>
        {editable ? (
          <input
            defaultValue={line.note ?? ''}
            onBlur={(e) => {
              if (e.target.value === (line.note ?? '')) return;
              mutations.updateLine.mutate({ id: sessionId, lineId: line.id, note: e.target.value });
            }}
            placeholder="سبب الفرق…"
            className="field h-8 py-0 text-xs"
          />
        ) : (
          <span className="text-xs text-muted">{line.note || '—'}</span>
        )}
      </td>
      {editable && (
        <td>
          <Button
            size="icon" variant="ghost" className="size-8"
            title={line.skipped ? 'إعادة إدراجها في الجرد' : 'تعليمها كغير مجرودة'}
            onClick={toggleSkip}
          >
            <SkipForward className={cn('size-4', line.skipped && 'text-brand-500')} />
          </Button>
        </td>
      )}
    </tr>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-sm', className)} />
      {label}
    </span>
  );
}
