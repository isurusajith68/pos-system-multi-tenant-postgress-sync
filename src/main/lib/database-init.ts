import {
  employeeService,
  settingsService,
  permissionService,
  roleService,
  rolePermissionService
} from "./database";
// import { runMigrations } from "./migration"; // Disabled: Migration handling moved to database init
import { getPrismaClient } from "./prisma";

// Create tenant tables in public schema
export async function createTenantTables(): Promise<void> {
  try {
    console.log("Creating tenant tables in public schema...");

    const prisma = getPrismaClient();

    // Create tenants table
    await prisma.$queryRaw`
      CREATE TABLE IF NOT EXISTS public.tenants (
        id TEXT PRIMARY KEY,
        schema_name TEXT NOT NULL UNIQUE,
        company_name TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // Create tenant_users table
    await prisma.$queryRaw`
      CREATE TABLE IF NOT EXISTS public.tenant_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // Create indexes
    await prisma.$queryRaw`
      CREATE INDEX IF NOT EXISTS idx_tenant_users_email ON public.tenant_users(email);
    `;

    await prisma.$queryRaw`
      CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON public.tenant_users(tenant_id);
    `;

    // Insert sample data for testing
    const tenantId = 'tenant-001';
    const schemaName = 'schemazentra_2';

    // Insert tenant (ignore if exists)
    await prisma.$queryRaw`
      INSERT INTO public.tenants (id, schema_name, company_name)
      VALUES (${tenantId}, ${schemaName}, 'Test Company')
      ON CONFLICT (id) DO NOTHING;
    `;

    // Insert tenant user (ignore if exists)
    await prisma.$queryRaw`
      INSERT INTO public.tenant_users (id, tenant_id, email)
      VALUES ('user-001', ${tenantId}, 'admin@posystem.com')
      ON CONFLICT (email) DO NOTHING;
    `;

    console.log("Tenant tables created successfully with sample data");
  } catch (error) {
    console.error("Error creating tenant tables:", error);
    // Don't throw error - tenant tables are not critical for basic functionality
  }
}

