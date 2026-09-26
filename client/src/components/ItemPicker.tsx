import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search, PackageSearch, Plus, Check, ImageOff, SlidersHorizontal } from 'lucide-react';
import {
  Badge, Button, Modal, Pagination, SearchInput, Select, TableSkeleton,
} from '@/components/ui';
import { Thumb, useThumbFallback } from '@/components/ImagePicker';
import { useCategories, useDebounced, useItems } from '@/hooks';
import { fmtCurrency, fmtInt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import type { Item } from '@/lib/types';

/**
 * The two ways to reach an item without typing its barcode.
 *
 * `ItemBrowserModal` is the full screen: filters, a scrollable table and a
 * pager, for when the operator is hunting. `ItemListDropdown` is the quick
 * one — every item, alphabetical, one click away — for when they already know
 * what they want and just need to see the list. They deliberately stay
 * separate rather than one component with a mode flag, because the fast path
 * must not pay for the slow one's filter bar and pagination.
 */

/* ------------------------------------------------------- full search screen */

export function ItemBrowserModal({
  open, onClose, onPick, priceKind = 'sale',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: Item, quantity: number) => void | Promise<void>;
  priceKind?: 'sale' | 'purchase';
}) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  /** Phone only — collapsed by default so the grid starts right under the search box. */
  const [filtersOpen, setFiltersOpen] = useState(false);

  /*
   * Each "إضافة" commits its item to the invoice at once — no basket to review
   * and commit later. `added` remembers how many of each item went in during
   * this visit (item id -> total qty), so a card can show "أُضيفت ✓" and the
   * header can show a running count, and it clears when the picker reopens.
   */
  const [added, setAdded] = useState<Record<string, number>>({});

  const { canSeePrices, canSeeSalePrice } = usePermissions();
  const canSeeThisPrice = priceKind === 'sale' ? canSeeSalePrice : canSeePrices;

  const { data: categories } = useCategories();
  const debounced = useDebounced(search, 250);

  const { data, isLoading } = useItems({
    search: debounced || undefined,
    category_id: categoryId || undefined,
    low_stock: onlyLow || undefined,
    sort: 'name',
    page,
    limit,
  }, open); // nothing to fetch while the dialog is shut

  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1); }, [debounced, categoryId, onlyLow, limit]);

  // Start clean each time it is opened — filters and the added-count both.
  useEffect(() => {
    if (!open) return;
    setSearch(''); setCategoryId(''); setOnlyLow(false); setPage(1); setFiltersOpen(false);
    setAdded({});
  }, [open]);

  const rows = data?.data ?? [];

  const addedEntries = Object.entries(added);
  const lineCount = addedEntries.length;
  const unitCount = addedEntries.reduce((sum, [, q]) => sum + q, 0);

  // Commit one item to the invoice immediately, and remember it went in.
  const addItem = async (item: Item, qty: number) => {
    const n = Math.max(1, Math.floor(qty || 0));
    await onPick(item, n); // parent adds the line and flashes it; it toasts on error
    setAdded((a) => ({ ...a, [item.id]: (a[item.id] ?? 0) + n }));
  };

  // "Back to choosing": clear the search/filters for a fresh pick.
  const keepChoosing = () => { setSearch(''); setCategoryId(''); setOnlyLow(false); setPage(1); };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={(
        <div className="flex flex-col gap-2.5 pe-2">
          {/* What has been added to the invoice so far, at the very top. */}
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span>{lineCount ? `أُضيفت للفاتورة: ${fmtInt(lineCount)} صنف` : 'اختر الأصناف'}</span>
            {lineCount > 0 && (
              <span className="text-xs font-normal text-muted">{fmtInt(unitCount)} قطعة</span>
            )}
          </span>

          {/* Search and filters live in this top bar now, above the grid, so
              they stay in place while the cards scroll under them. On a phone
              the category and low-stock filters fold behind the toggle to keep
              the bar short. font-normal resets the header's bold for the
              controls. */}
          <div className="flex flex-wrap items-center gap-2.5 text-sm font-normal">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="ابحث بالاسم أو الباركود…"
              className="min-w-0 flex-1 sm:min-w-56"
            />
            <Button
              variant={filtersOpen || categoryId || onlyLow ? 'primary' : 'secondary'}
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
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-9 w-auto min-w-40 flex-1 py-0 text-xs sm:flex-none"
                aria-label="التصنيف"
              >
                <option value="">كل التصنيفات</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Button
                variant={onlyLow ? 'primary' : 'ghost'}
                onClick={() => setOnlyLow((v) => !v)}
              >
                النواقص فقط
              </Button>
            </div>
          </div>
        </div>
      )}
      footer={(
        <>
          <Button variant="ghost" onClick={keepChoosing}>
            متابعة الاختيار
          </Button>
          <Button variant="primary" onClick={onClose}>
            مراجعة الفاتورة{lineCount ? ` (${fmtInt(lineCount)})` : ''}
          </Button>
        </>
      )}
    >
      <div className="-mx-5 -my-4">
        <div className="p-4">
          {isLoading ? (
            <TableSkeleton rows={8} cols={5} />
          ) : rows.length === 0 ? (
            <p className="px-1 py-12 text-center text-sm text-muted">
              لا توجد أصناف مطابقة
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {rows.map((item) => (
                <PickerCard
                  key={item.id}
                  item={item}
                  priceKind={priceKind}
                  canSeeThisPrice={canSeeThisPrice}
                  addedQty={added[item.id] ?? 0}
                  onAdd={(qty) => addItem(item, qty)}
                />
              ))}
            </div>
          )}
        </div>

        {!!data && (
          <Pagination
            page={data.meta.page}
            pages={data.meta.pages}
            total={data.meta.total}
            limit={data.meta.limit}
            onPage={setPage}
            onLimit={setLimit}
          />
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------- anchored popover */

/** Preferred width of both entry-cell dropdowns, in px; narrowed on phones. */
export const POPOVER_WIDTH = 416;

/**
 * A dropdown that escapes its scroll container.
 *
 * The line grid is wrapped in `overflow-x-auto`, and CSS forces the other axis
 * to `auto` alongside it — so anything absolutely positioned inside a cell gets
 * clipped at the table's edge. Rendering into a portal at fixed coordinates is
 * the only reliable way out; the position is re-measured on scroll and resize
 * so it stays glued to its cell.
 */
export function AnchoredPopover({
  anchorRef, open, children, className,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [pos, setPos] = useState<
    { top: number; left: number; width: number; maxHeight: number } | null
  >(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const GAP = 4;
    const EDGE = 12;
    // Never wider than the screen — 416px would overflow a phone outright.
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - EDGE * 2);
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    // Drop down by default; flip up only when that genuinely gains room, so a
    // grid near the bottom of the window never has its list cut off.
    const flip = below < 220 && above > below;

    setPos({
      top: flip ? Math.max(EDGE, r.top - GAP - Math.min(above, 420)) : r.bottom + GAP,
      // RTL: the popover hangs from the cell's right edge, clamped to the viewport.
      left: Math.max(EDGE, Math.min(r.right - width, window.innerWidth - width - EDGE)),
      width,
      maxHeight: Math.max(160, Math.min(flip ? above : below, 420)),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    // Capture phase: catches scrolling of the grid wrapper, not just the page.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
      }}
      className={cn('card z-50 flex flex-col overflow-hidden shadow-lg', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------ quick list of every item */

/** How many names the quick list holds before it defers to the full screen. */
const QUICK_LIST_LIMIT = 200;

export function ItemListDropdown({
  open, onClose, onPick, onOpenBrowser, anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: Item) => void;
  onOpenBrowser: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(0);

  const { data, isLoading } = useItems({ sort: 'name', page: 1, limit: QUICK_LIST_LIMIT }, open);
  const rows = useMemo(() => (open ? data?.data ?? [] : []), [open, data]);
  const truncated = (data?.meta.total ?? 0) > rows.length;

  // Click-away and Escape both close it; the arrow button toggles separately.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The caret button toggles on its own; closing here too would re-open it.
      if (!boxRef.current?.contains(t) && !anchorRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((i) => Math.min(i + 1, rows.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && rows[highlight]) { e.preventDefault(); onPick(rows[highlight]); onClose(); }
    };
    // `mousedown` rather than `click`: closing on click would fire after the
    // row's own handler had already been skipped by the re-render.
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, onPick, rows, highlight, anchorRef]);

  useEffect(() => { if (open) setHighlight(0); }, [open]);

  return (
    <AnchoredPopover anchorRef={anchorRef} open={open}>
    <div ref={boxRef} role="listbox" aria-label="كل الأصناف" className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-line bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-muted">
        كل الأصناف {!isLoading && <span className="nums">({fmtInt(data?.meta.total ?? 0)})</span>}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" /> جارٍ التحميل…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted">لا توجد أصناف بعد</p>
        ) : (
          rows.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === highlight}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => { onPick(item); onClose(); }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition',
                index === highlight ? 'bg-brand-500/12' : 'hover:bg-surface-2',
              )}
            >
              <Thumb url={item.image_url} alt={item.name} className="size-9" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="nums block font-mono text-[11px] text-subtle">{item.barcode}</span>
              </span>
              <span className="shrink-0 text-end">
                <span className="nums block text-sm font-bold">{fmtInt(item.quantity)}</span>
                <span className="block text-[10px] text-subtle">الرصيد</span>
              </span>
            </button>
          ))
        )}
      </div>

      {truncated && (
        <button
          type="button"
          onClick={() => { onClose(); onOpenBrowser(); }}
          className="flex w-full shrink-0 items-center justify-center gap-1.5 border-t border-line bg-surface-2 py-2 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-500/10 dark:text-brand-300"
        >
          <PackageSearch className="size-3.5" />
          عرض أول {fmtInt(QUICK_LIST_LIMIT)} فقط — افتح شاشة البحث للباقي
        </button>
      )}
    </div>
    </AnchoredPopover>
  );
}

