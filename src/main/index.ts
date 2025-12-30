import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import log from "electron-log";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { autoUpdater } from "electron-updater";
import {
  categoryService,
  productService,
  employeeService,
  salesInvoiceService,
  customerService,
  inventoryService,
  stockTransactionService,
  stockSyncService,
  supplierService,
  purchaseOrderService,
  paymentService,
  settingsService,
  roleService,
  permissionService,
  rolePermissionService,
  customProductService,
  subscriptionService,
  credentialCacheService,
  localMetaService
} from "./lib/database";
import { backupService } from "./lib/backup";
import { printerService } from "./lib/printer";
import { scannerService } from "./lib/scanner";
import { licenseService } from "./lib/license";
import {
  bootstrapLocalFromServer,
  ensureDeviceId,
  pullChanges,
  pushOutbox,
  setTenantId,
  syncNow
} from "./lib/sync";
import { getSyncStatus, startSyncWorker } from "./lib/sync-worker";
// import { initializeDatabase } from "./lib/database-init"; // Disabled: Database initialization no longer needed
import { getPrismaClient, setActiveSchema } from "./lib/prisma";
import { initializeDatabase } from "./lib/database-init";

// Configure logging
log.transports.file.level = "info";
log.transports.file.maxSize = 10485760; // 10MB
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
log.transports.file.resolvePathFn = () => join(app.getPath("userData"), "logs", "main.log");

