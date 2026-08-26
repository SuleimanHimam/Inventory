import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Package, Pencil, Trash2, SlidersHorizontal, PackageSearch, ImageOff, PackageCheck,
  LayoutGrid, Rows3,
} from 'lucide-react';
import {
  Button, Card, PageHeader, Pagination, SearchInput, Select, EmptyState, TableSkeleton,
  ConfirmDialog, Badge,
} from '@/components/ui';
import { ItemFormModal } from '@/components/ItemFormModal';
import { BarcodeChip, ItemLink, QuantityCell } from '@/components/domain';
import {
  useCategories, useDebounced, useItemMutations, useItems, useMediaQuery, DEVICE_TABLE_QUERY,
} from '@/hooks';
import { Thumb, useThumbFallback } from '@/components/ImagePicker';
import { usePrefs } from '@/store/prefs';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
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
  /** "In stock" means quantity > 0 — independent of the low-stock threshold. */
  const [onlyInStock, setOnlyInStock] = useState(false);
  const listView = usePrefs((state) => state.listView);
  const setListView = usePrefs((state) => state.setListView);
  const canUseTable = useMediaQuery(DEVICE_TABLE_QUERY);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  /** Phone only — collapsed by default so the cards start right under the search box. */
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [formItem, setFormItem] = useState<Item | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

  const debouncedSearch = useDebounced(search, 250);
  const { data: categories = [] } = useCategories();
  /*
   * Two different questions on this screen:
   *  • `canSeePrices`    — manager only: the purchase price, and sorting by price.
   *  • `canSeeSalePrice` — manager or clerk: the sale price column/line.
   *  • `canWriteItems`   — a clerk searches this catalogue, it does not edit it.
   */
  const { canSeePrices, canSeeSalePrice, canWriteItems } = usePermissions();
  const { remove } = useItemMutations();

  const { data, isLoading, isFetching } = useItems({
    search: debouncedSearch || undefined,
    category_id: categoryId || undefined,
    low_stock: onlyLow || undefined,
    in_stock: onlyInStock || undefined,
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

  useEffect(() => { setPage(1); }, [debouncedSearch, categoryId, onlyLow, onlyInStock, sort, limit]);

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
  const hasFilters = !!(debouncedSearch || categoryId || onlyLow || onlyInStock);

  return (
    <>
      {/* On phone this costs a full screen row for a title the operator
          already knows they're on — the same space buys another row of
          cards. "صنف جديد" stays reachable via the command palette
          (Ctrl/Cmd+K → "صنف جديد"). */}
      <div className="hidden sm:block">
        <PageHeader
          title="الأصناف"
          subtitle="جميع الأصناف المعرّفة في النظام مع أرصدتها الحالية"
          actions={canWriteItems
            ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={openCreate}>صنف جديد</Button>
            : undefined}
        />
      </div>

      {/* Phone-only replacement for that header button — floats above the
          bottom nav so it stays reachable no matter how far the list is
          scrolled. */}
      {canWriteItems && (
        <button
          type="button"
          onClick={openCreate}
          aria-label="صنف جديد"
          className="fixed bottom-[5.5rem] end-4 z-40 grid size-14 place-items-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition active:scale-95 hover:bg-brand-700 sm:hidden"
        >
          <Plus className="size-6" />
        </button>
      )}

      {/*
        On phone the page itself scrolls (no ribbon/header above it to
        budget for), so the filter bar is pinned with `sticky` instead of
        being boxed into an internally-scrolling card — `overflow-hidden`
        only applies at `sm:` so sticky has the real page as its scrolling
        ancestor on phone.

        From `sm:` up, the card is capped to the viewport so only the rows
        scroll: the filter bar and the pager stay pinned, and the sticky
        table header remains visible while scanning a long list.

        16.5rem = ribbon (8.39) + main padding (2) + page header and its
        margin (4.44) + status bar (1.75). Measured in the browser, not
        guessed — the old value still reserved 3rem for a title bar that no
        longer exists, which left a dead strip above the status bar.
      */}
      <Card className="list-pane flex flex-col">
        {/* Filter bar. On phone, category/sort/low-stock start collapsed
            behind the toggle button so the cards open right under the
            search box instead of below a tall filter row. Sticky so the
            search box stays reachable while scrolling a long list. */}
        {/* The filter bar lives *inside* the scroller, not above it. As a
            sibling it was a ~70px dead strip: a touch starting on it scrolled
            nothing, because the nearest scrollable ancestor of the bar was the
            page rather than the list. Inside, it still pins via `position:
            sticky` and a swipe that begins on it scrolls the list. */}
        <div className="list-scroll min-h-0 flex-1">
        <div className="filter-bar flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line bg-surface p-3.5">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="ابحث بالاسم أو الباركود أو الباركود الفرعي…"
            className="min-w-0 flex-1 sm:min-w-64"
          />
          <Button
            variant={filtersOpen || categoryId || onlyLow || onlyInStock || sort !== 'name' ? 'primary' : 'secondary'}
            size="icon"
            className="sm:hidden"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-label="تصفية"
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
          <div className={cn(
            'flex w-full flex-wrap items-center gap-2.5 sm:w-auto sm:contents',
            !filtersOpen && 'hidden sm:contents',
          )}>
            <Select
              value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="w-auto min-w-40 flex-1 sm:flex-none"
            >
              <option value="">كل التصنيفات</option>
              <option value="none">بدون تصنيف</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.item_count})</option>
              ))}
            </Select>
            <Select
              value={sort} onChange={(e) => setSort(e.target.value)}
              className="w-auto min-w-36 flex-1 sm:flex-none"
            >
              <option value="name">ترتيب: الاسم</option>
              <option value="quantity">الأقل كمية</option>
              <option value="quantity_desc">الأكثر كمية</option>
              <option value="newest">الأحدث إضافة</option>
              {/* Sorting by price discloses the price order, so it is offered
                  only to a role allowed to read one. The API refuses it too. */}
              {canSeeSalePrice && <option value="price">الأعلى سعراً</option>}
            </Select>
            {/* Two independent toggles rather than one three-way control:
                "in stock" and "low stock" overlap (an item can be both), so a
                segmented الكل/المتوفر/النواقص would have to pick one and hide
                the overlap that is actually the most useful list on the
                screen — what is still sellable but needs reordering. */}
            <Button
              variant={onlyInStock ? 'primary' : 'secondary'}
              icon={<PackageCheck className="size-4" />}
              onClick={() => setOnlyInStock((v) => !v)}
              title="إظهار الأصناف التي كميتها أكبر من صفر فقط"
            >
              المتوفر فقط
            </Button>
            <Button
              variant={onlyLow ? 'primary' : 'secondary'}
              icon={<SlidersHorizontal className="size-4" />}
              onClick={() => setOnlyLow((v) => !v)}
            >
              النواقص فقط
            </Button>
            {/* Table or gallery -- offered only where both layouts exist. A
                tablet is wide enough to pass a width test and still only ever
                gets the grid, so the button would do nothing there; the pointer
                is the part that decides, and only a media query can ask. */}
            {canUseTable && (
            <Button
              variant={listView === 'gallery' ? 'primary' : 'secondary'}
              icon={listView === 'gallery'
                ? <Rows3 className="size-4" />
                : <LayoutGrid className="size-4" />}
              onClick={() => setListView(listView === 'gallery' ? 'table' : 'gallery')}
              title={listView === 'gallery' ? 'العرض كجدول' : 'العرض كمعرض صور'}
            >
              {listView === 'gallery' ? 'جدول' : 'معرض'}
            </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton cols={canSeePrices ? 6 : canSeeSalePrice ? 5 : 4} />
        ) : items.length === 0 ? (
          <div className="grid min-h-[16rem] place-items-center p-4">
            <EmptyState
              icon={hasFilters ? <PackageSearch className="size-6" /> : <Package className="size-6" />}
              title={hasFilters ? 'لا توجد نتائج مطابقة' : 'لم تُضف أي أصناف بعد'}
              message={hasFilters
                ? 'جرّب تعديل كلمة البحث أو إزالة عوامل التصفية.'
                : 'ابدأ بإضافة صنف يدوياً أو استورد قائمة كاملة من ملف Excel.'}
              action={hasFilters ? (
                <Button onClick={() => { setSearch(''); setCategoryId(''); setOnlyLow(false); setOnlyInStock(false); }}>
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
          <div className={cn(isFetching && 'opacity-60 transition-opacity')}>
            {/* Phone/tablet: an image-forward card grid — a price list reads
                fine as a table on a desk, but a catalogue you're scanning by
                eye wants the photo up front, like flipping through a shelf. */}
            {/* pb-28 clears the floating "+" button (bottom-[5.5rem] + size-14)
                so the last row's action icons are never hidden under it. */}
            <div className="device-cards grid-cols-2 gap-3 p-3 pb-28 sm:grid-cols-3 sm:pb-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {items.map((item) => (
                <Card key={item.id} className="flex flex-col overflow-hidden">
                  <Link to={`/items/${item.id}`} className="block">
                    <div className="aspect-square w-full overflow-hidden bg-surface-2">
                      {item.image_url ? (
                        <CardImage url={item.image_url} alt={item.name} />
                      ) : (
                        <div className="grid size-full place-items-center">
                          <ImageOff className="size-8 text-subtle" />
                        </div>
                      )}
                    </div>
                    <div className="p-2.5">
                      {/* Two lines rather than one truncated line: at this card
                          width that is roughly 5–6 words, which is where most
                          item names actually become distinguishable from each
                          other. `line-clamp-2` still ellipses anything longer,
                          and min-h keeps one-line names from making the card
                          shorter than its neighbours in the grid. */}
                      <p
                        className="line-clamp-2 min-h-[2.5em] text-sm font-bold leading-tight text-ink"
                        title={item.name}
                      >
                        {item.name}
                      </p>
                      {item.category_name ? (
                        <Badge tone="brand" className="mt-1">{item.category_name}</Badge>
                      ) : (
                        <span className="mt-1 block text-[11px] text-subtle">بدون تصنيف</span>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {/* Price for a manager; for everyone else the barcode,
                            which is the identifier they actually work from. */}
                        {canSeeSalePrice ? (
                          <span className="nums text-sm font-bold text-brand-600 dark:text-brand-400">
                            {fmtCurrency(item.sale_price)}
                          </span>
                        ) : (
                          <span className="nums truncate text-[11px] text-subtle" title={item.barcode ?? ''}>
                            {item.barcode ?? '—'}
                          </span>
                        )}
                        <QuantityCell quantity={item.quantity} threshold={item.effective_threshold}
                          showIcon={false} showLabel={false} />
                      </div>
                    </div>
                  </Link>
                  {/* A clerk gets no action bar at all: the card is a search
                      result to read, not a row to maintain. Dropping the strip
                      rather than disabling three buttons also gives the card
                      back its height. */}
                  {canWriteItems && (
                    <div className="mt-auto flex items-center gap-0.5 border-t border-line p-1.5">
                      <Button size="icon" variant="ghost" title="تعديل" onClick={() => openEdit(item)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" title="حذف" className="ms-auto hover:text-accent-600 dark:hover:text-accent-400"
                        onClick={() => setDeleteTarget(item)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>

            {/* Desktop: the dense table — more columns visible at once, no scrolling per row. */}
            {/* No `stacked`: that turns a table into mobile cards below 1024px, which
                  would fight the card grid above — this page has its own. */}
            <table className="data-table device-table">
              <thead>
                <tr>
                  <th className="w-px" />
                  <th>الصنف</th>
                  <th>التصنيف</th>
                  <th>الباركود</th>
                  {canSeePrices && <th className="text-center">سعر الشراء</th>}
                  {canSeeSalePrice && <th className="text-center">سعر البيع</th>}
                  <th className="text-center">الكمية</th>
                  <th className="w-px" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-thumb className="pe-0">
                      {/* Larger than the 40px default: the stored thumbnail is
                          240px, so this costs no extra bytes and no sharpness —
                          at 40px a product photo is unidentifiable. */}
                      <Thumb url={item.image_url} alt={item.name} className="size-14" />
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
                    {canSeePrices && (
                      <td data-label="سعر الشراء" className="nums text-center text-muted">{fmtCurrency(item.purchase_price)}</td>
                    )}
                    {canSeeSalePrice && (
                      <td data-label="سعر البيع" className="nums text-center font-semibold">{fmtCurrency(item.sale_price)}</td>
                    )}
                    <td data-label="الكمية" className="text-center">
                      <QuantityCell quantity={item.quantity} threshold={item.effective_threshold}
                          showIcon={false} showLabel={false} />
                    </td>
                    <td>
                      {canWriteItems && (
                        <div className="flex items-center justify-end gap-0.5">
                          <Button size="icon" variant="ghost" title="تعديل" onClick={() => openEdit(item)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" title="حذف"
                            className="hover:text-accent-600 dark:hover:text-accent-400"
                            onClick={() => setDeleteTarget(item)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        </div>

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
            غير محفوظة أو بجلسة جرد جارية.
          </>
        }
      />
    </>
  );
}

/**
 * The phone card grid's photo.
 *
 * Loads the small derived thumbnail, not the original — this grid was the
 * last place still pulling multi-megabyte camera photos (the desktop table
 * already went through `Thumb`), and on a phone it is the *only* view that
 * renders, which is why the list stayed slow after the table was fixed.
 */
function CardImage({ url, alt }: { url: string; alt: string }) {
  const img = useThumbFallback(url);
  return (
    <img
      src={img.src}
      onError={img.onError}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="size-full object-cover"
    />
  );
}
