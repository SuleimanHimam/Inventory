import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TriangleAlert, PackageCheck, ShoppingCart, ArrowLeftRight, Printer } from 'lucide-react';
import {
  Button, Card, PageHeader, Pagination, Select, EmptyState, TableSkeleton, Badge,
} from '@/components/ui';
import { StockMovementModal } from '@/components/ItemFormModal';
import { BarcodeChip, ItemLink, QuantityCell } from '@/components/domain';
import { useCategories, useItems } from '@/hooks';
import { fmtCurrency, fmtInt } from '@/lib/format';
import { usePrefs } from '@/store/prefs';
import type { Item } from '@/lib/types';

export default function LowStock() {
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [moveItem, setMoveItem] = useState<Item | null>(null);

  const { data: categories = [] } = useCategories();
  const threshold = usePrefs((s) => s.lowStockThreshold);

  const { data, isLoading } = useItems({
    low_stock: true,
    category_id: categoryId || undefined,
    sort: 'quantity',
    page,
    limit,
  });

  useEffect(() => { setPage(1); }, [categoryId, limit]);

  const items = data?.data ?? [];
  const outOfStock = items.filter((item) => item.quantity <= 0).length;

  return (
    <>
      <PageHeader
        title="تقرير نواقص المخزون"
        subtitle={`الأصناف التي وصلت إلى حد التنبيه أو أقل — الحد العام الحالي ${threshold}`}
        actions={
          <>
            <Link to="/settings">
              <Button>تعديل حد التنبيه</Button>
            </Link>
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>طباعة</Button>
          </>
        }
      />

      {!!items.length && (
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-muted">أصناف تحت الحد</p>
            <p className="nums mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
              {fmtInt(data?.meta.total)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">نفدت تماماً (في هذه الصفحة)</p>
            <p className="nums mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400">{fmtInt(outOfStock)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">تكلفة إعادة التعبئة التقديرية</p>
            <p className="nums mt-1 text-2xl font-bold">
              {fmtCurrency(items.reduce(
                (sum, item) => sum + Math.max(0, item.effective_threshold - item.quantity) * item.purchase_price, 0))}
            </p>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-3.5 no-print">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-auto min-w-44">
            <option value="">كل التصنيفات</option>
            <option value="none">بدون تصنيف</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </Select>
        </div>

        {isLoading ? (
          <TableSkeleton cols={6} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<PackageCheck className="size-6" />}
            title="لا توجد نواقص"
            message="جميع الأصناف ضمن الحدود الآمنة. سيظهر هنا أي صنف يصل إلى حد التنبيه الخاص به."
            action={<Link to="/items"><Button variant="primary">عرض كل الأصناف</Button></Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table stacked">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>التصنيف</th>
                  <th>الباركود</th>
                  <th className="text-center">الرصيد</th>
                  <th className="text-center">حد التنبيه</th>
                  <th className="text-center">الكمية المقترحة</th>
                  <th className="w-px no-print" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const shortfall = Math.max(0, item.effective_threshold - item.quantity);
                  return (
                    <tr key={item.id}>
                      <td data-primary className="max-w-xs">
                        <ItemLink id={item.id} name={item.name} />
                        {item.quantity <= 0 && <Badge tone="danger" className="ms-2">نفد</Badge>}
                      </td>
                      <td>
                        {item.category_name
                          ? <Badge tone="brand">{item.category_name}</Badge>
                          : <span className="text-xs text-subtle">—</span>}
                      </td>
                      <td data-label="الباركود"><BarcodeChip code={item.barcode} /></td>
                      <td data-label="الرصيد" className="text-center">
                        <QuantityCell quantity={item.quantity} threshold={item.effective_threshold} />
                      </td>
                      <td data-label="حد التنبيه" className="nums text-center text-muted">{fmtInt(item.effective_threshold)}</td>
                      <td data-label="الكمية المقترحة" className="nums text-center font-bold text-brand-600 dark:text-brand-400">
                        {fmtInt(shortfall)}
                      </td>
                      <td className="no-print">
                        <div className="flex justify-end gap-0.5">
                          <Button size="icon" variant="ghost" title="حركة مخزون"
                            onClick={() => setMoveItem(item)}>
                            <ArrowLeftRight className="size-4" />
                          </Button>
                          <Link to={`/invoices/new?type=PURCHASE`}>
                            <Button size="icon" variant="ghost" title="إنشاء فاتورة شراء">
                              <ShoppingCart className="size-4" />
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <Pagination page={data.meta.page} pages={data.meta.pages} total={data.meta.total}
            limit={data.meta.limit} onPage={setPage} onLimit={setLimit} />
        )}
      </Card>

      {!!items.length && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-subtle">
          <TriangleAlert className="size-3.5" />
          «الكمية المقترحة» هي الفرق بين الرصيد الحالي وحد التنبيه — نقطة بداية لإعادة الطلب.
        </p>
      )}

      <StockMovementModal open={!!moveItem} onClose={() => setMoveItem(null)} item={moveItem} />
    </>
  );
}
