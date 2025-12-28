-- Sync infrastructure tables (public schema)
CREATE TABLE IF NOT EXISTS public.devices (
  device_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sync_change_log (
  change_id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  version INT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_device_id TEXT,
  outbox_id TEXT,
  payload JSONB
);

CREATE TABLE IF NOT EXISTS public.sync_cursors (
  device_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  last_change_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_change_log_outbox_id_uq
  ON public.sync_change_log (tenant_id, outbox_id)
  WHERE outbox_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sync_change_log_tenant_change_id_idx
  ON public.sync_change_log (tenant_id, change_id);

-- Add sync metadata columns to tenant tables (base_schema)
ALTER TABLE base_schema.products
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.categories
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.product_images
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.product_tags
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.product_tag_map
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.employee
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.inventory
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.stock_transactions
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.suppliers
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.purchase_orders
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.purchase_order_items
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.customers
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.sales_invoices
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.payments
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.custom_products
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.sales_details
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.shift_logs
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.customer_transactions
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.settings
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.roles
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.permissions
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.role_permissions
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;

ALTER TABLE base_schema.employee_roles
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT;
