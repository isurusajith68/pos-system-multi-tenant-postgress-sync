import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import toast from "react-hot-toast";
import { useAppData } from "../contexts/AppDataContext";
import { useTranslation } from "../contexts/LanguageContext";
import { useCurrentUser } from "../contexts/CurrentUserContext";
import { formatToThreeDecimalPlaces } from "../lib/quantityValidation";

interface Product {
  id: string;
  sku?: string;
  barcode?: string;
  name: string;
  englishName?: string;
  description?: string;
  brand?: string;
  categoryId: string;
  price: number;
  discountedPrice?: number | null;
  wholesale?: number | null;
  costPrice?: number;
  taxInclusivePrice?: number;
  taxRate?: number;
  unitSize?: string;
  unit?: string;
  stockLevel: number;
  createdAt: Date;
  updatedAt: Date;
  category?: Category;
  images?: unknown[];
  productTags?: unknown[];
}

interface Category {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CartItem extends Product {
  quantity: number;
  total: number;
  discount: {
    type: "percentage" | "amount";
    value: number;
  };
  salePrice?: number;
  originalTotal: number;
  customQuantity?: number;
  originalPrice: number;
  customProductId?: string; // Reference to custom product in database
}

type ProductFilters = {
  searchTerm?: string;
  categoryId?: string;
  code?: string;
};

type ProductQueryCacheEntry = {
  data?: Product[];
  expiresAt: number;
  inFlight?: Promise<Product[]>;
};

type ScanIndexEntry = {
  product: Product;
  expiresAt: number;
};

const PRODUCT_QUERY_CACHE_TTL_MS = 3000;
const PRODUCT_QUERY_CACHE_MAX = 200;
const SCAN_INDEX_TTL_MS = 5000;
const SCAN_INDEX_MAX = 2000;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);

  return `{${entries.join(",")}}`;
};

