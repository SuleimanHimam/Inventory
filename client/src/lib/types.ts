export type Paginated<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number; pages: number };
};

export type Category = { id: string; name: string; created_at: string; item_count?: number };

export type SubBarcode = {
  id: string; item_id: string; barcode: string; label: string | null; created_at: string;
};

/** An alternate purchase/sale unit for an item (e.g. "Box of 12"). */
export type ItemUnit = {
  id: string;
  item_id: string;
  name: string;
  barcode: string;
  /** Multiplier to the item's base unit, e.g. 12 for a box of 12 pieces. */
  conversion_factor: number;
  /** @money Absent for a staff role — see the note above `Item`. */
  purchase_price?: number;
  /** @money Absent for a staff role. */
  sale_price?: number;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  cbm_m3: number | null;
  created_at: string;
  updated_at: string;
};

export type ItemImage = {
  id: string;
  item_id: string;
  file: string;
  sort_order: number;
  created_at: string;
  /** Server-relative path; run through `mediaUrl()` before using as a src. */
  url: string;
};

/**
 * Money fields across this file are optional, and that is not laziness.
 *
 * The API strips every price out of the response when the signed-in role is
 * not allowed to see one (`server/src/lib/roles.js`), so at runtime these keys
 * are genuinely absent for a staff account. Declaring them `number` would be a
 * lie the compiler then helps enforce — `sale_price - purchase_price` would
 * typecheck and produce `NaN` on screen.
 *
 * Marked `@money` so the set is greppable. Guard reads with
 * `usePermissions().canSeePrices` rather than defaulting to 0, which would
 * display a confident, wrong number.
 */
export type Item = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  barcode: string | null;
  notes: string | null;
  /** @money Absent for a staff role. */
  purchase_price?: number;
  /** @money Absent for a staff role. */
  sale_price?: number;
  quantity: number;
  low_stock_threshold: number | null;
  effective_threshold: number;
  is_low_stock: boolean;
  source: 'MANUAL' | 'IMPORT';
  /** The primary photo — always the first of `images`, kept in sync server-side. */
  image_file: string | null;
  /** Server-relative path; run through `mediaUrl()` before using as a src. */
  image_url: string | null;
  /** The full gallery. Only present on the single-item (detail) fetch. */
  images?: ItemImage[];
  /** Physical attributes of the item's own (base) unit. */
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  cbm_m3: number | null;
  created_at: string;
  updated_at: string;
  sub_barcodes?: SubBarcode[];
  /** Alternate purchase/sale units. Only present on the single-item (detail) fetch. */
  units?: ItemUnit[];
  stats?: { total_in: number; total_out: number; movement_count: number };
  matched_on?: 'PRIMARY' | 'SUB' | 'UNIT' | 'name' | 'barcode' | 'sub_barcode' | 'unit';
  matched_barcode?: string;
  matched_unit_id?: string | null;
};

export type MovementType = 'IN' | 'OUT';
export type ReferenceType = 'MANUAL' | 'STOCK_COUNT' | 'IMPORT' | 'INVOICE';

export type Movement = {
  id: string;
  item_id: string;
  item_name: string;
  item_barcode: string | null;
  type: MovementType;
  quantity: number;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_type: InvoiceType | null;
  invoice_source: InvoiceSource | null;
  reference_type: ReferenceType;
  note: string | null;
  created_at: string;
};

export type Party = {
  id: string;
  name: string;
  contact_person?: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** `total_value` is @money — absent for a staff role. */
  stats?: { invoice_count: number; total_value?: number; last_invoice_date: string | null };
  recent_invoices?: Array<Pick<Invoice, 'id' | 'number' | 'type' | 'status' | 'invoice_date' | 'total'>>;
};

export type InvoiceType = 'STOCK_IN' | 'STOCK_OUT';
export type InvoiceStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';
export type InvoiceSource = 'USER' | 'QUICK' | 'STOCK_COUNT' | 'IMPORT';

export type InvoiceLine = {
  id: string;
  invoice_id: string;
  item_id: string;
  item_name: string;
  item_barcode: string | null;
  item_quantity: number;
  /** Primary photo of the item; run through `mediaUrl()` before using as a src. */
  item_image_url: string | null;
  category_name: string | null;
  barcode_scanned: string | null;
  /** How many of `unit_id` (or the base unit, if null) were entered. */
  quantity: number;
  unit_id: string | null;
  unit_name: string | null;
  unit_barcode: string | null;
  /** Snapshotted at add/edit time — multiplies `quantity` to get base-unit stock. */
  conversion_factor: number;
  /** Every unit configured for this item, for the line's own unit picker. */
  item_units: Array<{ id: string; name: string; conversion_factor: number }>;
  /** @money Absent for a staff role — the server fills it from the item. */
  unit_price?: number;
  /** @money Absent for a staff role. */
  line_total?: number;
  /**
   * What these goods cost, snapshotted when the invoice was posted — never
   * today's purchase price. @money, and manager-only: absent for staff *and*
   * clerk, unlike the sale-side fields above. Null on an unposted line.
   */
  cost_price?: number | null;
  /** quantity x cost_price. @money, manager-only. */
  line_cost?: number | null;
  /** line_total − line_cost. @money, manager-only. Null on anything but a posted sale. */
  line_profit?: number | null;
  update_item_price: boolean;
  note: string | null;
};

