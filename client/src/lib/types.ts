export type Paginated<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number; pages: number };
};

export type Category = { id: string; name: string; created_at: string; item_count?: number };

export type SubBarcode = {
  id: string; item_id: string; barcode: string; label: string | null; created_at: string;
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

export type Item = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  barcode: string;
  purchase_price: number;
  sale_price: number;
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
  created_at: string;
  updated_at: string;
  sub_barcodes?: SubBarcode[];
  stats?: { total_in: number; total_out: number; movement_count: number };
  matched_on?: 'PRIMARY' | 'SUB' | 'name' | 'barcode' | 'sub_barcode';
  matched_barcode?: string;
};

export type MovementType = 'IN' | 'OUT';
export type ReferenceType = 'MANUAL' | 'STOCK_COUNT' | 'IMPORT' | 'INVOICE';

export type Movement = {
  id: string;
  item_id: string;
  item_name: string;
  item_barcode: string;
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
  stats?: { invoice_count: number; total_value: number; last_invoice_date: string | null };
  recent_invoices?: Array<Pick<Invoice, 'id' | 'number' | 'type' | 'status' | 'invoice_date' | 'total'>>;
};

export type InvoiceType = 'STOCK_IN' | 'STOCK_OUT' | 'PURCHASE' | 'SALE';
export type InvoiceStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';
export type InvoiceSource = 'USER' | 'QUICK' | 'STOCK_COUNT' | 'IMPORT';

export type InvoiceLine = {
  id: string;
  invoice_id: string;
  item_id: string;
  item_name: string;
  item_barcode: string;
  item_quantity: number;
  /** Primary photo of the item; run through `mediaUrl()` before using as a src. */
  item_image_url: string | null;
  category_name: string | null;
  barcode_scanned: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  update_item_price: boolean;
  note: string | null;
};

export type Invoice = {
  id: string;
  type: InvoiceType;
  number: string;
  status: InvoiceStatus;
  source: InvoiceSource;
  is_system: boolean;
  supplier_id: string | null;
  customer_id: string | null;
  supplier_name: string | null;
  customer_name: string | null;
  party_name: string | null;
  invoice_date: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  line_count: number;
  note: string | null;
  stock_count_id: string | null;
  stock_count_number: string | null;
  created_by: string;
  created_at: string;
  posted_at: string | null;
  lines?: InvoiceLine[];
  movements?: Movement[];
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
  item_barcode: string;
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
  stock_value: number;
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

export type Settings = {
  low_stock_threshold: string;
  import_max_rows: string;
  import_max_file_mb: string;
  company_name: string;
  currency: string;
  digits: 'latn' | 'arab';
};