const POSSystem2: React.FC = () => {
  const { t } = useTranslation();
  const { currentUser: user } = useCurrentUser();
  const { categories, customers, setCustomers, refreshCategories, refreshCustomers, settings } =
    useAppData();
  const [products, setProducts] = useState<Product[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  // Default to all categories until categories are fetched.
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => {
    // This will be updated after categories are fetched, but for initial render, use empty array (all)
    return [];
  });
  const [hasAutoSelectedCategory, setHasAutoSelectedCategory] = useState(false);
  const productQueryCacheRef = useRef<Map<string, ProductQueryCacheEntry>>(new Map());
  const scanIndexRef = useRef<Map<string, ScanIndexEntry>>(new Map());

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const orderedCategories = useMemo(() => {
    const main = categories.filter((category) => category.name.toLowerCase() === "main");
    const rest = categories.filter((category) => category.name.toLowerCase() !== "main");
    return [...main, ...rest];
  }, [categories]);
  const selectedCategoryIds = useMemo(() => {
    if (selectedCategories.length === 0 || categories.length === 0) {
      return [];
    }
    const categoryIdSet = new Set(categories.map((category) => category.id));
    const uniqueSelected = new Set<string>();
    selectedCategories.forEach((id) => {
      if (categoryIdSet.has(id)) {
        uniqueSelected.add(id);
      }
    });
    return Array.from(uniqueSelected);
  }, [selectedCategories, categories]);
  const isAllCategoriesSelected =
    categories.length > 0 && selectedCategoryIds.length === categories.length;
  const isAllCategoriesActive = selectedCategoryIds.length === 0 || isAllCategoriesSelected;
  const isCategoryFilterActive = selectedCategoryIds.length > 0 && !isAllCategoriesSelected;
  const selectedCategorySet = useMemo(() => new Set(selectedCategoryIds), [selectedCategoryIds]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 200);

    return () => clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    productQueryCacheRef.current.clear();
    scanIndexRef.current.clear();
  }, [user?.id]);

  const cacheScanProducts = useCallback((items: Product[]): void => {
    if (items.length === 0) {
      return;
    }

    const now = Date.now();
    const scanIndex = scanIndexRef.current;

    items.forEach((product) => {
      if (product.barcode) {
        scanIndex.set(product.barcode, {
          product,
          expiresAt: now + SCAN_INDEX_TTL_MS
        });
      }
      if (product.sku) {
        scanIndex.set(product.sku, {
          product,
          expiresAt: now + SCAN_INDEX_TTL_MS
        });
      }
    });

    for (const [key, entry] of scanIndex) {
      if (entry.expiresAt <= now) {
        scanIndex.delete(key);
      }
    }

    if (scanIndex.size > SCAN_INDEX_MAX) {
      const overflow = scanIndex.size - SCAN_INDEX_MAX;
      const keys = scanIndex.keys();
      for (let i = 0; i < overflow; i += 1) {
        const next = keys.next();
        if (next.done) {
          break;
        }
        scanIndex.delete(next.value);
      }
    }
  }, []);

  const getCachedScanProduct = useCallback((code: string): Product | null => {
    if (!code) {
      return null;
    }

    const entry = scanIndexRef.current.get(code);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      scanIndexRef.current.delete(code);
      return null;
    }

    return entry.product;
  }, []);

  const getProductsCached = useCallback(
    async (options: {
      filters: ProductFilters;
      pagination?: { skip?: number; take?: number };
    }): Promise<Product[]> => {
      const cacheKey = stableStringify(options ?? {});
      const cache = productQueryCacheRef.current;
      const now = Date.now();
      const cached = cache.get(cacheKey);
      console.log(cached);
      if (cached?.data && cached.expiresAt > now) {
        cacheScanProducts(cached.data);
        return cached.data;
      }

      if (cached?.inFlight) {
        return cached.inFlight;
      }

      const request = window.api.products.findMany(options).then((data: Product[]) => {
        cache.set(cacheKey, {
          data,
          expiresAt: Date.now() + PRODUCT_QUERY_CACHE_TTL_MS
        });
        cacheScanProducts(data);
        if (cache.size > PRODUCT_QUERY_CACHE_MAX) {
          const overflow = cache.size - PRODUCT_QUERY_CACHE_MAX;
          const keys = cache.keys();
          for (let i = 0; i < overflow; i += 1) {
            const next = keys.next();
            if (next.done) {
              break;
            }
            cache.delete(next.value);
          }
        }
        return data;
      });

      cache.set(cacheKey, {
        data: cached?.data,
        expiresAt: cached?.expiresAt ?? 0,
        inFlight: request
      });

      return request.catch((error) => {
        cache.delete(cacheKey);
        throw error;
      });
    },
    [cacheScanProducts]
  );

  const baseProductFilters = useMemo<ProductFilters>(() => {
    const filters: ProductFilters = {};

    if (debouncedSearchTerm) {
      filters.searchTerm = debouncedSearchTerm;
    }

    return filters;
  }, [debouncedSearchTerm]);

  useEffect(() => {
    if (hasAutoSelectedCategory || categories.length === 0) {
      return;
    }

    setSelectedCategories([]);
    setHasAutoSelectedCategory(true);
  }, [categories.length, hasAutoSelectedCategory]);

  const [currentTotal, setCurrentTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [bulkDiscountType, setBulkDiscountType] = useState<"percentage" | "amount">("percentage");
  const [bulkDiscountValue, setBulkDiscountValue] = useState(0);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [totalDiscountAmount, setTotalDiscountAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<"cash" | "card" | "credit" | "wholesale">("cash");
  const [creditPriceMode, setCreditPriceMode] = useState<"discounted" | "regular">("discounted");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<number>(0);
  const storeInfo = useMemo(
    () => ({
      name: settings.companyName || "Zentra",
      address: settings.companyAddress || "123 Main Street, City, Country",
      phone: settings.companyPhone || "+1-234-567-8900",
      email: settings.companyEmail || "info@zentra.com"
    }),
    [settings]
  );
  const printerSettings = useMemo(
    () => ({
      selectedPrinter: settings.selectedPrinter,
      printCopies: settings.printCopies,
      silentPrint: settings.silentPrint,
      printPreview: settings.printPreview
    }),
    [settings]
  );
  const scannerEnabled = settings.scannerEnabled;
  const [isPartialPayment, setIsPartialPayment] = useState(false);
  const [partialPaymentAmount, setPartialPaymentAmount] = useState("");

  // Customer management state
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerFormData, setCustomerFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: ""
  });
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);

  // Custom product state
  const [showCustomProductModal, setShowCustomProductModal] = useState(false);
  const [customProductData, setCustomProductData] = useState({
    name: "වෙනත්",
    quantity: "1",
    price: ""
  });

  // Quantity popup state
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [selectedProductForQuantity, setSelectedProductForQuantity] = useState<Product | null>(
    null
  );
  const [quantityInput, setQuantityInput] = useState("1");

  // Keyboard shortcuts helper modal
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Cart history state
  const [showCartHistoryModal, setShowCartHistoryModal] = useState(false);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);

  // Payment confirmation modal
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [isPayButtonLoading, setIsPayButtonLoading] = useState(false);

  const openPaymentConfirmation = useCallback(() => {
    setShowPaymentConfirmation(true);
    setIsPayButtonLoading(true);
  }, []);

  const cancelPaymentConfirmation = useCallback(() => {
    setShowPaymentConfirmation(false);
    setIsPayButtonLoading(false);
  }, []);

  // Refs for keyboard navigation
  const searchInputRef = useRef<HTMLInputElement>(null);
  const receivedAmountRef = useRef<HTMLInputElement>(null);
  const discountInputRef = useRef<HTMLInputElement>(null);

  // Product list navigation
  const [selectedProductIndex, setSelectedProductIndex] = useState<number>(-1);
  const productRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Cart item selection
  const [selectedCartItemIndex, setSelectedCartItemIndex] = useState<number>(-1);
  const cartQuantityInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Custom product modal refs
  const customProductNameRef = useRef<HTMLInputElement>(null);
  const customProductQuantityRef = useRef<HTMLInputElement>(null);
  const customProductPriceRef = useRef<HTMLInputElement>(null);

  // Cart history management
  const saveCartToHistory = useCallback(
    (showToast: boolean = true): void => {
      if (cartItems.length === 0) return;

      const cartHistory = {
        cartItems,
        totalDiscountAmount,
        paymentMode,
        selectedCustomer,
        receivedAmount,
        isPartialPayment,
        partialPaymentAmount,
        timestamp: new Date().toISOString()
      };

      localStorage.setItem("pos_cart_history", JSON.stringify(cartHistory));
      if (showToast) {
        toast.success(t("pos.toast.cartSaved") || "Cart saved successfully");
      }
    },
    [
      cartItems,
      totalDiscountAmount,
      paymentMode,
      selectedCustomer,
      receivedAmount,
      isPartialPayment,
      partialPaymentAmount,
      t
    ]
  );

  const restoreCartFromHistory = useCallback((): void => {
    try {
      const savedCart = localStorage.getItem("pos_cart_history");
      if (!savedCart) {
        toast.error(t("No saved cart found") || "No saved cart found");
        setShowRestorePrompt(false);
        return;
      }

      const cartHistory = JSON.parse(savedCart);

      // Restore cart items with proper date parsing
      const restoredCartItems = (cartHistory.cartItems || []).map((item: any) => ({
        ...item,
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
        updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date()
      }));

      setCartItems(restoredCartItems);
      setTotalDiscountAmount(cartHistory.totalDiscountAmount || 0);
      setPaymentMode(cartHistory.paymentMode || "cash");
      setSelectedCustomer(cartHistory.selectedCustomer || "");
      setReceivedAmount(cartHistory.receivedAmount || "");
      setIsPartialPayment(cartHistory.isPartialPayment || false);
      setPartialPaymentAmount(cartHistory.partialPaymentAmount || "");

      toast.success(
        t("pos.toast.cartRestored") || `Cart restored with ${restoredCartItems.length} items`
      );
      setShowRestorePrompt(false);
    } catch (error) {
      console.error("Error restoring cart:", error);
      toast.error(t("pos.toast.cartRestoreFailed") || "Failed to restore cart");
      setShowRestorePrompt(false);
    }
  }, [t]);

  const clearCartHistory = useCallback((): void => {
    localStorage.removeItem("pos_cart_history");
    setShowRestorePrompt(false);
    toast.success(t("pos.toast.cartHistoryCleared") || "Cart history cleared");
  }, [t]);

  const loadScannerDevices = useCallback(async (): Promise<void> => {
    try {
      const devices = await window.api.scanner.getDevices();

      if (devices.length > 0) {
        // toast.success(t("pos.toast.scannerFound", { count: devices.length }));
      }
    } catch (error) {
      console.error("Error loading scanner devices:", error);
      toast.error(t("pos.toast.scannerLoadError"));
    }
  }, [t]);

  const handleScannedData = useCallback(
    async (data: { data?: string }) => {
      if (isInputFocused) {
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastScanTime < 100) {
        return;
      }

      if (!data || !data.data) {
        console.warn("Invalid scan data received:", data);
        return;
      }

      const scannedCode = data.data.trim();

      if (!scannedCode || scannedCode.length < 3) {
        return;
      }

      if (scannedCode.length === 1) {
        return;
      }

      if (/^\d+$/.test(scannedCode) && scannedCode.length < 6) {
        return;
      }

      if (/^[a-zA-Z]{3,}$/.test(scannedCode) && scannedCode.length < 8) {
        return;
      }

      if (/[\s!@#$%^&*()_+\-=[\]{};':"\\|,.<>?/]/.test(scannedCode)) {
        return;
      }

      setLastScanTime(currentTime);

      try {
        const cachedProduct = getCachedScanProduct(scannedCode);
        if (cachedProduct) {
          if (cachedProduct.stockLevel <= 0) {
            toast.error(t("pos.toast.outOfStock", { name: cachedProduct.name }), {
              duration: 3000,
              position: "top-center"
            });
            return;
          }

          setSelectedProductForQuantity(cachedProduct);
          setQuantityInput("1");
          setShowQuantityModal(true);
          return;
        }

        const exactMatches = await getProductsCached({
          filters: { code: scannedCode },
          pagination: { take: 5 }
        });

        if (exactMatches.length > 0) {
          const foundProduct = exactMatches[0];

          if (foundProduct.stockLevel <= 0) {
            toast.error(t("pos.toast.outOfStock", { name: foundProduct.name }), {
              duration: 3000,
              position: "top-center"
            });
            return;
          }

          // Instead of adding directly, show quantity popup
          setSelectedProductForQuantity(foundProduct);
          setQuantityInput("1");
          setShowQuantityModal(true);
          return;
        }

        const fallbackMatches = await getProductsCached({
          filters: { searchTerm: scannedCode },
          pagination: { take: 5 }
        });

        if (fallbackMatches.length > 0) {
          const foundProduct = fallbackMatches[0];

          if (foundProduct.stockLevel <= 0) {
            toast.error(t("pos.toast.outOfStock", { name: foundProduct.name }), {
              duration: 3000,
              position: "top-center"
            });
            return;
          }

          addToCartRef.current(foundProduct, 1);
          toast.success(t("pos.toast.addedToCart", { name: foundProduct.name }), {
            duration: 2000,
            position: "top-center"
          });
          return;
        }

        console.log("Product not found for code:", scannedCode);
        toast.error(t("pos.toast.productNotFound", { code: scannedCode }), {
          duration: 3000,
          position: "top-center"
        });

        if (!searchTerm.trim()) {
          setSearchTerm(scannedCode);
        }
      } catch (error) {
        console.error("Error searching products:", error);
        toast.error(t("pos.toast.productsLoadFailed"));
      }
    },
    [getCachedScanProduct, getProductsCached, isInputFocused, lastScanTime, searchTerm, t]
  );

  const applyBulkDiscount = useCallback((): void => {
    const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let discountAmount = 0;

    if (bulkDiscountType === "percentage") {
      discountAmount = (subtotal * bulkDiscountValue) / 100;
    } else {
      discountAmount = bulkDiscountValue;
    }

    setTotalDiscountAmount(Math.min(discountAmount, subtotal));
    setBulkDiscountValue(0);
  }, [bulkDiscountType, bulkDiscountValue, cartItems]);

  const clearAllDiscounts = (): void => {
    setTotalDiscountAmount(0);
  };

  // Customer management functions
  const handleAddCustomer = async (): Promise<void> => {
    if (!customerFormData.name.trim()) {
      toast.error(t("pos.toast.customerNameRequired"));
      return;
    }

    setIsAddingCustomer(true);
    try {
      const newCustomer = await window.api.customers.create(customerFormData);
      setCustomers((prev) => [...prev, newCustomer]);
      setSelectedCustomer(newCustomer.id);
      setShowCustomerModal(false);
      setCustomerFormData({ name: "", phone: "", email: "", address: "" });
      toast.success(t("pos.toast.customerAdded"));
    } catch (error) {
      console.error("Error adding customer:", error);
      toast.error(t("pos.toast.customerAddFailed"));
    } finally {
      setIsAddingCustomer(false);
    }
  };

  // Custom product function
  const handleAddCustomProduct = async (): Promise<void> => {
    if (!customProductData.name.trim()) {
      toast.error(t("Please enter product name"));
      return;
    }

    const quantity = parseFloat(customProductData.quantity);
    const price = parseFloat(customProductData.price);

    if (!customProductData.quantity || isNaN(quantity) || quantity <= 0) {
      toast.error(t("Please enter valid quantity"));
      return;
    }

    if (!customProductData.price || isNaN(price) || price <= 0) {
      toast.error(t("Please enter valid price"));
      return;
    }

    try {
      // Create custom product in database
      const customProduct = await window.api.customProducts.create({
        name: customProductData.name,
        price: price
      });

      // Create a cart item from the custom product
      const customCartItem: CartItem = {
        id: `custom-${customProduct.id}`,
        name: customProductData.name,
        englishName: customProductData.name,
        categoryId: "custom",
        price: price,
        discountedPrice: undefined,
        wholesale: undefined,
        costPrice: 0,
        stockLevel: 9999,
        quantity: quantity,
        total: quantity * price,
        discount: { type: "amount", value: 0 },
        originalTotal: quantity * price,
        originalPrice: price,
        customQuantity: quantity,
        createdAt: new Date(),
        updatedAt: new Date(),
        customProductId: customProduct.id // Add reference to the database custom product
      };

      setCartItems([...cartItems, customCartItem]);
      setShowCustomProductModal(false);
      setCustomProductData({ name: "වෙනත්", quantity: "1", price: "" });
      toast.success(t("Custom product added to cart"));
    } catch (error) {
      console.error("Error creating custom product:", error);
      toast.error(t("Failed to create custom product"));
    }
  };

  useEffect(() => {
    const loadInitialData = async (): Promise<void> => {
      await Promise.all([fetchCategories(), fetchCustomers()]);
    };

    void loadInitialData();

    // Check for saved cart history
    const savedCart = localStorage.getItem("pos_cart_history");
    if (savedCart) {
      setShowRestorePrompt(true);
    }
  }, []);
  useEffect(() => {
    if (!scannerEnabled) {
      return;
    }

    void loadScannerDevices();
  }, [scannerEnabled, loadScannerDevices]);
  useEffect(() => {
    if (!scannerEnabled) {
      console.log("Scanner disabled, removing listeners");
      window.api?.scanner?.removeAllListeners?.();
      return;
    }

    console.log("Setting up scanner event listeners");
    window.api?.scanner?.removeAllListeners?.();

    const handleData = (data: { data?: string }): void => {
      console.log("Scanner data event:", data);
      void handleScannedData(data);
    };

    if (window.api?.scanner) {
      window.api.scanner.onData(handleData);
    } else {
      console.error("Scanner API not available");
    }

    return () => {
      console.log("Cleaning up scanner listeners");
      window.api?.scanner?.removeAllListeners?.();
    };
  }, [scannerEnabled, handleScannedData]);

  useEffect(() => {
    const handleFocusIn = (e: FocusEvent): void => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      ) {
        console.log("Input field focused, disabling scanner temporarily");
        setIsInputFocused(true);
      }
    };

    const handleFocusOut = (e: FocusEvent): void => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      ) {
        console.log("Input field unfocused, re-enabling scanner");
        setIsInputFocused(false);
      }
    };

    const handleKeyDown = (): void => {
      if (isInputFocused) {
        console.log("Keyboard input detected while input focused - scanner should ignore");
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isInputFocused]);

  useEffect(() => {
    const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const finalTotal = subtotal - totalDiscountAmount;
    setCurrentTotal(Math.max(0, finalTotal));
  }, [cartItems, totalDiscountAmount]);

  useEffect(() => {
    setCartItems((prevItems) => {
      let hasChanges = false;

      const updatedItems = prevItems.map((item) => {
        const derivedSalePrice =
          paymentMode === "wholesale"
            ? item.wholesale && item.wholesale > 0
              ? item.wholesale
              : item.discountedPrice && item.discountedPrice > 0
                ? item.discountedPrice
                : undefined
            : paymentMode === "credit"
              ? creditPriceMode === "discounted" &&
                item.discountedPrice &&
                item.discountedPrice > 0
                ? item.discountedPrice
                : undefined
              : item.discountedPrice && item.discountedPrice > 0
                ? item.discountedPrice
                : undefined;
        const originalUnitPrice = item.originalPrice ?? item.price;
        const effectivePrice = !derivedSalePrice ? originalUnitPrice : derivedSalePrice;

        if (item.price === effectivePrice && item.salePrice === derivedSalePrice) {
          return item;
        }

        hasChanges = true;
        const quantity = item.customQuantity ?? item.quantity;
        const updatedTotal = quantity * effectivePrice;

        return {
          ...item,
          price: effectivePrice,
          salePrice: derivedSalePrice,
          total: updatedTotal,
          originalTotal: updatedTotal
        };
      });

      return hasChanges ? updatedItems : prevItems;
    });

    if (paymentMode !== "cash") {
      setReceivedAmount("");
    }
  }, [paymentMode, creditPriceMode]);

  const originalSubtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const fetchProducts = useCallback(async (): Promise<void> => {
    if (categories.length > 0 && selectedCategories.length === 0 && !hasAutoSelectedCategory) {
      return;
    }

    try {
      setLoading(true);

      if (isAllCategoriesActive || selectedCategoryIds.length <= 1) {
        const filters: ProductFilters = { ...baseProductFilters };
        if (!isAllCategoriesActive && selectedCategoryIds.length === 1) {
          filters.categoryId = selectedCategoryIds[0];
        }
        const data = await getProductsCached({ filters });
        setProducts(data);
        return;
      }

      const categoryRequests = selectedCategoryIds.map((categoryId) =>
        getProductsCached({
          filters: { ...baseProductFilters, categoryId }
        })
      );
      const categoryResults = await Promise.all(categoryRequests);
      const mergedProducts = new Map<string, Product>();
      categoryResults.forEach((items) => {
        items.forEach((product) => mergedProducts.set(product.id, product));
      });
      setProducts(Array.from(mergedProducts.values()));
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error(t("pos.toast.productsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [
    baseProductFilters,
    getProductsCached,
    isAllCategoriesActive,
    selectedCategoryIds,
    t,
    categories.length,
    selectedCategories.length,
    hasAutoSelectedCategory
  ]);

  const fetchCategories = async (): Promise<void> => {
    try {
      await refreshCategories({ force: true });
    } catch (error) {
      console.error("Error fetching categories:", error);
      toast.error(t("pos.toast.categoriesLoadFailed"));
    }
  };

  const fetchCustomers = async (): Promise<void> => {
    try {
      await refreshCustomers({ force: true });
    } catch (error) {
      console.error("Error fetching customers:", error);
      // Don't show error toast for customers as it's optional
    }
  };

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const filteredProducts = useMemo(() => {
    if (isAllCategoriesActive || selectedCategoryIds.length <= 1) {
      return products;
    }

    return products.filter((product) => selectedCategorySet.has(product.categoryId));
  }, [products, isAllCategoriesActive, selectedCategoryIds.length, selectedCategorySet]);

  const cartItemsById = useMemo(() => {
    const map = new Map<string, CartItem>();
    cartItems.forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [cartItems]);

  const handleQuantityConfirm = (): void => {
    if (!selectedProductForQuantity) return;

    const quantity = parseFloat(quantityInput);
    if (isNaN(quantity) || quantity <= 0) {
      toast.error(t("Please enter valid quantity"));
      return;
    }

    addToCartWithQuantity(selectedProductForQuantity, quantity);
    setShowQuantityModal(false);
    setSelectedProductForQuantity(null);
    setQuantityInput("1");
  };

  const addToCartWithQuantity = useCallback(
    (product: Product, inputQuantity: number = 1): void => {
      const existingItem = cartItems.find((item) => item.id === product.id);
      const currentCartQuantity = existingItem ? existingItem.quantity : 0;
      const requestedQuantity = currentCartQuantity + inputQuantity;

      if (product.stockLevel <= 0) {
        toast.error(t("pos.toast.outOfStock", { name: product.name }), {
          duration: 3000,
          position: "top-center"
        });
        return;
      }

      if (requestedQuantity > product.stockLevel) {
        toast.error(
          t("pos.toast.insufficientStock", {
            name: product.name,
            available: formatToThreeDecimalPlaces(product.stockLevel)
          }),
          {
            duration: 3000,
            position: "top-center"
          }
        );
        return;
      }

      let derivedSalePrice: number | undefined;
      console.log(product);
      if (paymentMode === "wholesale") {
        if (product.wholesale && product.wholesale > 0) {
          derivedSalePrice = product.wholesale;
        } else if (product.discountedPrice && product.discountedPrice > 0) {
          derivedSalePrice = product.discountedPrice;
        } else {
          derivedSalePrice = product.price;
        }
      } else if (paymentMode === "credit") {
        derivedSalePrice =
          creditPriceMode === "discounted" &&
          product.discountedPrice &&
          product.discountedPrice > 0
            ? product.discountedPrice
            : undefined;
      } else {
        derivedSalePrice =
          product.discountedPrice && product.discountedPrice > 0
            ? product.discountedPrice
            : undefined;
      }

      const preservedSalePrice = existingItem?.salePrice ?? derivedSalePrice;

      const effectivePrice = !preservedSalePrice ? product.price : preservedSalePrice;

      const originalPrice = product.price;

      if (existingItem) {
        const newQuantity = existingItem.quantity + inputQuantity;
        setCartItems(
          cartItems.map((item) =>
            item.id === product.id
              ? {
                  ...item,
                  quantity: newQuantity,
                  price: effectivePrice,
                  salePrice: preservedSalePrice,
                  costPrice: item.costPrice ?? product.costPrice ?? 0,
                  total: newQuantity * effectivePrice,
                  originalTotal: newQuantity * effectivePrice,
                  originalPrice: originalPrice,
                  customQuantity: newQuantity
                }
              : item
          )
        );
      } else {
        const total = effectivePrice;
        setCartItems([
          ...cartItems,
          {
            ...product,
            quantity: inputQuantity,
            total: total * inputQuantity,
            discount: { type: "amount", value: 0 },
            originalTotal: total * inputQuantity,
            price: effectivePrice,
            salePrice: preservedSalePrice,
            costPrice: product.costPrice ?? 0,
            originalPrice: originalPrice,
            customQuantity: inputQuantity
          }
        ]);
      }
    },
    [cartItems, paymentMode, creditPriceMode, t]
  );

  const addToCart = useCallback((product: Product): void => {
    setSelectedProductForQuantity(product);
    setQuantityInput("1");
    setShowQuantityModal(true);
  }, []);

  const updateQuantity = (productId: string, newQuantity: number): void => {
    if (newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }

    const item = cartItems.find((item) => item.id === productId);
    if (!item) return;

    if (newQuantity > item.stockLevel) {
      toast.error(`Only ${item.stockLevel} available`);
      return;
    }

    setCartItems(
      cartItems.map((item) =>
        item.id === productId
          ? {
              ...item,
              quantity: newQuantity,
              total: newQuantity * item.price,
              originalTotal: newQuantity * item.price,
              customQuantity: newQuantity
            }
          : item
      )
    );
  };

  const removeFromCart = useCallback(
    (productId: string): void => {
      const item = cartItems.find((item) => item.id === productId);
      if (item) {
        setCartItems(cartItems.filter((item) => item.id !== productId));
        toast.success(t("pos.toast.itemRemoved", { name: item.name }));
      }
    },
    [cartItems, t]
  );

  const clearCart = useCallback((): void => {
    if (cartItems.length > 0) {
      setCartItems([]);
      localStorage.removeItem("pos_cart_history");
      toast.success(t("pos.toast.cartCleared"));
    }
  }, [cartItems, t]);

  const printReceipt = useCallback(
    async (receivedAmount: number, invoiceNumber?: string): Promise<void> => {
      try {
        const receiptData = {
          header: storeInfo.name,
          storeName: storeInfo.name,
          storeAddress: storeInfo.address,
          storePhone: storeInfo.phone,
          invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
          date: new Date().toLocaleDateString(),
          time: new Date().toLocaleTimeString(),
          items: cartItems.map((item) => ({
            name: item.name,
            quantity: item.customQuantity || item.quantity,
            unit: item.unit || item.unitSize || "pc",
            price: item.price,
            total: item.price * (item.customQuantity || item.quantity),
            originalPrice: item.originalPrice
          })),
          subtotal: originalSubtotal,
          tax: 0,
          discount: totalDiscountAmount,
          total: currentTotal,
          paymentMethod: paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1),
          change:
            paymentMode === "cash" || paymentMode === "wholesale"
              ? receivedAmount - currentTotal
              : undefined,
          amountReceived:
            paymentMode === "cash" || paymentMode === "wholesale" ? receivedAmount : undefined,
          footer: `${user?.name || "N/A"}`
        };

        const printConfig = {
          width: 300,
          height: 600,
          margin: "0 0 0 0",
          copies: printerSettings.printCopies,
          preview: printerSettings.printPreview,
          silent: printerSettings.silentPrint
        };

        const result = await window.api.printer.printReceipt(
          receiptData,
          printerSettings.selectedPrinter || undefined,
          printConfig
        );

        if (result.success) {
          toast.success(t("pos.toast.printSuccess"));
        } else {
          toast.error(t("pos.toast.printError"));
        }
      } catch (error) {
        console.error("Error printing receipt:", error);
        toast.error(t("pos.toast.printError"));
      }
    },
    [
      storeInfo,
      cartItems,
      originalSubtotal,
      totalDiscountAmount,
      currentTotal,
      paymentMode,
      user,
      printerSettings,
      t
    ]
  );

  const processPayment = useCallback(
    async (skipPrint: boolean = false): Promise<void> => {
      if (cartItems.length === 0) {
        toast.error(t("pos.toast.cartEmpty"));
        setIsPayButtonLoading(false);
        return;
      }

      const totalAmount = currentTotal;
      let received: number;

      if (paymentMode === "cash" || paymentMode === "wholesale") {
        received = parseFloat(receivedAmount);

        if (!receivedAmount || isNaN(received)) {
          toast.error(t("pos.toast.invalidPayment"));
          setIsPayButtonLoading(false);
          return;
        }

        if (received < totalAmount) {
          toast.error(
            t("pos.toast.insufficientPayment", {
              required: totalAmount.toFixed(2)
            })
          );
          setIsPayButtonLoading(false);
          return;
        }
      } else if (paymentMode === "credit") {
        if (!selectedCustomer) {
          toast.error(t("pos.toast.selectCustomer"));
          setIsPayButtonLoading(false);
          return;
        }

        if (isPartialPayment) {
          received = parseFloat(partialPaymentAmount);
          if (!partialPaymentAmount || isNaN(received) || received <= 0) {
            toast.error(t("pos.toast.invalidPartialPayment"));
            setIsPayButtonLoading(false);
            return;
          }
          if (received >= totalAmount) {
            toast.error(t("pos.toast.partialPaymentTooHigh"));
            setIsPayButtonLoading(false);
            return;
          }
        } else {
          received = 0;
        }
      } else {
        received = totalAmount;
      }

      if (!user?.id) {
        toast.error(t("pos.toast.noEmployee"));
        setIsPayButtonLoading(false);
        return;
      }

      try {
        const salesInvoiceData = {
          customerId: selectedCustomer || undefined,
          employeeId: user.id,
          subTotal: originalSubtotal,
          totalAmount: totalAmount,
          paymentMode: paymentMode,
          taxAmount: 0,
          discountAmount: totalDiscountAmount,
          amountReceived: received,
          outstandingBalance:
            paymentMode === "credit" && isPartialPayment
              ? totalAmount - received
              : paymentMode === "credit"
                ? totalAmount
                : 0,
          paymentStatus:
            paymentMode === "credit" && isPartialPayment
              ? "partial"
              : paymentMode === "credit"
                ? "unpaid"
                : "paid",
          salesDetails: cartItems.map((item) => ({
            productId: item.customProductId ? undefined : item.id,
            customProductId: item.customProductId || undefined,
            quantity: item.customQuantity || item.quantity,
            unitPrice: item.price,
            unit: item.unit || item.unitSize || "pc",
            taxRate: 0,
            originalPrice: item.originalPrice
          }))
        };

        const invoiceResult = await window.api.salesInvoices.create(salesInvoiceData);
        const invoiceNumber = invoiceResult?.id || `INV-${Date.now()}`;

        if (received > 0) {
          await window.api.payments.create({
            invoiceId: invoiceNumber,
            amount: received,
            paymentMode: paymentMode === "credit" ? "cash" : paymentMode,
            employeeId: user.id,
            customerId: selectedCustomer || undefined,
            notes: isPartialPayment ? "Partial payment" : undefined
          });
        }

        const change = paymentMode === "cash" ? received - totalAmount : 0;
        const successMessageKey = ((): string => {
          if (paymentMode === "credit" && isPartialPayment) {
            return "pos.toast.partialPaymentSuccess";
          } else if (paymentMode === "credit") {
            return "pos.toast.creditSaleSuccess";
          } else {
            return "pos.toast.paymentSuccess";
          }
        })();

        toast.success(
          t(successMessageKey, {
            change: change.toFixed(2),
            outstanding: (totalAmount - received).toFixed(2)
          })
        );

        if (!skipPrint) {
          await printReceipt(received, invoiceNumber);
        }

        clearCart();
        setReceivedAmount("");
        setTotalDiscountAmount(0);
        setSelectedCustomer("");
        setCustomerSearchTerm("");
        setShowCustomerDropdown(false);

        setIsPartialPayment(false);
        setPartialPaymentAmount("");
        setPaymentMode("cash"); // Reset to default payment mode
        localStorage.removeItem("pos_cart_history");

        // Customer reset

        // Remove focus from received amount input
        receivedAmountRef.current?.blur();

        toast.success(t("pos.toast.saleCompleted", { total: totalAmount.toFixed(2) }));
      } catch (error) {
        console.error("Error processing payment:", error);
        toast.error(t("pos.toast.paymentFailed"));
      } finally {
        setIsPayButtonLoading(false);
      }
    },
    [
      cartItems,
      currentTotal,
      receivedAmount,
      paymentMode,
      selectedCustomer,
      user,
      originalSubtotal,
      totalDiscountAmount,
      isPartialPayment,
      partialPaymentAmount,
      clearCart,
      printReceipt,
      t,
      setIsPayButtonLoading
    ]
  );

  const addToCartRef = useRef(addToCartWithQuantity);
  const removeFromCartRef = useRef(removeFromCart);
  const clearCartRef = useRef(clearCart);
  const processPaymentRef = useRef(processPayment);
  const applyBulkDiscountRef = useRef(applyBulkDiscount);

  useEffect(() => {
    addToCartRef.current = addToCartWithQuantity;
    removeFromCartRef.current = removeFromCart;
    clearCartRef.current = clearCart;
    processPaymentRef.current = processPayment;
    applyBulkDiscountRef.current = applyBulkDiscount;
  }, [addToCartWithQuantity, removeFromCart, clearCart, processPayment, applyBulkDiscount]);

  // Close customer dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as HTMLElement;
      if (!target.closest(".customer-dropdown-container")) {
        setShowCustomerDropdown(false);
      }
    };

    if (showCustomerDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showCustomerDropdown]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyboardShortcut = (event: KeyboardEvent): void => {
      // Handle payment confirmation modal shortcuts first
      if (showPaymentConfirmation) {
        if (event.key === "Enter" || event.key === "p" || event.key === "P") {
          event.preventDefault();
          setShowPaymentConfirmation(false);
          processPaymentRef.current();
        } else if (event.key === "n" || event.key === "N") {
          event.preventDefault();
          setShowPaymentConfirmation(false);
          processPaymentRef.current(true);
        } else if (event.key === "Escape") {
          cancelPaymentConfirmation();
        }
        return;
      }

      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      ) {
        // Allow Enter key in specific inputs
        if (event.key === "Enter") {
          if (target.getAttribute("placeholder")?.includes("Amount Received")) {
            openPaymentConfirmation();
            return;
          }
        }
        return;
      }

      // Ctrl/Cmd + P - Process Payment
      if ((event.ctrlKey || event.metaKey) && (event.key === "p" || event.key === "P")) {
        event.preventDefault();
        if (cartItems.length > 0) {
          openPaymentConfirmation();
        }
      }

      // Ctrl/Cmd + Shift + D - Clear Cart
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        (event.key === "d" || event.key === "D")
      ) {
        event.preventDefault();
        clearCartRef.current();
      }

      // Ctrl/Cmd + N - Add Custom Product
      if ((event.ctrlKey || event.metaKey) && (event.key === "n" || event.key === "N")) {
        event.preventDefault();
        setShowCustomProductModal(true);
      }

      // Ctrl/Cmd + K - Add Customer (for credit sales)
      if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        if (paymentMode === "credit") {
          setShowCustomerModal(true);
        }
      }

      // F1 - Switch to Cash
      if (event.key === "F1") {
        event.preventDefault();
        setPaymentMode("cash");
      }

      // F2 - Switch to Card
      if (event.key === "F2") {
        event.preventDefault();
        setPaymentMode("card");
      }

      // F3 - Switch to Credit
      if (event.key === "F3") {
        event.preventDefault();
        setPaymentMode("credit");
      }

      // F4 - Switch to Wholesale
      if (event.key === "F4") {
        event.preventDefault();
        setPaymentMode("wholesale");
      }

      // Escape - Close Modals
      if (event.key === "Escape") {
        setShowCustomProductModal(false);
        setShowCustomerModal(false);
        setShowQuantityModal(false);
        setShowShortcutsModal(false);
        setShowCartHistoryModal(false);
        setShowRestorePrompt(false);
        cancelPaymentConfirmation();
      }

      // Ctrl/Cmd + S - Save Cart
      if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        if (cartItems.length > 0) {
          saveCartToHistory(true);
        }
      }

      // F12 or Ctrl/Cmd + / - Show Keyboard Shortcuts Helper
      if (event.key === "F12" || ((event.ctrlKey || event.metaKey) && event.key === "/")) {
        event.preventDefault();
        setShowShortcutsModal(true);
      }

      // Ctrl/Cmd + F - Focus Search
      if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        event.stopPropagation();
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
      }

      // Ctrl/Cmd + A - Focus Received Amount
      if ((event.ctrlKey || event.metaKey) && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        event.stopPropagation();
        if (paymentMode === "cash" || paymentMode === "wholesale") {
          setTimeout(() => {
            receivedAmountRef.current?.focus();
            receivedAmountRef.current?.select();
          }, 0);
        }
      }

      // Ctrl/Cmd + D - Focus Discount Input
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === "d" || event.key === "D")) {
        event.preventDefault();
        event.stopPropagation();
        setTimeout(() => {
          discountInputRef.current?.focus();
          discountInputRef.current?.select();
        }, 0);
      }

      // Number keys 1-9 for category selection (Alt + Number)
      if (event.altKey && event.key >= "1" && event.key <= "9") {
        event.preventDefault();
        const categoryIndex = parseInt(event.key, 10) - 1;
        if (categoryIndex >= 0 && categoryIndex < orderedCategories.length) {
          setSelectedCategories([orderedCategories[categoryIndex].id]);
        }
      }

      // Alt + 0 - Select All Categories
      if (event.altKey && event.key === "0") {
        event.preventDefault();
        setSelectedCategories([]);
      }

      // Arrow Down - Navigate product list down
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedProductIndex((prev) => {
          const newIndex = prev < filteredProducts.length - 1 ? prev + 1 : prev;
          setTimeout(() => {
            productRefs.current[newIndex]?.scrollIntoView({
              behavior: "smooth",
              block: "nearest"
            });
          }, 0);
          return newIndex;
        });
      }

      // Arrow Up - Navigate product list up
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedProductIndex((prev) => {
          const newIndex = prev > 0 ? prev - 1 : 0;
          setTimeout(() => {
            productRefs.current[newIndex]?.scrollIntoView({
              behavior: "smooth",
              block: "nearest"
            });
          }, 0);
          return newIndex;
        });
      }

      // Enter - Add selected product to cart
      if (event.key === "Enter" && selectedProductIndex >= 0) {
        event.preventDefault();
        const selectedProduct = filteredProducts[selectedProductIndex];
        if (selectedProduct && selectedProduct.stockLevel > 0) {
          addToCart(selectedProduct);
        }
      }

      // Arrow Left - Navigate to previous cart item
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (cartItems.length > 0) {
          setSelectedCartItemIndex((prev) => {
            if (prev <= 0) {
              return cartItems.length - 1; // Wrap to last item
            }
            return prev - 1;
          });
        }
      }

      // Arrow Right - Navigate to next cart item
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (cartItems.length > 0) {
          setSelectedCartItemIndex((prev) => {
            if (prev >= cartItems.length - 1 || prev < 0) {
              return 0; // Wrap to first item
            }
            return prev + 1;
          });
        }
      }

      // Plus (+) or Equals (=) - Increase quantity of selected cart item
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        if (cartItems.length > 0) {
          const itemIndex =
            selectedCartItemIndex >= 0 && selectedCartItemIndex < cartItems.length
              ? selectedCartItemIndex
              : cartItems.length - 1;
          const item = cartItems[itemIndex];
          if (item.quantity < item.stockLevel) {
            updateQuantity(item.id, item.quantity + 1);
          }
        }
      }

      // Minus (-) - Decrease quantity of selected cart item
      if (event.key === "-") {
        event.preventDefault();
        if (cartItems.length > 0) {
          const itemIndex =
            selectedCartItemIndex >= 0 && selectedCartItemIndex < cartItems.length
              ? selectedCartItemIndex
              : cartItems.length - 1;
          const item = cartItems[itemIndex];
          updateQuantity(item.id, item.quantity - 1);
        }
      }

      // Backspace - Remove selected cart item
      if (event.key === "Backspace") {
        event.preventDefault();
        if (cartItems.length > 0) {
          const itemIndex =
            selectedCartItemIndex >= 0 && selectedCartItemIndex < cartItems.length
              ? selectedCartItemIndex
              : cartItems.length - 1;
          const item = cartItems[itemIndex];
          removeFromCart(item.id);
        }
      }

      // Q - Focus quantity input of selected cart item
      if (event.key === "q" || event.key === "Q") {
        event.preventDefault();
        if (cartItems.length > 0) {
          const itemIndex =
            selectedCartItemIndex >= 0 && selectedCartItemIndex < cartItems.length
              ? selectedCartItemIndex
              : cartItems.length - 1;
          const inputRef = cartQuantityInputRefs.current[itemIndex];
          if (inputRef) {
            inputRef.focus();
            inputRef.select();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyboardShortcut);

    return () => {
      document.removeEventListener("keydown", handleKeyboardShortcut);
    };
  }, [
    cartItems,
    paymentMode,
    filteredProducts,
    orderedCategories,
    selectedProductIndex,
    selectedCartItemIndex,
    showPaymentConfirmation
  ]);

  // Reset selected product index when search or category changes
  useEffect(() => {
    setSelectedProductIndex(-1);
    productRefs.current = [];
  }, [searchTerm, selectedCategoryIds]);

  // Auto-save cart before leaving page
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      if (cartItems.length > 0) {
        // Auto-save cart when closing/refreshing
        const cartHistory = {
          cartItems,
          totalDiscountAmount,
          paymentMode,
          selectedCustomer,
          receivedAmount,
          isPartialPayment,
          partialPaymentAmount,
          timestamp: new Date().toISOString()
        };
        localStorage.setItem("pos_cart_history", JSON.stringify(cartHistory));
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [
    cartItems,
    totalDiscountAmount,
    paymentMode,
    selectedCustomer,
    receivedAmount,
    isPartialPayment,
    partialPaymentAmount
  ]);

  // Reset cart selection when cart becomes empty or items change
  useEffect(() => {
    if (cartItems.length === 0) {
      setSelectedCartItemIndex(-1);
    } else if (selectedCartItemIndex >= cartItems.length) {
      setSelectedCartItemIndex(cartItems.length - 1);
    } else if (selectedCartItemIndex === -1 && cartItems.length > 0) {
      setSelectedCartItemIndex(0); // Auto-select first item when cart has items
    }
  }, [cartItems.length]);

  return (
    <div className="flex h-[90vh] bg-gray-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100 gap-4">
      {/* Left Side - Products Grid (40%) */}
      <div className="w-[40%] p-4 surface-panel flex flex-col gap-3 border-r border-gray-300 dark:border-slate-700">
        {/* Search */}
        <div className="mb-2 flex gap-2">
          <div className="relative flex-1">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  searchInputRef.current?.blur();
                }
              }}
              className="w-full px-3 py-2 pr-10 text-sm rounded-lg surface-input"
            />
            {searchTerm && (
              <button
                onClick={() => {
                  setSearchTerm("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-slate-300 hover:text-gray-600 dark:hover:text-white p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                title="Clear search"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => setShowShortcutsModal(true)}
            className="px-3 py-2 bg-gray-200 dark:bg-slate-800 hover:bg-gray-300 dark:hover:bg-slate-700 rounded text-sm font-medium flex items-center gap-1 text-slate-900 dark:text-white"
            title="Keyboard Shortcuts (F12)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
          </button>
        </div>

        {/* Category Selection */}
        <div className="mb-2">
          <div className="space-y-3">
            {/* Selected Categories Tags */}
            {isCategoryFilterActive && (
              <div className="flex flex-wrap items-center gap-2">
                {selectedCategoryIds.map((categoryId) => {
                  const category = categoryMap.get(categoryId);
                  if (!category) return null;
                  return (
                    <span
                      key={categoryId}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full dark:bg-blue-900/40 dark:text-blue-200"
                    >
                      {category.name}
                      <button
                        onClick={() => {
                          setSelectedCategories((prev) => prev.filter((id) => id !== categoryId));
                        }}
                        className="ml-1 hover:bg-blue-200 rounded-full p-0.5"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </span>
                  );
                })}
                <button
                  onClick={() => setSelectedCategories([])}
                  className="text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 underline"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Category Buttons */}
            <div
              className="flex gap-2 overflow-x-auto items-center p-2"
              onWheel={(e) => {
                e.preventDefault();
                e.currentTarget.scrollLeft += e.deltaY;
              }}
            >
              <button
                onClick={() => setShowCustomProductModal(true)}
                className="px-3 py-1.5 bg-green-500 text-white rounded text-sm font-medium whitespace-nowrap hover:bg-green-600 flex items-center gap-1"
              >
                + Custom
              </button>
              <button
                onClick={() => setSelectedCategories([])}
                className={`px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap ${
                  isAllCategoriesActive
                    ? "bg-blue-500 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-700"
                }`}
              >
                {isAllCategoriesSelected ? "All Selected" : "All Items"}
              </button>
              {orderedCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => {
                    setSelectedCategories((prev) => {
                      if (prev.length === 0 || prev.length === categories.length) {
                        return [category.id];
                      }
                      if (prev.includes(category.id)) {
                        return prev.filter((id) => id !== category.id);
                      }
                      return [...prev, category.id];
                    });
                  }}
                  className={`px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap ${
                    isCategoryFilterActive && selectedCategorySet.has(category.id)
                      ? "bg-blue-500 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-700"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-2 gap-3">
            {loading ? (
              <div className="col-span-full flex items-center justify-center h-64">
                <div className="text-gray-400">Loading products...</div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="col-span-full flex items-center justify-center h-64">
                <div className="text-gray-400">No products found</div>
              </div>
            ) : (
              filteredProducts.map((product, index) => {
                const cartItem = cartItemsById.get(product.id);
                const isInCart = Boolean(cartItem);

                // Calculate available stock (total stock - quantity in cart)
                const cartQuantity = cartItem?.quantity ?? 0;
                const availableStock = product.stockLevel - cartQuantity;
                const isOutOfStock = availableStock <= 0;
                const isSelected = selectedProductIndex === index;

                // Determine display price based on payment mode
                const displayPrice =
                  paymentMode === "wholesale" && product.wholesale && product.wholesale > 0
                    ? product.wholesale
                    : paymentMode === "credit" && creditPriceMode === "regular"
                      ? product.price
                      : product.discountedPrice && product.discountedPrice > 0
                        ? product.discountedPrice
                        : product.price;

                const hasDiscount =
                  paymentMode === "wholesale" &&
                  product.wholesale &&
                  product.wholesale > 0 &&
                  product.wholesale < product.price
                    ? true
                    : (paymentMode !== "credit" || creditPriceMode === "discounted") &&
                      product.discountedPrice &&
                      product.discountedPrice > 0 &&
                      product.discountedPrice < product.price;

                return (
                  <button
                    key={product.id}
                    ref={(el) => {
                      productRefs.current[index] = el;
                    }}
                    onClick={() => {
                      if (!isOutOfStock) {
                        addToCart(product);
                      }
                    }}
                    disabled={isOutOfStock}
                    className={`p-4 rounded-lg text-left transition-all ${
                      isOutOfStock && isSelected
                        ? "bg-gray-200 cursor-not-allowed opacity-50 border-2 border-red-500 shadow-lg ring-2 ring-red-300 dark:bg-slate-800 dark:border-red-500 dark:ring-red-500 dark:text-slate-200"
                        : isOutOfStock
                          ? "bg-gray-200 cursor-not-allowed opacity-50 dark:bg-slate-800 dark:text-slate-300"
                          : isSelected
                            ? "bg-blue-100 border-2 border-blue-500 shadow-lg ring-2 ring-blue-300 dark:bg-blue-900/40 dark:border-blue-400 dark:ring-blue-500"
                            : isInCart
                              ? "bg-green-100 border-2 border-green-500 shadow-md dark:bg-green-900/40 dark:border-green-400"
                              : "bg-white hover:bg-gray-50 hover:shadow-md dark:bg-slate-900 dark:border-slate-800 dark:hover:bg-slate-800 dark:text-slate-100"
                    }`}
                  >
                    <div className="flex h-full">
                      <div className="flex-1">
                        <h3
                          className={`font-semibold text-sm mb-1 line-clamp-2 ${
                            isOutOfStock
                              ? "text-gray-400 dark:text-slate-400"
                              : "text-gray-800 dark:text-white"
                          }`}
                        >
                          {product.name}
                        </h3>
                        {product.brand && (
                          <p className="text-xs text-blue-500 dark:text-blue-200 mb-1 line-clamp-1">
                            {product.brand}
                          </p>
                        )}
                        {product.englishName && (
                          <p className="text-xs text-gray-500 dark:text-slate-400 mb-2 line-clamp-1">
                            {product.englishName}
                          </p>
                        )}
                      </div>

                      <div className="mt-auto">
                        {hasDiscount ? (
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-gray-400 dark:text-slate-400 line-through">
                              Rs. {product.price.toFixed(2)}
                            </span>
                            <span className="text-sm font-bold text-green-600 dark:text-green-400">
                              Rs. {displayPrice.toFixed(2)}
                            </span>
                          </div>
                        ) : (
                          <div className="text-sm font-bold text-gray-800 dark:text-white mb-2">
                            Rs. {displayPrice.toFixed(2)}
                          </div>
                        )}

                        <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">
                          {paymentMode === "wholesale" && product.wholesale && product.wholesale > 0
                            ? "Wholesale"
                            : (paymentMode !== "credit" || creditPriceMode === "discounted") &&
                                product.discountedPrice &&
                                product.discountedPrice > 0 &&
                                product.discountedPrice < product.price
                              ? "Discount"
                              : "Regular"}
                        </div>

                        <div className="flex items-center justify-between">
                          <span
                            className={`text-xs ${
                              isOutOfStock
                                ? "text-red-500 font-medium dark:text-red-400"
                                : availableStock < 10
                                  ? "text-orange-500 dark:text-orange-300"
                                  : "text-gray-500 dark:text-slate-400"
                            }`}
                          >
                            {isOutOfStock ? "Out of Stock" : `Stock: ${availableStock}`}
                          </span>
                          {isInCart && cartItem && (
                            <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full font-medium dark:bg-green-600">
                              {cartItem.quantity}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="w-[40%] p-4  flex flex-col gap-4 border-r border-gray-300 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
           
            <h2 className="text-lg font-semibold text-gray-700 dark:text-white">Cart</h2>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200 ml-1 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800">
              <svg
                className="w-4 h-4 mr-1 text-blue-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.35 2.7A2 2 0 0 0 7.48 19h9.04a2 2 0 0 0 1.83-1.3L21 13M7 13V6h13"
                />
              </svg>
              {cartItems.length} {cartItems.length === 1 ? t("item") : t("items")}
            </span>
          </div>
             {cartItems.length > 0 && (
              <button
                onClick={() => saveCartToHistory(true)}
                className="px-3 py-1.5 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg text-xs font-semibold hover:from-green-600 hover:to-green-700 transition-all shadow-sm flex items-center gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                  />
                </svg>
                {t("Save Cart")}
              </button>
            )}
        </div>
        <div className="mb-2">
          <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-600 dark:text-slate-300 border-b pb-2 dark:border-slate-700">
            <div className="col-span-5">Item</div>
            <div className="col-span-2 text-center">Qty</div>
            <div className="col-span-2 text-right">Each</div>
            <div className="col-span-3 text-right">Total</div>
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto mb-2">
          {cartItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-slate-400">
              No items in cart
            </div>
          ) : (
            <div className="space-y-1">
              {cartItems.map((item, index) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedCartItemIndex(index)}
                  className={`grid grid-cols-12 gap-2 items-center py-2 rounded text-sm cursor-pointer transition-colors ${
                    selectedCartItemIndex === index
                      ? "bg-blue-50 border-l-4 border-blue-500 pl-2 dark:bg-blue-900/40 dark:border-blue-400"
                      : "hover:bg-gray-50 dark:hover:bg-slate-900/60"
                  }`}
                >
                  <div className="col-span-5">
                    <div className="font-medium">{item.name}</div>
                    {item.unit && <div className="text-xs text-gray-500">{item.unit}</div>}
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-6 h-6 flex items-center justify-center bg-gray-200 dark:bg-slate-700 rounded hover:bg-gray-300 dark:hover:bg-slate-600"
                    >
                      -
                    </button>
                    <input
                      ref={(el) => {
                        cartQuantityInputRefs.current[index] = el;
                      }}
                      type="number"
                      value={item.quantity}
                      onChange={(e) => {
                        const newQty = parseFloat(e.target.value);
                        if (!isNaN(newQty) && newQty > 0) {
                          updateQuantity(item.id, newQty);
                        }
                      }}
                      onBlur={(e) => {
                        if (!e.target.value || parseFloat(e.target.value) <= 0) {
                          updateQuantity(item.id, 1);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="w-12 text-center border border-gray-300 rounded py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      step="1"
                    />
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-6 h-6 flex items-center justify-center bg-gray-200 dark:bg-slate-700 rounded hover:bg-gray-300 dark:hover:bg-slate-600"
                    >
                      +
                    </button>
                  </div>
                  <div className="col-span-2 text-right text-slate-900 dark:text-slate-100">
                    Rs. {item.price.toFixed(2)}
                  </div>
                  <div className="col-span-3 text-right font-medium text-slate-900 dark:text-slate-100">
                    Rs. {item.total.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-[20%] p-2  flex flex-col shadow-lg">
        {/* Payment Mode Section */}
        <div className="mb-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Payment Method
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaymentMode("cash")}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                paymentMode === "cash"
                  ? "bg-blue-500 text-white shadow-md transform scale-105 dark:bg-blue-600 dark:text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 border border-gray-200"
              }`}
            >
              Cash
            </button>
            <button
              onClick={() => setPaymentMode("card")}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                paymentMode === "card"
                  ? "bg-blue-500 text-white shadow-md transform scale-105 dark:bg-blue-600 dark:text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 border border-gray-200"
              }`}
            >
              Card
            </button>
            <button
              onClick={() => setPaymentMode("credit")}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                paymentMode === "credit"
                  ? "bg-blue-500 text-white shadow-md transform scale-105 dark:bg-blue-600 dark:text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 border border-gray-200"
              }`}
            >
              Credit
            </button>
            <button
              onClick={() => setPaymentMode("wholesale")}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                paymentMode === "wholesale"
                  ? "bg-blue-500 text-white shadow-md transform scale-105 dark:bg-blue-600 dark:text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 border border-gray-200"
              }`}
            >
              Wholesale
            </button>
          </div>
          <div className="mt-2">
            {paymentMode === "credit" && (
            <div className="mb-3">
              <label className="text-xs font-semibold text-gray-500  tracking-wide ">
                {t("What price use for this sale")}
              </label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  onClick={() => setCreditPriceMode("discounted")}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    creditPriceMode === "discounted"
                      ? "bg-blue-500 text-white shadow-sm dark:bg-blue-600"
                      : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 border border-gray-200"
                  }`}
                >
                  {t("Discounted")}
                </button>
                <button
                  onClick={() => setCreditPriceMode("regular")}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    creditPriceMode === "regular"
                      ? "bg-blue-500 text-white shadow-sm dark:bg-blue-600"
                      : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 border border-gray-200"
                  }`}
                >
                  {t("Regular")}
                </button>
              </div>
            </div>
          )}
          </div>
        </div>

        <div className="flex-1"></div>

        {/* Discount Section */}
        <div className="mb-2 surface-card p-4 rounded-xl shadow-sm">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Apply Discount
          </h3>

          <div className="flex gap-2 mb-4 w-full min-w-0">
            <select
              value={bulkDiscountType}
              onChange={(e) => setBulkDiscountType(e.target.value as "percentage" | "amount")}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent flex-shrink-0"
            >
              <option value="percentage">%</option>
              <option value="amount">Rs.</option>
            </select>

            <input
              ref={discountInputRef}
              type="number"
              placeholder="Amount"
              value={bulkDiscountValue}
              onChange={(e) => setBulkDiscountValue(parseFloat(e.target.value) || 0)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                  applyBulkDiscount();
                }
              }}
              className="min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={applyBulkDiscount}
              className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors shadow-sm"
            >
              Apply
            </button>
            <button
              onClick={clearAllDiscounts}
              className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors shadow-sm"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Summary Section */}
        <div className="mb-2 surface-card p-4 rounded-xl shadow-sm">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Order Summary
          </h3>
          <div className="space-y-3">
            {/* Customer Selection (required only for credit sales) */}
            <div className="mb-3 pb-3 border-b border-gray-200">
              <label className="block text-xs font-medium text-gray-700 mb-2">
                {t("Select Customer")}{" "}
                {paymentMode === "credit" && <span className="text-red-500">*</span>}
              </label>
              <div className="relative customer-dropdown-container">
                <input
                  type="text"
                  placeholder={t("Search customer...")}
                  value={customerSearchTerm}
                  onChange={(e) => setCustomerSearchTerm(e.target.value)}
                  onFocus={() => setShowCustomerDropdown(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg surface-input"
                />
                {showCustomerDropdown && (
                  <div className="absolute z-50 w-full mt-1 surface-card rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    <button
                      onClick={() => {
                        setShowCustomerModal(true);
                        setShowCustomerDropdown(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 border-b border-gray-100 font-medium dark:bg-transparent dark:text-blue-200 dark:hover:bg-slate-900/70 dark:border-slate-700"
                    >
                      + {t("Add New Customer")}
                    </button>
                    {customers
                      .filter((customer) =>
                        customer.name.toLowerCase().includes(customerSearchTerm.toLowerCase())
                      )
                      .map((customer) => (
                        <button
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomer(customer.id);
                            setCustomerSearchTerm(customer.name);
                            setShowCustomerDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-900/70 ${
                            selectedCustomer === customer.id
                              ? "bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200"
                              : "dark:text-slate-100"
                          }`}
                        >
                          <div className="font-medium">{customer.name}</div>
                          {customer.phone && (
                            <div className="text-xs text-gray-500">{customer.phone}</div>
                          )}
                        </button>
                      ))}
                    {customers.filter((customer) =>
                      customer.name.toLowerCase().includes(customerSearchTerm.toLowerCase())
                    ).length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-slate-400 text-center">
                        {t("No customers found")}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {selectedCustomer && (
                <button
                  onClick={() => {
                    setSelectedCustomer("");
                    setCustomerSearchTerm("");
                  }}
                  className="mt-2 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                >
                  {t("Clear Selection")}
                </button>
              )}
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-slate-400">Subtotal</span>
              <span className="text-sm font-semibold text-gray-800 dark:text-white">
                Rs. {originalSubtotal.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-slate-400">Discount</span>
              <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                - Rs. {totalDiscountAmount.toFixed(2)}
              </span>
            </div>
            <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-gray-800 dark:text-white">TOTAL</span>
                <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
                  Rs. {currentTotal.toFixed(2)}
                </span>
              </div>
            </div>
            {(paymentMode === "cash" || paymentMode === "wholesale") && (
              <div className="pt-2">
                <input
                  ref={receivedAmountRef}
                  type="number"
                  placeholder="Amount Received"
                  value={receivedAmount}
                  onChange={(e) => setReceivedAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full px-3 py-2.5 text-sm rounded-lg surface-input"
                />
                {paymentMode === "cash" && receivedAmount && (
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200 dark:border-slate-700">
                    <span className="text-sm text-gray-600 dark:text-slate-400">Change</span>
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                      Rs. {(parseFloat(receivedAmount) - currentTotal).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )}
            {paymentMode === "credit" && (
              <div className="pt-2">
                <label className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    checked={isPartialPayment}
                    onChange={(e) => setIsPartialPayment(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700">{t("Partial Payment")}</span>
                </label>
                {isPartialPayment && (
                  <input
                    type="number"
                    placeholder={t("Amount Received")}
                    value={partialPaymentAmount}
                    onChange={(e) => setPartialPaymentAmount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-full px-3 py-2.5 text-sm rounded-lg surface-input"
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={clearCart}
              className="px-4 py-3.5 bg-white border-2 border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors shadow-sm dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
            >
              Clear
            </button>

            <button
              type="button"
              onClick={openPaymentConfirmation}
              className="px-4 py-3.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg text-sm font-semibold shadow-md transition-all transform hover:from-blue-600 hover:to-blue-700 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:hover:from-blue-500 disabled:hover:to-blue-500"
              disabled={isPayButtonLoading}
            >
              {isPayButtonLoading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="relative h-4 w-4">
                    <span className="absolute inset-0 rounded-full border-2 border-white/30" />
                    <span className="absolute inset-0 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </span>
                  <span className="text-sm font-semibold tracking-wide">
                    Processing
                    <span className="animate-pulse">…</span>
                  </span>
                </span>
              ) : (
                "Pay"
              )}
            </button>
          </div>
        </div>
      </div>

      {showQuantityModal && selectedProductForQuantity && (
        <div
          className="fixed inset-0  bg-opacity-50 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="surface-card rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">{t("Enter Quantity")}</h3>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                {t("Product")}:{" "}
                <span className="font-medium">{selectedProductForQuantity.name}</span>
              </p>
              <p className="text-sm text-gray-600 mb-4">
                {t("Available Stock")}:{" "}
                <span className="font-medium">{selectedProductForQuantity.stockLevel}</span>
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("Quantity")} <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={quantityInput}
                onChange={(e) => setQuantityInput(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg surface-input"
                placeholder={t("Enter quantity")}
                step="1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                    handleQuantityConfirm();
                  }
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleQuantityConfirm}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t("Add to Cart")}
              </button>
              <button
                onClick={() => {
                  setShowQuantityModal(false);
                  setSelectedProductForQuantity(null);
                  setQuantityInput("1");
                }}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCustomProductModal && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="surface-card rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">{t("Add Custom Product")}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("Product Name")} <span className="text-red-500">*</span>
                </label>
                <input
                  ref={customProductNameRef}
                  type="text"
                  value={customProductData.name}
                  onChange={(e) =>
                    setCustomProductData({ ...customProductData, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      customProductQuantityRef.current?.focus();
                      customProductQuantityRef.current?.select();
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg surface-input"
                  placeholder={t("Enter product name")}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("Quantity")} <span className="text-red-500">*</span>
                </label>
                <input
                  ref={customProductQuantityRef}
                  type="number"
                  value={customProductData.quantity}
                  onChange={(e) =>
                    setCustomProductData({ ...customProductData, quantity: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      customProductPriceRef.current?.focus();
                      customProductPriceRef.current?.select();
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg surface-input"
                  placeholder={t("Enter quantity")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("Price")} <span className="text-red-500">*</span>
                </label>
                <input
                  ref={customProductPriceRef}
                  type="number"
                  value={customProductData.price}
                  onChange={(e) =>
                    setCustomProductData({ ...customProductData, price: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomProduct();
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg surface-input"
                  placeholder={t("Enter price")}
                  min="0.01"
                  step="0.01"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAddCustomProduct}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t("Add to Cart")}
              </button>
              <button
                onClick={() => {
                  setShowCustomProductModal(false);
                  setCustomProductData({ name: "වෙනත්", quantity: "1", price: "" });
                }}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showShortcutsModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="surface-card rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">{t("Keyboard Shortcuts")}</h3>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-white"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold text-lg mb-3 text-blue-600">{t("Payment Methods")}</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Cash Payment")}</span>
                    <kbd className="surface-kbd">F1</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Card Payment")}</span>
                    <kbd className="surface-kbd">F2</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Credit Payment")}</span>
                    <kbd className="surface-kbd">F3</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Wholesale Payment")}</span>
                    <kbd className="surface-kbd">F4</kbd>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-lg mb-3 text-green-600">{t("Actions")}</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Process Payment")}</span>
                    <kbd className="surface-kbd">Ctrl + P</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Save Cart")}</span>
                    <kbd className="surface-kbd">Ctrl + S</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Clear Cart")}</span>
                    <kbd className="surface-kbd">Ctrl + Shift + D</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Add Custom Product")}</span>
                    <kbd className="surface-kbd">Ctrl + N</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Add Customer")}</span>
                    <kbd className="surface-kbd">Ctrl + K</kbd>
                  </div>
                </div>
              </div>

              {/* Product Navigation */}
              <div>
                <h4 className="font-semibold text-lg mb-3 text-cyan-600">
                  {t("Product Navigation")}
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Navigate Down")}</span>
                    <kbd className="surface-kbd">↓</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Navigate Up")}</span>
                    <kbd className="surface-kbd">↑</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Add to Cart")}</span>
                    <kbd className="surface-kbd">Enter</kbd>
                  </div>
                  <div className="p-2 bg-cyan-50 rounded border border-cyan-200">
                    <p className="text-xs text-cyan-800">
                      <strong>{t("Tip:")} </strong>
                      {t("Use arrow keys to browse products, Enter to add selected")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Cart Controls */}
              <div>
                <h4 className="font-semibold text-lg mb-3 text-emerald-600">
                  {t("Cart Controls")}
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Previous Item")}</span>
                    <kbd className="surface-kbd">←</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Next Item")}</span>
                    <kbd className="surface-kbd">→</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Increase Quantity")}</span>
                    <kbd className="surface-kbd">+ or =</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Decrease Quantity")}</span>
                    <kbd className="surface-kbd">-</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Edit Quantity")}</span>
                    <kbd className="surface-kbd">Q</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Remove Item")}</span>
                    <kbd className="surface-kbd">Backspace</kbd>
                  </div>
                </div>
              </div>

              {/* Input Focus */}
              <div>
                <h4 className="font-semibold text-lg mb-3 text-indigo-600">{t("Quick Focus")}</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Search Products")}</span>
                    <kbd className="surface-kbd">Ctrl + F</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Received Amount")}</span>
                    <kbd className="surface-kbd">Ctrl + A</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Discount Input")}</span>
                    <kbd className="surface-kbd">Ctrl + D</kbd>
                  </div>
                </div>
              </div>

              {/* Category Selection */}
              <div>
                <h4 className="font-semibold text-lg mb-3 text-pink-600">{t("Categories")}</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("All Items")}</span>
                    <kbd className="surface-kbd">Alt + 0</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Category 1-9")}</span>
                    <kbd className="surface-kbd">Alt + 1-9</kbd>
                  </div>
                  <div className="p-2 bg-yellow-50 rounded border border-yellow-200">
                    <p className="text-xs text-yellow-800">
                      <strong>{t("Note:")} </strong>
                      {t("Alt + 1 selects first category, Alt + 2 second, etc.")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <div>
                <h4 className="font-semibold text-lg mb-3 text-purple-600">{t("Navigation")}</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Close Modal")}</span>
                    <kbd className="surface-kbd">Esc</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Show Shortcuts")}</span>
                    <kbd className="surface-kbd">F12</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Show Shortcuts (Alt)")}</span>
                    <kbd className="surface-kbd">Ctrl + /</kbd>
                  </div>
                </div>
              </div>

              {/* Enter Key Shortcuts */}
              <div>
                <h4 className="font-semibold text-lg mb-3 text-orange-600">{t("Enter Key")}</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Blur Input")}</span>
                    <kbd className="surface-kbd">Enter</kbd>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-gray-50 rounded dark:bg-slate-800">
                    <span className="text-sm">{t("Apply Discount")}</span>
                    <kbd className="surface-kbd">Enter (Discount)</kbd>
                  </div>
                  <div className="p-2 bg-blue-50 rounded border border-blue-200">
                    <p className="text-xs text-blue-800">
                      <strong>{t("Tip:")} </strong>
                      {t("Press Enter in any input to remove focus and continue with keyboard")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Pro Tips */}
              <div className="md:col-span-2">
                <h4 className="font-semibold text-lg mb-3 text-teal-600">{t("Pro Tips")}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-900">
                      <strong>💡 {t("Stock Updates:")}</strong>{" "}
                      {t("Available stock shows in real-time as you add items to cart")}
                    </p>
                  </div>
                  <div className="p-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
                    <p className="text-xs text-green-900">
                      <strong>💡 {t("Cart Navigation:")}</strong>{" "}
                      {t("Click any cart item to select it, then use ← → to adjust quantity")}
                    </p>
                  </div>
                  <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
                    <p className="text-xs text-purple-900">
                      <strong>💡 {t("Fast Entry:")}</strong>{" "}
                      {t("In Custom Product modal, use Enter to move between fields")}
                    </p>
                  </div>
                  <div className="p-3 bg-gradient-to-r from-orange-50 to-yellow-50 rounded-lg border border-orange-200">
                    <p className="text-xs text-orange-900">
                      <strong>💡 {t("Quick Payment:")}</strong>{" "}
                      {t("Enter amount and press Enter in Received Amount field to process")}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t("Got it!")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCustomerModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="surface-card rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">{t("Add New Customer")}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("Name")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={customerFormData.name}
                  onChange={(e) =>
                    setCustomerFormData({ ...customerFormData, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg surface-input"
                  placeholder={t("Enter customer name")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("Phone")}</label>
                <input
                  type="text"
                  value={customerFormData.phone}
                  onChange={(e) =>
                    setCustomerFormData({ ...customerFormData, phone: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg surface-input"
                  placeholder={t("Enter phone number")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("Email")}</label>
                <input
                  type="email"
                  value={customerFormData.email}
                  onChange={(e) =>
                    setCustomerFormData({ ...customerFormData, email: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg surface-input"
                  placeholder={t("Enter email address")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("Address")}
                </label>
                <textarea
                  value={customerFormData.address}
                  onChange={(e) =>
                    setCustomerFormData({ ...customerFormData, address: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg surface-input"
                  placeholder={t("Enter address")}
                  rows={3}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAddCustomer}
                disabled={isAddingCustomer}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isAddingCustomer ? t("Adding...") : t("Add Customer")}
              </button>
              <button
                onClick={() => {
                  setShowCustomerModal(false);
                  setCustomerFormData({ name: "", phone: "", email: "", address: "" });
                }}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Cart Prompt Modal */}
      {showRestorePrompt && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="surface-card rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6 text-blue-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold">{t("Restore Previous Cart?")}</h3>
            </div>
            <p className="text-gray-600 mb-6">
              {t("You have a saved cart from a previous session. Would you like to restore it?")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={restoreCartFromHistory}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                {t("Restore Cart")}
              </button>
              <button
                onClick={clearCartHistory}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 font-medium"
              >
                {t("Start Fresh")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Cart Modal (before leaving) */}
      {showCartHistoryModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="surface-card rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6 text-orange-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold">{t("Save Cart Before Leaving?")}</h3>
            </div>
            <p className="text-gray-600 mb-6">
              {t("You have items in your cart. Would you like to save them for later?")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  saveCartToHistory(true);
                  setShowCartHistoryModal(false);
                }}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                {t("Save Cart")}
              </button>
              <button
                onClick={() => setShowCartHistoryModal(false)}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 font-medium"
              >
                {t("Don't Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment confirmation modal */}
      {showPaymentConfirmation && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="surface-card rounded-lg p-6 w-96 flex flex-col">
            <h3 className="text-lg font-semibold mb-4 text-center">Confirm Payment</h3>
            <p className="text-gray-600 mb-6 text-center">Choose how you want to print the bill:</p>
            <div className="flex flex-col gap-3">
              <button
                className="bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded"
                onClick={() => {
                  setShowPaymentConfirmation(false);
                  processPaymentRef.current();
                }}
              >
                Print with Receipt <span className="text-xs opacity-75">(Enter or P)</span>
              </button>
              <button
                className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded"
                onClick={() => {
                  setShowPaymentConfirmation(false);
                  processPaymentRef.current(true);
                }}
              >
                Print without Receipt <span className="text-xs opacity-75">(N)</span>
              </button>
              <button
                className="bg-gray-500 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded"
                onClick={cancelPaymentConfirmation}
              >
                Cancel <span className="text-xs opacity-75">(Esc)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default POSSystem2;
