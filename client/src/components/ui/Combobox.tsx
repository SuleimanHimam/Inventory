import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronsUpDown, Check, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A type-to-search select — one accessible pattern used everywhere the app picks
 * from a long list (accounts, and anything else with more than a handful of
 * options). A native <select> cannot be searched by typing a substring, which
 * is unworkable for a 90-account chart; this is the replacement.
 *
 * Two shapes, same behaviour (type to filter, ↑/↓ to move, Enter to choose, Esc
 * to close), both portalled to <body> so neither is clipped by a modal:
 *
 *  • default — a full-page search-and-choose sheet: full screen on a phone,
 *    a centered dialog on wider screens. Right for long lists.
 *  • `anchored` — a compact dropdown under the field, sized to its options.
 *    Right for a short list where a full-page sheet is overkill.
 */
export type ComboOption = {
  value: string;
  label: string;
  hint?: string;      // muted secondary text (e.g. an account number)
  keywords?: string;  // extra text matched by search but not shown
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  title?: string;
  disabled?: boolean;
  allowClear?: boolean;
  /** Compact dropdown sized to the options, instead of the full-page sheet. */
  anchored?: boolean;
  id?: string;
  className?: string;
  invalid?: boolean;
  autoFocus?: boolean;
};

const norm = (s: string) => s.toLowerCase().replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').trim();

export function Combobox({
  value, onChange, options, placeholder = '— اختر —',
  searchPlaceholder = 'اكتب للبحث…', emptyText = 'لا نتائج', title,
  disabled, allowClear = true, anchored = false, id, className, invalid, autoFocus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const [above, setAbove] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return options;
    return options.filter((o) =>
      norm(o.label).includes(q)
      || (o.hint && norm(o.hint).includes(q))
      || (o.keywords && norm(o.keywords).includes(q)));
  }, [options, query]);

  // On open: reset the query, highlight the current pick, and focus the search
  // box once painted so the mobile keyboard rises with it.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    const idx = options.findIndex((o) => o.value === value);
    setHighlight(idx === -1 ? 0 : idx);
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => searchRef.current?.focus()));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The full-page sheet locks the background; the anchored dropdown does not.
  useEffect(() => {
    if (!open || anchored) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open, anchored]);

  // Anchored: position under the trigger, flip up when space below is tight,
  // and follow scroll/resize. Also close on an outside click.
  useLayoutEffect(() => {
    if (!open || !anchored) return undefined;
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      setAbove(below < 260 && r.top > below);
      setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
    };
    measure();
    const on = () => measure();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
    };
  }, [open, anchored]);

  useEffect(() => {
    if (!open || !anchored) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, anchored]);

  // Keep the highlighted row in view as the user arrows through.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[highlight] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const choose = (v: string) => { onChange(v); close(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[highlight]; if (o) choose(o.value); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  const searchBar = (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        ref={searchRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
        onKeyDown={onKey}
        placeholder={title || searchPlaceholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        enterKeyHint="search"
        className="field ps-9"
      />
    </div>
  );

  const optionList = (compact: boolean) => (
    <ul ref={listRef} role="listbox" className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', compact ? 'p-1' : 'p-1.5')}>
      {filtered.length === 0 ? (
        <li className={cn('text-center text-sm text-subtle', compact ? 'px-3 py-6' : 'px-3 py-10')}>{emptyText}</li>
      ) : filtered.map((o, i) => (
        <li key={o.value} role="option" aria-selected={o.value === value}>
          <button
            type="button"
            onClick={() => choose(o.value)}
            onMouseEnter={() => setHighlight(i)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg text-start text-sm transition',
              compact ? 'px-2.5 py-2' : 'rounded-xl px-3 py-3',
              i === highlight ? 'bg-surface-2' : 'hover:bg-surface-2',
            )}
          >
            <Check className={cn('size-4 shrink-0', o.value === value ? 'text-brand-600 dark:text-brand-400' : 'opacity-0')} />
            {o.hint && <span className="nums shrink-0 font-mono text-xs text-subtle">{o.hint}</span>}
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        onClick={() => !disabled && setOpen((o) => (anchored ? !o : true))}
        className={cn('field flex items-center gap-2 text-start', className)}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-subtle')}>
          {selected ? selected.label : placeholder}
        </span>
        {allowClear && selected && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="مسح"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="grid size-5 place-items-center rounded text-subtle transition hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronsUpDown className="size-4 shrink-0 text-subtle" />
        )}
      </button>

      {open && anchored && rect && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            left: rect.left,
            width: rect.width,
            ...(above ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
          }}
          className="card elevated animate-fade-in z-[70] flex max-h-72 flex-col overflow-hidden rounded-xl"
        >
          <div className="shrink-0 border-b border-line p-2">{searchBar}</div>
          {optionList(true)}
        </div>,
        document.body,
      )}

      {open && !anchored && createPortal(
        <div className="fixed inset-0 z-[70] flex justify-center overflow-hidden no-print items-stretch sm:items-start sm:p-4 sm:py-[6dvh]">
          <div className="fixed inset-0 bg-[#1c1f1d]/45 backdrop-blur-[2px] animate-fade-in" onClick={close} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            className="card elevated animate-rise relative z-10 flex w-full flex-col overflow-hidden h-full rounded-none sm:h-auto sm:max-h-[80dvh] sm:max-w-lg sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line p-2.5">
              {searchBar}
              <button
                type="button"
                onClick={close}
                aria-label="إغلاق"
                className="grid size-10 shrink-0 place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-5" />
              </button>
            </div>
            {optionList(false)}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
