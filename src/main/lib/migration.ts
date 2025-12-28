import { is } from "@electron-toolkit/utils";
import { getPrismaClient } from "./prisma";

export async function runMigrations(): Promise<void> {
  if (is.dev) {
    // In development, migrations are handled by Prisma CLI
    console.log("Development mode: Migrations should be run via 'npx prisma migrate dev'");
    return;
  }

  try {
    const prisma = getPrismaClient();

    // Create the _prisma_migrations table if it doesn't exist (PostgreSQL version)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS _prisma_migrations (
        id VARCHAR(36) PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        finished_at TIMESTAMP,
        migration_name VARCHAR(255) NOT NULL,
        logs TEXT,
        rolled_back_at TIMESTAMP,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        applied_steps_count INTEGER NOT NULL DEFAULT 0
      );
    `);

    // // Check which migrations have been applied
    // const appliedMigrations = (await prisma.$queryRawUnsafe(`
    //   SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    // `)) as { migration_name: string }[];

    // const appliedMigrationNames = appliedMigrations.map((m) => m.migration_name);

    // Check if database already has tables (indicating schema is set up) - PostgreSQL version
    const existingTables = (await prisma.$queryRawUnsafe(`
      SELECT table_name as name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name != '_prisma_migrations'
    `)) as { name: string }[];

    // Define required tables for a complete schema
    const requiredTables = [
      "products",
      "categories",
      "product_images",
      "product_tags",
      "product_tag_map",
      "Employee",
      "inventory",
      "stock_transactions",
      "suppliers",
      "purchase_orders",
      "purchase_order_items",
      "customers",
      "sales_invoices",
      "sales_details",
      "shift_logs",
      "customer_transactions",
      "report_daily_sales_summary",
      "report_inventory_summary",
      "report_employee_sales",
      "report_customer_insights",
      "settings",
      "payments",
      "roles",
      "permissions",
      "role_permissions",
      "employee_roles",
      "custom_products"
    ];

    const existingTableNames = existingTables.map((t) => t.name);
    const missingTables = requiredTables.filter((table) => !existingTableNames.includes(table));

    if (missingTables.length === 0) {
      console.log(
        "Database schema is complete, skipping migrations. Existing tables:",
        existingTableNames
      );
      return;
    }

    console.log("Database schema is incomplete. Missing tables:", missingTables);
    console.log("Running Prisma migrations...");

    // For PostgreSQL, we should use Prisma's migration system
    // In production, migrations should be applied using: npx prisma migrate deploy
    console.log("Please run 'npx prisma migrate deploy' to apply migrations to PostgreSQL");

    // Note: For production PostgreSQL deployments, it's recommended to run migrations
    // as part of your deployment process rather than at runtime
  } catch (error) {
    console.error("Error running migrations:", error);
    console.log("Please ensure PostgreSQL is running and DATABASE_URL is correctly configured");
    // Don't throw - allow the app to continue with basic functionality
  }
}
