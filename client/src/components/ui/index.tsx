import {
  forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ Button */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  icon?: ReactNode;
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 '
    + 'disabled:bg-brand-600/45 disabled:shadow-none',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-surface-2 active:bg-surface-3',
  subtle: 'bg-surface-2 text-ink hover:bg-surface-3 border border-transparent',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-600/45',
  success: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-600/45',
};

const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-9.5 px-4 text-sm gap-2 rounded-[0.625rem]',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
  icon: 'size-9 rounded-[0.625rem] justify-center',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...props }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold',
        'transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.985]',
        'disabled:pointer-events-none disabled:opacity-60',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------- Field */
type FieldWrapProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

export function Field({ label, hint, error, required, className, children }: FieldWrapProps) {
  return (
    <label className={cn('block', className)}>
      {label && (
        <span className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted">
          {label}
          {required && <span className="text-rose-500">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-rose-500">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn('field', className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} rows={3} className={cn('field resize-y', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn('field cursor-pointer appearance-none bg-no-repeat pe-9', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundPosition: 'left 0.7rem center',
        }}
        {...props}
      >
        {children}
      </select>
    );
  },
);

/** Search box with a leading icon and an optional clear button. */
export function SearchInput({
  value, onValueChange, placeholder = 'بحث…', className, autoFocus,
}: {
  value: string; onValueChange: (v: string) => void;
  placeholder?: string; className?: string; autoFocus?: boolean;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        className="field ps-9 pe-8"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange('')}
          className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle transition hover:bg-surface-2 hover:text-ink"
          aria-label="مسح"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */
type BadgeTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'info' | 'purple';

const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-muted',
  brand: 'bg-brand-500/12 text-brand-700 dark:text-brand-300',
  success: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  danger: 'bg-rose-500/12 text-rose-700 dark:text-rose-400',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  info: 'bg-sky-500/12 text-sky-700 dark:text-sky-400',
  purple: 'bg-violet-500/12 text-violet-700 dark:text-violet-400',
};

export function Badge({
  tone = 'neutral', children, className, icon,
}: { tone?: BadgeTone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
      BADGE[tone], className,
    )}>
      {icon}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Modal */
export function Modal({
  open, onClose, title, description, children, footer, size = 'md', initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  initialFocus?: React.RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => {
      (initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]),select,textarea,button',
      ))?.focus();
    }, 40);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      clearTimeout(timer);
    };
  }, [open, onClose, initialFocus]);

  if (!open) return null;

  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 py-[4vh] no-print sm:p-4 sm:py-[6vh]">
      <div
        className="fixed inset-0 bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn('card animate-rise relative z-10 w-full overflow-hidden', width)}
      >
        <div className="flex items-start gap-4 border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold leading-tight">{title}</h2>
            {description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-me-1 -mt-1 rounded-lg p-1.5 text-subtle transition hover:bg-surface-2 hover:text-ink"
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto px-4 py-4 sm:max-h-[64vh] sm:px-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-4 py-3 max-sm:[&>button]:whitespace-nowrap sm:px-5 sm:py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------------- Confirmation */
export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'تأكيد', tone = 'danger', loading,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: ReactNode; confirmLabel?: string;
  tone?: 'danger' | 'primary' | 'success'; loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>إلغاء</Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{message}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------- Page shell */
export function PageHeader({
  title, subtitle, actions, breadcrumb,
}: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5 sm:gap-4">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1.5 text-xs text-subtle">{breadcrumb}</div>}
        <h1 className="text-lg font-bold leading-tight tracking-tight sm:text-[1.35rem]">{title}</h1>
        {/* The subtitle is explanatory, not load-bearing — it costs a phone
            more vertical space than it gives back. */}
        {subtitle && <p className="mt-1 hidden text-sm text-muted sm:block">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card', className)}>{children}</div>;
}

/* ------------------------------------------------------------ Empty state */
export function EmptyState({
  icon, title, message, action,
}: { icon?: ReactNode; title: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-500/10 text-brand-500">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {message && <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-shimmer rounded-md bg-surface-3', className)} />;
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-3.5', c === 0 ? 'w-[28%]' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- Pagination */
export function Pagination({
  page, pages, total, limit, onPage, onLimit,
}: {
  page: number; pages: number; total: number; limit: number;
  onPage: (page: number) => void; onLimit?: (limit: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs no-print">
      <div className="flex items-center gap-3 text-muted">
        <span className="nums">عرض {from}–{to} من {total}</span>
        {onLimit && (
          <select
            className="field h-7 w-auto py-0 text-xs"
            value={limit}
            onChange={(e) => onLimit(Number(e.target.value))}
            aria-label="عدد الصفوف"
          >
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / صفحة</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="السابق">
          <ChevronRight className="size-4" />
        </Button>
        <span className="nums px-2 font-semibold text-muted">{page} / {pages}</span>
        <Button size="icon" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="التالي">
          <ChevronLeft className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Dropdown */
/**
 * Click-toggled dropdown. Deliberately not hover-driven: a hover menu is
 * unreachable by touch, awkward for keyboard users, and closes if the pointer
 * strays while travelling to an item.
 */
export function Menu({
  trigger, children, align = 'end', width = 'w-56',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          className={cn(
            'card animate-rise absolute top-full z-40 mt-1.5 overflow-hidden p-1.5 shadow-lg',
            width,
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A row inside `Menu`. */
export function MenuItem({
  onClick, icon, children, className,
}: { onClick: () => void; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm transition hover:bg-surface-2',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Misc */
export function Toggle({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-surface-3 border border-line-strong',
        )}
      >
        <span className={cn(
          'absolute top-1/2 size-4.5 -translate-y-1/2 rounded-full bg-white shadow transition-[inset-inline-start]',
          checked ? 'start-[1.5rem]' : 'start-[0.15rem]',
        )} />
      </button>
    </label>
  );
}

/** Small labelled statistic used on detail pages. */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-subtle">{label}</p>
      <p className={cn('mt-0.5 text-sm font-bold nums', tone)}>{value}</p>
    </div>
  );
}
