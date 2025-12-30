import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { PrinterConfig } from "../main/lib/printer";

interface CategoryData {
  name: string;
  parentCategoryId?: string;
}

interface ProductData {
  sku?: string;
  barcode?: string;
  name: string;
  englishName?: string;
  description?: string;
  brand?: string;
  categoryId: string;
  price: number;
  discountedPrice?: number;
  taxInclusivePrice?: number;
  taxRate?: number;
  unitSize?: string;
  stockLevel?: number;
}

interface EmployeeData {
  employee_id: string;
  name: string;
  role: string;
  email: string;
  password_hash: string;
}

interface EmployeeUpdateData {
  employee_id?: string;
  name?: string;
  role?: string;
  email?: string;
  password_hash?: string;
}

export interface Employee {
  id: string;
  employee_id: string;
  name: string;
  role: string;
  email: string;
  password_hash: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SalesInvoiceData {
  customerId?: string;
  employeeId: string;
  subTotal: number;
  totalAmount: number;
  paymentMode: string;
  taxAmount?: number;
  discountAmount?: number;
  amountReceived: number;
  salesDetails: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate?: number;
  }>;
}

interface CustomerData {
  name: string;
  email?: string;
  phone?: string;
  preferences?: string;
}

interface CustomerUpdateData {
  name?: string;
  email?: string;
  phone?: string;
  preferences?: string;
  loyaltyPoints?: number;
}

interface InventoryData {
  productId: string;
  quantity: number;
  reorderLevel: number;
  batchNumber?: string;
  expiryDate?: Date;
}

interface InventoryUpdateData {
  quantity?: number;
  reorderLevel?: number;
  batchNumber?: string;
  expiryDate?: Date;
}

type PaginationOptions = {
  skip?: number;
  take?: number;
};

type InventoryFilters = {
  searchTerm?: string;
  productId?: string;
  lowStock?: boolean;
  expiringSoon?: boolean;
};

type StockTransactionFilters = {
  searchTerm?: string;
  productId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  reason?: string;
};

