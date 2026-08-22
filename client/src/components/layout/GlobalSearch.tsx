import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Search, Package, CornerDownLeft, ArrowUp, ArrowDown, Loader2, Barcode, Command,
  LayoutDashboard, Tags, FileText, ClipboardList, Users, Truck, FileSpreadsheet, Plus,
} from 'lucide-react';
import { useItemSearch } from '@/hooks';
import { cn } from '@/lib/cn';
import { fmtInt, fmtCurrency } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { Badge } from '@/components/ui';

/** Static destinations offered when the query is empty or matches a page name. */
const COMMANDS = [
  { label: 'لوحة المعلومات', to: '/', icon: LayoutDashboard, keywords: 'رئيسية dashboard' },
  { label: 'الأصناف', to: '/items', icon: Package, keywords: 'items اصناف مواد' },
  { label: 'صنف جديد', to: '/items?new=1', icon: Plus, keywords: 'اضافة صنف جديد new item' },
  { label: 'التصنيفات', to: '/categories', icon: Tags, keywords: 'categories' },
  { label: 'الفواتير', to: '/invoices', icon: FileText, keywords: 'invoices فاتورة' },
  { label: 'فاتورة إخراج جديدة', to: '/invoices/new?type=STOCK_OUT', icon: Plus, keywords: 'بيع sale اخراج out جديدة' },
  { label: 'فاتورة إدخال جديدة', to: '/invoices/new?type=STOCK_IN', icon: Plus, keywords: 'شراء purchase ادخال in جديدة' },
  { label: 'الجرد', to: '/stock-counts', icon: ClipboardList, keywords: 'stocktaking جرد' },
  { label: 'العملاء', to: '/customers', icon: Users, keywords: 'customers' },
  { label: 'الموردون', to: '/suppliers', icon: Truck, keywords: 'suppliers' },
  { label: 'استيراد Excel', to: '/import', icon: FileSpreadsheet, keywords: 'import excel استيراد' },
];

const MATCH_LABEL: Record<string, string> = {
  name: 'مطابقة بالاسم',
  barcode: 'مطابقة بالباركود',
  sub_barcode: 'مطابقة بباركود فرعي',
};

/** Lets the ribbon open the palette without duplicating its state. */
export type GlobalSearchHandle = { open: () => void };

