import { usePrefs } from '@/store/prefs';

/**
 * Formatting helpers. Arabic month names on the Gregorian calendar, with the
 * digit system switchable between Western (0-9) and Arabic-Indic (٠-٩).
 * Western digits are the default: they read better in dense financial tables.
 */
const localeFor = () => (usePrefs.getState().digits === 'arab' ? 'ar-EG-u-nu-arab' : 'ar-EG-u-nu-latn');

const cache = new Map<string, Intl.NumberFormat>();
const numberFormat = (options: Intl.NumberFormatOptions) => {
  const key = localeFor() + JSON.stringify(options);
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(localeFor(), options);
    cache.set(key, formatter);
  }
  return formatter;
};

/** Whole numbers — quantities, counts. */
export const fmtInt = (value: number | null | undefined) =>
  numberFormat({ maximumFractionDigits: 0 }).format(Number(value ?? 0));

/** Money with exactly two decimals. */
export const fmtMoney = (value: number | null | undefined) =>
  numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0));

/** Money with the configured currency code appended. */
export const fmtCurrency = (value: number | null | undefined) =>
  `${fmtMoney(value)} ${usePrefs.getState().currency}`;

/** Signed variance, always showing an explicit + or −. */
export const fmtSigned = (value: number | null | undefined) => {
  const n = Number(value ?? 0);
  if (n === 0) return fmtInt(0);
  return `${n > 0 ? '+' : '−'}${fmtInt(Math.abs(n))}`;
};

const parseDate = (value: string | null | undefined) => {
  if (!value) return null;
  // Bare `YYYY-MM-DD` is a business date — read it as local, not UTC.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** e.g. ‏28 يوليو 2026 */
export const fmtDate = (value: string | null | undefined) => {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(localeFor(), {
    day: 'numeric', month: 'long', year: 'numeric', calendar: 'gregory',
  }).format(date);
};

/** Compact numeric form for dense table columns. */
export const fmtDateShort = (value: string | null | undefined) => {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(localeFor(), {
    day: '2-digit', month: '2-digit', year: 'numeric', calendar: 'gregory',
  }).format(date);
};

export const fmtDateTime = (value: string | null | undefined) => {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(localeFor(), {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    calendar: 'gregory',
  }).format(date);
};

/** "قبل ٣ دقائق" style relative time for activity feeds. */
export const fmtRelative = (value: string | null | undefined) => {
  const date = parseDate(value);
  if (!date) return '—';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(localeFor(), { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000], ['month', 2592000], ['day', 86400],
    ['hour', 3600], ['minute', 60],
  ];
  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(seconds) >= secondsInUnit) return rtf.format(Math.round(seconds / secondsInUnit), unit);
  }
  return rtf.format(Math.round(seconds), 'second');
};

/** Today's date as `YYYY-MM-DD`, for date inputs. */
export const todayIso = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};