// Log uncaught exceptions and unhandled rejections
process.on("uncaughtException", (error) => {
  log.error("Uncaught Exception:", error);
  // Don't exit the process in production, just log it
  if (!is.dev) {
    return;
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Override console methods to also log to file
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args) => {
  log.info(...args);
  originalConsoleLog(...args);
};

console.error = (...args) => {
  log.error(...args);
  originalConsoleError(...args);
};

console.warn = (...args) => {
  log.warn(...args);
  originalConsoleWarn(...args);
};

log.info("Application starting...");

const UPDATE_STATE_CHANNEL = "updates:state";
const UPDATE_CHECK_CHANNEL = "updates:check";
const UPDATE_INSTALL_CHANNEL = "updates:install";

let updateWindow: BrowserWindow | null = null;
let autoUpdaterConfigured = false;

async function createWindow(): Promise<BrowserWindow> {
  log.info("Creating main window...");

  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });

  updateWindow = mainWindow;
  mainWindow.on("closed", () => {
    if (updateWindow === mainWindow) {
      updateWindow = null;
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

const getUpdateTarget = (): BrowserWindow | null => {
  if (updateWindow && !updateWindow.isDestroyed()) {
    return updateWindow;
  }

  const [firstWindow] = BrowserWindow.getAllWindows();
  return firstWindow ?? null;
};

function setupAutoUpdater(): void {
  if (autoUpdaterConfigured) {
    return;
  }

  autoUpdaterConfigured = true;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;

  const sendState = (state: string, payload: Record<string, unknown> = {}) => {
    const target = getUpdateTarget();
    if (!target) {
      log.warn("Auto-updater event triggered but no renderer window is available.");
      return;
    }
    target.webContents.send(UPDATE_STATE_CHANNEL, { state, ...payload });
  };

  autoUpdater.on("checking-for-update", () => sendState("checking"));
  autoUpdater.on("update-available", (info) =>
    sendState("available", { version: info.version, releaseNotes: info.releaseNotes })
  );
  autoUpdater.on("update-not-available", () => sendState("not_available"));
  autoUpdater.on("download-progress", (progress) =>
    sendState("downloading", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  );
  autoUpdater.on("update-downloaded", () => sendState("downloaded"));
  autoUpdater.on("error", (error) =>
    sendState("error", { message: error instanceof Error ? error.message : String(error) })
  );

  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    if (is.dev || !app.isPackaged) {
      const message = "Automatic updates are disabled in development.";
      sendState("error", { message });
      return { success: false, message };
    }

    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendState("error", { message });
      return { success: false, message };
    }
  });

  ipcMain.handle(UPDATE_INSTALL_CHANNEL, () => {
    if (is.dev || !app.isPackaged) {
      return { success: false, message: "Automatic updates are disabled in development." };
    }
    autoUpdater.quitAndInstall();
    return { success: true };
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  log.info("Electron app is ready, initializing...");

  try {
    // Initialize database (includes default admin creation)
    // Disabled: Database is already initialized with migrations
    // log.info("Initializing database...");
    // await initializeDatabase();
    // log.info("Database initialization completed");
  } catch (error) {
    log.error("Error during app initialization:", error);
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC test
  ipcMain.on("ping", () => console.log("pong"));

  // Database IPC handlers
  // Categories
  ipcMain.handle("categories:findMany", async (_, options) => {
    try {
      return await categoryService.findMany(options);
    } catch (error) {
      console.error("Error fetching categories:", error);
      throw error;
    }
  });

  ipcMain.handle("categories:create", async (_, data) => {
    try {
      return await categoryService.create(data);
    } catch (error) {
      console.error("Error creating category:", error);
      throw error;
    }
  });

  ipcMain.handle("categories:update", async (_, id, data) => {
    try {
      return await categoryService.update(id, data);
    } catch (error) {
      console.error("Error updating category:", error);
      throw error;
    }
  });

  ipcMain.handle("categories:delete", async (_, id) => {
    try {
      return await categoryService.delete(id);
    } catch (error) {
      console.error("Error deleting category:", error);
      throw error;
    }
  });

  // Products
  ipcMain.handle("products:findMany", async (_, options) => {
    try {
      return await productService.findMany(options);
    } catch (error) {
      console.error("Error fetching products:", error);
      throw error;
    }
  });

  ipcMain.handle("products:count", async (_, filters) => {
    try {
      return await productService.count(filters);
    } catch (error) {
      console.error("Error counting products:", error);
      throw error;
    }
  });

  ipcMain.handle("products:create", async (_, data) => {
    try {
      return await productService.create(data);
    } catch (error) {
      console.error("Error creating product:", error);
      throw error;
    }
  });

  ipcMain.handle("products:update", async (_, id, data) => {
    try {
      return await productService.update(id, data);
    } catch (error) {
      console.error("Error updating product:", error);
      throw error;
    }
  });

  ipcMain.handle("products:delete", async (_, id) => {
    try {
      return await productService.delete(id);
    } catch (error) {
      console.error("Error deleting product:", error);
      throw error;
    }
  });

  // Employees
  ipcMain.handle("employees:findMany", async (_, options) => {
    try {
      return await employeeService.findMany(options);
    } catch (error) {
      console.error("Error fetching employees:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:create", async (_, data) => {
    try {
      return await employeeService.create(data);
    } catch (error) {
      console.error("Error creating employee:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:update", async (_, id, data) => {
    try {
      return await employeeService.update(id, data);
    } catch (error) {
      console.error("Error updating employee:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:delete", async (_, id) => {
    try {
      return await employeeService.delete(id);
    } catch (error) {
      console.error("Error deleting employee:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:findByEmail", async (_, email) => {
    try {
      return await employeeService.findByEmail(email);
    } catch (error) {
      console.error("Error finding employee by email:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:findByEmailOnline", async (_, email, schemaName) => {
    try {
      return await employeeService.findByEmailOnline(email, schemaName);
    } catch (error) {
      console.error("Error finding employee by email (online):", error);
      throw error;
    }
  });

  ipcMain.handle("employees:findByEmployeeId", async (_, employee_id) => {
    try {
      return await employeeService.findByEmployeeId(employee_id);
    } catch (error) {
      console.error("Error finding employee by employee_id:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:verifyPassword", async (_, password, hash) => {
    try {
      return await employeeService.verifyPassword(password, hash);
    } catch (error) {
      console.error("Error verifying password:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:hashPassword", async (_, password) => {
    try {
      return await employeeService.hashPassword(password);
    } catch (error) {
      console.error("Error hashing password:", error);
      throw error;
    }
  });

  ipcMain.handle("credentialCache:findByEmail", async (_, email) => {
    try {
      return await credentialCacheService.findByEmail(email);
    } catch (error) {
      console.error("Error finding credential cache entry:", error);
      throw error;
    }
  });

  ipcMain.handle("credentialCache:upsert", async (_, data) => {
    try {
      return await credentialCacheService.upsert(data);
    } catch (error) {
      console.error("Error upserting credential cache entry:", error);
      throw error;
    }
  });

  ipcMain.handle("credentialCache:recordFailedAttempt", async (_, email) => {
    try {
      return await credentialCacheService.recordFailedAttempt(email);
    } catch (error) {
      console.error("Error recording credential cache failure:", error);
      throw error;
    }
  });

  ipcMain.handle("credentialCache:resetFailedAttempts", async (_, email) => {
    try {
      return await credentialCacheService.resetFailedAttempts(email);
    } catch (error) {
      console.error("Error resetting credential cache failures:", error);
      throw error;
    }
  });

  ipcMain.handle("credentialCache:deleteByEmail", async (_, email) => {
    try {
      return await credentialCacheService.deleteByEmail(email);
    } catch (error) {
      console.error("Error deleting credential cache entry:", error);
      throw error;
    }
  });

  ipcMain.handle("localMeta:get", async (_, key) => {
    try {
      return await localMetaService.get(key);
    } catch (error) {
      console.error("Error reading local meta:", error);
      throw error;
    }
  });

  ipcMain.handle("localMeta:set", async (_, key, value) => {
    try {
      return await localMetaService.set(key, value);
    } catch (error) {
      console.error("Error writing local meta:", error);
      throw error;
    }
  });

  ipcMain.handle("localMeta:delete", async (_, key) => {
    try {
      return await localMetaService.delete(key);
    } catch (error) {
      console.error("Error deleting local meta:", error);
      throw error;
    }
  });

  // New role-based employee handlers
  ipcMain.handle("employees:createWithRole", async (_, data) => {
    try {
      return await employeeService.createWithRole(data);
    } catch (error) {
      console.error("Error creating employee with role:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:updateWithRole", async (_, id, data) => {
    try {
      return await employeeService.updateWithRole(id, data);
    } catch (error) {
      console.error("Error updating employee with role:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:assignRole", async (_, employeeId, roleId) => {
    try {
      return await employeeService.assignRole(employeeId, roleId);
    } catch (error) {
      console.error("Error assigning role to employee:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:removeRole", async (_, employeeId, roleId) => {
    try {
      return await employeeService.removeRole(employeeId, roleId);
    } catch (error) {
      console.error("Error removing role from employee:", error);
      throw error;
    }
  });

  ipcMain.handle("employees:getRole", async (_, employeeId) => {
    try {
      return await employeeService.getEmployeeRole(employeeId);
    } catch (error) {
      console.error("Error getting employee role:", error);
      throw error;
    }
  });

  // Employee Roles
  ipcMain.handle("employeeRoles:findMany", async (_, filters) => {
    try {
      const prisma = getPrismaClient();
      return await prisma.employeeRole.findMany({
        where: filters || {},
        include: {
          role: {
            select: {
              id: true,
              name: true,
              description: true,
              isSystem: true
            }
          },
          employee: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });
    } catch (error) {
      console.error("Error fetching employee roles:", error);
      throw error;
    }
  });

  // Debug handler to check database state
  ipcMain.handle("debug:checkUserPermissions", async (_, employeeId) => {
    try {
      const prisma = getPrismaClient();

      // Get employee details
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
          employeeRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    where: { granted: true },
                    include: {
                      permission: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      // Get all employees for comparison
      const allEmployees = await prisma.employee.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      });

      // Get all roles
      const allRoles = await prisma.role.findMany();

      return {
        employee,
        allEmployees,
        allRoles,
        employeeId
      };
    } catch (error) {
      console.error("Error in debug handler:", error);
      throw error;
    }
  });

  // Fix admin permissions handler
  ipcMain.handle("debug:fixAdminPermissions", async () => {
    try {
      const prisma = getPrismaClient();

      // Find admin user
      const adminUser = await prisma.employee.findUnique({
        where: { email: "admin@posystem.com" },
        include: { employeeRoles: true }
      });

      if (!adminUser) {
        return { success: false, message: "Admin user not found" };
      }

      // Find Administrator role
      const adminRole = await prisma.role.findFirst({
        where: { name: "Administrator" }
      });

      if (!adminRole) {
        return { success: false, message: "Administrator role not found" };
      }

      // Check if admin already has the role
      const existingRole = await prisma.employeeRole.findUnique({
        where: {
          employeeId_roleId: {
            employeeId: adminUser.id,
            roleId: adminRole.id
          }
        }
      });

      if (existingRole) {
        return {
          success: true,
          message: "Admin already has Administrator role",
          alreadyAssigned: true
        };
      }

      // Assign Administrator role to admin user
      await prisma.employeeRole.create({
        data: {
          employeeId: adminUser.id,
          roleId: adminRole.id,
          assignedBy: adminUser.id
        }
      });

      return { success: true, message: "Administrator role assigned to admin user" };
    } catch (error) {
      console.error("Error fixing admin permissions:", error);
      return { success: false, message: error instanceof Error ? error.message : "Unknown error" };
    }
  }); // Sales Invoices
  ipcMain.handle("salesInvoices:findMany", async (_, filters, options) => {
    try {
      return await salesInvoiceService.getFiltered(filters, options);
    } catch (error) {
      console.error("Error fetching sales invoices:", error);
      throw error;
    }
  });

  ipcMain.handle("salesInvoices:findById", async (_, id) => {
    try {
      return await salesInvoiceService.findById(id);
    } catch (error) {
      console.error("Error fetching sales invoice:", error);
      throw error;
    }
  });

  ipcMain.handle("salesInvoices:create", async (_, data) => {
    try {
      return await salesInvoiceService.create(data);
    } catch (error) {
      console.error("Error creating sales invoice:", error);
      throw error;
    }
  });

  ipcMain.handle("salesInvoices:delete", async (_, id) => {
    try {
      return await salesInvoiceService.delete(id);
    } catch (error) {
      console.error("Error deleting sales invoice:", error);
      throw error;
    }
  });

  ipcMain.handle("salesInvoices:getStats", async (_, filters) => {
    try {
      return await salesInvoiceService.getStats(filters);
    } catch (error) {
      console.error("Error getting sales stats:", error);
      throw error;
    }
  });

  ipcMain.handle(
    "salesInvoices:refund",
    async (_, invoiceId: string, options?: { employeeId?: string; reason?: string }) => {
      try {
        return await salesInvoiceService.refund(invoiceId, options);
      } catch (error) {
        console.error("Error processing refund:", error);
        throw error;
      }
    }
  );

  // Customers
  ipcMain.handle("customers:findMany", async (_, options) => {
    try {
      return await customerService.findMany(options);
    } catch (error) {
      console.error("Error fetching customers:", error);
      throw error;
    }
  });

  ipcMain.handle("customers:create", async (_, data) => {
    try {
      return await customerService.create(data);
    } catch (error) {
      console.error("Error creating customer:", error);
      throw error;
    }
  });

  ipcMain.handle("customers:update", async (_, id, data) => {
    try {
      return await customerService.update(id, data);
    } catch (error) {
      console.error("Error updating customer:", error);
      throw error;
    }
  });

  ipcMain.handle("customers:delete", async (_, id) => {
    try {
      return await customerService.delete(id);
    } catch (error) {
      console.error("Error deleting customer:", error);
      throw error;
    }
  });

  ipcMain.handle("customers:findByEmail", async (_, email) => {
    try {
      return await customerService.findByEmail(email);
    } catch (error) {
      console.error("Error finding customer by email:", error);
      throw error;
    }
  });

  ipcMain.handle("customers:findByPhone", async (_, phone) => {
    try {
      return await customerService.findByPhone(phone);
    } catch (error) {
      console.error("Error finding customer by phone:", error);
      throw error;
    }
  });

  // Custom Products
  ipcMain.handle("customProducts:findMany", async (_, options) => {
    try {
      return await customProductService.findMany(options);
    } catch (error) {
      console.error("Error fetching custom products:", error);
      throw error;
    }
  });

  ipcMain.handle("customProducts:create", async (_, data) => {
    try {
      return await customProductService.create(data);
    } catch (error) {
      console.error("Error creating custom product:", error);
      throw error;
    }
  });

  ipcMain.handle("customProducts:findById", async (_, id) => {
    try {
      return await customProductService.findById(id);
    } catch (error) {
      console.error("Error finding custom product by ID:", error);
      throw error;
    }
  });

  ipcMain.handle("customProducts:update", async (_, id, data) => {
    try {
      return await customProductService.update(id, data);
    } catch (error) {
      console.error("Error updating custom product:", error);
      throw error;
    }
  });

  ipcMain.handle("customProducts:delete", async (_, id) => {
    try {
      return await customProductService.delete(id);
    } catch (error) {
      console.error("Error deleting custom product:", error);
      throw error;
    }
  });

  // Inventory IPC handlers
  ipcMain.handle("inventory:findMany", async (_, filters, options) => {
    try {
      return await inventoryService.findMany(filters, options);
    } catch (error) {
      console.error("Error fetching inventory:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:count", async (_, filters) => {
    try {
      return await inventoryService.count(filters);
    } catch (error) {
      console.error("Error counting inventory:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:create", async (_, data) => {
    try {
      return await inventoryService.create(data);
    } catch (error) {
      console.error("Error creating inventory:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:upsert", async (_, data) => {
    try {
      return await inventoryService.upsert(data);
    } catch (error) {
      console.error("Error upserting inventory:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:update", async (_, id, data) => {
    try {
      return await inventoryService.update(id, data);
    } catch (error) {
      console.error("Error updating inventory:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:delete", async (_, id) => {
    try {
      return await inventoryService.delete(id);
    } catch (error) {
      console.error("Error deleting inventory:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:findById", async (_, id) => {
    try {
      return await inventoryService.findById(id);
    } catch (error) {
      console.error("Error finding inventory by ID:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:quickAdjust", async (_, id, newQuantity, reason) => {
    try {
      return await inventoryService.quickAdjust(id, newQuantity, reason);
    } catch (error) {
      console.error("Error adjusting inventory:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:getLowStockItems", async (_) => {
    try {
      return await inventoryService.getLowStockItems();
    } catch (error) {
      console.error("Error getting low stock items:", error);
      throw error;
    }
  });

  ipcMain.handle("inventory:adjustStock", async (_, id, newQuantity, reason, relatedInvoiceId) => {
    try {
      return await inventoryService.adjustStock(id, newQuantity, reason, relatedInvoiceId);
    } catch (error) {
      console.error("Error adjusting stock:", error);
      throw error;
    }
  });

  // Stock Transaction IPC handlers
  ipcMain.handle("stockTransactions:findMany", async (_, filters, options) => {
    try {
      return await stockTransactionService.findMany(filters, options);
    } catch (error) {
      console.error("Error fetching stock transactions:", error);
      throw error;
    }
  });

  ipcMain.handle("stockTransactions:count", async (_, filters) => {
    try {
      return await stockTransactionService.count(filters);
    } catch (error) {
      console.error("Error counting stock transactions:", error);
      throw error;
    }
  });

  ipcMain.handle("stockTransactions:create", async (_, data) => {
    try {
      return await stockTransactionService.create(data);
    } catch (error) {
      console.error("Error creating stock transaction:", error);
      throw error;
    }
  });

  ipcMain.handle("stockTransactions:findById", async (_, id) => {
    try {
      return await stockTransactionService.findById(id);
    } catch (error) {
      console.error("Error finding stock transaction by ID:", error);
      throw error;
    }
  });

  ipcMain.handle("stockTransactions:getMovementAnalytics", async (_, filters) => {
    try {
      return await stockTransactionService.getStockMovementAnalytics(filters);
    } catch (error) {
      console.error("Error getting stock movement analytics:", error);
      throw error;
    }
  });

  ipcMain.handle("stockTransactions:update", async (_, id, data) => {
    try {
      return await stockTransactionService.update(id, data);
    } catch (error) {
      console.error("Error updating stock transaction:", error);
      throw error;
    }
  });

  ipcMain.handle("stockTransactions:delete", async (_, id) => {
    try {
      return await stockTransactionService.delete(id);
    } catch (error) {
      console.error("Error deleting stock transaction:", error);
      throw error;
    }
  });

  // Stock Sync IPC handlers
  ipcMain.handle("stockSync:syncProductStockFromInventory", async (_, productId) => {
    try {
      return await stockSyncService.syncProductStockFromInventory(productId);
    } catch (error) {
      console.error("Error syncing product stock:", error);
      throw error;
    }
  });

  ipcMain.handle("stockSync:syncAllProductsStockFromInventory", async () => {
    try {
      return await stockSyncService.syncAllProductsStockFromInventory();
    } catch (error) {
      console.error("Error syncing all products stock:", error);
      throw error;
    }
  });

  // Supplier IPC handlers
  ipcMain.handle("suppliers:findMany", async (_) => {
    try {
      return await supplierService.findMany();
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      throw error;
    }
  });

  ipcMain.handle("suppliers:create", async (_, data) => {
    try {
      return await supplierService.create(data);
    } catch (error) {
      console.error("Error creating supplier:", error);
      throw error;
    }
  });

  ipcMain.handle("suppliers:update", async (_, id, data) => {
    try {
      return await supplierService.update(id, data);
    } catch (error) {
      console.error("Error updating supplier:", error);
      throw error;
    }
  });

  ipcMain.handle("suppliers:delete", async (_, id) => {
    try {
      return await supplierService.delete(id);
    } catch (error) {
      console.error("Error deleting supplier:", error);
      throw error;
    }
  });

  ipcMain.handle("suppliers:findById", async (_, id) => {
    try {
      return await supplierService.findById(id);
    } catch (error) {
      console.error("Error finding supplier by ID:", error);
      throw error;
    }
  });

  // Purchase Order IPC handlers
  ipcMain.handle("purchaseOrders:findMany", async (_, filters) => {
    try {
      return await purchaseOrderService.findMany(filters);
    } catch (error) {
      console.error("Error fetching purchase orders:", error);
      throw error;
    }
  });

  ipcMain.handle("purchaseOrders:create", async (_, data) => {
    try {
      return await purchaseOrderService.create(data);
    } catch (error) {
      console.error("Error creating purchase order:", error);
      throw error;
    }
  });

  ipcMain.handle("purchaseOrders:update", async (_, id, data) => {
    try {
      return await purchaseOrderService.update(id, data);
    } catch (error) {
      console.error("Error updating purchase order:", error);
      throw error;
    }
  });

  ipcMain.handle("purchaseOrders:delete", async (_, id) => {
    try {
      return await purchaseOrderService.delete(id);
    } catch (error) {
      console.error("Error deleting purchase order:", error);
      throw error;
    }
  });

  ipcMain.handle("purchaseOrders:findById", async (_, id) => {
    try {
      return await purchaseOrderService.findById(id);
    } catch (error) {
      console.error("Error finding purchase order by ID:", error);
      throw error;
    }
  });

  ipcMain.handle("purchaseOrders:receiveItems", async (_, id, receivedItems) => {
    try {
      return await purchaseOrderService.receiveItems(id, receivedItems);
    } catch (error) {
      console.error("Error receiving purchase order items:", error);
      throw error;
    }
  });

  // Payments IPC handlers
  ipcMain.handle("payments:findMany", async (_, filters) => {
    try {
      return await paymentService.findMany(filters);
    } catch (error) {
      console.error("Error fetching payments:", error);
      throw error;
    }
  });

  ipcMain.handle("payments:create", async (_, data) => {
    try {
      return await paymentService.create(data);
    } catch (error) {
      console.error("Error creating payment:", error);
      throw error;
    }
  });

  ipcMain.handle("payments:findById", async (_, id) => {
    try {
      return await paymentService.findById(id);
    } catch (error) {
      console.error("Error fetching payment:", error);
      throw error;
    }
  });

  ipcMain.handle("payments:update", async (_, id, data) => {
    try {
      return await paymentService.update(id, data);
    } catch (error) {
      console.error("Error updating payment:", error);
      throw error;
    }
  });

  ipcMain.handle("payments:delete", async (_, id) => {
    try {
      return await paymentService.delete(id);
    } catch (error) {
      console.error("Error deleting payment:", error);
      throw error;
    }
  });

  // Settings IPC handlers
  ipcMain.handle("settings:findMany", async () => {
    try {
      return await settingsService.findMany();
    } catch (error) {
      console.error("Error fetching settings:", error);
      throw error;
    }
  });

  ipcMain.handle("settings:findByKey", async (_, key) => {
    try {
      return await settingsService.findByKey(key);
    } catch (error) {
      console.error("Error finding setting by key:", error);
      throw error;
    }
  });

  ipcMain.handle("settings:upsert", async (_, key, value, type, category, description) => {
    try {
      return await settingsService.upsert(key, value, type, category, description);
    } catch (error) {
      console.error("Error upserting setting:", error);
      throw error;
    }
  });

  ipcMain.handle("settings:updateBulk", async (_, settings) => {
    try {
      return await settingsService.updateBulk(settings);
    } catch (error) {
      console.error("Error updating settings in bulk:", error);
      throw error;
    }
  });

  ipcMain.handle("settings:delete", async (_, key) => {
    try {
      return await settingsService.delete(key);
    } catch (error) {
      console.error("Error deleting setting:", error);
      throw error;
    }
  });

  ipcMain.handle("settings:getByCategory", async (_, category) => {
    try {
      return await settingsService.getByCategory(category);
    } catch (error) {
      console.error("Error getting settings by category:", error);
      throw error;
    }
  });

  // Role IPC handlers
  ipcMain.handle("roles:findMany", async () => {
    try {
      return await roleService.findMany();
    } catch (error) {
      console.error("Error fetching roles:", error);
      throw error;
    }
  });

  ipcMain.handle("roles:create", async (_, data) => {
    try {
      return await roleService.create(data);
    } catch (error) {
      console.error("Error creating role:", error);
      throw error;
    }
  });

  ipcMain.handle("roles:update", async (_, id, data) => {
    try {
      return await roleService.update(id, data);
    } catch (error) {
      console.error("Error updating role:", error);
      throw error;
    }
  });

  ipcMain.handle("roles:delete", async (_, id) => {
    try {
      return await roleService.delete(id);
    } catch (error) {
      console.error("Error deleting role:", error);
      throw error;
    }
  });

  ipcMain.handle("roles:findById", async (_, id) => {
    try {
      return await roleService.findById(id);
    } catch (error) {
      console.error("Error finding role by ID:", error);
      throw error;
    }
  });

  // Additional role handlers for UI compatibility
  ipcMain.handle("get-all-roles", async () => {
    try {
      return await roleService.findMany();
    } catch (error) {
      console.error("Error fetching all roles:", error);
      throw error;
    }
  });

  ipcMain.handle("check-role-usage", async (_, roleId) => {
    try {
      return await roleService.checkUsage(roleId);
    } catch (error) {
      console.error("Error checking role usage:", error);
      throw error;
    }
  });

  ipcMain.handle("delete-role", async (_, roleId) => {
    try {
      return await roleService.delete(roleId);
    } catch (error) {
      console.error("Error deleting role:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("roles:assignToEmployee", async (_, roleId, employeeId, assignedBy) => {
    try {
      return await roleService.assignToEmployee(roleId, employeeId, assignedBy);
    } catch (error) {
      console.error("Error assigning role to employee:", error);
      throw error;
    }
  });

  ipcMain.handle("roles:removeFromEmployee", async (_, roleId, employeeId) => {
    try {
      return await roleService.removeFromEmployee(roleId, employeeId);
    } catch (error) {
      console.error("Error removing role from employee:", error);
      throw error;
    }
  });

  // Permission IPC handlers
  ipcMain.handle("permissions:findMany", async () => {
    try {
      return await permissionService.findMany();
    } catch (error) {
      console.error("Error fetching permissions:", error);
      throw error;
    }
  });

  ipcMain.handle("permissions:create", async (_, data) => {
    try {
      return await permissionService.create(data);
    } catch (error) {
      console.error("Error creating permission:", error);
      throw error;
    }
  });

  ipcMain.handle("permissions:update", async (_, id, data) => {
    try {
      return await permissionService.update(id, data);
    } catch (error) {
      console.error("Error updating permission:", error);
      throw error;
    }
  });

  ipcMain.handle("permissions:delete", async (_, id) => {
    try {
      return await permissionService.delete(id);
    } catch (error) {
      console.error("Error deleting permission:", error);
      throw error;
    }
  });

  ipcMain.handle("permissions:findById", async (_, id) => {
    try {
      return await permissionService.findById(id);
    } catch (error) {
      console.error("Error finding permission by ID:", error);
      throw error;
    }
  });

  ipcMain.handle("permissions:findByModule", async (_, module) => {
    try {
      return await permissionService.findByModule(module);
    } catch (error) {
      console.error("Error finding permissions by module:", error);
      throw error;
    }
  });

  ipcMain.handle("permissions:bulkCreate", async (_, permissions) => {
    try {
      return await permissionService.bulkCreate(permissions);
    } catch (error) {
      console.error("Error bulk creating permissions:", error);
      throw error;
    }
  });

  // Role Permission IPC handlers
  ipcMain.handle("rolePermissions:grant", async (_, roleId, permissionId) => {
    try {
      return await rolePermissionService.grantPermission(roleId, permissionId);
    } catch (error) {
      console.error("Error granting permission:", error);
      throw error;
    }
  });

  ipcMain.handle("rolePermissions:revoke", async (_, roleId, permissionId) => {
    try {
      return await rolePermissionService.revokePermission(roleId, permissionId);
    } catch (error) {
      console.error("Error revoking permission:", error);
      throw error;
    }
  });

  ipcMain.handle("rolePermissions:remove", async (_, roleId, permissionId) => {
    try {
      return await rolePermissionService.removePermission(roleId, permissionId);
    } catch (error) {
      console.error("Error removing permission:", error);
      throw error;
    }
  });

  ipcMain.handle("rolePermissions:findMany", async (_, filters) => {
    try {
      const prisma = getPrismaClient();
      return await prisma.rolePermission.findMany({
        where: filters || {},
        include: {
          role: {
            select: {
              id: true,
              name: true,
              description: true,
              isSystem: true
            }
          },
          permission: {
            select: {
              id: true,
              module: true,
              action: true,
              scope: true,
              description: true
            }
          }
        }
      });
    } catch (error) {
      console.error("Error fetching role permissions:", error);
      throw error;
    }
  });

  ipcMain.handle("rolePermissions:getRolePermissions", async (_, roleId) => {
    try {
      return await rolePermissionService.getRolePermissions(roleId);
    } catch (error) {
      console.error("Error getting role permissions:", error);
      throw error;
    }
  });

  ipcMain.handle("rolePermissions:getEmployeePermissions", async (_, employeeId) => {
    try {
      return await rolePermissionService.getEmployeePermissions(employeeId);
    } catch (error) {
      console.error("Error getting employee permissions:", error);
      throw error;
    }
  });

  ipcMain.handle(
    "rolePermissions:checkEmployeePermission",
    async (_, employeeId, module, action, scope) => {
      try {
        return await rolePermissionService.checkEmployeePermission(
          employeeId,
          module,
          action,
          scope
        );
      } catch (error) {
        console.error("Error checking employee permission:", error);
        throw error;
      }
    }
  );

  // Database query handlers (for direct SQL access when needed)
  ipcMain.handle("database:query", async (_, sql, params) => {
    try {
      const { getPrismaClient } = await import("./lib/prisma");
      const prisma = getPrismaClient();
      return await prisma.$queryRawUnsafe(sql, ...(params || []));
    } catch (error) {
      console.error("Error executing database query:", error);
      throw error;
    }
  });

  ipcMain.handle("database:execute", async (_, sql, params) => {
    try {
      const { getPrismaClient } = await import("./lib/prisma");
      const prisma = getPrismaClient();
      return await prisma.$executeRawUnsafe(sql, ...(params || []));
    } catch (error) {
      console.error("Error executing database command:", error);
      throw error;
    }
  });

  // License IPC handlers
  ipcMain.handle("license:isActivated", async () => {
    try {
      return await licenseService.isActivated();
    } catch (error) {
      console.error("Error checking license activation:", error);
      throw error;
    }
  });

  ipcMain.handle("license:activate", async (_, licenseKey) => {
    try {
      return await licenseService.activateLicense(licenseKey);
    } catch (error) {
      console.error("Error activating license:", error);
      throw error;
    }
  });

  ipcMain.handle("license:getInfo", async () => {
    try {
      return await licenseService.getLicenseInfo();
    } catch (error) {
      console.error("Error getting license info:", error);
      throw error;
    }
  });

  // Backup IPC handlers
  ipcMain.handle("backup:create", async (_, backupName) => {
    try {
      return await backupService.createBackup(backupName);
    } catch (error) {
      console.error("Error creating backup:", error);
      throw error;
    }
  });

  ipcMain.handle("backup:list", async () => {
    try {
      return await backupService.listBackups();
    } catch (error) {
      console.error("Error listing backups:", error);
      throw error;
    }
  });

  ipcMain.handle("backup:restore", async (_, backupPath) => {
    try {
      return await backupService.restoreBackup(backupPath);
    } catch (error) {
      console.error("Error restoring backup:", error);
      throw error;
    }
  });

  ipcMain.handle("backup:delete", async (_, backupPath) => {
    try {
      return await backupService.deleteBackup(backupPath);
    } catch (error) {
      console.error("Error deleting backup:", error);
      throw error;
    }
  });

  ipcMain.handle("backup:getStats", async () => {
    try {
      return await backupService.getBackupStats();
    } catch (error) {
      console.error("Error getting backup stats:", error);
      throw error;
    }
  });

  // Printer IPC handlers
  ipcMain.handle("printer:getPrinters", async () => {
    try {
      return await printerService.getPrinters();
    } catch (error) {
      console.error("Error getting printers:", error);
      throw error;
    }
  });

  ipcMain.handle("printer:printReceipt", async (_, receiptData, printerName, config) => {
    try {
      return await printerService.printReceipt(receiptData, printerName, config);
    } catch (error) {
      console.error("Error printing receipt:", error);
      throw error;
    }
  });

  ipcMain.handle("printer:testPrint", async (_, printerName) => {
    try {
      console.log("Main process: Received testPrint IPC call with printer:", printerName);
      const result = await printerService.printTest(printerName);
      console.log("Main process: Test print result:", result);
      return result;
    } catch (error) {
      console.error("Error testing printer:", error);
      throw error;
    }
  });

  // Scanner IPC handlers
  ipcMain.handle("scanner:getDevices", async () => {
    try {
      return await scannerService.getConnectedDevices();
    } catch (error) {
      console.error("Error getting scanner devices:", error);
      throw error;
    }
  });

  ipcMain.handle("scanner:startScanning", async () => {
    try {
      scannerService.setConfig({ enabled: true });
      return { success: true };
    } catch (error) {
      console.error("Error starting scanner:", error);
      throw error;
    }
  });

  ipcMain.handle("scanner:stopScanning", async () => {
    try {
      scannerService.setConfig({ enabled: false });
      return { success: true };
    } catch (error) {
      console.error("Error stopping scanner:", error);
      throw error;
    }
  });

  ipcMain.handle("scanner:detectDevices", async () => {
    try {
      return await scannerService.detectDevices();
    } catch (error) {
      console.error("Error detecting scanner devices:", error);
      throw error;
    }
  });

  ipcMain.handle("scanner:testScan", async () => {
    try {
      // Use the scanner service's test scan method
      scannerService.testScan();
      return { success: true };
    } catch (error) {
      console.error("Error testing scanner:", error);
      throw error;
    }
  });

  // Logging IPC handlers
  ipcMain.handle("logs:getLogPath", async () => {
    return join(app.getPath("userData"), "logs", "main.log");
  });

  ipcMain.handle("sqlite:getPath", async () => {
    try {
      const { getLocalDbPath } = await import("./lib/local-sqlite");
      return getLocalDbPath();
    } catch (error) {
      console.error("Error getting SQLite path:", error);
      throw error;
    }
  });

  ipcMain.handle("logs:getLogContent", async (_, maxLines = 100) => {
    const logPath = join(app.getPath("userData"), "logs", "main.log");

    try {
      if (!existsSync(logPath)) {
        return "Log file does not exist yet.";
      }

      const content = readFileSync(logPath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());

      // Return last maxLines lines
      return lines.slice(-maxLines).join("\n");
    } catch (error) {
      log.error("Error reading log file:", error);
      return `Error reading log file: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  ipcMain.handle("logs:clearLogs", async () => {
    const logPath = join(app.getPath("userData"), "logs", "main.log");

    try {
      if (existsSync(logPath)) {
        unlinkSync(logPath);
        log.info("Log file cleared by user");
      }
      return { success: true };
    } catch (error) {
      log.error("Error clearing log file:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Tenant IPC handlers for multi-tenancy
  ipcMain.handle("tenants:findMany", async () => {
    try {
      const { tenantService } = await import("./lib/database");
      return await tenantService.findMany();
    } catch (error) {
      console.error("Error fetching tenants:", error);
      throw error;
    }
  });

  ipcMain.handle("tenants:create", async (_, data) => {
    try {
      const { tenantService } = await import("./lib/database");
      return await tenantService.create(data);
    } catch (error) {
      console.error("Error creating tenant:", error);
      throw error;
    }
  });

  ipcMain.handle("tenants:findById", async (_, id) => {
    try {
      const { tenantService } = await import("./lib/database");
      return await tenantService.findById(id);
    } catch (error) {
      console.error("Error finding tenant by ID:", error);
      throw error;
    }
  });

  ipcMain.handle("tenants:findBySchemaName", async (_, schemaName) => {
    try {
      const { tenantService } = await import("./lib/database");
      return await tenantService.findBySchemaName(schemaName);
    } catch (error) {
      console.error("Error finding tenant by schema name:", error);
      throw error;
    }
  });

  ipcMain.handle("tenants:update", async (_, id, data) => {
    try {
      const { tenantService } = await import("./lib/database");
      return await tenantService.update(id, data);
    } catch (error) {
      console.error("Error updating tenant:", error);
      throw error;
    }
  });

  ipcMain.handle("tenants:delete", async (_, id) => {
    try {
      const { tenantService } = await import("./lib/database");
      return await tenantService.delete(id);
    } catch (error) {
      console.error("Error deleting tenant:", error);
      throw error;
    }
  });

  ipcMain.handle("tenants:setActiveSchema", async (_, schemaName, options) => {
    try {
      const normalizedSchema =
        typeof schemaName === "string" && schemaName.trim().length > 0 ? schemaName : null;
      const skipTenantLookup = Boolean(options?.skipTenantLookup);
      setActiveSchema(normalizedSchema);
      if (normalizedSchema && !skipTenantLookup) {
        const { tenantService } = await import("./lib/database");
        const { setTenantId } = await import("./lib/sync");
        const tenant = await tenantService.findBySchemaName(normalizedSchema);
        if (tenant?.id) {
          setTenantId(tenant.id);
        }
      }
      return true;
    } catch (error) {
      console.error("Error setting active schema:", error);
      throw error;
    }
  });

  // Tenant User IPC handlers
  ipcMain.handle("tenantUsers:findMany", async () => {
    try {
      const { tenantUserService } = await import("./lib/database");
      return await tenantUserService.findMany();
    } catch (error) {
      console.error("Error fetching tenant users:", error);
      throw error;
    }
  });

  ipcMain.handle("tenantUsers:create", async (_, data) => {
    try {
      const { tenantUserService } = await import("./lib/database");
      return await tenantUserService.create(data);
    } catch (error) {
      console.error("Error creating tenant user:", error);
      throw error;
    }
  });

  ipcMain.handle("tenantUsers:findByEmail", async (_, email) => {
    try {
      const { tenantUserService } = await import("./lib/database");
      return await tenantUserService.findByEmail(email);
    } catch (error) {
      console.error("Error finding tenant user by email:", error);
      throw error;
    }
  });

  ipcMain.handle("tenantUsers:findById", async (_, id) => {
    try {
      const { tenantUserService } = await import("./lib/database");
      return await tenantUserService.findById(id);
    } catch (error) {
      console.error("Error finding tenant user by ID:", error);
      throw error;
    }
  });

  ipcMain.handle("tenantUsers:update", async (_, id, data) => {
    try {
      const { tenantUserService } = await import("./lib/database");
      return await tenantUserService.update(id, data);
    } catch (error) {
      console.error("Error updating tenant user:", error);
      throw error;
    }
  });

  ipcMain.handle("tenantUsers:delete", async (_, id) => {
    try {
      const { tenantUserService } = await import("./lib/database");
      return await tenantUserService.delete(id);
    } catch (error) {
      console.error("Error deleting tenant user:", error);
      throw error;
    }
  });

  ipcMain.handle("tenantUsers:findByTenantId", async (_, tenantId) => {
    try {
      const { tenantUserService } = await import("./lib/database");
      return await tenantUserService.findByTenantId(tenantId);
    } catch (error) {
      console.error("Error finding tenant users by tenant ID:", error);
      throw error;
    }
  });

  // Subscription IPC handlers
  ipcMain.handle("subscriptions:findMany", async () => {
    try {
      return await subscriptionService.findMany();
    } catch (error) {
      console.error("Error fetching subscriptions:", error);
      throw error;
    }
  });

  ipcMain.handle("subscriptions:create", async (_, data) => {
    try {
      return await subscriptionService.create(data);
    } catch (error) {
      console.error("Error creating subscription:", error);
      throw error;
    }
  });

  ipcMain.handle("subscriptions:findByTenantId", async (_, tenantId) => {
    try {
      return await subscriptionService.findByTenantId(tenantId);
    } catch (error) {
      console.error("Error finding subscription by tenant ID:", error);
      throw error;
    }
  });

  ipcMain.handle("subscriptions:findById", async (_, id) => {
    try {
      return await subscriptionService.findById(id);
    } catch (error) {
      console.error("Error finding subscription by ID:", error);
      throw error;
    }
  });

  ipcMain.handle("subscriptions:update", async (_, id, data) => {
    try {
      return await subscriptionService.update(id, data);
    } catch (error) {
      console.error("Error updating subscription:", error);
      throw error;
    }
  });

  ipcMain.handle("subscriptions:delete", async (_, id) => {
    try {
      return await subscriptionService.delete(id);
    } catch (error) {
      console.error("Error deleting subscription:", error);
      throw error;
    }
  });

  // Toast notification handler
  ipcMain.handle("show-toast", async (event, options) => {
    try {
      // Send the toast to the renderer process
      event.sender.send("toast-notification", options);
      return { success: true };
    } catch (error) {
      console.error("Error showing toast:", error);
      throw error;
    }
  });

  // Sync IPC handlers
  ipcMain.handle("sync:status", async () => {
    return getSyncStatus();
  });

  ipcMain.handle("sync:run", async () => {
    return await syncNow();
  });

  ipcMain.handle("sync:push", async () => {
    return await pushOutbox();
  });

  ipcMain.handle("sync:pull", async () => {
    return await pullChanges();
  });

  ipcMain.handle("sync:setTenant", async (_, tenantId: string) => {
    setTenantId(tenantId);
    return { success: true };
  });

  ipcMain.handle("sync:bootstrap", async () => {
    return await bootstrapLocalFromServer();
  });

  // License activation is not required - start the app directly
  await createWindow();
  setupAutoUpdater();
  startSyncWorker();
  ensureDeviceId();
  if (!is.dev && app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      log.error("Error while checking for updates:", error);
    });
  } else {
    log.info("Automatic updates are disabled in development builds.");
  }

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

// Initialize scanner service after app is ready
app.whenReady().then(() => {
  // Get the main window after it's created
  setTimeout(() => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      scannerService.initialize(mainWindow);
    }
  }, 1000); // Small delay to ensure window is fully created
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  log.info("All windows closed");
  if (process.platform !== "darwin") {
    log.info("Quitting application");
    app.quit();
  }
});

app.on("before-quit", () => {
  log.info("Application is quitting...");
});
