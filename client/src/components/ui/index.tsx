import {
  forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ Button */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'success' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  icon?: ReactNode;
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  // The coloured shadow — teal light spilling under a teal button — is what
  // makes these feel lifted rather than painted on.
  primary:
    'bg-brand-600 text-white shadow-btn-primary '
    + 'hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/45',
  // Red CTA, white text (4.83:1) — red, unlike the amber this replaced, does
  // carry white. Visually identical to `danger` by design decision; the two
  // are kept as separate variants so they can be told apart again with one
  // edit if that collision ever bites.
  accent:
    'bg-accent-600 text-white shadow-btn-accent '
    + 'hover:bg-accent-700 active:bg-accent-800 disabled:bg-accent-600/45',
  secondary:
    'bg-surface text-ink border border-line-strong shadow-btn-neutral '
    + 'hover:bg-surface-2 active:bg-surface-3',
  subtle: 'bg-surface-2 text-ink hover:bg-surface-3 border border-transparent',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  // Red is reserved for destructive actions and out-of-stock — never decoration.
  danger:
    'bg-red-600 text-white shadow-btn-danger '
    + 'hover:bg-red-700 active:bg-red-800 disabled:bg-red-600/45',
  success:
    'bg-green-700 text-white shadow-btn-success '
    + 'hover:bg-green-800 active:bg-green-900 disabled:bg-green-700/45',
};

// 8–10px radius on controls, against 16px on cards — the smaller element
// keeps the tighter corner so the two don't read as the same object.
const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-[0.625rem]',
  lg: 'h-12 px-6 text-sm gap-2 rounded-[0.625rem]',
  // 40px — short of the 44px touch-target guideline at rest, but this app's
  // mobile breakpoint scales the root font-size up (see index.css), which
  // scales this rem-based size right along with it; call sites in genuinely
  // tight spots (e.g. table row actions) already override with an explicit
  // size-N className, which wins over this default either way.
  icon: 'size-10 rounded-[0.625rem] justify-center',
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
        // Press to 0.96 and spring back: the overshoot curve is what makes a
        // tap feel physical rather than like a CSS state change.
        'transition-[background-color,box-shadow,transform] duration-150',
        'active:scale-[0.96] active:duration-75',
        'hover:[transition-timing-function:cubic-bezier(0.34,1.4,0.64,1)]',
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

/**
 * A labelled control. The label sits *inside* the control and rises out of the
 * way on focus or once there is a value — see the `.fld__*` rules in index.css
 * for the motion and the reasoning behind it.
 *
 * The `<label>` still wraps its control rather than pairing by id, so clicking
 * anywhere in the box focuses the input with no id wiring at any call site.
 * The raised/resting state is therefore selected with `:has()` rather than a
 * sibling combinator.
 *
 * Wrapping something that is not a form control (the image picker, a bare div)
 * needs no opt-out: with no `.field` inside to float over, CSS drops the label
 * back above the content by itself.
 */