export type Invoice = {
  id: string;
  type: InvoiceType;
  /** null until the invoice is saved — numbers are minted on save, not on open. */
  number: string | null;
  status: InvoiceStatus;
  source: InvoiceSource;
  is_system: boolean;
  supplier_id: string | null;
  customer_id: string | null;
  supplier_name: string | null;
  customer_name: string | null;
  party_name: string | null;
  invoice_date: string;
  /** @money The four below are absent for a staff role. */
  subtotal?: number;
  discount_total?: number;
  tax_total?: number;
  total?: number;
  line_count: number;
  /** The document's first line, so a list row can show what it is for. */
  first_item_name: string | null;
  first_item_qty: number | null;
  note: string | null;
  stock_count_id: string | null;
  stock_count_number: string | null;
  created_by: string;
  created_at: string;
  posted_at: string | null;
  /**
   * Profitability. All four are @money and manager-only — a clerk sees sale
   * prices and totals but never what the goods cost.
   *
   * `profit` is revenue net of discount, before tax, minus the cost snapshot
   * taken at posting time. It is null on a STOCK_IN: a purchase is inventory
   * changing form, not a loss.
   */
  cost_total?: number | null;
  profit?: number | null;
  /** Gross margin against revenue, not markup against cost. @money-gated. */
  margin_pct?: number | null;
  /** False when any line's cost was reconstructed by migration 007 rather than recorded. */
  profit_exact?: boolean | null;
  /** Set when a manager reversed this document; its status is then CANCELLED. */
  reversed_at: string | null;
  reversed_by: string | null;
  is_reversed: boolean;
  /** Set when a manager last reopened this document for editing. */
  reopened_at: string | null;
  reopened_by: string | null;
  /** How many times it has been reopened and re-posted. 0 for an untouched document. */
  revision: number;
  lines?: InvoiceLine[];
  movements?: Movement[];
};

/**
 * Totals for whatever filter the invoices list currently has applied —
 * POSTED documents only, across the whole filter rather than the current page.
 * The three money fields are @money and absent for a staff role; the counts
 * always arrive.
 */
export type InvoiceSummary = {
  /** Purchases: STOCK_IN. @money */
  in_total?: number;
  /** Sales: STOCK_OUT. @money */
  out_total?: number;
  /** out_total − in_total. @money */
  net_total?: number;
  /**
   * Earned on the sales in this range: revenue net of discount, before tax,
   * minus cost. @money and manager-only.
   *
   * Not to be confused with `net_total` above, which is money that *moved* —
   * a month with a big restock has a poor net_total and a healthy profit_total.
   */
  profit_total?: number;
  /** False when any invoice in the range has a reconstructed rather than recorded cost. */
  profit_exact?: boolean;
  in_count: number;
  out_count: number;
};

export type PostProblem = {
  code: string;
  message: string;
  line_id?: string;
  item_id?: string;
  available?: number;
  requested?: number;
};

export type StockCountStatus = 'OPEN' | 'SUBMITTED' | 'APPLIED' | 'CANCELLED';

export type StockCountLine = {
  id: string;
  stock_count_id: string;
  item_id: string;
  item_name: string;
  item_barcode: string | null;
  category_name: string | null;
  expected_quantity: number;
  counted_quantity: number | null;
  live_quantity: number;
  variance: number | null;
  skipped: boolean;
  is_stale: boolean;
  auto_invoice_line_id: string | null;
  note: string | null;
};

export type StockCount = {
  id: string;
  number: string;
  scope: 'ALL' | 'CATEGORY' | 'ITEM';
  category_id: string | null;
  category_name: string | null;
  item_id: string | null;
  item_name: string | null;
  status: StockCountStatus;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  applied_at: string | null;
  line_count: number;
  counted_count: number;
  variance_count: number;
  lines?: StockCountLine[];
  invoices: Array<Pick<Invoice, 'id' | 'number' | 'type' | 'status'>>;
  summary?: {
    total: number; entered: number; skipped: number; unchanged: number;
    surplus: StockCountLine[]; shortage: StockCountLine[];
    surplus_units: number; shortage_units: number;
  };
};

