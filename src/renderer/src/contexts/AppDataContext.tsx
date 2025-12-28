import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode
} from "react";
import { useCurrentUser } from "./CurrentUserContext";

export interface Category {
  id: string;
  name: string;
  description?: string;
  parentCategoryId?: string;
  createdAt: Date;
  updatedAt: Date;
  parentCategory?: Category;
  subCategories?: Category[];
}

export interface ProductImage {
  id: string;
  productId: string;
  url: string;
  altText?: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductTag {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductTagMap {
  productId: string;
  tagId: string;
  createdAt: Date;
  product?: Product;
  tag?: ProductTag;
}

export interface Product {
  id: string;
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
  wholesale?: number | null;
  taxInclusivePrice?: number;
  taxRate?: number;
  unitSize?: string;
  unitType?: string;
  unit?: string;
  stockLevel: number;
  createdAt: Date;
  updatedAt: Date;
  category?: Category;
  images?: ProductImage[];
  productTags?: ProductTagMap[];
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  loyaltyPoints?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeRole {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
}

export interface EmployeeRoleMap {
  role: EmployeeRole;
}

export interface Employee {
  id: string;
  employee_id: string;
  name: string;
  role: string;
  email: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
  employeeRoles?: EmployeeRoleMap[];
  tenantId?: string;
}

export interface SettingsState {
  darkMode: boolean;
  notifications: boolean;
  autoBackup: boolean;
  backupFrequency: string;
  backupRetention: number;
  language: string;
  currency: string;
  taxRate: number;
  lowStockThreshold: number;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  selectedPrinter: string;
  printCopies: number;
  silentPrint: boolean;
  printPreview: boolean;
  scannerEnabled: boolean;
  scannerAutoFocus: boolean;
}

export interface SettingRecord {
  key: string;
  value: string;
  type: "boolean" | "number" | "string";
  category?: string;
  description?: string;
}

export const DEFAULT_SETTINGS: SettingsState = {
  darkMode: false,
  notifications: true,
  autoBackup: true,
  backupFrequency: "daily",
  backupRetention: 30,
  language: "en",
  currency: "LKR",
  taxRate: 15,
  lowStockThreshold: 10,
  companyName: "Your Company Name",
  companyAddress: "Your Company Address",
  companyPhone: "+94 XX XXX XXXX",
  companyEmail: "info@yourcompany.com",
  selectedPrinter: "",
  printCopies: 1,
  silentPrint: true,
  printPreview: false,
  scannerEnabled: true,
  scannerAutoFocus: true
};

const numericSettingKeys: ReadonlySet<string> = new Set([
  "taxRate",
  "lowStockThreshold",
  "backupRetention",
  "printCopies"
]);

export const applySettingsRecords = (
  records: SettingRecord[],
  baseSettings: SettingsState = DEFAULT_SETTINGS
): SettingsState => {
  const nextSettings: SettingsState = { ...baseSettings };
  const nextSettingsRecord = nextSettings as unknown as Record<
    string,
    string | number | boolean
  >;

  records.forEach((setting) => {
    if (!(setting.key in nextSettings)) {
      return;
    }

    const key = setting.key;

    if (setting.type === "boolean") {
      nextSettingsRecord[key] = setting.value === "true";
      return;
    }

    if (setting.type === "number" || numericSettingKeys.has(key)) {
      const parsed = Number.parseFloat(setting.value);
      nextSettingsRecord[key] = Number.isFinite(parsed) ? parsed : setting.value;
      return;
    }

    nextSettingsRecord[key] = setting.value;
  });

  return nextSettings;
};

type DataKey = "products" | "categories" | "customers" | "employees" | "settings";

interface AppDataContextValue {
  products: Product[];
  categories: Category[];
  customers: Customer[];
  employees: Employee[];
  settings: SettingsState;
  loading: Record<DataKey, boolean>;
  loaded: Record<DataKey, boolean>;
  refreshProducts: (options?: { force?: boolean }) => Promise<void>;
  refreshCategories: (options?: { force?: boolean }) => Promise<void>;
  refreshCustomers: (options?: { force?: boolean }) => Promise<void>;
  refreshEmployees: (options?: { force?: boolean }) => Promise<void>;
  refreshSettings: (options?: { force?: boolean }) => Promise<void>;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState>>;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

export const useAppData = (): AppDataContextValue => {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used within an AppDataProvider");
  }
  return context;
};

interface AppDataProviderProps {
  children: ReactNode;
}

export const AppDataProvider: React.FC<AppDataProviderProps> = ({ children }) => {
  const { currentUser } = useCurrentUser();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState<Record<DataKey, boolean>>({
    products: false,
    categories: false,
    customers: false,
    employees: false,
    settings: false
  });
  const [loaded, setLoaded] = useState<Record<DataKey, boolean>>({
    products: false,
    categories: false,
    customers: false,
    employees: false,
    settings: false
  });
  const loadedRef = useRef(loaded);
  const lastUserIdRef = useRef<string | null>(null);
  const currentUserId = currentUser?.id ?? null;

  const setLoadingKey = useCallback((key: DataKey, value: boolean) => {
    setLoading((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setLoadedKey = useCallback((key: DataKey, value: boolean) => {
    setLoaded((prev) => ({ ...prev, [key]: value }));
  }, []);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  const refreshProducts = useCallback(
    async (options: { force?: boolean } = {}): Promise<void> => {
      if (!currentUserId) {
        return;
      }
      if (loadedRef.current.products && !options.force) {
        return;
      }
      setLoadingKey("products", true);
      try {
        const data = await window.api.products.findMany();
        setProducts(data);
        setLoadedKey("products", true);
      } catch (error) {
        console.error("Error loading products:", error);
        throw error;
      } finally {
        setLoadingKey("products", false);
      }
    },
    [currentUserId, setLoadingKey, setLoadedKey]
  );

  const refreshCategories = useCallback(
    async (options: { force?: boolean } = {}): Promise<void> => {
      if (!currentUserId) {
        return;
      }
      if (loadedRef.current.categories && !options.force) {
        return;
      }
      setLoadingKey("categories", true);
      try {
        const data = await window.api.categories.findMany();
        setCategories(data);
        setLoadedKey("categories", true);
      } catch (error) {
        console.error("Error loading categories:", error);
        throw error;
      } finally {
        setLoadingKey("categories", false);
      }
    },
    [currentUserId, setLoadingKey, setLoadedKey]
  );

  const refreshCustomers = useCallback(
    async (options: { force?: boolean } = {}): Promise<void> => {
      if (!currentUserId) {
        return;
      }
      if (loadedRef.current.customers && !options.force) {
        return;
      }
      setLoadingKey("customers", true);
      try {
        const data = await window.api.customers.findMany({ includeInactive: true });
        setCustomers(data);
        setLoadedKey("customers", true);
      } catch (error) {
        console.error("Error loading customers:", error);
        throw error;
      } finally {
        setLoadingKey("customers", false);
      }
    },
    [currentUserId, setLoadingKey, setLoadedKey]
  );

  const refreshEmployees = useCallback(
    async (options: { force?: boolean } = {}): Promise<void> => {
      if (!currentUserId) {
        return;
      }
      if (loadedRef.current.employees && !options.force) {
        return;
      }
      setLoadingKey("employees", true);
      try {
        const data = await window.api.employees.findMany();
        setEmployees(data);
        setLoadedKey("employees", true);
      } catch (error) {
        console.error("Error loading employees:", error);
        throw error;
      } finally {
        setLoadingKey("employees", false);
      }
    },
    [currentUserId, setLoadingKey, setLoadedKey]
  );

  const refreshSettings = useCallback(
    async (options: { force?: boolean } = {}): Promise<void> => {
      if (!currentUserId) {
        return;
      }
      if (loadedRef.current.settings && !options.force) {
        return;
      }
      setLoadingKey("settings", true);
      try {
        const records: SettingRecord[] = await window.api.settings.findMany();
        const nextSettings = applySettingsRecords(records, DEFAULT_SETTINGS);
        setSettings(nextSettings);
        setLoadedKey("settings", true);
      } catch (error) {
        console.error("Error loading settings:", error);
        throw error;
      } finally {
        setLoadingKey("settings", false);
      }
    },
    [currentUserId, setLoadingKey, setLoadedKey]
  );

  useEffect(() => {
    const nextUserId = currentUserId;

    if (!nextUserId) {
      lastUserIdRef.current = null;
      setProducts([]);
      setCategories([]);
      setCustomers([]);
      setEmployees([]);
      setSettings(DEFAULT_SETTINGS);
      setLoaded({
        products: false,
        categories: false,
        customers: false,
        employees: false,
        settings: false
      });
      return;
    }

    if (lastUserIdRef.current !== nextUserId) {
      lastUserIdRef.current = nextUserId;
      setProducts([]);
      setCategories([]);
      setCustomers([]);
      setEmployees([]);
      setSettings(DEFAULT_SETTINGS);
      setLoaded({
        products: false,
        categories: false,
        customers: false,
        employees: false,
        settings: false
      });
    }

    void Promise.allSettled([
      refreshProducts({ force: true }),
      refreshCategories({ force: true }),
      refreshCustomers({ force: true }),
      refreshEmployees({ force: true }),
      refreshSettings({ force: true })
    ]);
  }, [
    currentUserId,
    refreshProducts,
    refreshCategories,
    refreshCustomers,
    refreshEmployees,
    refreshSettings
  ]);

  const value = useMemo<AppDataContextValue>(
    () => ({
      products,
      categories,
      customers,
      employees,
      settings,
      loading,
      loaded,
      refreshProducts,
      refreshCategories,
      refreshCustomers,
      refreshEmployees,
      refreshSettings,
      setProducts,
      setCategories,
      setCustomers,
      setEmployees,
      setSettings
    }),
    [
      products,
      categories,
      customers,
      employees,
      settings,
      loading,
      loaded,
      refreshProducts,
      refreshCategories,
      refreshCustomers,
      refreshEmployees,
      refreshSettings
    ]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
};
