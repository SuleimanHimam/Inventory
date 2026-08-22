/**
 * Roles, and the one thing a role currently changes: whether money is visible.
 *
 * Three roles now (`memberships.role`'s CHECK constraint — see migration 006):
 *
 *   • OWNER  — "مدير". Sees everything, manages users and settings.
 *   • MEMBER — "موظف". Scans, counts, creates and posts invoices, and never
 *     sees a price.
 *   • CLERK  — "موظف إخراج". One screen only: enters stock-out invoices
 *     through the item search. Sees an item's sale price there — never a
 *     purchase price, a total, or anything else money-shaped — and can never
 *     set one. The dashboard and the invoice list are refused outright
 *     (`requireNotClerk`), not just hidden client-side.
 *
 * ---------------------------------------------------------------------------
 * Why the redaction is a response filter and not a `SELECT` variant
 * ---------------------------------------------------------------------------
 * The obvious implementation is a second column list per query — one with
 * prices, one without. That fails the moment anyone adds a query: money leaks
 * by omission, silently, and the only way to notice is to read every response
 * by hand.
 *
 * So instead this wraps `res.json` once, in front of every authenticated route,
 * and strips a named set of keys on the way out. A new endpoint is redacted
 * before it is written. The cost is that the key set has to be kept honest —
 * hence the list below names every money alias the service layer produces, and
 * `test/roles.test.js` walks real responses looking for numbers that should not
 * be there.
 *
 * This is a visibility boundary, not a security boundary against a determined
 * member — quantities and invoice line counts remain visible, and enough of
 * those over time imply a price. It answers the actual requirement ("the staff
 * account must not show purchase and sale prices"), and it answers it at the
 * API rather than in the UI, so opening devtools does not defeat it.
 */
import { forbidden } from './errors.js';

export const MANAGER = 'OWNER';
export const STAFF = 'MEMBER';
export const CLERK = 'CLERK';
export const ROLES = [MANAGER, STAFF, CLERK];

/** Arabic labels — the API is the only place that knows the internal names. */
export const ROLE_LABELS = { [MANAGER]: 'مدير', [STAFF]: 'موظف', [CLERK]: 'موظف إخراج' };

export const isManager = (role) => role === MANAGER;

/** Only managers see money in general. The predicate most of the feature turns on. */
export const canSeePrices = isManager;

/**
 * The one exception: a clerk sees an item's sale price (never a purchase
 * price, never a total) even though `canSeePrices` is false for it. Kept as
 * its own predicate rather than folded into `canSeePrices` so every existing
 * `canSeePrices` check — totals, purchase prices, reports — stays exactly as
 * restrictive as it already was; only the two call sites that specifically
 * mean "the sale price" need to ask this instead.
 */
export const canSeeSalePrice = (role) => role === MANAGER || role === CLERK;

/** Route guard for anything only a manager may do (user admin, settings, import). */
export function requireManager(req, _res, next) {
  if (!isManager(req.auth?.role)) {
    return next(forbidden('هذه الصلاحية للمدير فقط', 'MANAGER_ONLY'));
  }
  return next();
}

/**
 * Route guard for the dashboard and the invoice list — a clerk's UI never
 * links to either, but "hiding a screen does not protect it" (see
 * `RequireManager` on the client), so the API refuses them too.
 */
export function requireNotClerk(req, _res, next) {
  if (req.auth?.role === CLERK) {
    return next(forbidden('هذه الشاشة غير متاحة لهذا الحساب', 'CLERK_RESTRICTED'));
  }
  return next();
}

/**
 * Route guard for writes to the item catalogue.
 *
 * A clerk searches this catalogue to build a stock-out invoice; it does not
 * maintain it. Creating, editing or deleting an item — and the quick stock
 * movement endpoint, which writes a posted invoice of its own — are all
 * refused. Its UI hides the controls, and this is what makes that mean
 * something.
 */
export function requireItemWrite(req, _res, next) {
  if (req.auth?.role === CLERK) {
    return next(forbidden('هذا الحساب يبحث في الأصناف ولا يعدّلها', 'CLERK_READ_ONLY'));
  }
  return next();
}

/**
 * Every key in an API response whose value is money, or is derived from money
 * closely enough to reveal it.
 *
 * `total` is the awkward one: it is both an invoice total and the row count in
 * the pagination envelope. `isPageMeta` below tells the two apart by shape
 * rather than by guessing from the value.
 */
