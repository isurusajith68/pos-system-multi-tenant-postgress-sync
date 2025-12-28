-- Initialize base_schema with default data
-- This script creates the base schema and populates it with default permissions, roles, and admin user

-- Create public schema tables for multi-tenancy
CREATE TABLE IF NOT EXISTS public.tenants (
    id TEXT PRIMARY KEY,
    schema_name TEXT NOT NULL UNIQUE,
    company_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tenant_users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tenant_users_email ON public.tenant_users(email);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON public.tenant_users(tenant_id);

-- Create base_schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS base_schema;

-- Set search path to base_schema
SET search_path TO base_schema;

-- Create default permissions
INSERT INTO base_schema.permissions (permission_id, module, action, scope, description, created_at, updated_at)
VALUES
  -- Invoice permissions
  (1, 'invoices', 'view', 'all', 'View all invoices', NOW(), NOW()),
  (2, 'invoices', 'view', 'daily', 'View daily invoices', NOW(), NOW()),
  (3, 'invoices', 'view', 'monthly', 'View monthly invoices', NOW(), NOW()),
  (4, 'invoices', 'view_detail', NULL, 'View invoice details', NOW(), NOW()),
  (5, 'invoices', 'create', NULL, 'Create new invoices', NOW(), NOW()),
  (6, 'invoices', 'edit', NULL, 'Edit existing invoices', NOW(), NOW()),
  (7, 'invoices', 'delete', NULL, 'Delete invoices', NOW(), NOW()),
  (8, 'invoices', 'refund', NULL, 'Process invoice refunds', NOW(), NOW()),
  
  -- Product permissions
  (9, 'products', 'view', NULL, 'View products', NOW(), NOW()),
  (10, 'products', 'create', NULL, 'Create new products', NOW(), NOW()),
  (11, 'products', 'edit', NULL, 'Edit existing products', NOW(), NOW()),
  (12, 'products', 'delete', NULL, 'Delete products', NOW(), NOW()),
  (13, 'products', 'manage_stock', NULL, 'Manage product stock', NOW(), NOW()),
  
  -- Customer permissions
  (14, 'customers', 'view', NULL, 'View customers', NOW(), NOW()),
  (15, 'customers', 'create', NULL, 'Create new customers', NOW(), NOW()),
  (16, 'customers', 'edit', NULL, 'Edit customer information', NOW(), NOW()),
  (17, 'customers', 'delete', NULL, 'Delete customers', NOW(), NOW()),
  
  -- Report permissions
  (18, 'reports', 'view', 'daily', 'View daily reports', NOW(), NOW()),
  (19, 'reports', 'view', 'monthly', 'View monthly reports', NOW(), NOW()),
  (20, 'reports', 'view', 'all', 'View all reports', NOW(), NOW()),
  (21, 'reports', 'export', NULL, 'Export reports', NOW(), NOW()),
  
  -- Settings permissions
  (22, 'settings', 'view', NULL, 'View system settings', NOW(), NOW()),
  (23, 'settings', 'edit', NULL, 'Edit system settings', NOW(), NOW()),
  (24, 'settings', 'manage_roles', NULL, 'Manage user roles', NOW(), NOW()),
  
  -- Employee permissions
  (25, 'employees', 'view', NULL, 'View employees', NOW(), NOW()),
  (26, 'employees', 'create', NULL, 'Create new employees', NOW(), NOW()),
  (27, 'employees', 'edit', NULL, 'Edit employee information', NOW(), NOW()),
  (28, 'employees', 'delete', NULL, 'Delete employees', NOW(), NOW())
ON CONFLICT (module, action, scope) DO NOTHING;

-- Create default roles
INSERT INTO base_schema.roles (role_id, name, description, is_system, created_at, updated_at)
VALUES
  (1, 'Administrator', 'Full system access', true, NOW(), NOW()),
  (2, 'Manager', 'Store management access', true, NOW(), NOW()),
  (3, 'Cashier', 'Point of sale access', true, NOW(), NOW()),
  (4, 'Inventory Staff', 'Product and stock management', true, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

-- Grant all permissions to Administrator role
INSERT INTO base_schema.role_permissions (role_id, permission_id, granted, created_at)
SELECT 
  (SELECT role_id FROM base_schema.roles WHERE name = 'Administrator'),
  permission_id,
  true,
  NOW()
FROM base_schema.permissions
ON CONFLICT (role_id, permission_id) DO UPDATE SET granted = true;

-- Create default settings
INSERT INTO base_schema.settings (setting_id, key, value, type, category, description, created_at, updated_at)
VALUES
  -- General Settings
  (1, 'companyName', 'Your Company Name', 'string', 'general', 'Your business name that appears on receipts and invoices', NOW(), NOW()),
  (2, 'companyAddress', 'Your Company Address', 'string', 'general', 'Business address for invoices and receipts', NOW(), NOW()),
  (3, 'companyPhone', '+94 XX XXX XXXX', 'string', 'general', 'Contact phone number', NOW(), NOW()),
  (4, 'companyEmail', 'info@yourcompany.com', 'string', 'general', 'Business email address', NOW(), NOW()),
  (5, 'companyWebsite', 'www.yourcompany.com', 'string', 'general', 'Business website URL', NOW(), NOW()),
  (6, 'companyLogo', '', 'string', 'general', 'Path to company logo file', NOW(), NOW()),
  
  -- Financial Settings
  (7, 'currency', 'LKR', 'string', 'financial', 'Currency used for pricing and transactions', NOW(), NOW()),
  (8, 'currencySymbol', 'Rs.', 'string', 'financial', 'Currency symbol for display', NOW(), NOW()),
  (9, 'taxRate', '15', 'number', 'financial', 'Default tax percentage applied to sales', NOW(), NOW()),
  (10, 'taxIncluded', 'false', 'boolean', 'financial', 'Whether tax is included in product prices', NOW(), NOW()),
  (11, 'defaultDiscountRate', '0', 'number', 'financial', 'Default discount percentage for sales', NOW(), NOW()),
  
  -- System Settings
  (12, 'darkMode', 'false', 'boolean', 'system', 'Switch between light and dark theme', NOW(), NOW()),
  (13, 'language', 'en', 'string', 'system', 'Interface language', NOW(), NOW()),
  (14, 'timezone', 'Asia/Colombo', 'string', 'system', 'System timezone', NOW(), NOW()),
  (15, 'dateFormat', 'DD/MM/YYYY', 'string', 'system', 'Date format for display', NOW(), NOW()),
  (16, 'timeFormat', '12', 'string', 'system', 'Time format (12 or 24 hour)', NOW(), NOW()),
  
  -- Inventory Settings
  (17, 'lowStockThreshold', '10', 'number', 'inventory', 'Alert when stock falls below this number', NOW(), NOW()),
  (18, 'negativeStockAllowed', 'false', 'boolean', 'inventory', 'Allow sales when stock is negative', NOW(), NOW()),
  (19, 'autoUpdateStock', 'true', 'boolean', 'inventory', 'Automatically update stock on sales/purchases', NOW(), NOW()),
  
  -- Receipt & Invoice Settings
  (20, 'receiptHeader', 'Thank you for your business!', 'string', 'receipt', 'Header text on receipts', NOW(), NOW()),
  (21, 'receiptFooter', 'Please come again!', 'string', 'receipt', 'Footer text on receipts', NOW(), NOW()),
  (22, 'receiptCopies', '1', 'number', 'receipt', 'Number of receipt copies to print', NOW(), NOW()),
  (23, 'showLogoOnReceipt', 'true', 'boolean', 'receipt', 'Display company logo on receipts', NOW(), NOW()),
  (24, 'invoicePrefix', 'INV', 'string', 'receipt', 'Prefix for invoice numbers', NOW(), NOW()),
  (25, 'invoiceStartNumber', '1000', 'number', 'receipt', 'Starting number for invoices', NOW(), NOW()),
  
  -- Notification Settings
  (26, 'notifications', 'true', 'boolean', 'notifications', 'Receive system notifications', NOW(), NOW()),
  (27, 'lowStockNotifications', 'true', 'boolean', 'notifications', 'Notify when products are low in stock', NOW(), NOW()),
  (28, 'saleNotifications', 'false', 'boolean', 'notifications', 'Notify on each sale completion', NOW(), NOW()),
  (29, 'errorNotifications', 'true', 'boolean', 'notifications', 'Notify on system errors', NOW(), NOW()),
  
  -- Backup Settings
  (30, 'autoBackup', 'true', 'boolean', 'backup', 'Automatically backup data daily', NOW(), NOW()),
  (31, 'backupFrequency', 'daily', 'string', 'backup', 'How often to perform automatic backups', NOW(), NOW()),
  (32, 'backupRetention', '30', 'number', 'backup', 'Number of days to keep backup files', NOW(), NOW()),
  
  -- Scanner Settings
  (33, 'scannerEnabled', 'true', 'boolean', 'scanner', 'Enable barcode/QR code scanner functionality', NOW(), NOW()),
  (34, 'scannerAutoFocus', 'true', 'boolean', 'scanner', 'Automatically focus input field when scanner is active', NOW(), NOW()),
  (35, 'scannerSound', 'true', 'boolean', 'scanner', 'Play sound when barcode is scanned', NOW(), NOW()),
  
  -- Printer Settings
  (36, 'defaultPrinter', '', 'string', 'printer', 'Default printer for receipts', NOW(), NOW()),
  (37, 'printReceipts', 'true', 'boolean', 'printer', 'Automatically print receipts after sales', NOW(), NOW()),
  (38, 'printInvoices', 'false', 'boolean', 'printer', 'Automatically print invoices', NOW(), NOW()),
  
  -- License Settings
  (39, 'license_activated', 'false', 'boolean', 'license', 'License activation status', NOW(), NOW()),
  (40, 'license_key', '<license_key>', 'string', 'license', 'License key for activation', NOW(), NOW()),
  (41, 'trialPeriodDays', '30', 'number', 'license', 'Number of trial days allowed', NOW(), NOW()),
  
  -- Business Hours
  (42, 'businessHours', '9:00-17:00', 'string', 'business', 'Default business operating hours', NOW(), NOW()),
  (43, 'weekendOperation', 'false', 'boolean', 'business', 'Operate on weekends', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

-- Note: Admin user creation should be done through the application
-- because it requires password hashing which should be done in the application layer
-- The application will create the admin user on first run if it doesn't exist

-- Reset search path
RESET search_path;
