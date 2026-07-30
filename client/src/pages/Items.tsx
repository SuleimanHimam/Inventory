import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Package, ArrowLeftRight, Pencil, Trash2, SlidersHorizontal, PackageSearch,
} from 'lucide-react';
import {
  Button, Card, PageHeader, Pagination, SearchInput, Select, EmptyState, TableSkeleton,
  ConfirmDialog, Badge,
} from '@/components/ui';
import { ItemFormModal, StockMovementModal } from '@/components/ItemFormModal';
import { BarcodeChip, ItemLink, QuantityCell } from '@/components/domain';
import { useCategories, useDebounced, useItemMutations, useItems } from '@/hooks';
import { Thumb } from '@/components/ImagePicker';
import { cn } from '@/lib/cn';
import { fmtCurrency } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import type { Item } from '@/lib/types';

export default function Items() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  // Honour ?category=… so "view items" links from the Categories page land filtered.
  const [categoryId, setCategoryId] = useState(params.get('category') ?? '');
  const [sort, setSort] = useState('name');
  const [onlyLow, setOnlyLow] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [formItem, setFormItem] = useState<Item | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [moveItem, setMoveItem] = useState<Item | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

  const debouncedSearch = useDebounced(search, 250);
  const { data: categories = [] } = useCategories();
  const { remove } = useItemMutations();

  const { data, isLoading, isFetching } = useItems({
    search: debouncedSearch || undefined,
    category_id: categoryId || undefined,
    low_stock: onlyLow || undefined,
    sort,
    page,
    limit,
  });

  // `?new=1` (from the top-nav menu / command palette) opens the create form.
  useEffect(() => {
    if (params.get('new') === '1') {
      setFormItem(null);
      setShowForm(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => { setPage(1); }, [debouncedSearch, categoryId, onlyLow, sort, limit]);

  const openCreate = () => { setFormItem(null); setShowForm(true); };
  const openEdit = (item: Item) => { setFormItem(item); setShowForm(true); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      toast.success('تم حذف الصنف', 'يبقى سجل حركاته محفوظاً للمراجعة');
      setDeleteTarget(null);
    } catch (error) {
      toastError(error, 'تعذّر حذف الصنف');
    }
  };

  const items = data?.data ?? [];
  const hasFilters = !!(debouncedSearch || categoryId || onlyLow);

  return (
    <>
      <PageHeader
        title="الأصناف"
        subtitle="جميع الأصناف المعرّفة في النظام مع أرصدتها الحالية"
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={openCreate}>صنف جديد</Button>}
      />

      {/*
        The card is capped to the viewport so only the rows scroll: the filter
        bar and the pager stay pinned, and the sticky table header remains
        visible while scanning a long list.

        16.5rem = ribbon (8.39) + main padding (2) + page header and its
        margin (4.44) + status bar (1.75). Measured in the browser, not
        guessed — the old value still reserved 3rem for a title bar that no
        longer exists, which left a dead strip above the status bar.
      */}
      <Card className="flex min-h-[18rem] flex-col overflow-hidden sm:max-h-[calc(100vh-16.5rem)]">
        {/* Filter bar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line p-3.5">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="ابحث بالاسم أو الباركود أو الباركود الفرعي…"
            className="min-w-64 flex-1"
          />
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-auto min-w-40">
            <option value="">كل التصنيفات</option>
            <option value="none">بدون تصنيف</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.item_count})</option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto min-w-36">
            <option value="name">ترتيب: الاسم</option>
            <option value="quantity">الأقل كمية</option>
            <option value="newest">الأحدث إضافة</option>
            <option value="price">الأعلى سعراً</option>
          </Select>
          <Button
            variant={onlyLow ? 'primary' : 'secondary'}
            icon={<SlidersHorizontal className="size-4" />}
            onClick={() => setOnlyLow((v) => !v)}
          >
            النواقص فقط
          </Button>
        </div>

        {isLoading ? (
          <div className="min-h-0 flex-1 overflow-auto"><TableSkeleton cols={6} /></div>
        ) : items.length === 0 ? (
          <div className="grid min-h-0 flex-1 place-items-center">
            <EmptyState
              icon={hasFilters ? <PackageSearch className="size-6" /> : <Package className="size-6" />}
              title={hasFilters ? 'لا توجد نتائج مطابقة' : 'لم تُضف أي أصناف بعد'}
              message={hasFilters
                ? 'جرّب تعديل كلمة البحث أو إزالة عوامل التصفية.'
                : 'ابدأ بإضافة صنف يدوياً أو استورد قائمة كاملة من ملف Excel.'}
              action={hasFilters ? (
                <Button onClick={() => { setSearch(''); setCategoryId(''); setOnlyLow(false); }}>
                  إزالة عوامل التصفية
                </Button>
              ) : (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                  إضافة صنف
                </Button>
              )}
            />
          </div>
        ) : (
          <div className={cn(
            'min-h-0 flex-1 overflow-auto',
            isFetching && 'opacity-60 transition-opacity',
          )}>
            <table className="data-table stacked">
              <thead>
                <tr>
                  <th className="w-px" />
                  <th>الصنف</th>
                  <th>التصنيف</th>
                  <th>الباركود</th>
                  <th className="text-center">سعر الشراء</th>
                  <th className="text-center">سعر البيع</th>
                  <th className="text-center">الكمية</th>
                  <th className="w-px" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-thumb className="pe-0">
                      <Thumb url={item.image_url} alt={item.name} />
                    </td>
                    <td data-primary className="max-w-xs">
                      <ItemLink id={item.id} name={item.name} />
                      {item.source === 'IMPORT' && (
                        <Badge tone="info" className="ms-2">مستورد</Badge>
                      )}
                    </td>
                    <td data-label="التصنيف">
                      {item.category_name
                        ? <Badge tone="brand">{item.category_name}</Badge>
                        : <span className="text-xs text-subtle">—</span>}
                    </td>
                    <td data-label="الباركود"><BarcodeChip code={item.barcode} /></td>
                    <td data-label="سعر الشراء" className="nums text-center text-muted">{fmtCurrency(item.purchase_price)}</td>
                    <td data-label="سعر البيع" className="nums text-center font-semibold">{fmtCurrency(item.sale_price)}</td>
                    <td data-label="الكمية" className="text-center">
                      <QuantityCell quantity={item.quantity} threshold={item.effective_threshold} />
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          size="icon" variant="ghost" title="حركة مخزون"
                          onClick={() => setMoveItem(item)}
                        >
                          <ArrowLeftRight className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="تعديل" onClick={() => openEdit(item)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" title="حذف"
                          className="hover:text-rose-500"
                          onClick={() => setDeleteTarget(item)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <div className="shrink-0">
            <Pagination
              page={data.meta.page}
              pages={data.meta.pages}
              total={data.meta.total}
              limit={data.meta.limit}
              onPage={setPage}
              onLimit={setLimit}
            />
          </div>
        )}
      </Card>

      <ItemFormModal open={showForm} onClose={() => setShowForm(false)} item={formItem} />
      <StockMovementModal open={!!moveItem} onClose={() => setMoveItem(null)} item={moveItem} />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={remove.isPending}
        title="حذف الصنف"
        confirmLabel="حذف"
        message={
          <>
            سيُخفى <strong className="text-ink">{deleteTarget?.name}</strong> من القوائم،
            مع الاحتفاظ بكامل سجل حركاته لأغراض المراجعة. لا يمكن حذف صنف مرتبط بفاتورة
            مسودة أو بجلسة جرد جارية.
          </>
        }
      />
    </>
  );
}
