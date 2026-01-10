/// <reference types="vite/client" />

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Window {
  api: {
    categories: {
      findMany: () => Promise<any[]>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
    };
    products: {
      findMany: (options?: any) => Promise<any[]>;
      count: (filters?: any) => Promise<number>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
    };
    employees: {
      findMany: () => Promise<any[]>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findByEmail: (email: string) => Promise<any>;
      findByEmployeeId: (employee_id: string) => Promise<any>;
      verifyPassword: (password: string, hash: string) => Promise<boolean>;
      hashPassword: (password: string) => Promise<string>;
    };
    salesInvoices: {
      findMany: (filters?: any) => Promise<any[]>;
      findById: (id: string) => Promise<any>;
      create: (data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
      getStats: (filters?: any) => Promise<any>;
      refund: (
        id: string,
        options?: { employeeId?: string; reason?: string }
      ) => Promise<{ originalInvoiceId: string; refundInvoice: any }>;
    };
    customers: {
      findMany: (options?: { includeInactive?: boolean }) => Promise<any[]>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findByEmail: (email: string) => Promise<any>;
      findByPhone: (phone: string) => Promise<any>;
    };
    inventory: {
      findMany: (filters?: any, options?: any) => Promise<any[]>;
      count: (filters?: any) => Promise<number>;
      create: (data: any) => Promise<any>;
      upsert: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findById: (id: string) => Promise<any>;
      getLowStockItems: () => Promise<any[]>;
      adjustStock: (
        id: string,
        newQuantity: number,
        reason: string,
        relatedInvoiceId?: string
      ) => Promise<any>;
      quickAdjust: (id: string, newQuantity: number, reason: string) => Promise<any>;
    };
    stockTransactions: {
      findMany: (filters?: any, options?: any) => Promise<any[]>;
      count: (filters?: any) => Promise<number>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findById: (id: string) => Promise<any>;
      getMovementAnalytics: (filters?: any) => Promise<any>;
    };
    stockSync: {
      syncProductStockFromInventory: (productId: string) => Promise<any>;
      syncAllProductsStockFromInventory: () => Promise<any>;
    };
    sync: {
      getStatus: () => Promise<{ state: "idle" | "syncing" | "error" | "offline"; error: string | null }>;
    };
    syncConflicts: {
      list: (includeResolved?: boolean) => Promise<any[]>;
      resolve: (conflictId: string) => Promise<{ success: boolean }>;
    };
    suppliers: {
      findMany: () => Promise<any[]>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findById: (id: string) => Promise<any>;
    };
    purchaseOrders: {
      findMany: (filters?: any) => Promise<any[]>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findById: (id: string) => Promise<any>;
      receiveItems: (id: string, receivedItems: any[]) => Promise<any>;
    };
    stores: {
      findMany: () => Promise<any[]>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findById: (id: string) => Promise<any>;
    };
    settings: {
      findMany: () => Promise<any[]>;
      findByKey: (key: string) => Promise<any>;
      upsert: (
        key: string,
        value: string,
        type?: string,
        category?: string,
        description?: string
      ) => Promise<any>;
      updateBulk: (settings: any[]) => Promise<any>;
      delete: (key: string) => Promise<any>;
      getByCategory: (category: string) => Promise<any>;
    };
    payments: {
      findMany: (filters?: any) => Promise<any[]>;
      create: (data: any) => Promise<any>;
      findById: (id: string) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
    };
    backup: {
      create: (backupName?: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      list: () => Promise<Array<{ name: string; path: string; size: number; createdAt: Date }>>;
      restore: (backupPath: string) => Promise<{ success: boolean; error?: string }>;
      delete: (backupPath: string) => Promise<{ success: boolean; error?: string }>;
      getStats: () => Promise<{ totalBackups: number; totalSize: number; lastBackup?: Date }>;
    };
    printer: {
      getPrinters: () => Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>;
      printReceipt: (
        receiptData: any,
        printerName?: string,
        config?: any
      ) => Promise<{ success: boolean; error?: string }>;
      testPrint: (
        printerName?: string,
        receiptTemplate?: string
      ) => Promise<{ success: boolean; error?: string }>;
    };
    scanner: {
      getDevices: () => Promise<
        Array<{ name: string; vendorId: number; productId: number; type: string }>
      >;
      startScanning: () => Promise<{ success: boolean }>;
      stopScanning: () => Promise<{ success: boolean }>;
      testScan: () => Promise<{ success: boolean }>;
      onData: (callback: (data: any) => void) => void;
      removeAllListeners: () => void;
    };
    license: {
      isActivated: () => Promise<boolean>;
      activate: (licenseKey: string) => Promise<{ success: boolean; message: string }>;
      getInfo: () => Promise<{
        isActivated: boolean;
        hasLicenseKey: boolean;
        licenseKeyHash?: string;
      }>;
    };
    logs: {
      getLogPath: () => Promise<string>;
      getLogContent: (maxLines?: number) => Promise<string>;
      clearLogs: () => Promise<{ success: boolean; error?: string }>;
    };
    roles: {
      findMany: () => Promise<any[]>;
      create: (data: { name: string; description?: string; isSystem?: boolean }) => Promise<any>;
      update: (id: string, data: { name?: string; description?: string }) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findById: (id: string) => Promise<any>;
      assignToEmployee: (roleId: string, employeeId: string, assignedBy?: string) => Promise<any>;
      removeFromEmployee: (roleId: string, employeeId: string) => Promise<any>;
    };
    permissions: {
      findMany: () => Promise<any[]>;
      create: (data: {
        module: string;
        action: string;
        scope?: string;
        description?: string;
      }) => Promise<any>;
      update: (id: string, data: { description?: string }) => Promise<any>;
      delete: (id: string) => Promise<any>;
      findById: (id: string) => Promise<any>;
      findByModule: (module: string) => Promise<any[]>;
      bulkCreate: (
        permissions: Array<{
          module: string;
          action: string;
          scope?: string;
          description?: string;
        }>
      ) => Promise<any[]>;
    };
    rolePermissions: {
      grant: (roleId: string, permissionId: string) => Promise<any>;
      revoke: (roleId: string, permissionId: string) => Promise<any>;
      remove: (roleId: string, permissionId: string) => Promise<any>;
      getRolePermissions: (roleId: string) => Promise<any[]>;
      getEmployeePermissions: (employeeId: string) => Promise<any[]>;
      checkEmployeePermission: (
        employeeId: string,
        module: string,
        action: string,
        scope?: string
      ) => Promise<boolean>;
    };
    customProducts: {
      create: (data: any) => Promise<any>;
      findMany: () => Promise<any[]>;
    };
    updates: {
      onState: (callback: (payload: {
        state: "checking" | "available" | "not_available" | "downloading" | "downloaded" | "error";
        version?: string;
        releaseNotes?: string | Record<string, unknown>;
        message?: string;
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
      }) => void) => () => void;
      check: () => Promise<{ success: boolean; message?: string }>;
      install: () => Promise<{ success: boolean; message?: string }>;
    };
  };
}