interface UpdateStatePayload {
  state: "checking" | "available" | "not_available" | "downloading" | "downloaded" | "error";
  version?: string;
  releaseNotes?: string | Record<string, unknown>;
  message?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

const UPDATE_CHANNELS = {
  state: "updates:state",
  check: "updates:check",
  install: "updates:install"
} as const;

interface StockTransactionData {
  productId: string;
  changeQty: number;
  reason: string;
  relatedInvoiceId?: string;
}

interface ReceiptData {
  header?: string;
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  invoiceNumber: string;
  date: string;
  time: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod?: string;
  change?: number;
  footer?: string;
}

interface ScannedData {
  type: "barcode" | "qrcode" | "unknown";
  data: string;
  timestamp: Date;
  device?: string;
}

interface SupplierData {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

interface SupplierUpdateData {
  name?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

interface PurchaseOrderData {
  supplierId: string;
  orderDate: Date;
  status: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
  }>;
}

interface PurchaseOrderUpdateData {
  status?: string;
  orderDate?: Date;
}

interface StoreData {
  name: string;
  location: string;
}

interface StoreUpdateData {
  name?: string;
  location?: string;
}

const api = {
  categories: {
    findMany: () => ipcRenderer.invoke("categories:findMany"),
    create: (data: CategoryData) => ipcRenderer.invoke("categories:create", data),
    update: (id: string, data: CategoryData) => ipcRenderer.invoke("categories:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("categories:delete", id)
  },
  products: {
    findMany: (options?: any) => ipcRenderer.invoke("products:findMany", options),
    count: (filters?: any) => ipcRenderer.invoke("products:count", filters),
    create: (data: ProductData) => ipcRenderer.invoke("products:create", data),
    update: (id: string, data: ProductData) => ipcRenderer.invoke("products:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("products:delete", id)
  },
  employees: {
    findMany: (options?: any) => ipcRenderer.invoke("employees:findMany", options),
    create: (data: EmployeeData) => ipcRenderer.invoke("employees:create", data),
    update: (id: string, data: EmployeeUpdateData) =>
      ipcRenderer.invoke("employees:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("employees:delete", id),
    findByEmail: (email: string) => ipcRenderer.invoke("employees:findByEmail", email),
    findByEmployeeId: (employee_id: string) =>
      ipcRenderer.invoke("employees:findByEmployeeId", employee_id),
    verifyPassword: (password: string, hash: string) =>
      ipcRenderer.invoke("employees:verifyPassword", password, hash),
    hashPassword: (password: string) => ipcRenderer.invoke("employees:hashPassword", password)
  },
  salesInvoices: {
    findMany: (filters?: any) => ipcRenderer.invoke("salesInvoices:findMany", filters),
    findById: (id: string) => ipcRenderer.invoke("salesInvoices:findById", id),
    create: (data: SalesInvoiceData) => ipcRenderer.invoke("salesInvoices:create", data),
    delete: (id: string) => ipcRenderer.invoke("salesInvoices:delete", id),
    getStats: (filters?: any) => ipcRenderer.invoke("salesInvoices:getStats", filters),
    refund: (id: string, options?: { employeeId?: string; reason?: string }) =>
      ipcRenderer.invoke("salesInvoices:refund", id, options)
  },
  customers: {
    findMany: (options?: any) => ipcRenderer.invoke("customers:findMany", options),
    create: (data: CustomerData) => ipcRenderer.invoke("customers:create", data),
    update: (id: string, data: CustomerUpdateData) =>
      ipcRenderer.invoke("customers:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("customers:delete", id),
    findByEmail: (email: string) => ipcRenderer.invoke("customers:findByEmail", email),
    findByPhone: (phone: string) => ipcRenderer.invoke("customers:findByPhone", phone)
  },
  customProducts: {
    findMany: () => ipcRenderer.invoke("customProducts:findMany"),
    create: (data: { name: string; price: number }) =>
      ipcRenderer.invoke("customProducts:create", data),
    update: (id: string, data: { name?: string; price?: number }) =>
      ipcRenderer.invoke("customProducts:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("customProducts:delete", id),
    findById: (id: string) => ipcRenderer.invoke("customProducts:findById", id)
  },
  inventory: {
    findMany: (filters?: InventoryFilters, options?: { pagination?: PaginationOptions }) =>
      ipcRenderer.invoke("inventory:findMany", filters, options),
    count: (filters?: InventoryFilters) => ipcRenderer.invoke("inventory:count", filters),
    create: (data: InventoryData) => ipcRenderer.invoke("inventory:create", data),
    upsert: (data: InventoryData) => ipcRenderer.invoke("inventory:upsert", data),
    update: (id: string, data: InventoryUpdateData) =>
      ipcRenderer.invoke("inventory:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("inventory:delete", id),
    findById: (id: string) => ipcRenderer.invoke("inventory:findById", id),
    getLowStockItems: () => ipcRenderer.invoke("inventory:getLowStockItems"),
    adjustStock: (id: string, newQuantity: number, reason: string, relatedInvoiceId?: string) =>
      ipcRenderer.invoke("inventory:adjustStock", id, newQuantity, reason, relatedInvoiceId),
    quickAdjust: (id: string, newQuantity: number, reason: string) =>
      ipcRenderer.invoke("inventory:quickAdjust", id, newQuantity, reason)
  },
  stockTransactions: {
    findMany: (filters?: StockTransactionFilters, options?: { pagination?: PaginationOptions }) =>
      ipcRenderer.invoke("stockTransactions:findMany", filters, options),
    count: (filters?: StockTransactionFilters) =>
      ipcRenderer.invoke("stockTransactions:count", filters),
    create: (data: StockTransactionData) => ipcRenderer.invoke("stockTransactions:create", data),
    update: (
      id: string,
      data: {
        changeQty?: number;
        reason?: string;
        relatedInvoiceId?: string;
      }
    ) => ipcRenderer.invoke("stockTransactions:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("stockTransactions:delete", id),
    findById: (id: string) => ipcRenderer.invoke("stockTransactions:findById", id),
    getMovementAnalytics: (filters?: { productId?: string; dateFrom?: Date; dateTo?: Date }) =>
      ipcRenderer.invoke("stockTransactions:getMovementAnalytics", filters)
  },
  stockSync: {
    syncProductStockFromInventory: (productId: string) =>
      ipcRenderer.invoke("stockSync:syncProductStockFromInventory", productId),
    syncAllProductsStockFromInventory: () =>
      ipcRenderer.invoke("stockSync:syncAllProductsStockFromInventory")
  },
  sync: {
    getStatus: () => ipcRenderer.invoke("sync:status")
  },
  suppliers: {
    findMany: () => ipcRenderer.invoke("suppliers:findMany"),
    create: (data: SupplierData) => ipcRenderer.invoke("suppliers:create", data),
    update: (id: string, data: SupplierUpdateData) =>
      ipcRenderer.invoke("suppliers:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("suppliers:delete", id),
    findById: (id: string) => ipcRenderer.invoke("suppliers:findById", id)
  },
  purchaseOrders: {
    findMany: (filters?: { supplierId?: string; status?: string }) =>
      ipcRenderer.invoke("purchaseOrders:findMany", filters),
    create: (data: PurchaseOrderData) => ipcRenderer.invoke("purchaseOrders:create", data),
    update: (id: string, data: PurchaseOrderUpdateData) =>
      ipcRenderer.invoke("purchaseOrders:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("purchaseOrders:delete", id),
    findById: (id: string) => ipcRenderer.invoke("purchaseOrders:findById", id),
    receiveItems: (id: string, receivedItems: Array<{ itemId: string; receivedDate: Date }>) =>
      ipcRenderer.invoke("purchaseOrders:receiveItems", id, receivedItems)
  },
  stores: {
    findMany: () => ipcRenderer.invoke("stores:findMany"),
    create: (data: StoreData) => ipcRenderer.invoke("stores:create", data),
    update: (id: string, data: StoreUpdateData) => ipcRenderer.invoke("stores:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("stores:delete", id),
    findById: (id: string) => ipcRenderer.invoke("stores:findById", id)
  },
  settings: {
    findMany: () => ipcRenderer.invoke("settings:findMany"),
    findByKey: (key: string) => ipcRenderer.invoke("settings:findByKey", key),
    upsert: (key: string, value: string, type?: string, category?: string, description?: string) =>
      ipcRenderer.invoke("settings:upsert", key, value, type, category, description),
    updateBulk: (
      settings: Array<{
        key: string;
        value: string;
        type?: string;
        category?: string;
        description?: string;
      }>
    ) => ipcRenderer.invoke("settings:updateBulk", settings),
    delete: (key: string) => ipcRenderer.invoke("settings:delete", key),
    getByCategory: (category: string) => ipcRenderer.invoke("settings:getByCategory", category)
  },

  payments: {
    findMany: (filters?: {
      invoiceId?: string;
      customerId?: string;
      dateFrom?: Date;
      dateTo?: Date;
    }) => ipcRenderer.invoke("payments:findMany", filters),
    create: (data: {
      invoiceId: string;
      amount: number;
      paymentMode: string;
      employeeId: string;
      notes?: string;
    }) => ipcRenderer.invoke("payments:create", data),
    findById: (id: string) => ipcRenderer.invoke("payments:findById", id),
    update: (
      id: string,
      data: {
        amount?: number;
        paymentMode?: string;
        notes?: string;
      }
    ) => ipcRenderer.invoke("payments:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("payments:delete", id)
  },

  backup: {
    create: (backupName?: string) => ipcRenderer.invoke("backup:create", backupName),
    list: () => ipcRenderer.invoke("backup:list"),
    restore: (backupPath: string) => ipcRenderer.invoke("backup:restore", backupPath),
    delete: (backupPath: string) => ipcRenderer.invoke("backup:delete", backupPath),
    getStats: () => ipcRenderer.invoke("backup:getStats")
  },

  printer: {
    getPrinters: () => ipcRenderer.invoke("printer:getPrinters"),
    printReceipt: (
      receiptData: ReceiptData,
      printerName?: string,
      config?: Partial<PrinterConfig>
    ) => ipcRenderer.invoke("printer:printReceipt", receiptData, printerName, config),
    testPrint: (printerName?: string) => {
      return ipcRenderer.invoke("printer:testPrint", printerName);
    }
  },

  scanner: {
    getDevices: () => ipcRenderer.invoke("scanner:getDevices"),
    startScanning: () => ipcRenderer.invoke("scanner:startScanning"),
    stopScanning: () => ipcRenderer.invoke("scanner:stopScanning"),
    detectDevices: () => ipcRenderer.invoke("scanner:detectDevices"),
    testScan: () => ipcRenderer.invoke("scanner:testScan"),
    onData: (callback: (data: ScannedData) => void) => {
      ipcRenderer.on("scanner:data", (_, data) => callback(data));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners("scanner:data");
    }
  },

  license: {
    isActivated: () => ipcRenderer.invoke("license:isActivated"),
    activate: (licenseKey: string) => ipcRenderer.invoke("license:activate", licenseKey),
    getInfo: () => ipcRenderer.invoke("license:getInfo")
  },

  logs: {
    getLogPath: () => ipcRenderer.invoke("logs:getLogPath"),
    getLogContent: (maxLines?: number) => ipcRenderer.invoke("logs:getLogContent", maxLines),
    clearLogs: () => ipcRenderer.invoke("logs:clearLogs")
  },

  roles: {
    findMany: () => ipcRenderer.invoke("roles:findMany"),
    create: (data: { name: string; description?: string; isSystem?: boolean }) =>
      ipcRenderer.invoke("roles:create", data),
    update: (id: string, data: { name?: string; description?: string }) =>
      ipcRenderer.invoke("roles:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("roles:delete", id),
    findById: (id: string) => ipcRenderer.invoke("roles:findById", id),
    assignToEmployee: (roleId: string, employeeId: string, assignedBy?: string) =>
      ipcRenderer.invoke("roles:assignToEmployee", roleId, employeeId, assignedBy),
    removeFromEmployee: (roleId: string, employeeId: string) =>
      ipcRenderer.invoke("roles:removeFromEmployee", roleId, employeeId)
  },

  permissions: {
    findMany: () => ipcRenderer.invoke("permissions:findMany"),
    create: (data: { module: string; action: string; scope?: string; description?: string }) =>
      ipcRenderer.invoke("permissions:create", data),
    update: (id: string, data: { description?: string }) =>
      ipcRenderer.invoke("permissions:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("permissions:delete", id),
    findById: (id: string) => ipcRenderer.invoke("permissions:findById", id),
    findByModule: (module: string) => ipcRenderer.invoke("permissions:findByModule", module),
    bulkCreate: (
      permissions: Array<{
        module: string;
        action: string;
        scope?: string;
        description?: string;
      }>
    ) => ipcRenderer.invoke("permissions:bulkCreate", permissions)
  },

  rolePermissions: {
    grant: (roleId: string, permissionId: string) =>
      ipcRenderer.invoke("rolePermissions:grant", roleId, permissionId),
    revoke: (roleId: string, permissionId: string) =>
      ipcRenderer.invoke("rolePermissions:revoke", roleId, permissionId),
    remove: (roleId: string, permissionId: string) =>
      ipcRenderer.invoke("rolePermissions:remove", roleId, permissionId),
    getRolePermissions: (roleId: string) =>
      ipcRenderer.invoke("rolePermissions:getRolePermissions", roleId),
    getEmployeePermissions: (employeeId: string) =>
      ipcRenderer.invoke("rolePermissions:getEmployeePermissions", employeeId),
    checkEmployeePermission: (employeeId: string, module: string, action: string, scope?: string) =>
      ipcRenderer.invoke(
        "rolePermissions:checkEmployeePermission",
        employeeId,
        module,
        action,
        scope
      )
  },

  subscriptions: {
    findMany: () => ipcRenderer.invoke("subscriptions:findMany"),
    create: (data: {
      tenantId: string;
      planName: string;
      joinedAt?: Date;
      expiresAt: Date;
      status: string;
    }) => ipcRenderer.invoke("subscriptions:create", data),
    findByTenantId: (tenantId: string) => ipcRenderer.invoke("subscriptions:findByTenantId", tenantId),
    findById: (id: string) => ipcRenderer.invoke("subscriptions:findById", id),
    update: (id: string, data: {
      planName?: string;
      expiresAt?: Date;
      status?: string;
    }) => ipcRenderer.invoke("subscriptions:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("subscriptions:delete", id)
  },
  updates: {
    onState: (callback: (payload: UpdateStatePayload) => void) => {
      const listener = (_event: unknown, payload: UpdateStatePayload) => {
        callback(payload);
      };
      ipcRenderer.on(UPDATE_CHANNELS.state, listener);
      return () => {
        ipcRenderer.removeListener(UPDATE_CHANNELS.state, listener);
      };
    },
    check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check),
    install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install)
  },

  showToast: (options: { type: "success" | "error" | "warning" | "info"; message: string }) =>
    ipcRenderer.invoke("show-toast", options)
  ,
  sqlite: {
    getPath: () => ipcRenderer.invoke("sqlite:getPath")
  }
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
