import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, Download, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Loader2,
  ArrowRight, RotateCcw, FileWarning,
} from 'lucide-react';
import { Button, Card, PageHeader, Badge, Stat } from '@/components/ui';
import { useImportMutations } from '@/hooks';
import { api } from '@/lib/api';
import { fmtCurrency, fmtInt } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import { cn } from '@/lib/cn';
import type { ImportPreview, ImportResult } from '@/lib/types';

type Step = 'upload' | 'preview' | 'done';

export default function ImportItems() {
  const [step, setStep] = useState<Step>('upload');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mutations = useImportMutations();

  const reset = () => { setStep('upload'); setPreview(null); setResult(null); };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error('صيغة غير مدعومة', 'يُقبل ملف Excel بصيغة ‎.xlsx‎ فقط');
      return;
    }
    try {
      const data = await mutations.preview.mutateAsync(file);
      setPreview(data);
      setStep('preview');
      if (data.invalid_count) {
        toast.warning(`${data.invalid_count} صف يحتوي على أخطاء`, 'راجع الجدول قبل التأكيد');
      }
    } catch (error) {
      toastError(error, 'تعذّر قراءة الملف');
    }
  };

  const commit = async () => {
    if (!preview) return;
    try {
      const data = await mutations.commit.mutateAsync({ upload_id: preview.upload_id, on_duplicate: onDuplicate });
      setResult(data);
      setStep('done');
      toast.success('اكتمل الاستيراد', `أُنشئ ${data.created_count} صنف وتم تحديث ${data.updated_count}`);
    } catch (error) {
      toastError(error, 'تعذّر إتمام الاستيراد');
    }
  };

  const downloadTemplate = () =>
    api.download('/items/import/template', 'قالب-استيراد-الأصناف.xlsx')
      .catch((error) => toastError(error, 'تعذّر تنزيل القالب'));

  const downloadErrors = () =>
    preview && api.download(`/items/import/${preview.upload_id}/errors`, 'الصفوف-المرفوضة.xlsx')
      .catch((error) => toastError(error, 'تعذّر تنزيل التقرير'));

  return (
    <>
      <PageHeader
        title="استيراد الأصناف من Excel"
        subtitle="عرّف مئات الأصناف دفعة واحدة مع مراجعة كاملة قبل الحفظ"
        actions={
          <Button icon={<Download className="size-4" />} onClick={downloadTemplate}>تنزيل القالب</Button>
        }
      />

      <Steps step={step} />

      {step === 'upload' && (
        <Card className="mt-4 p-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition',
              dragging ? 'border-brand-500 bg-brand-500/8' : 'border-line-strong hover:border-brand-400 hover:bg-surface-2',
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            {mutations.preview.isPending ? (
              <>
                <Loader2 className="size-10 animate-spin text-brand-500" />
                <p className="mt-4 text-sm font-semibold">جارٍ تحليل الملف…</p>
                <p className="mt-1 text-xs text-muted">قد يستغرق الأمر لحظات مع الملفات الكبيرة</p>
              </>
            ) : (
              <>
                <div className="grid size-16 place-items-center rounded-2xl bg-brand-500/10 text-brand-500">
                  <Upload className="size-7" />
                </div>
                <p className="mt-4 text-sm font-bold">اسحب ملف ‎.xlsx‎ وأفلته هنا</p>
                <p className="mt-1 text-xs text-muted">أو انقر لاختيار الملف من جهازك</p>
              </>
            )}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-2 p-4">
              <p className="text-xs font-bold">الأعمدة المطلوبة</p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                <li><code className="font-mono text-ink">name</code> — اسم الصنف (إلزامي)</li>
                <li><code className="font-mono text-ink">barcode</code> — الباركود (إلزامي)</li>
                <li><code className="font-mono text-ink">category</code> — التصنيف (يُنشأ تلقائياً)</li>
                <li><code className="font-mono text-ink">purchase_price</code> — سعر الشراء</li>
                <li><code className="font-mono text-ink">sale_price</code> — سعر البيع</li>
                <li><code className="font-mono text-ink">opening_quantity</code> — الرصيد الافتتاحي</li>
              </ul>
            </div>
            <div className="rounded-xl bg-surface-2 p-4">
              <p className="text-xs font-bold">كيف تُعالَج البيانات</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
                <li>• تُعرض كل الصفوف للمراجعة قبل أي حفظ.</li>
                <li>• الصفوف التي تحتوي أخطاء تُرفض وحدها دون إيقاف البقية.</li>
                <li>• الرصيد الافتتاحي يُسجَّل عبر فاتورة إدخال واحدة قابلة للتتبع.</li>
                <li>• يمكنك تنزيل تقرير بالصفوف المرفوضة مع سبب كل رفض.</li>
              </ul>
            </div>
          </div>
        </Card>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryCard tone="brand" label="إجمالي الصفوف" value={preview.total} icon={<FileSpreadsheet className="size-5" />} />
            <SummaryCard tone="success" label="صفوف جديدة صالحة" value={preview.valid_count} icon={<CheckCircle2 className="size-5" />} />
            <SummaryCard tone="warning" label="باركود موجود مسبقاً" value={preview.duplicate_count} icon={<AlertTriangle className="size-5" />} />
            <SummaryCard tone="danger" label="صفوف مرفوضة" value={preview.invalid_count} icon={<XCircle className="size-5" />} />
          </div>

          {preview.duplicate_count > 0 && (
            <Card className="mt-4 p-4">
              <p className="text-sm font-bold">كيف نتعامل مع الباركودات الموجودة مسبقاً؟</p>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {([
                  { value: 'skip', title: 'تخطي الصف', hint: 'إبقاء بيانات الصنف الحالية كما هي' },
                  { value: 'update', title: 'تحديث الصنف', hint: 'استبدال الاسم والأسعار بالقيم الجديدة' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setOnDuplicate(option.value)}
                    className={cn(
                      'rounded-xl border-2 p-3 text-start transition',
                      onDuplicate === option.value
                        ? 'border-brand-500 bg-brand-500/8'
                        : 'border-line bg-surface-2 hover:border-line-strong',
                    )}
                  >
                    <p className="text-sm font-bold">{option.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{option.hint}</p>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <Card className="mt-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="text-sm font-bold">معاينة الصفوف — {preview.filename}</h2>
              {preview.invalid_count > 0 && (
                <Button size="sm" icon={<FileWarning className="size-3.5" />} onClick={downloadErrors}>
                  تنزيل تقرير الأخطاء
                </Button>
              )}
            </div>

            <div className="max-h-[26rem] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-12 text-center">الصف</th>
                    <th>الاسم</th>
                    <th>التصنيف</th>
                    <th>الباركود</th>
                    <th className="text-center">شراء</th>
                    <th className="text-center">بيع</th>
                    <th className="text-center">افتتاحي</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.row_number}
                      className={cn(!row.valid && 'bg-rose-500/6', row.valid && row.duplicate && 'bg-amber-500/6')}
                    >
                      <td className="nums text-center text-xs text-subtle">{row.row_number}</td>
                      <td className="max-w-[16rem] truncate font-medium">{row.name || <span className="text-rose-500">—</span>}</td>
                      <td className="text-xs text-muted">{row.category || '—'}</td>
                      <td className="nums font-mono text-xs">{row.barcode || <span className="text-rose-500">—</span>}</td>
                      <td className="nums text-center text-xs">{fmtCurrency(row.purchase_price)}</td>
                      <td className="nums text-center text-xs">{fmtCurrency(row.sale_price)}</td>
                      <td className="nums text-center text-xs">{fmtInt(row.opening_quantity)}</td>
                      <td>
                        {!row.valid ? (
                          <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
                            {row.errors.join('؛ ')}
                          </span>
                        ) : row.duplicate ? (
                          <Badge tone="warning">
                            موجود: {row.existing_item_name}
                          </Badge>
                        ) : (
                          <Badge tone="success">جاهز</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-4 py-3">
              <p className="text-xs text-muted">
                سيتم حفظ {fmtInt(preview.valid_count + (onDuplicate === 'update' ? preview.duplicate_count : 0))} صف،
                وتجاهل {fmtInt(preview.invalid_count + (onDuplicate === 'skip' ? preview.duplicate_count : 0))} صف.
              </p>
              <div className="flex gap-2">
                <Button icon={<RotateCcw className="size-4" />} onClick={reset}>اختيار ملف آخر</Button>
                <Button
                  variant="primary"
                  icon={<CheckCircle2 className="size-4" />}
                  onClick={commit}
                  loading={mutations.commit.isPending}
                  disabled={preview.valid_count === 0 && !(onDuplicate === 'update' && preview.duplicate_count > 0)}
                >
                  تأكيد الاستيراد
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {step === 'done' && result && (
        <Card className="mt-4 p-8">
          <div className="mx-auto max-w-lg text-center">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-emerald-500/12 text-emerald-500">
              <CheckCircle2 className="size-8" />
            </div>
            <h2 className="mt-4 text-lg font-bold">اكتمل الاستيراد</h2>

            <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-surface-2 p-4 text-start sm:grid-cols-4">
              <Stat label="أصناف جديدة" value={fmtInt(result.created_count)} tone="text-emerald-600 dark:text-emerald-400" />
              <Stat label="أصناف محدّثة" value={fmtInt(result.updated_count)} />
              <Stat label="صفوف متخطاة" value={fmtInt(result.skipped_count)} />
              <Stat label="صفوف مرفوضة" value={fmtInt(result.rejected_count)}
                tone={result.rejected_count ? 'text-rose-600 dark:text-rose-400' : undefined} />
            </div>

            {result.opening_invoice && (
              <p className="mt-4 text-sm text-muted">
                سُجّلت الأرصدة الافتتاحية عبر الفاتورة{' '}
                <Link to={`/invoices/${result.opening_invoice.id}`}
                  className="nums font-mono font-semibold text-brand-600 hover:underline dark:text-brand-400">
                  {result.opening_invoice.number}
                </Link>
              </p>
            )}

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button icon={<RotateCcw className="size-4" />} onClick={reset}>استيراد ملف آخر</Button>
              {result.rejected_count > 0 && (
                <Button icon={<FileWarning className="size-4" />} onClick={downloadErrors}>
                  تنزيل الصفوف المرفوضة
                </Button>
              )}
              <Link to="/items">
                <Button variant="primary" icon={<ArrowRight className="size-4" />}>عرض الأصناف</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function Steps({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'upload', label: 'رفع الملف' },
    { key: 'preview', label: 'المراجعة' },
    { key: 'done', label: 'الحفظ' },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="flex items-center gap-2">
      {steps.map((item, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
        return (
          <div key={item.key} className="flex flex-1 items-center gap-2">
            <span className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition',
              state === 'done' && 'bg-emerald-500 text-white',
              state === 'active' && 'bg-brand-600 text-white',
              state === 'todo' && 'bg-surface-3 text-subtle',
            )}>
              {state === 'done' ? <CheckCircle2 className="size-4" /> : index + 1}
            </span>
            <span className={cn('text-xs font-semibold',
              state === 'todo' ? 'text-subtle' : 'text-ink')}>
              {item.label}
            </span>
            {index < steps.length - 1 && (
              <span className={cn('h-px flex-1 rounded', index < activeIndex ? 'bg-emerald-500' : 'bg-line')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const SUMMARY_TONES = {
  brand: 'bg-brand-500/12 text-brand-600 dark:text-brand-400',
  success: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  danger: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
};

function SummaryCard({
  tone, label, value, icon,
}: { tone: keyof typeof SUMMARY_TONES; label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', SUMMARY_TONES[tone])}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted">{label}</p>
        <p className="nums text-xl font-bold">{fmtInt(value)}</p>
      </div>
    </Card>
  );
}