export const GlobalSearch = forwardRef<GlobalSearchHandle>(function GlobalSearch(_props, ref) {
  const { canSeePrices } = usePermissions();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: items = [], isFetching } = useItemSearch(term, 8);

  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);

  const commands = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return COMMANDS.slice(0, 6);
    return COMMANDS.filter((c) =>
      c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q)).slice(0, 4);
  }, [term]);

  // Flat list of everything selectable, so ↑/↓ can walk both sections.
  const options = useMemo(
    () => [
      ...items.map((item) => ({ kind: 'item' as const, id: item.id, to: `/items/${item.id}`, item })),
      ...commands.map((c) => ({ kind: 'command' as const, id: c.to, to: c.to, command: c })),
    ],
    [items, commands],
  );

  // Ctrl/⌘+K anywhere, plus "/" when not already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === '/' && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => { setCursor(0); }, [term]);

  useEffect(() => {
    if (!open) { setTerm(''); setCursor(0); return; }
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  // Keep the highlighted row inside the scroll viewport.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const go = (to: string) => { setOpen(false); navigate(to); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % Math.max(options.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + options.length) % Math.max(options.length, 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const opt = options[cursor]; if (opt) go(opt.to); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <>
      {/* Trigger in the top nav */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-9 w-full max-w-md items-center gap-2.5 rounded-[0.625rem] border border-line-strong bg-surface-2 px-3 text-sm text-subtle transition hover:border-brand-400 hover:bg-surface"
      >
        <Search className="size-4 shrink-0 transition group-hover:text-brand-500" />
        <span className="flex-1 text-start">ابحث عن صنف أو باركود…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-subtle sm:flex">
          <Command className="size-2.5" />K
        </kbd>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh] no-print">
          <div className="fixed inset-0 bg-[#1c1f1d]/50 backdrop-blur-[2px] animate-fade-in"
            onClick={() => setOpen(false)} aria-hidden />

          <div className="card animate-rise relative z-10 w-full max-w-2xl overflow-hidden p-0">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4.5 shrink-0 text-subtle" />
              <input
                ref={inputRef}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="ابحث بالاسم أو الباركود أو الباركود الفرعي…"
                aria-label="البحث الشامل"
                role="combobox"
                aria-expanded
                aria-controls="global-search-results"
                className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
              />
              {isFetching && <Loader2 className="size-4 animate-spin text-subtle" />}
            </div>

            <div id="global-search-results" role="listbox" ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {items.length > 0 && (
                <Section title="الأصناف">
                  {items.map((item, index) => (
                    <Row
                      key={item.id}
                      active={cursor === index}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(`/items/${item.id}`)}
                      icon={<Package className="size-4" />}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{item.name}</span>
                          {item.category_name && (
                            <Badge tone="brand" className="shrink-0">{item.category_name}</Badge>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-subtle">
                          <span className="flex items-center gap-1">
                            <Barcode className="size-3" />
                            <span className="nums font-mono">{item.matched_barcode ?? item.barcode}</span>
                          </span>
                          {item.matched_on && item.matched_on !== 'name' && (
                            <span className="text-brand-500">{MATCH_LABEL[item.matched_on] ?? ''}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className={cn('nums text-sm font-bold',
                          item.quantity <= 0 ? 'text-accent-600 dark:text-accent-400'
                            : item.is_low_stock ? 'text-accent-500' : 'text-ink')}>
                          {fmtInt(item.quantity)}
                        </p>
                        {canSeePrices && (
                          <p className="nums text-[11px] text-subtle">{fmtCurrency(item.sale_price)}</p>
                        )}
                      </div>
                    </Row>
                  ))}
                </Section>
              )}

              {commands.length > 0 && (
                <Section title="الانتقال إلى">
                  {commands.map((command, index) => {
                    const flatIndex = items.length + index;
                    return (
                      <Row
                        key={command.to}
                        active={cursor === flatIndex}
                        onMouseEnter={() => setCursor(flatIndex)}
                        onClick={() => go(command.to)}
                        icon={<command.icon className="size-4" />}
                      >
                        <span className="flex-1 text-sm font-medium">{command.label}</span>
                      </Row>
                    );
                  })}
                </Section>
              )}

              {term.trim() && !isFetching && options.length === 0 && (
                <div className="px-4 py-12 text-center">
                  <p className="text-sm font-semibold">لا توجد نتائج</p>
                  <p className="mt-1 text-xs text-muted">
                    لم يُعثر على صنف يطابق «{term}». جرّب الاسم أو الباركود كاملاً.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-[11px] text-subtle">
              <Hint icon={<ArrowUp className="size-3" />} extra={<ArrowDown className="size-3" />}>تنقّل</Hint>
              <Hint icon={<CornerDownLeft className="size-3" />}>فتح</Hint>
              <Hint icon={<span className="font-mono text-[10px]">Esc</span>}>إغلاق</Hint>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 last:mb-0">
      <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-subtle">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  active, onClick, onMouseEnter, icon, children,
}: {
  active: boolean; onClick: () => void; onMouseEnter: () => void;
  icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-active={active}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start transition',
        active ? 'bg-brand-500/12' : 'hover:bg-surface-2',
      )}
    >
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg',
        active ? 'bg-brand-600 text-white' : 'bg-surface-3 text-muted')}>
        {icon}
      </span>
      {children}
    </button>
  );
}

function Hint({ icon, extra, children }: { icon: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="grid size-4 place-items-center rounded border border-line-strong bg-surface">{icon}</kbd>
      {extra && <kbd className="grid size-4 place-items-center rounded border border-line-strong bg-surface">{extra}</kbd>}
      {children}
    </span>
  );
}