export type ImportRow = {
  row_number: number;
  name: string;
  category: string | null;
  barcode: string;
  purchase_price: number;
  sale_price: number;
  opening_quantity: number;
  valid: boolean;
  errors: string[];
  duplicate: boolean;
  existing_item_id: string | null;
  existing_item_name: string | null;
  reason?: string;
};

export type ImportPreview = {
  upload_id: string;
  filename: string;
  total: number;
  valid_count: number;
  duplicate_count: number;
  invalid_count: number;
  rows: ImportRow[];
};

export type ImportResult = {
  created_count: number;
  updated_count: number;
  skipped_count: number;
  rejected_count: number;
  opening_invoice: { id: string; number: string } | null;
  rejected: ImportRow[];
};

export type DashboardStats = {
  total_items: number;
  total_units: number;
  /** @money Absent for a staff role. */
  stock_value?: number;
  /** @money Absent for a staff role. */
  stock_profit?: number;
  low_stock_count: number;
  out_of_stock_count: number;
  threshold: number;
  today: { in_qty: number; out_qty: number; movements: number };
  trend: Array<{ day: string; in_qty: number; out_qty: number }>;
  top_moving: Array<{ id: string; name: string; moved: number }>;
  counts: {
    categories: number; customers: number; suppliers: number;
    draft_invoices: number; open_counts: number;
  };
};

/** A member of the signed-in user's organisation — Settings › المستخدمون. */
export type OrgUser = {
  id: string;
  email: string;
  /** Kept in step with `Role` in lib/permissions.ts and `ROLES` in server/src/lib/roles.js. */
  role: 'OWNER' | 'MEMBER' | 'CLERK';
  created_at: string;
  /** False for a membership with no password account behind it (Supabase mode). */
  has_local_account: boolean;
  /** False = open account: the username alone signs them in. */
  has_password: boolean;
  /** The caller's own row — the UI disables what would lock them out. */
  is_self: boolean;
};

export type Settings = {
  low_stock_threshold: string;
  import_max_rows: string;
  import_max_file_mb: string;
  company_name: string;
  currency: string;
  digits: 'latn' | 'arab';
};

/* ------------------------------------------------------------------ backup */
/**
 * One backup: the database and the product photos of a single moment.
 *
 * Mirrors what `server/src/lib/backup.js` reads off disk. `source` says where
 * it came from — `external` covers sets this API did not write, which on this
 * deployment means the 02:00 scheduled task.
 */
export type BackupSet = {
  /** `2026-08-16_0200` — also the folder name, and how sets are ordered. */
  name: string;
  created_at: string;
  /** Bytes, database plus photos. */
  size: number;
  has_uploads: boolean;
  source: 'auto' | 'manual' | 'imported' | 'external';
  database: string | null;
  counts: { items: number; invoices: number; movements: number; users: number } | null;
  /** Only ever false on an imported set the server was not permitted to check. */
  verified?: boolean;
  unverified_reason?: string | null;
};

/** What the SQL login is actually permitted to do — asked of SQL Server, not assumed. */
export type BackupCapabilities = {
  can_backup: boolean;
  can_restore: boolean;
  /** Reading a backup's header needs the same permission as restoring it. */
  can_verify: boolean;
  sysadmin: boolean;
  login?: string;
  database?: string;
  includes_uploads?: boolean;
  reason: string | null;
};

export type BackupConfig = {
  auto: boolean;
  /** Local 24-hour `HH:MM`. */
  time: string;
  keep_days: number;
  /** Optional second destination — a UNC share or another drive. */
  copy_to: string;
};

export type BackupStatus = {
  capabilities: BackupCapabilities;
  config: BackupConfig;
  sets: BackupSet[];
  directory: string;
  max_upload_mb: number;
  next_run_at: string | null;
  last_auto_run: {
    at: string; ok: boolean; set: string | null;
    error?: string | null; copied_to?: string | null; copy_error?: string;
  } | null;
};

/** One level of the server's folder tree — directory names only, never files. */
export type BrowseResult = {
  /** Absolute, normalised. Null at the drive-list level. */
  path: string | null;
  parent: string | null;
  /** Proven by writing a probe file, not by asking the filesystem. */
  writable: boolean;
  entries: { name: string; path: string }[];
  drives: { name: string; path: string }[];
};

export type RestoreResult = {
  restored: string;
  took_ms: number;
  photos_restored: number | null;
  counts: { items: number; invoices: number; movements: number; users: number } | null;
  warnings: string[];
};
