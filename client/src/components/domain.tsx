import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  ArrowDownLeft, ArrowUpRight, FileText, PackagePlus, XCircle, AlertTriangle, CheckCircle2,
  PackageMinus, Bot, ClipboardList, FileSpreadsheet, Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt, fmtSigned } from '@/lib/format';
import type {
  InvoiceSource, InvoiceStatus, InvoiceType, MovementType, ReferenceType, StockCountStatus,
} from '@/lib/types';

/* --------------------------------------------------------- invoice labels */
/**
 * Presentation metadata per invoice type. Labels resolve through i18n at read
 * time, so switching locale relabels every badge without touching call sites.
 */
export const INVOICE_TYPES: Record<InvoiceType, {
  get label(): string; get short(): string;
  tone: 'success' | 'danger' | 'brand' | 'purple';
  icon: typeof FileText; direction: 'IN' | 'OUT';
}> = {
  STOCK_IN: {
    get label() { return i18n.t('invoiceType.STOCK_IN'); },
    get short() { return i18n.t('invoiceType.short.STOCK_IN'); },
    tone: 'success', icon: PackagePlus, direction: 'IN',
  },
  STOCK_OUT: {
    get label() { return i18n.t('invoiceType.STOCK_OUT'); },
    get short() { return i18n.t('invoiceType.short.STOCK_OUT'); },
    tone: 'danger', icon: PackageMinus, direction: 'OUT',
  },
};

export const INVOICE_STATUS: Record<InvoiceStatus, { tone: 'neutral' | 'success' | 'danger' }> = {
  DRAFT: { tone: 'neutral' },
  POSTED: { tone: 'success' },
  CANCELLED: { tone: 'danger' },
};

export const COUNT_STATUS: Record<StockCountStatus, {
  get label(): string; tone: 'info' | 'warning' | 'success' | 'danger';
}> = {
  OPEN: { get label() { return i18n.t('countStatus.OPEN'); }, tone: 'info' },
  SUBMITTED: { get label() { return i18n.t('countStatus.SUBMITTED'); }, tone: 'warning' },
  APPLIED: { get label() { return i18n.t('countStatus.APPLIED'); }, tone: 'success' },
  CANCELLED: { get label() { return i18n.t('countStatus.CANCELLED'); }, tone: 'danger' },
};

const SOURCE_ICON: Record<InvoiceSource, typeof Bot | null> = {
  USER: null,
  QUICK: Zap,
  STOCK_COUNT: ClipboardList,
  IMPORT: FileSpreadsheet,
};

/** Reference-type labels, resolved through i18n on access. */
export const REFERENCE_LABEL: Record<ReferenceType, string> = new Proxy(
  {} as Record<ReferenceType, string>,
  { get: (_target, key: string) => i18n.t(`referenceType.${key}`) },
);

export function InvoiceTypeBadge({ type, withIcon = true }: { type: InvoiceType; withIcon?: boolean }) {
  const config = INVOICE_TYPES[type];
  const Icon = config.icon;
  return (
    <Badge tone={config.tone} icon={withIcon ? <Icon className="size-3" /> : undefined}>
      {config.short}
    </Badge>
  );
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation();
  return <Badge tone={INVOICE_STATUS[status].tone}>{t(`invoiceStatus.${status}`)}</Badge>;
}

/** Marks documents the system generated rather than a person. */
export function SourceBadge({ source }: { source: InvoiceSource }) {
  const { t } = useTranslation();
  const Icon = SOURCE_ICON[source];
  if (!Icon) return null;
  return <Badge tone="info" icon={<Icon className="size-3" />}>{t(`invoiceSource.${source}`)}</Badge>;
}

/* ------------------------------------------------------------- quantities */
/**
 * Stock level, as status rather than as a number that happens to be coloured.
 *
 * Colour never carries the meaning on its own here: each state pairs a hue
 * with its own icon *and* a word. That is what keeps it readable for the
 * ~8% of men with red/green colour blindness, in a printout, and on a phone
 * held at arm's length under warehouse lighting — all normal conditions for
 * this app, none of which colour alone survives.
 *
 * The count stays the most prominent element; the label sits under it, quiet.
 */
const STOCK_STATE = {
  out: {
    icon: XCircle,
    label: 'نفد',
    text: 'text-stock-out-text dark:text-red-400',
  },
  low: {
    icon: AlertTriangle,
    label: 'منخفض',
    text: 'text-stock-low-text dark:text-accent-400',
  },
  in: {
    icon: CheckCircle2,
    label: 'متوفر',
    text: 'text-stock-in-text dark:text-green-400',
  },
} as const;

export function QuantityCell({
  quantity, threshold, className, showLabel = true, showIcon = true,
}: {
  quantity: number; threshold?: number; className?: string;
  showLabel?: boolean; showIcon?: boolean;
}) {
  const state = quantity <= 0 ? 'out'
    : (threshold !== undefined && quantity <= threshold) ? 'low'
      : 'in';
  const { icon: Icon, label, text } = STOCK_STATE[state];

  return (
    <span className={cn('inline-flex flex-col items-start gap-0.5', className)}>
      <span className={cn('nums inline-flex items-center gap-1 font-bold', text)}>
        {showIcon && <Icon className="size-3.5 shrink-0" aria-hidden />}
        {fmtInt(quantity)}
        {/* With the icon and word hidden, the state would otherwise be carried
            by colour alone. The number itself says "none left" at a glance,
            but "low" does not, so it keeps a screen-reader-only word. */}
        {!showLabel && !showIcon && state !== 'in' && <span className="sr-only"> — {label}</span>}
      </span>
      {showLabel && (
        <span className={cn('text-[10px] font-semibold leading-none', text)}>{label}</span>
      )}
    </span>
  );
}

export function MovementBadge({ type }: { type: MovementType }) {
  const { t } = useTranslation();
  return type === 'IN' ? (
    <Badge tone="success" icon={<ArrowDownLeft className="size-3" />}>{t('movementType.IN')}</Badge>
  ) : (
    <Badge tone="danger" icon={<ArrowUpRight className="size-3" />}>{t('movementType.OUT')}</Badge>
  );
}

/** Signed stocktaking variance with surplus/shortage colouring. */
export function VarianceCell({ variance }: { variance: number | null }) {
  if (variance === null) return <span className="text-subtle">—</span>;
  const tone =
    variance > 0 ? 'text-emerald-600 dark:text-emerald-400'
      : variance < 0 ? 'text-accent-600 dark:text-accent-400'
        : 'text-subtle';
  return <span className={cn('nums font-bold', tone)}>{fmtSigned(variance)}</span>;
}

/* ------------------------------------------------------------------ links */
export function ItemLink({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <Link
      to={`/items/${id}`}
      className={cn('font-semibold text-ink transition hover:text-brand-600 dark:hover:text-brand-400', className)}
    >
      {name}
    </Link>
  );
}

export function InvoiceLink({ id, number }: { id: string; number: string | null }) {
  if (!id || !number) return <span className="text-subtle">—</span>;
  return (
    <Link to={`/invoices/${id}`} className="nums font-semibold text-brand-600 hover:underline dark:text-brand-400">
      {number}
    </Link>
  );
}

/** Monospaced barcode chip. */
export function BarcodeChip({ code, className }: { code: string | null; className?: string }) {
  if (!code) {
    return <span className={cn('text-[11px] text-subtle', className)}>بدون باركود</span>;
  }
  return (
    <span className={cn(
      'nums inline-block rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] tracking-tight text-muted',
      className,
    )}>
      {code}
    </span>
  );
}
