PRAGMA foreign_keys = ON;

-- Local metadata
CREATE TABLE IF NOT EXISTS local_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Outbox of pending local changes
CREATE TABLE IF NOT EXISTS sync_outbox (
  outbox_id TEXT PRIMARY KEY,
  batch_id TEXT,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_created_at ON sync_outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_table_row ON sync_outbox(table_name, row_id);

-- Offline login cache
CREATE TABLE IF NOT EXISTS credential_cache (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  roles TEXT,
  last_verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

-- Conflict records
CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  local_payload TEXT NOT NULL,
  remote_payload TEXT NOT NULL,
  local_version INTEGER,
  remote_version INTEGER,
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Domain tables (local SQLite cache)
CREATE TABLE IF NOT EXISTS categories (
  category_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_category_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (parent_category_id) REFERENCES categories(category_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  sku TEXT UNIQUE,
  barcode TEXT,
  name TEXT NOT NULL,
  english_name TEXT,
  description TEXT,
  brand TEXT,
  category_id TEXT NOT NULL,
  price REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  discounted_price REAL,
  wholesale REAL,
  tax_inclusive_price REAL,
  tax_rate REAL,
  unit_size TEXT,
  unit_type TEXT,
  unit TEXT,
  stock_level REAL NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS product_images (
  image_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  url TEXT NOT NULL,
  alt_text TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_tags (
  tag_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT
);

CREATE TABLE IF NOT EXISTS product_tag_map (
  product_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  PRIMARY KEY (product_id, tag_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES product_tags(tag_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  address TEXT,
  password_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  inventory_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  quantity REAL NOT NULL,
  reorder_level INTEGER NOT NULL,
  batch_number TEXT,
  expiry_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS stock_transactions (
  transaction_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'OUT',
  change_qty REAL NOT NULL,
  reason TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  related_invoice_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  po_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  status TEXT NOT NULL,
  total_amount REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  po_item_id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  received_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(po_id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  preferences TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT
);

CREATE TABLE IF NOT EXISTS sales_invoices (
  invoice_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  customer_id TEXT,
  employee_id TEXT NOT NULL,
  sub_total REAL NOT NULL,
  total_amount REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  tax_amount REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  amount_received REAL NOT NULL,
  outstanding_balance REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'paid',
  refund_invoice_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(invoice_id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS custom_products (
  custom_product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT
);

CREATE TABLE IF NOT EXISTS sales_details (
  sales_detail_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  product_id TEXT,
  custom_product_id TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  original_price REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(invoice_id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL,
  FOREIGN KEY (custom_product_id) REFERENCES custom_products(custom_product_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shift_logs (
  log_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  shift_start TEXT NOT NULL,
  shift_end TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customer_transactions (
  customer_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  PRIMARY KEY (customer_id, invoice_id),
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT,
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(invoice_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS report_daily_sales_summary (
  report_id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  total_sales REAL NOT NULL,
  total_transactions INTEGER NOT NULL,
  total_tax REAL NOT NULL,
  total_discount REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_inventory_summary (
  report_id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS report_employee_sales (
  report_id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  total_sales REAL NOT NULL,
  total_transactions INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS report_customer_insights (
  report_id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  total_spent REAL NOT NULL,
  transactions_count INTEGER NOT NULL,
  points_earned INTEGER NOT NULL,
  points_redeemed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS settings (
  setting_id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'string',
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  role_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  scope TEXT,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  UNIQUE (module, action, scope)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(permission_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_roles (
  employee_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_modified_by_device_id TEXT,
  PRIMARY KEY (employee_id, role_id),
  FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices(date);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