export function Field({ label, hint, error, required, className, children }: FieldWrapProps) {
  return (
    <label className={cn('fld block', className)}>
      <span className="fld__box">
        {children}
        {label && (
          <span className="fld__text">
            {label}
            {required && <span className="text-accent-600 dark:text-accent-400">*</span>}
          </span>
        )}
      </span>
      {error ? (
        <span className="mt-1 block text-xs font-medium text-accent-600 dark:text-accent-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

/*
 * Both controls below default `placeholder` to a single space.
 *
 * That is load-bearing, not cosmetic: the floating label uses
 * `:placeholder-shown` as its "is empty" test, and an input carrying no
 * placeholder attribute never matches it — the label would stay raised over an
 * empty field. The space is never visible (index.css keeps the placeholder
 * transparent until focus), and a real placeholder passed by a call site still
 * wins and still reveals itself on focus.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, placeholder = ' ', ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        className={cn('field', className)}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, placeholder = ' ', ...props }, ref) {
    return <textarea ref={ref} rows={3} placeholder={placeholder} className={cn('field resize-y', className)} {...props} />;
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
  danger: 'bg-accent-500/12 text-accent-700 dark:text-accent-400',
  warning: 'bg-accent-500/15 text-accent-700 dark:text-accent-400',
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
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  initialFocus?: React.RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * The callbacks are held in a ref so the effect below can depend on `open`
   * alone.
   *
   * This is not a micro-optimisation, it was a bug: `onClose` and
   * `initialFocus` were in the dependency array, and a caller that defines its
   * handler inline (`onClose={() => setOpen(false)}`, or any handler declared
   * in the component body) hands over a new function identity on every render.
   * A modal whose content holds state — every form in this app — therefore
   * re-ran this effect on each keystroke, and 40ms later the autofocus fired
   * again and moved the caret to the first focusable element in the panel: the
   * ✕ button. You could type exactly one character before focus jumped away,
   * and on Android the soft keyboard closed with it.
   *
   * Autofocus must happen once per opening, so `open` is the only honest
   * dependency. Escape still calls whatever the latest `onClose` is.
   */
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef(initialFocus);
  onCloseRef.current = onClose;
  initialFocusRef.current = initialFocus;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => {
      (initialFocusRef.current?.current ?? panelRef.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]),select,textarea,button',
      ))?.focus();
    }, 40);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      clearTimeout(timer);
    };
  }, [open]);

  if (!open) return null;

  const full = size === 'full';
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-none' }[size];

  return createPortal(
    <div className={cn(
      // overflow-hidden here, always — never a second scrollable ancestor
      // around the panel. That used to be overflow-y-auto for non-full sizes
      // (to reach a modal taller than a short viewport), but a scrollable
      // wrapper around a panel whose *own* body also scrolls is exactly the
      // nested-scroll setup mobile browsers mishandle: a drag that reaches
      // the inner region's end "hands off" to the outer one instead of
      // stopping, and the page reads as stuck until it's reloaded. Capping
      // the panel itself at a dvh-based max-height (below) — the same trick
      // `full` mode already used — makes the outer scroll unnecessary for
      // every size, not just that one: the panel can never exceed the
      // viewport, so its own internal body scroll is always enough.
      'fixed inset-0 z-50 flex justify-center overflow-hidden no-print',
      full ? 'items-stretch p-0' : 'items-start p-2 py-[4dvh] sm:p-4 sm:py-[6dvh]',
    )}>
      <div
        className="fixed inset-0 bg-[#1c1f1d]/45 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          'card elevated animate-rise relative z-10 flex w-full flex-col overflow-hidden',
          full ? 'h-full rounded-none' : 'max-h-[92dvh] sm:max-h-[88dvh]',
          width,
        )}
      >
        <div className="flex shrink-0 items-start gap-4 border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
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
        {/* overscroll-contain stops a swipe that reaches the end of this area
            from chaining to the page behind it — the other half of the mobile
            "scrolled down, can't get back up" problem. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-4 py-3 max-sm:[&>button]:whitespace-nowrap sm:px-5 sm:py-3.5">
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
    <div className="page-header mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5 sm:gap-4">
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
/**
 * An empty screen is the first thing a new user sees, so it is treated as a
 * welcome rather than an error: a soft haloed illustration, a plainly-worded
 * heading, and one obvious next step.
 *
 * `tone` colours the halo so an empty list ("nothing here yet — add one")
 * reads as friendly, while a genuine dead end can read as a warning, without
 * either needing its own component.
 */
export function EmptyState({
  icon, title, message, action, tone = 'brand',
}: {
  icon?: ReactNode; title: string; message?: ReactNode; action?: ReactNode;
  tone?: 'brand' | 'accent' | 'warning' | 'neutral';
}) {
  const halo = {
    brand: 'from-brand-400/25 to-brand-500/5 text-brand-600 dark:text-brand-300',
    accent: 'from-accent-400/25 to-accent-500/5 text-accent-600 dark:text-accent-300',
    warning: 'from-accent-400/30 to-accent-500/5 text-accent-700 dark:text-accent-300',
    neutral: 'from-surface-3 to-surface-2 text-muted',
  }[tone];

  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center sm:py-16">
      {icon && (
        <div className="relative mb-5">
          {/* Soft bloom behind the glyph — depth without needing artwork. */}
          <div className={cn('absolute inset-0 -z-10 scale-150 rounded-full bg-gradient-to-br blur-2xl opacity-70', halo)} aria-hidden />
          <div className={cn(
            'animate-rise grid size-16 place-items-center rounded-3xl bg-gradient-to-br shadow-sm',
            halo,
          )}>
            {icon}
          </div>
        </div>
      )}
      <p className="text-base font-bold">{title}</p>
      {message && <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
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
