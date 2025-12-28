import { ElectronAPI } from "@electron-toolkit/preload";

interface CategoryData {
  name: string;
  parentCategoryId?: string;
}

interface Category {
  id: string;
  name: string;
  parentCategoryId?: string;
  createdAt: Date;
  updatedAt: Date;
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
  costPrice?: number;
  discountedPrice?: number | null;
  taxInclusivePrice?: number;
  taxRate?: number;
  unitSize?: string;
  stockLevel: number;
}

interface Product {
  id: string;
  sku?: string;
  barcode?: string;
  name: string;
  description?: string;
  brand?: string;
  categoryId: string;
  price: number;
  costPrice?: number;
  discountedPrice?: number;
  taxInclusivePrice?: number;
  taxRate?: number;
  unitSize?: string;
  stockLevel: number;
  createdAt: Date;
  updatedAt: Date;
}

type PaginationOptions = {
  skip?: number;
  take?: number;
};

type ProductFilters = {
  searchTerm?: string;
  code?: string;
  categoryId?: string;
  stockFilter?: "all" | "inStock" | "outOfStock";
  minPrice?: number;
  maxPrice?: number;
};

type ProductSort = {
  field?: "name" | "price" | "category" | "stock" | "createdAt";
  direction?: "asc" | "desc";
};

