import {
  useEffect, useMemo, useRef, useState,
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
 * Opening it raises a full-page search-and-choose sheet: full screen on a phone
 * (where a small anchored menu under a field is hard to scroll and search), and
 * a centered command-palette dialog on wider screens. It is portalled to
 * <body>, so it is never clipped by a modal's scroll area, and driven entirely
 * by the keyboard: type to filter, ↑/↓ to move, Enter to choose, Esc to close.
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
  id?: string;
  className?: string;
  invalid?: boolean;
  autoFocus?: boolean;
};

const norm = (s: string) => s.toLowerCase().replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').trim();

export function Combobox({
  value, onChange, options, placeholder = '— اختر —',
  searchPlaceholder = 'اكتب للبحث…', emptyText = 'لا نتائج', title,
  disabled, allowClear = true, id, className, invalid, autoFocus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
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

  // Lock the background, focus the search box once painted (so the mobile
  // keyboard opens with the sheet), and reset the highlight to the current pick.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setQuery('');
    const idx = options.findIndex((o) => o.value === value);
    setHighlight(idx === -1 ? 0 : idx);
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => searchRef.current?.focus()));
    return () => {
      document.body.style.overflow = previous;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
        onClick={() => !disabled && setOpen(true)}
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

      {open && createPortal(
        <div className="fixed inset-0 z-[70] flex justify-center overflow-hidden no-print items-stretch sm:items-start sm:p-4 sm:py-[6dvh]">
          <div className="fixed inset-0 bg-[#1c1f1d]/45 backdrop-blur-[2px] animate-fade-in" onClick={close} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            className="card elevated animate-rise relative z-10 flex w-full flex-col overflow-hidden h-full rounded-none sm:h-auto sm:max-h-[80dvh] sm:max-w-lg sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line p-2.5">
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
              <button
                type="button"
                onClick={close}
                aria-label="إغلاق"
                className="grid size-10 shrink-0 place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-5" />
              </button>
            </div>
            <ul ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
              {filtered.length === 0 ? (
                <li className="px-3 py-10 text-center text-sm text-subtle">{emptyText}</li>
              ) : filtered.map((o, i) => (
                <li key={o.value} role="option" aria-selected={o.value === value}>
                  <button
                    type="button"
                    onClick={() => choose(o.value)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-start text-sm transition',
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
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