export async function initializeDatabase(): Promise<void> {
  try {
    console.log("Initializing PostgreSQL database...");

    // Create tenant tables in public schema first
    await createTenantTables();

    // Check if database has complete schema (PostgreSQL version)
    try {
      const prisma = getPrismaClient();
      const tables = (await prisma.$queryRawUnsafe(
        `SELECT table_name as name
         FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'`
      )) as { name: string }[];

      const tableNames = tables.map((t) => t.name);
      const requiredTables = ["Employee", "products", "categories", "settings"];

      const hasAllTables = requiredTables.every((table) => tableNames.includes(table));

      if (!hasAllTables) {
        console.log("Database schema incomplete, please run migrations. Found tables:", tableNames);
        console.log("Run: npx prisma migrate deploy");
      } else {
        // await runMigrations(); // Disabled: Migration handling moved to database init
        await createDefaultPermissionsAndRoles(); // Must create permissions & roles first
        await createDefaultAdmin(); // Then create admin and assign role
        await createDefaultSettings();
      }
    } catch (error) {
      console.log("Error checking database schema:", error);
      console.log("Please ensure PostgreSQL is running and DATABASE_URL is configured");
    }

    console.log("Database initialization completed");
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
}

export async function createDefaultAdmin(): Promise<void> {
  try {
    console.log("Checking default admin user...");
    const existingAdmin = await employeeService.findByEmail("admin@posystem.com");

    if (existingAdmin) {
      console.log(`Existing admin found: ${existingAdmin.id} (${existingAdmin.name})`);

      // Check if admin has role assigned and assign Administrator role if missing
      try {
        const adminRole = await employeeService.getEmployeeRole(existingAdmin.id);
        console.log(`Admin current role: ${adminRole?.name || "No role assigned"}`);

        if (!adminRole || adminRole.name !== "Administrator") {
          console.log("Warning: Admin does not have Administrator role, assigning it now...");
          const roles = await roleService.findMany();
          const administratorRole = roles.find((r) => r.name === "Administrator");

          if (administratorRole) {
            await employeeService.assignRole(existingAdmin.id, administratorRole.id);
            console.log("Assigned Administrator role to existing admin user");

            // Verify role assignment
            const verifyRole = await employeeService.getEmployeeRole(existingAdmin.id);
            console.log(`Verified: Admin now has ${verifyRole?.name || "No"} role`);
          } else {
            console.error("ERROR: Administrator role not found!");
          }
        } else {
          console.log("Admin already has Administrator role");
        }
      } catch (error) {
        console.error("ERROR: Error checking/assigning admin role:", error);
      }
      return;
    }

    console.log("No admin user found, creating new admin...");
    const defaultPassword = "admin123";
    const hashedPassword = await employeeService.hashPassword(defaultPassword);

    // Create admin user with legacy role field for backwards compatibility
    const adminUser = await employeeService.create({
      employee_id: "ADMIN001",
      name: "System Administrator",
      role: "Administrator", // Legacy field
      email: "admin@posystem.com",
      password_hash: hashedPassword
    });

    console.log(`Created new admin user: ${adminUser.id} (${adminUser.name})`);
    console.log(`Email: ${adminUser.email}`);
    console.log(`Default password: ${defaultPassword}`);

    // Assign Administrator role through the new role-based system
    try {
      const roles = await roleService.findMany();
      const administratorRole = roles.find((r) => r.name === "Administrator");

      if (administratorRole) {
        await employeeService.assignRole(adminUser.id, administratorRole.id);
        console.log("Assigned Administrator role to new admin user");

        // Verify role assignment
        const verifyRole = await employeeService.getEmployeeRole(adminUser.id);
        console.log(`Verified: Admin has ${verifyRole?.name || "No"} role assigned`);

        // Verify permissions are accessible
        const permissions = await rolePermissionService.getEmployeePermissions(adminUser.id);
        console.log(`Admin can access ${permissions.length} permissions`);
      } else {
        console.error("ERROR: Administrator role not found when creating default admin");
      }
    } catch (error) {
      console.error("ERROR: Error assigning role to admin user:", error);
    }
  } catch (error) {
    console.error("ERROR: Error creating default admin user:", error);
  }
}

async function ensureAdministratorHasAllPermissions(): Promise<void> {
  try {
    console.log("Checking Administrator role permissions...");

    // Find Administrator role
    const roles = await roleService.findMany();
    const administratorRole = roles.find((r) => r.name === "Administrator");

    if (!administratorRole) {
      console.error("ERROR: Administrator role not found!");
      return;
    }
    console.log(`Found Administrator role: ${administratorRole.id}`);

    // Get all permissions
    const allPermissions = await permissionService.findMany();
    if (allPermissions.length === 0) {
      console.error("ERROR: No permissions found in database!");
      return;
    }
    console.log(`Total permissions in system: ${allPermissions.length}`);

    // Get existing role permissions with proper include
    const roleWithPermissions = await roleService.findById(administratorRole.id);
    const existingPermissions = roleWithPermissions?.rolePermissions || [];
    const existingPermissionIds = new Set(
      existingPermissions
        .filter((rp) => rp.granted) // Only count granted permissions
        .map((rp) => rp.permissionId)
    );

    console.log(`Administrator currently has: ${existingPermissionIds.size} permissions`);

    let assignedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Grant each permission to Administrator role
    for (const permission of allPermissions) {
      try {
        // Check if permission is already assigned AND granted
        if (existingPermissionIds.has(permission.id)) {
          skippedCount++;
        } else {
          await rolePermissionService.grantPermission(administratorRole.id, permission.id);
          assignedCount++;
          console.log(
            `  Granted: ${permission.module}:${permission.action}${permission.scope ? `:${permission.scope}` : ""}`
          );
        }
      } catch (error) {
        errorCount++;
        console.error(
          `  ERROR: Failed to assign: ${permission.module}:${permission.action}`,
          error
        );
      }
    }

    console.log(
      `Administrator permissions sync completed:\n` +
        `   - ${assignedCount} newly assigned\n` +
        `   - ${skippedCount} already granted\n` +
        `   - ${errorCount} errors\n` +
        `   - ${allPermissions.length} total permissions`
    );

    // Verify final count
    const finalCheck = await roleService.findById(administratorRole.id);
    const finalCount = finalCheck?.rolePermissions?.filter((rp) => rp.granted).length || 0;
    console.log(`Verification: Administrator now has ${finalCount} granted permissions`);

    if (finalCount !== allPermissions.length) {
      console.warn(
        `Warning: Expected ${allPermissions.length} permissions but found ${finalCount}`
      );
    }
  } catch (error) {
    console.error("ERROR: Error ensuring Administrator has all permissions:", error);
  }
}

export async function createDefaultSettings(): Promise<void> {
  try {
    const defaultSettings = [
      {
        key: "companyName",
        value: "Your Company Name",
        type: "string",
        category: "general",
        description: "Your business name that appears on receipts and invoices"
      },
      {
        key: "companyAddress",
        value: "Your Company Address",
        type: "string",
        category: "general",
        description: "Business address for invoices and receipts"
      },
      {
        key: "companyPhone",
        value: "+94 XX XXX XXXX",
        type: "string",
        category: "general",
        description: "Contact phone number"
      },
      {
        key: "companyEmail",
        value: "info@yourcompany.com",
        type: "string",
        category: "general",
        description: "Business email address"
      },
      {
        key: "companyWebsite",
        value: "www.yourcompany.com",
        type: "string",
        category: "general",
        description: "Business website URL"
      },
      {
        key: "companyLogo",
        value: "",
        type: "string",
        category: "general",
        description: "Path to company logo file"
      },

      // Financial Settings
      {
        key: "currency",
        value: "LKR",
        type: "string",
        category: "financial",
        description: "Currency used for pricing and transactions"
      },
      {
        key: "currencySymbol",
        value: "Rs.",
        type: "string",
        category: "financial",
        description: "Currency symbol for display"
      },
      {
        key: "taxRate",
        value: "15",
        type: "number",
        category: "financial",
        description: "Default tax percentage applied to sales"
      },
      {
        key: "taxIncluded",
        value: "false",
        type: "boolean",
        category: "financial",
        description: "Whether tax is included in product prices"
      },
      {
        key: "defaultDiscountRate",
        value: "0",
        type: "number",
        category: "financial",
        description: "Default discount percentage for sales"
      },

      // System Settings
      {
        key: "darkMode",
        value: "false",
        type: "boolean",
        category: "system",
        description: "Switch between light and dark theme"
      },
      {
        key: "language",
        value: "en",
        type: "string",
        category: "system",
        description: "Interface language"
      },
      {
        key: "timezone",
        value: "Asia/Colombo",
        type: "string",
        category: "system",
        description: "System timezone"
      },
      {
        key: "dateFormat",
        value: "DD/MM/YYYY",
        type: "string",
        category: "system",
        description: "Date format for display"
      },
      {
        key: "timeFormat",
        value: "12",
        type: "string",
        category: "system",
        description: "Time format (12 or 24 hour)"
      },

      // Inventory Settings
      {
        key: "lowStockThreshold",
        value: "10",
        type: "number",
        category: "inventory",
        description: "Alert when stock falls below this number"
      },
      {
        key: "negativeStockAllowed",
        value: "false",
        type: "boolean",
        category: "inventory",
        description: "Allow sales when stock is negative"
      },
      {
        key: "autoUpdateStock",
        value: "true",
        type: "boolean",
        category: "inventory",
        description: "Automatically update stock on sales/purchases"
      },

      // Receipt & Invoice Settings
      {
        key: "receiptHeader",
        value: "Thank you for your business!",
        type: "string",
        category: "receipt",
        description: "Header text on receipts"
      },
      {
        key: "receiptFooter",
        value: "Please come again!",
        type: "string",
        category: "receipt",
        description: "Footer text on receipts"
      },
      {
        key: "receiptCopies",
        value: "1",
        type: "number",
        category: "receipt",
        description: "Number of receipt copies to print"
      },
      {
        key: "showLogoOnReceipt",
        value: "true",
        type: "boolean",
        category: "receipt",
        description: "Display company logo on receipts"
      },
      {
        key: "invoicePrefix",
        value: "INV",
        type: "string",
        category: "receipt",
        description: "Prefix for invoice numbers"
      },
      {
        key: "invoiceStartNumber",
        value: "1000",
        type: "number",
        category: "receipt",
        description: "Starting number for invoices"
      },

      // Notification Settings
      {
        key: "notifications",
        value: "true",
        type: "boolean",
        category: "notifications",
        description: "Receive system notifications"
      },
      {
        key: "lowStockNotifications",
        value: "true",
        type: "boolean",
        category: "notifications",
        description: "Notify when products are low in stock"
      },
      {
        key: "saleNotifications",
        value: "false",
        type: "boolean",
        category: "notifications",
        description: "Notify on each sale completion"
      },
      {
        key: "errorNotifications",
        value: "true",
        type: "boolean",
        category: "notifications",
        description: "Notify on system errors"
      },

      // Backup Settings
      {
        key: "autoBackup",
        value: "true",
        type: "boolean",
        category: "backup",
        description: "Automatically backup data daily"
      },
      {
        key: "backupFrequency",
        value: "daily",
        type: "string",
        category: "backup",
        description: "How often to perform automatic backups"
      },
      {
        key: "backupRetention",
        value: "30",
        type: "number",
        category: "backup",
        description: "Number of days to keep backup files"
      },

      // Scanner Settings
      {
        key: "scannerEnabled",
        value: "true",
        type: "boolean",
        category: "scanner",
        description: "Enable barcode/QR code scanner functionality"
      },
      {
        key: "scannerAutoFocus",
        value: "true",
        type: "boolean",
        category: "scanner",
        description: "Automatically focus input field when scanner is active"
      },
      {
        key: "scannerSound",
        value: "true",
        type: "boolean",
        category: "scanner",
        description: "Play sound when barcode is scanned"
      },

      // Printer Settings
      {
        key: "defaultPrinter",
        value: "",
        type: "string",
        category: "printer",
        description: "Default printer for receipts"
      },
      {
        key: "printReceipts",
        value: "true",
        type: "boolean",
        category: "printer",
        description: "Automatically print receipts after sales"
      },
      {
        key: "printInvoices",
        value: "false",
        type: "boolean",
        category: "printer",
        description: "Automatically print invoices"
      },

      // License Settings
      {
        key: "license_activated",
        value: "false",
        type: "boolean",
        category: "license",
        description: "License activation status"
      },
      {
        key: "license_key",
        value: "<license_key>",
        type: "string",
        category: "license",
        description: "License key for activation"
      },
      {
        key: "trialPeriodDays",
        value: "30",
        type: "number",
        category: "license",
        description: "Number of trial days allowed"
      },

      // Business Hours
      {
        key: "businessHours",
        value: "9:00-17:00",
        type: "string",
        category: "business",
        description: "Default business operating hours"
      },
      {
        key: "weekendOperation",
        value: "false",
        type: "boolean",
        category: "business",
        description: "Operate on weekends"
      }
    ];

    for (const setting of defaultSettings) {
      try {
        const existing = await settingsService.findByKey(setting.key);
        if (!existing) {
          await settingsService.upsert(
            setting.key,
            setting.value,
            setting.type,
            setting.category,
            setting.description
          );
          console.log(`Created default setting: ${setting.key}`);
        }
      } catch (error) {
        console.error(`Error creating setting ${setting.key}:`, error);
      }
    }

    console.log("Default settings initialization completed");
  } catch (error) {
    console.error("Error creating default settings:", error);
  }
}

export async function createDefaultPermissionsAndRoles(): Promise<void> {
  try {
    console.log("Starting permissions and roles initialization...");

    // Step 1: Create permissions if they don't exist
    const existingPermissions = await permissionService.findMany();
    if (existingPermissions.length === 0) {
      console.log("No permissions found, creating default permissions...");

      const defaultPermissions = [
        { module: "invoices", action: "view", scope: "all", description: "View all invoices" },
        { module: "invoices", action: "view", scope: "daily", description: "View daily invoices" },
        {
          module: "invoices",
          action: "view",
          scope: "monthly",
          description: "View monthly invoices"
        },
        {
          module: "invoices",
          action: "view_detail",
          scope: undefined,
          description: "View invoice details"
        },
        {
          module: "invoices",
          action: "create",
          scope: undefined,
          description: "Create new invoices"
        },
        {
          module: "invoices",
          action: "edit",
          scope: undefined,
          description: "Edit existing invoices"
        },
        { module: "invoices", action: "delete", scope: undefined, description: "Delete invoices" },
        {
          module: "invoices",
          action: "refund",
          scope: undefined,
          description: "Process invoice refunds"
        },

        { module: "products", action: "view", scope: undefined, description: "View products" },
        {
          module: "products",
          action: "create",
          scope: undefined,
          description: "Create new products"
        },
        {
          module: "products",
          action: "edit",
          scope: undefined,
          description: "Edit existing products"
        },
        { module: "products", action: "delete", scope: undefined, description: "Delete products" },
        {
          module: "products",
          action: "manage_stock",
          scope: undefined,
          description: "Manage product stock"
        },

        { module: "customers", action: "view", scope: undefined, description: "View customers" },
        {
          module: "customers",
          action: "create",
          scope: undefined,
          description: "Create new customers"
        },
        {
          module: "customers",
          action: "edit",
          scope: undefined,
          description: "Edit customer information"
        },
        {
          module: "customers",
          action: "delete",
          scope: undefined,
          description: "Delete customers"
        },

        { module: "reports", action: "view", scope: "daily", description: "View daily reports" },
        {
          module: "reports",
          action: "view",
          scope: "monthly",
          description: "View monthly reports"
        },
        { module: "reports", action: "view", scope: "all", description: "View all reports" },
        { module: "reports", action: "export", scope: undefined, description: "Export reports" },

        {
          module: "settings",
          action: "view",
          scope: undefined,
          description: "View system settings"
        },
        {
          module: "settings",
          action: "edit",
          scope: undefined,
          description: "Edit system settings"
        },
        {
          module: "settings",
          action: "manage_roles",
          scope: undefined,
          description: "Manage user roles"
        },

        { module: "employees", action: "view", scope: undefined, description: "View employees" },
        {
          module: "employees",
          action: "create",
          scope: undefined,
          description: "Create new employees"
        },
        {
          module: "employees",
          action: "edit",
          scope: undefined,
          description: "Edit employee information"
        },
        { module: "employees", action: "delete", scope: undefined, description: "Delete employees" }
      ];

      await permissionService.bulkCreate(defaultPermissions);
      console.log(`Created ${defaultPermissions.length} default permissions`);
    } else {
      console.log(`Found ${existingPermissions.length} existing permissions`);
    }

    // Step 2: Create roles if they don't exist
    const existingRoles = await roleService.findMany();
    const defaultRoles = [
      { name: "Administrator", description: "Full system access", isSystem: true },
      { name: "Manager", description: "Store management access", isSystem: true },
      { name: "Cashier", description: "Point of sale access", isSystem: true },
      { name: "Inventory Staff", description: "Product and stock management", isSystem: true }
    ];

    for (const role of defaultRoles) {
      const roleExists = existingRoles.find((r) => r.name === role.name);
      if (!roleExists) {
        try {
          await roleService.create(role);
          console.log(`Created role: ${role.name}`);
        } catch (error) {
          console.log(`Warning: Role ${role.name} might already exist:`, error);
        }
      } else {
        console.log(`Role ${role.name} already exists`);
      }
    }

    // Step 3: ALWAYS ensure Administrator role has ALL permissions
    console.log("Ensuring Administrator role has all permissions...");
    await ensureAdministratorHasAllPermissions();

    console.log("Default permissions and roles initialization completed");
  } catch (error) {
    console.error("ERROR: Error creating default permissions and roles:", error);
  }
}
