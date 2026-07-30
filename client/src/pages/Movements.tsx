import { useEffect, useState } from 'react';
import { ArrowLeftRight, Download } from 'lucide-react';
import {
  Button, Card, PageHeader, Pagination, Select, EmptyState, TableSkeleton, Input, Badge,
} from '@/components/ui';
import { InvoiceLink, ItemLink, MovementBadge, REFERENCE_LABEL, BarcodeChip } from '@/components/domain';
import { useMovements } from '@/hooks';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function Movements() {
  const [type, setType] = useState('');
  const [reference, setReference] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const { data, isLoading, isFetching } = useMovements({
    type: type || undefined,
    reference_type: reference || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page,
    limit,
  });

  useEffect(() => { setPage(1); }, [type, reference, dateFrom, dateTo, limit]);

  const movements = data?.data ?? [];
  const hasFilters = !!(type || reference || dateFrom || dateTo);

  /** Client-side CSV of the current page — a quick hand-off to Excel. */
  const exportCsv = () => {
    const header = ['التاريخ', 'الصنف', 'الباركود', 'النوع', 'الكمية', 'المصدر', 'المستند', 'ملاحظة'];
    const rows = movements.map((m) => [
      fmtDateTime(m.created_at), m.item_name, m.item_barcode,
      m.type === 'IN' ? 'وارد' : 'صادر', m.quantity,
      REFERENCE_LABEL[m.reference_type], m.invoice_number ?? '', m.note ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    // BOM keeps Arabic readable when Excel opens the file.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'حركات-المخزون.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="حركات المخزون"
        subtitle="السجل الكامل لكل حركة دخول وخروج — سجل غير قابل للتعديل"
        actions={
          <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!movements.length}>
            تصدير الصفحة (CSV)
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-3.5">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto min-w-32">
            <option value="">كل الأنواع</option>
            <option value="IN">وارد فقط</option>
            <option value="OUT">صادر فقط</option>
          </Select>
          <Select value={reference} onChange={(e) => setReference(e.target.value)} className="w-auto min-w-40">
            <option value="">كل المصادر</option>
            <option value="INVOICE">فاتورة</option>
            <option value="MANUAL">حركة يدوية</option>
            <option value="STOCK_COUNT">تسوية جرد</option>
            <option value="IMPORT">استيراد</option>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="nums w-auto" aria-label="من تاريخ" />
            <span className="text-xs text-subtle">إلى</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="nums w-auto" aria-label="إلى تاريخ" />
          </div>
          {hasFilters && (
            <Button variant="ghost" onClick={() => {
              setType(''); setReference(''); setDateFrom(''); setDateTo('');
            }}>
              إزالة التصفية
            </Button>
          )}
        </div>

        {isLoading ? (
          <TableSkeleton cols={7} />
        ) : movements.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="size-6" />}
            title={hasFilters ? 'لا توجد حركات مطابقة' : 'لا توجد حركات مخزون بعد'}
            message={hasFilters
              ? 'جرّب توسيع النطاق الزمني أو إزالة عوامل التصفية.'
              : 'تُسجَّل الحركات تلقائياً عند ترحيل الفواتير أو اعتماد جلسات الجرد.'}
          />
        ) : (
          <div className={cn('overflow-x-auto', isFetching && 'opacity-60 transition-opacity')}>
            <table className="data-table stacked">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الصنف</th>
                  <th>الباركود</th>
                  <th>النوع</th>
                  <th className="text-center">الكمية</th>
                  <th>المصدر</th>
                  <th>المستند</th>
                  <th>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td data-label="التاريخ" className="whitespace-nowrap text-xs text-muted">{fmtDateTime(movement.created_at)}</td>
                    <td data-primary className="max-w-[14rem]">
                      <ItemLink id={movement.item_id} name={movement.item_name} />
                    </td>
                    <td data-label="الباركود"><BarcodeChip code={movement.item_barcode} /></td>
                    <td data-label="النوع"><MovementBadge type={movement.type} /></td>
                    <td data-label="الكمية" className={cn('nums text-center font-bold',
                      movement.type === 'IN'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400')}>
                      {movement.type === 'IN' ? '+' : '−'}{fmtInt(movement.quantity)}
                    </td>
                    <td>
                      <Badge tone={movement.reference_type === 'STOCK_COUNT' ? 'info' : 'neutral'}>
                        {REFERENCE_LABEL[movement.reference_type]}
                      </Badge>
                    </td>
                    <td data-label="المستند"><InvoiceLink id={movement.invoice_id!} number={movement.invoice_number} /></td>
                    <td className="max-w-[16rem] truncate text-xs text-muted" title={movement.note ?? ''}>
                      {movement.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <Pagination page={data.meta.page} pages={data.meta.pages} total={data.meta.total}
            limit={data.meta.limit} onPage={setPage} onLimit={setLimit} />
        )}
      </Card>
    </>
  );
}