type ProductFindManyOptions = {
  filters?: ProductFilters;
  pagination?: PaginationOptions;
  sort?: ProductSort;
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

type InventoryFindManyOptions = {
  pagination?: PaginationOptions;
};

type StockTransactionFindManyOptions = {
  pagination?: PaginationOptions;
};

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

interface Employee {
  id: string;
  employee_id: string;
  name: string;
  role: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Setting {
  id: string;
  key: string;
  value: string;
  type: string;
  category: string;
  description?: string;
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
    originalPrice: number;
    unit?: string;
    costPrice?: number;
  }>;
}

interface SalesInvoice {
  id: string;
  date: Date;
  customerId?: string;
  employeeId: string;
  subTotal: number;
  totalAmount: number;
  paymentMode: string;
  taxAmount: number;
  discountAmount: number;
  amountReceived: number;
  refundInvoiceId?: string;
  createdAt: Date;
  updatedAt: Date;
  customer?: Customer;
  employee?: Employee;
  salesDetails?: SalesDetail[];
}

interface SalesDetail {
  id: string;
  invoiceId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  product?: Product;
  unit?: string;
  originalPrice: number;
  costPrice: number;
}

interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  paymentMode: string;
  employeeId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  invoice?: SalesInvoice;
  employee?: Employee;
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

interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  loyaltyPoints: number;
  preferences?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SalesStats {
  totalRevenue: number;
  totalDiscount: number;
  totalTax: number;
  totalInvoices: number;
  averageOrderValue: number;
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

interface Inventory {
  id: string;
  productId: string;
  quantity: number;
  reorderLevel: number;
  batchNumber?: string;
  expiryDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  product?: Product & { category?: Category };
}

interface StockTransactionData {
  productId: string;
  type: string; // "IN" or "OUT"
  changeQty: number;
  reason: string;
  relatedInvoiceId?: string;
}

interface StockTransaction {
  id: string;
  productId: string;
  type: string; // "IN" or "OUT"
  changeQty: number;
  reason: string;
  transactionDate: Date;
  relatedInvoiceId?: string;
  createdAt: Date;
  updatedAt: Date;
  product?: Product & { category?: Category };
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

interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
  purchaseOrders?: PurchaseOrder[];
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

interface PurchaseOrder {
  id: string;
  supplierId: string;
  orderDate: Date;
  status: string;
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
  supplier?: Supplier;
  items?: PurchaseOrderItem[];
}

interface PurchaseOrderItem {
  id: string;
  poId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  receivedDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  product?: Product & { category?: Category };
}

interface StoreData {
  name: string;
  location: string;
}

interface StoreUpdateData {
  name?: string;
  location?: string;
}

interface Store {
  id: string;
  name: string;
  location: string;
  createdAt: Date;
  updatedAt: Date;
  inventory?: Inventory[];
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      categories: {
        findMany: () => Promise<Category[]>;
        create: (data: CategoryData) => Promise<Category>;
        update: (id: string, data: CategoryData) => Promise<Category>;
        delete: (id: string) => Promise<Category>;
      };
      products: {
        findMany: (options?: ProductFindManyOptions) => Promise<Product[]>;
        count: (filters?: ProductFilters) => Promise<number>;
        create: (data: ProductData) => Promise<Product>;
        update: (id: string, data: ProductData) => Promise<Product>;
        delete: (id: string) => Promise<Product>;
      };
      employees: {
        findMany: () => Promise<Employee[]>;
        create: (data: EmployeeData) => Promise<Employee>;
        update: (id: string, data: EmployeeUpdateData) => Promise<Employee>;
        delete: (id: string) => Promise<Employee>;
        findByEmail: (email: string) => Promise<Employee | null>;
        findByEmployeeId: (employee_id: string) => Promise<Employee | null>;
        verifyPassword: (password: string, hash: string) => Promise<boolean>;
        hashPassword: (password: string) => Promise<string>;
      };
      salesInvoices: {
        findMany: (filters?: {
          dateFrom?: string;
          dateTo?: string;
          employeeId?: string;
          customerId?: string;
          paymentMode?: string;
        }) => Promise<SalesInvoice[]>;
        findById: (id: string) => Promise<SalesInvoice | null>;
        create: (data: SalesInvoiceData) => Promise<SalesInvoice>;
        delete: (id: string) => Promise<SalesInvoice>;
        getStats: (filters?: { dateFrom?: string; dateTo?: string }) => Promise<SalesStats>;
        refund: (
          id: string,
          options?: { employeeId?: string; reason?: string }
        ) => Promise<{ originalInvoiceId: string; refundInvoice: SalesInvoice }>;
      };
      customers: {
        findMany: (options?: { includeInactive?: boolean }) => Promise<Customer[]>;
        create: (data: CustomerData) => Promise<Customer>;
        update: (id: string, data: CustomerUpdateData) => Promise<Customer>;
        delete: (id: string) => Promise<Customer>;
        findByEmail: (email: string) => Promise<Customer | null>;
        findByPhone: (phone: string) => Promise<Customer | null>;
      };
      inventory: {
        findMany: (
          filters?: InventoryFilters,
          options?: InventoryFindManyOptions
        ) => Promise<Inventory[]>;
        count: (filters?: InventoryFilters) => Promise<number>;
        create: (data: InventoryData) => Promise<Inventory>;
        upsert: (data: InventoryData) => Promise<Inventory>;
        update: (id: string, data: InventoryUpdateData) => Promise<Inventory>;
        delete: (id: string) => Promise<Inventory>;
        findById: (id: string) => Promise<Inventory | null>;
        getLowStockItems: (storeId?: string) => Promise<Inventory[]>;
        adjustStock: (
          id: string,
          newQuantity: number,
          reason: string,
          relatedInvoiceId?: string
        ) => Promise<Inventory>;
      };
      stockTransactions: {
        findMany: (
          filters?: StockTransactionFilters,
          options?: StockTransactionFindManyOptions
        ) => Promise<StockTransaction[]>;
        count: (filters?: StockTransactionFilters) => Promise<number>;
        create: (data: StockTransactionData) => Promise<StockTransaction>;
        findById: (id: string) => Promise<StockTransaction | null>;
        getMovementAnalytics: (filters?: {
          productId?: string;
          storeId?: string;
          dateFrom?: Date;
          dateTo?: Date;
        }) => Promise<any>;
        transferBetweenStores: (data: {
          productId: string;
          fromStoreId: string;
          toStoreId: string;
          quantity: number;
          reason?: string;
        }) => Promise<any>;
        calculateOptimalDistribution: (productId: string) => Promise<any>;
      };
      suppliers: {
        findMany: () => Promise<Supplier[]>;
        create: (data: SupplierData) => Promise<Supplier>;
        update: (id: string, data: SupplierUpdateData) => Promise<Supplier>;
        delete: (id: string) => Promise<Supplier>;
        findById: (id: string) => Promise<Supplier | null>;
      };
      purchaseOrders: {
        findMany: (filters?: { supplierId?: string; status?: string }) => Promise<PurchaseOrder[]>;
        create: (data: PurchaseOrderData) => Promise<PurchaseOrder>;
        update: (id: string, data: PurchaseOrderUpdateData) => Promise<PurchaseOrder>;
        delete: (id: string) => Promise<PurchaseOrder>;
        findById: (id: string) => Promise<PurchaseOrder | null>;
        receiveItems: (
          id: string,
          receivedItems: Array<{ itemId: string; receivedDate: Date }>
        ) => Promise<PurchaseOrder>;
      };
      stores: {
        findMany: () => Promise<Store[]>;
        create: (data: StoreData) => Promise<Store>;
        update: (id: string, data: StoreUpdateData) => Promise<Store>;
        delete: (id: string) => Promise<Store>;
        findById: (id: string) => Promise<Store | null>;
      };
      stockSync: {
        syncProductStockFromInventory: (productId: string) => Promise<number>;
        syncAllProductsStockFromInventory: () => Promise<number>;
      };
      settings: {
        findMany: () => Promise<Setting[]>;
        findByKey: (key: string) => Promise<Setting | null>;
        upsert: (
          key: string,
          value: string,
          type?: string,
          category?: string,
          description?: string
        ) => Promise<Setting>;
        updateBulk: (
          settings: Array<{
            key: string;
            value: string;
            type?: string;
            category?: string;
            description?: string;
          }>
        ) => Promise<Setting[]>;
        delete: (key: string) => Promise<Setting>;
        getByCategory: (category: string) => Promise<Setting[]>;
      };

      payments: {
        findMany: (filters?: {
          invoiceId?: string;
          customerId?: string;
          dateFrom?: Date;
          dateTo?: Date;
        }) => Promise<Payment[]>;
        create: (data: {
          invoiceId: string;
          amount: number;
          paymentMode: string;
          employeeId: string;
          notes?: string;
        }) => Promise<Payment>;
        findById: (id: string) => Promise<Payment | null>;
        update: (
          id: string,
          data: {
            amount?: number;
            paymentMode?: string;
            notes?: string;
          }
        ) => Promise<Payment>;
        delete: (id: string) => Promise<Payment>;
      };

      backup: {
        create: (
          backupName?: string
        ) => Promise<{ success: boolean; path?: string; error?: string }>;
        list: () => Promise<Array<{ name: string; path: string; size: number; createdAt: Date }>>;
        restore: (backupPath: string) => Promise<{ success: boolean; error?: string }>;
        delete: (backupPath: string) => Promise<{ success: boolean; error?: string }>;
        getStats: () => Promise<{ totalBackups: number; totalSize: number; lastBackup?: Date }>;
      };

      printer: {
        getPrinters: () => Promise<
          Array<{ name: string; displayName: string; isDefault: boolean }>
        >;
        printReceipt: (
          receiptData: ReceiptData,
          printerName?: string,
          config?: PrinterConfig
        ) => Promise<{ success: boolean; error?: string }>;
        testPrint: (printerName?: string) => Promise<{ success: boolean; error?: string }>;
      };

      scanner: {
        getDevices: () => Promise<
          Array<{ name: string; vendorId: number; productId: number; type: string }>
        >;
        startScanning: () => Promise<{ success: boolean }>;
        stopScanning: () => Promise<{ success: boolean }>;
        testScan: () => Promise<{ success: boolean }>;
        onData: (callback: (data: ScannedData) => void) => void;
        removeAllListeners: () => void;
      };

      logs: {
        getLogPath: () => Promise<string>;
        getLogContent: (maxLines?: number) => Promise<string>;
        clearLogs: () => Promise<{ success: boolean; error?: string }>;
      };

      roles: {
        findMany: () => Promise<Role[]>;
        create: (data: { name: string; description?: string; isSystem?: boolean }) => Promise<Role>;
        update: (id: string, data: { name?: string; description?: string }) => Promise<Role>;
        delete: (id: string) => Promise<Role>;
        findById: (id: string) => Promise<Role | null>;
        assignToEmployee: (
          roleId: string,
          employeeId: string,
          assignedBy?: string
        ) => Promise<EmployeeRole>;
        removeFromEmployee: (roleId: string, employeeId: string) => Promise<EmployeeRole>;
      };

      permissions: {
        findMany: () => Promise<Permission[]>;
        create: (data: {
          module: string;
          action: string;
          scope?: string;
          description?: string;
        }) => Promise<Permission>;
        update: (id: string, data: { description?: string }) => Promise<Permission>;
        delete: (id: string) => Promise<Permission>;
        findById: (id: string) => Promise<Permission | null>;
        findByModule: (module: string) => Promise<Permission[]>;
        bulkCreate: (
          permissions: Array<{
            module: string;
            action: string;
            scope?: string;
            description?: string;
          }>
        ) => Promise<Permission[]>;
      };

      rolePermissions: {
        grant: (roleId: string, permissionId: string) => Promise<RolePermission>;
        revoke: (roleId: string, permissionId: string) => Promise<RolePermission>;
        remove: (roleId: string, permissionId: string) => Promise<RolePermission>;
        getRolePermissions: (roleId: string) => Promise<RolePermission[]>;
        getEmployeePermissions: (employeeId: string) => Promise<Permission[]>;
        checkEmployeePermission: (
          employeeId: string,
          module: string,
          action: string,
          scope?: string
        ) => Promise<boolean>;
      };
      updates: {
        onState: (callback: (payload: UpdateStatePayload) => void) => () => void;
        check: () => Promise<{ success: boolean; message?: string }>;
        install: () => Promise<{ success: boolean; message?: string }>;
      };
    };
  }
}

interface Role {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  rolePermissions?: RolePermission[];
  employeeRoles?: EmployeeRole[];
}

interface Permission {
  id: string;
  module: string;
  action: string;
  scope?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RolePermission {
  roleId: string;
  permissionId: string;
  granted: boolean;
  createdAt: Date;
  role: Role;
  permission: Permission;
}

interface EmployeeRole {
  employeeId: string;
  roleId: string;
  assignedAt: Date;
  assignedBy?: string;
  role: Role;
  employee: Employee;
}

export {};