const MONEY_KEYS = new Set([
  'purchase_price',   // items, item_units
  'sale_price',       // items, item_units
  'unit_price',       // invoice_lines
  'line_total',       // invoice_lines (derived)
  'subtotal',         // invoices (derived)
  'total',            // invoices (derived) — see isPageMeta
  'discount_total',   // invoices
  'tax_total',        // invoices
  'total_value',      // party stats (derived)
  'stock_value',      // dashboard (derived)
  'stock_profit',     // dashboard (derived)
  'in_total',         // invoices list summary — purchases in the filtered range
  'out_total',        // invoices list summary — sales in the filtered range
  'net_total',        // invoices list summary — the difference
]);

/**
 * The subset of `MONEY_KEYS` a clerk is allowed to keep. Everything else in
 * that set — purchase_price above all — stays dropped for it exactly as it is
 * for a plain staff account.
 *
 * `subtotal` and `total` are in here, and that is only safe because of a
 * boundary enforced elsewhere: `clerkStockOutOnly` in invoices.routes.js
 * confines a clerk to STOCK_OUT documents. On one of those every figure is
 * built from sale prices the clerk can already read line by line, so hiding
 * the sum would conceal nothing and would leave them unable to tell a customer
 * what to pay. On a STOCK_IN invoice the same keys would be purchase money —
 * which is exactly why the route guard, not this list, is what keeps them out
 * of one. Widen this set only if that guard still holds.
 */
const SALE_PRICE_KEYS = new Set([
  'sale_price', 'unit_price', 'line_total', 'subtotal', 'total',
]);

/** `{ page, limit, total, pages }` — the list envelope, where `total` counts rows. */
const isPageMeta = (o) => 'page' in o && 'limit' in o && 'pages' in o;

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/**
 * Recursively drop money keys. Returns a copy; the input is untouched.
 *
 * `keepSalePrice` is the one knob: a clerk gets it, everyone below manager
 * does not. Left off, the default reproduces the original all-or-nothing
 * behaviour, which is what the request-body filter below still wants — a
 * clerk cannot set a price even though it can read one.
 */
export function scrubMoney(value, { keepSalePrice = false } = {}) {
  if (Array.isArray(value)) return value.map((v) => scrubMoney(v, { keepSalePrice }));
  if (!isPlainObject(value)) return value;

  const pageMeta = isPageMeta(value);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === 'total' && pageMeta) { out[key] = val; continue; }
    if (keepSalePrice && SALE_PRICE_KEYS.has(key)) { out[key] = val; continue; }
    if (MONEY_KEYS.has(key)) continue;
    out[key] = scrubMoney(val, { keepSalePrice });
  }
  return out;
}

/**
 * Response filter: strip money from everything this request answers with.
 *
 * Mounted once, immediately after `authenticate`, so it covers every route
 * below it — including routes that do not exist yet. A manager skips the
 * filter entirely; a clerk still goes through it, just with the sale-price
 * keys spared.
 */
export function redactMoney(req, res, next) {
  if (isManager(req.auth?.role)) return next();
  const keepSalePrice = canSeeSalePrice(req.auth?.role);
  const json = res.json.bind(res);
  res.json = (body) => json(scrubMoney(body, { keepSalePrice }));
  return next();
}

/**
 * Request filter: only a manager may set a price — deliberately stricter than
 * `redactMoney` above. A clerk can read a sale price but never write one, so
 * this checks `canSeePrices` (manager-only), not `canSeeSalePrice`, and calls
 * `scrubMoney` with no options, which defaults `keepSalePrice` to false.
 *
 * Silently dropped rather than rejected, because the fields are not something
 * a staff or clerk user typed on purpose — the UI never renders an editable
 * price field for either. Dropping lets the service layer apply its normal
 * default, which for an invoice line means the price is read from the item
 * server-side. So a staff or clerk account scans, enters a quantity, and
 * posts a correctly priced invoice without ever being able to change the
 * number.
 */
export function stripMoneyFromBody(req, _res, next) {
  if (canSeePrices(req.auth?.role)) return next();
  if (req.body && typeof req.body === 'object') req.body = scrubMoney(req.body);
  return next();
}