/* ------------------------------------------------------------------ shared */

function QuantityCell({ item }: { item: Item }) {
  if (item.quantity <= 0) return <Badge tone="danger">نفد</Badge>;
  return (
    <span className={cn('nums text-sm font-bold', item.is_low_stock && 'text-accent-600 dark:text-accent-400')}>
      {fmtInt(item.quantity)}
    </span>
  );
}

/**
 * A photo-first product card that carries its own basket quantity.
 *
 * Nothing here touches the invoice. A card starts with an "إضافة" button; the
 * first tap puts one in the basket and the button becomes a −/quantity/+
 * stepper, with an X in the corner to drop the item entirely. `qty` and every
 * change are owned by the modal, so the same basket survives paging and
 * searching, and the running total at the top always matches.
 */
function PickerCard({
  item, priceKind, canSeeThisPrice, addedQty, onAdd,
}: {
  item: Item;
  priceKind: 'sale' | 'purchase';
  canSeeThisPrice: boolean;
  addedQty: number;
  onAdd: (quantity: number) => void | Promise<void>;
}) {
  const img = useThumbFallback(item.image_url);
  // The quantity is typed, and starts empty — no prefilled "1" to clear first.
  const [qtyText, setQtyText] = useState('');
  const [busy, setBusy] = useState(false);
  const added = addedQty > 0;

  const submit = async () => {
    if (busy) return;
    const qty = Math.max(1, Math.floor(Number(qtyText) || 0)); // empty → 1
    setBusy(true);
    try {
      await onAdd(qty);
      setQtyText(''); // ready for the next add of the same item
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(
      'card relative flex flex-col overflow-hidden transition',
      added && 'ring-2 ring-emerald-500',
    )}>
      {/* Confirmation that it went into the invoice, with how many so far. */}
      {added && (
        <span className="absolute end-1.5 top-1.5 z-10 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white shadow">
          <Check className="size-3" /> {fmtInt(addedQty)}
        </span>
      )}

      <div className="aspect-square w-full overflow-hidden bg-surface-2">
        {item.image_url ? (
          <img
            src={img.src}
            onError={img.onError}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center"><ImageOff className="size-8 text-subtle" /></div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-2.5">
        <p className="line-clamp-2 text-sm font-bold text-ink">{item.name}</p>
        {item.category_name ? (
          <Badge tone="brand" className="mt-1 self-start">{item.category_name}</Badge>
        ) : (
          <span className="mt-1 text-[11px] text-subtle">بدون تصنيف</span>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {canSeeThisPrice ? (
            <span className="nums text-sm font-bold text-brand-600 dark:text-brand-400">
              {fmtCurrency(priceKind === 'purchase' ? item.purchase_price : item.sale_price)}
            </span>
          ) : (
            <span className="nums truncate text-[11px] text-subtle" title={item.barcode ?? ''}>
              {item.barcode ?? '—'}
            </span>
          )}
          <QuantityCell item={item} />
        </div>

        {/* Type the quantity (blank = 1), then إضافة adds it to the invoice
            straight away. Pinned to the card's bottom edge (mt-auto). */}
        <div className="mt-auto flex items-center gap-1.5 pt-2">
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={qtyText}
            placeholder="الكمية"
            onChange={(e) => setQtyText(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            aria-label={`الكمية — ${item.name}`}
            className="field h-9 w-16 shrink-0 py-0 text-center text-sm font-bold"
          />
          <Button
            size="sm"
            variant={added ? 'success' : 'primary'}
            loading={busy}
            className="h-9 flex-1"
            icon={<Plus className="size-3.5" />}
            onClick={submit}
            aria-label={`إضافة — ${item.name}`}
          >
            إضافة
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The magnifier + caret pair that sits inside the item-name entry cell. */
export function ItemPickerButtons({
  onSearch, onList, listOpen,
}: {
  onSearch: () => void;
  onList: () => void;
  listOpen: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-px">
      <button
        type="button"
        onClick={onSearch}
        title="بحث عن صنف (F2)"
        aria-label="بحث عن صنف"
        className="grid size-[26px] place-items-center rounded border border-line bg-surface text-brand-600 transition hover:bg-brand-500/12 dark:text-brand-300"
      >
        <Search className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onList}
        title="قائمة كل الأصناف (F4)"
        aria-label="قائمة كل الأصناف"
        aria-expanded={listOpen}
        className={cn(
          'grid size-[26px] place-items-center rounded border border-line text-brand-600 transition hover:bg-brand-500/12 dark:text-brand-300',
          listOpen ? 'bg-brand-500/15' : 'bg-surface',
        )}
      >
        <svg viewBox="0 0 10 6" className="size-2.5 fill-current" aria-hidden>
          <path d="M0 0h10L5 6z" />
        </svg>
      </button>
    </span>
  );
}
