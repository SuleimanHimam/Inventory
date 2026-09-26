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
 * The dropdown is portalled to <body> and positioned with fixed coordinates
 * anchored to the trigger, so it is never clipped by a modal's scroll area
 * (every voucher form is a modal) and never trapped under another layer. It
 * flips above the trigger when there is more room there, closes on outside
 * click / Escape / scroll, and is driven entirely by the keyboard: type to
 * filter, ↑/↓ to move, Enter to choose, Esc to dismiss.
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
  disabled?: boolean;
  allowClear?: boolean;
  id?: string;
  className?: string;
  invalid?: boolean;
  autoFocus?: boolean;
};

const norm = (s: string) => s.toLowerCase().replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').trim();

export function Combobox({
  value, onChange, options, placeholder = '— اختر —',
  searchPlaceholder = 'اكتب للبحث…', emptyText = 'لا نتائج',
  disabled, allowClear = true, id, className, invalid, autoFocus,
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

  const measure = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip up when the space below is tight and there is more above.
    const below = window.innerHeight - r.bottom;
    setAbove(below < 280 && r.top > below);
    setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    measure();
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      const idx = Math.max(0, filtered.findIndex((o) => o.value === value));
      setHighlight(idx === -1 ? 0 : idx);
      // Focus once the portal has painted, so the mobile keyboard opens with it.
      requestAnimationFrame(() => requestAnimationFrame(() => searchRef.current?.focus()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row in view as the user arrows through.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[highlight] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const choose = (v: string) => { onChange(v); setOpen(false); triggerRef.current?.focus(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[highlight]; if (o) choose(o.value); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
  };

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
        onClick={() => !disabled && setOpen((o) => !o)}
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

      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            left: rect.left,
            width: rect.width,
            ...(above
              ? { bottom: window.innerHeight - rect.top + 4 }
              : { top: rect.bottom + 4 }),
          }}
          className="z-[60] overflow-hidden rounded-xl border border-line bg-surface shadow-lg animate-fade-in"
        >
          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute start-5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={onKey}
              placeholder={searchPlaceholder}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              enterKeyHint="search"
              className="field ps-9"
            />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-60 overflow-y-auto overscroll-contain p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-subtle">{emptyText}</li>
            ) : filtered.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button
                  type="button"
                  onClick={() => choose(o.value)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm transition',
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
        </div>,
        document.body,
      )}
    </>
  );
}
