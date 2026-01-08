import { formatToThreeDecimalPlaces } from "@renderer/lib/quantityValidation";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { useAppData } from "../contexts/AppDataContext";
import { useTranslation } from "../contexts/LanguageContext";

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
  // Relations
  category?: Category;
  images?: ProductImage[];
  productTags?: ProductTagMap[];
}

interface Category {
  id: string;
  name: string;
  parentCategoryId?: string;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  parentCategory?: Category;
  subCategories?: Category[];
}

interface ProductImage {
  id: string;
  productId: string;
  url: string;
  altText?: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductTag {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductTagMap {
  productId: string;
  tagId: string;
  createdAt: Date;
  product?: Product;
  tag?: ProductTag;
}

interface FormErrors {
  name?: string;
  englishName?: string;
  sku?: string;
  barcode?: string;
  price?: string;
  costPrice?: string;
  discountedPrice?: string;
  wholesale?: string;
  taxRate?: string;
  stockLevel?: string;
  categoryId?: string;
  description?: string;
  brand?: string;
  unitSize?: string;
  unitType?: string;
  unit?: string;
}

type SortField = "name" | "price" | "category" | "stock" | "createdAt";
type SortDirection = "asc" | "desc";
type ProductFilters = {
  searchTerm?: string;
  categoryId?: string;
  stockFilter?: "all" | "inStock" | "outOfStock";
  minPrice?: number;
  maxPrice?: number;
};

const ProductManagement: React.FC = () => {
  const { t } = useTranslation();
  const { products: allProducts, categories, refreshProducts, refreshCategories } = useAppData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    englishName: "",
    sku: "",
    barcode: "",
    description: "",
    brand: "",
    price: 0,
    costPrice: 0,
    discountedPrice: 0,
    wholesale: 0,
    taxRate: 0,
    taxInclusivePrice: 0,
    unitSize: "",
    unitType: "",
    unit: "",
    categoryId: "",
    stockLevel: 0
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // Filter and search states
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "inStock" | "outOfStock">("all");
  const [priceRange, setPriceRange] = useState({ min: "", max: "" });
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchTerm]);

  const productFilters = useMemo<ProductFilters>(() => {
    const filters: ProductFilters = {};

    if (debouncedSearchTerm) {
      filters.searchTerm = debouncedSearchTerm;
    }

    if (categoryFilter) {
      filters.categoryId = categoryFilter;
    }

    if (stockFilter !== "all") {
      filters.stockFilter = stockFilter;
    }

    const minPrice = Number.parseFloat(priceRange.min);
    if (Number.isFinite(minPrice)) {
      filters.minPrice = minPrice;
    }

    const maxPrice = Number.parseFloat(priceRange.max);
    if (Number.isFinite(maxPrice)) {
      filters.maxPrice = maxPrice;
    }

    return filters;
  }, [debouncedSearchTerm, categoryFilter, stockFilter, priceRange.min, priceRange.max]);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Category dropdown state
  const [categorySearchTerm, setCategorySearchTerm] = useState("");
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement | null>(null);

  // Scanner states
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [scannerStatus, setScannerStatus] = useState<"idle" | "scanning" | "connected">("idle");
  const [isScanningBarcode, setIsScanningBarcode] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false); // Toggle between barcode input mode and search mode

  // Ensure TypeScript recognizes scanner state usage
  useEffect(() => {
    // Dummy usage to ensure TypeScript recognizes the setters
    setScannerEnabled(scannerEnabled);
    setScannerStatus(scannerStatus);
  }, [scannerEnabled, scannerStatus, setScannerEnabled, setScannerStatus]);

  const filteredCategoryOptions = useMemo(() => {
    if (!categorySearchTerm.trim()) {
      return categories;
    }
    const query = categorySearchTerm.trim().toLowerCase();
    return categories.filter((category) => category.name.toLowerCase().includes(query));
  }, [categories, categorySearchTerm]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(event.target as Node)
      ) {
        setIsCategoryDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isCategoryDropdownOpen) {
      const selectedCategory = categories.find((category) => category.id === formData.categoryId);
      setCategorySearchTerm(selectedCategory ? selectedCategory.name : "");
    }
  }, [categories, formData.categoryId, isCategoryDropdownOpen]);

  useEffect(() => {
    if (!isCategoryDropdownOpen) {
      return;
    }

    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCategoryDropdownOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscKey);
    return () => {
      document.removeEventListener("keydown", handleEscKey);
    };
  }, [isCategoryDropdownOpen]);

  const fetchProducts = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const pagination = {
        skip: (currentPage - 1) * itemsPerPage,
        take: itemsPerPage
      };
      const [data, total] = await Promise.all([
        window.api.products.findMany({
          filters: productFilters,
          pagination,
          sort: { field: sortField, direction: sortDirection },
          bypassCache: true
        }),
        window.api.products.count(productFilters)
      ]);

      setProducts(data);
      setTotalProducts(total);
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error(t("Failed to load products. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, productFilters, sortField, sortDirection, t]);

  const fetchCategories = useCallback(async (): Promise<void> => {
    try {
      await refreshCategories({ force: true });
    } catch (error) {
      console.error("Error fetching categories:", error);
      toast.error(t("Failed to load categories. Please try again."));
    }
  }, [refreshCategories, t]);

  useEffect(() => {
    void fetchCategories();

    // Initialize scanner status
    const initializeScanner = async () => {
      try {
        if (window.api?.scanner?.getDevices) {
          const devices = await window.api.scanner.getDevices();
          if (devices && devices.length > 0) {
            setScannerStatus("connected");
          }
        }
      } catch (error) {
        console.error("Error initializing scanner:", error);
        setScannerStatus("idle");
      }
    };

    initializeScanner();
  }, [fetchCategories]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const openModal = (): void => {
    setIsModalOpen(true);
    setIsEditing(false);
    setEditingId(null);
    setFormData({
      name: "",
      englishName: "",
      sku: "",
      barcode: "",
      description: "",
      brand: "",
      price: 0,
      costPrice: 0,
      discountedPrice: 0,
      wholesale: 0,
      taxRate: 0,
      taxInclusivePrice: 0,
      unitSize: "",
      unitType: "",
      unit: "",
      categoryId: "",
      stockLevel: 0
    });
    setCategorySearchTerm("");
    setIsCategoryDropdownOpen(false);
    setErrors({});
  };

  const closeModal = useCallback((): void => {
    setIsModalOpen(false);
    setFormData({
      name: "",
      englishName: "",
      sku: "",
      barcode: "",
      description: "",
      brand: "",
      price: 0,
      costPrice: 0,
      discountedPrice: 0,
      wholesale: 0,
      taxRate: 0,
      taxInclusivePrice: 0,
      unitSize: "",
      unitType: "",
      unit: "",
      categoryId: "",
      stockLevel: 0
    });
    setCategorySearchTerm("");
    setIsCategoryDropdownOpen(false);
    setErrors({});
    setIsEditing(false);
    setEditingId(null);
  }, []);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && isModalOpen) {
        closeModal();
      }
    };

    document.addEventListener("keydown", handleEscKey);
    return () => {
      document.removeEventListener("keydown", handleEscKey);
    };
  }, [isModalOpen, closeModal]);

  // Scanner functionality
  const handleScannedBarcode = useCallback(
    (data: any) => {
      if (!isScanningBarcode) return;

      if (data && data.data) {
        const scannedCode = data.data.trim();

        if (isSearchMode) {
          // Search mode: Set search term to find products with this barcode
          setSearchTerm(scannedCode);
          setIsScanningBarcode(false);
          toast.success(`🔍 Searching for barcode: ${scannedCode}`, {
            duration: 2000,
            position: "top-center"
          });
        } else {
          // Input mode: Fill barcode field in the form
          setFormData((prev) => ({ ...prev, barcode: scannedCode }));
          setIsScanningBarcode(false);
          toast.success(`📷 Barcode scanned: ${scannedCode}`, {
            duration: 2000,
            position: "top-center"
          });
        }
      }
    },
    [isScanningBarcode, isSearchMode]
  );

  // Scanner event listeners
  useEffect(() => {
    if (!scannerEnabled || !isScanningBarcode) return;

    const handleData = (data: any) => {
      handleScannedBarcode(data);
    };

    if (window.api?.scanner) {
      window.api.scanner.onData(handleData);
    }

    return () => {
      if (window.api?.scanner) {
        window.api.scanner.removeAllListeners?.();
      }
    };
  }, [scannerEnabled, isScanningBarcode, handleScannedBarcode]);

  const startBarcodeScan = async (): Promise<void> => {
    try {
      if (!scannerEnabled) {
        toast.error(t("Scanner is not enabled"));
        return;
      }

      setIsScanningBarcode(true);
      setIsSearchMode(true); // Enable search mode by default
      toast(`🔍 Ready to scan barcode for product search.`, {
        duration: 3000,
        position: "top-center"
      });
    } catch (error) {
      console.error("Error starting barcode scan:", error);
      toast.error(t("Failed to start barcode scanning"));
    }
  };

  const startBarcodeInputScan = async (): Promise<void> => {
    try {
      if (!scannerEnabled) {
        toast.error(t("Scanner is not enabled"));
        return;
      }

      setIsScanningBarcode(true);
      setIsSearchMode(false); // Disable search mode for input
      toast(`📷 Ready to scan barcode for input. Point scanner at barcode.`, {
        duration: 3000,
        position: "top-center"
      });
    } catch (error) {
      console.error("Error starting barcode scan:", error);
      toast.error(t("Failed to start barcode scanning"));
    }
  };

  const stopBarcodeScan = (): void => {
    setIsScanningBarcode(false);
    toast(t("Barcode scanning stopped"));
  };

  const hasActiveFilters =
    debouncedSearchTerm.length > 0 ||
    categoryFilter.length > 0 ||
    stockFilter !== "all" ||
    priceRange.min.length > 0 ||
    priceRange.max.length > 0;

  // Calculate pagination
  const totalPages = totalProducts > 0 ? Math.ceil(totalProducts / itemsPerPage) : 0;
  const startIndex = totalProducts === 0 ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex =
    totalProducts === 0 ? 0 : Math.min(startIndex + itemsPerPage, totalProducts);

  useEffect(() => {
    if (totalProducts === 0) {
      if (currentPage !== 1) {
        setCurrentPage(1);
      }
      return;
    }

    const lastPage = Math.max(1, Math.ceil(totalProducts / itemsPerPage));
    if (currentPage > lastPage) {
      setCurrentPage(lastPage);
    }
  }, [currentPage, itemsPerPage, totalProducts]);

  // Pagination handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1); // Reset to first page when changing items per page
  };

  // Handle sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, categoryFilter, stockFilter, priceRange.min, priceRange.max]);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = t("Product name is required");
    } else if (formData.name.trim().length < 2) {
      newErrors.name = t("Product name must be at least 2 characters");
    }

    if (formData.sku && formData.sku.trim()) {
      const isDuplicateSku = allProducts.some(
        (product) => product.sku === formData.sku.trim() && product.id !== editingId
      );
      if (isDuplicateSku) {
        newErrors.sku = t("A product with this SKU already exists");
      }
    }

    if (formData.price <= 0) {
      newErrors.price = t("Price must be greater than 0");
    }

    if (formData.costPrice < 0) {
      newErrors.costPrice = t("Cost price cannot be negative");
    }

    if (!formData.categoryId) {
      newErrors.categoryId = t("Category is required");
    }

    if (formData.discountedPrice && formData.discountedPrice >= formData.price) {
      newErrors.discountedPrice = t("Discounted price must be less than regular price");
    }

    if (formData.wholesale !== undefined && formData.wholesale !== null && formData.wholesale < 0) {
      newErrors.wholesale = t("Wholesale price cannot be negative");
    }

    if (
      formData.wholesale !== undefined &&
      formData.wholesale !== null &&
      formData.wholesale >= formData.price
    ) {
      newErrors.wholesale = t("Wholesale price must be less than regular price");
    }

    if (formData.taxRate && (formData.taxRate < 0 || formData.taxRate > 100)) {
      newErrors.taxRate = t("Tax rate must be between 0 and 100");
    }

    if (
      formData.unitType &&
      !["Weight", "Volume", "Count", "Length", "Custom"].includes(formData.unitType)
    ) {
      newErrors.unitType = t("Please select a valid unit type");
    }

    // Unit validation - ensure a valid unit is selected
    if (formData.unit && formData.unit.trim() === "") {
      newErrors.unit = t("Please select a valid unit");
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      const productData = {
        name: formData.name.trim(),
        englishName: formData.englishName.trim() || undefined,
        sku: formData.sku.trim() || undefined,
        barcode: formData.barcode.trim() || undefined,
        description: formData.description.trim() || undefined,
        brand: formData.brand.trim() || undefined,
        price: Number(formData.price),
        costPrice: Number(formData.costPrice),
        discountedPrice: formData.discountedPrice ? Number(formData.discountedPrice) : null,
        wholesale:
          formData.wholesale !== undefined && formData.wholesale !== null
            ? Number(formData.wholesale)
            : undefined,
        taxRate: formData.taxRate ? Number(formData.taxRate) : undefined,
        unitSize: formData.unitSize.trim() || undefined,
        unitType: formData.unitType.trim() || undefined,
        unit: formData.unit.trim() || undefined,
        categoryId: formData.categoryId,
        stockLevel: formatToThreeDecimalPlaces(formData.stockLevel) || 0
      };

      if (isEditing && editingId) {
        // Get the current product to check stock level change
        const currentProduct = allProducts.find((p) => p.id === editingId);
        const currentStockLevel = currentProduct?.stockLevel || 0;
        const newStockLevel = formatToThreeDecimalPlaces(formData.stockLevel) || 0;
        const stockDifference = newStockLevel - currentStockLevel;

        // Update the product
        await window.api.products.update(editingId, productData);

        // Create stock transaction if stock level changed
        if (stockDifference !== 0) {
          // Calculate the correct change quantity based on stock difference
          // Positive difference (stock increased) = IN with positive changeQty
          // Negative difference (stock decreased) = OUT with negative changeQty
          const changeQty = stockDifference > 0 ? stockDifference : stockDifference; // Keep sign as is

          await window.api.stockTransactions.create({
            productId: editingId,
            type: stockDifference > 0 ? "IN" : "OUT",
            changeQty: changeQty,
            reason: stockDifference > 0 ? "stock_in" : "stock_out",
            relatedInvoiceId: undefined
          });
          toast.success(t("Product and inventory updated successfully!"));
        } else {
          toast.success(t("Product updated successfully!"));
        }
      } else {
        // Create new product
        const newProduct = await window.api.products.create(productData);

        // Create initial stock transaction if stock level > 0
        if (newProduct && newProduct.id && formData.stockLevel > 0) {
          await window.api.stockTransactions.create({
            productId: newProduct.id,
            type: "IN",
            changeQty: formatToThreeDecimalPlaces(formData.stockLevel),
            reason: "stock_in",
            relatedInvoiceId: undefined
          });
          toast.success(t("Product created with initial stock!"));
        } else {
          toast.success(t("Product created successfully!"));
        }
      }

      closeModal();
      await Promise.all([fetchProducts(), refreshProducts({ force: true })]);
    } catch (error) {
      console.error("Error saving product:", error);
      toast.error(t("Failed to save product. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (product: Product): void => {
    setFormData({
      name: product.name,
      englishName: product.englishName || "",
      sku: product.sku || "",
      barcode: product.barcode || "",
      description: product.description || "",
      brand: product.brand || "",
      price: product.price,
      costPrice: product.costPrice ?? 0,
      discountedPrice: product.discountedPrice || 0,
      wholesale: product.wholesale || 0,
      taxRate: product.taxRate || 0,
      taxInclusivePrice: product.taxInclusivePrice || 0,
      unitSize: product.unitSize || "",
      unitType: product.unitType || "",
      unit: product.unit || product.unitSize || "",
      categoryId: product.categoryId,
      stockLevel: product.stockLevel || 0
    });
    const selectedCategory = categories.find((category) => category.id === product.categoryId);
    setCategorySearchTerm(selectedCategory ? selectedCategory.name : "");
    setIsCategoryDropdownOpen(false);
    setIsEditing(true);
    setEditingId(product.id);
    setIsModalOpen(true);
    setErrors({});
  };

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!confirm(t('Are you sure you want to delete the product "{name}"?', { name }))) {
      return;
    }

    try {
      setLoading(true);
      await window.api.products.delete(id);
      toast.success(t("Product deleted successfully!"));
      await Promise.all([fetchProducts(), refreshProducts({ force: true })]);
    } catch (error) {
      console.error("Error deleting product:", error);
      toast.error(t("Failed to delete product. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  // Calculate stats
  const getStats = () => {
    const totalValue = allProducts.reduce(
      (sum, product) => sum + product.price * product.stockLevel,
      0
    );
    const totalStock = allProducts.reduce((sum, product) => sum + product.stockLevel, 0);
    const outOfStock = allProducts.filter((product) => product.stockLevel === 0).length;
    const averagePrice =
      allProducts.length > 0
        ? allProducts.reduce((sum, product) => sum + product.price, 0) / allProducts.length
        : 0;

    return { totalValue, totalStock, outOfStock, averagePrice };
  };

  const stats = getStats();

  // Invoice-style Pagination component
  const InvoicePagination = ({
    currentPage,
    totalPages,
    startIndex,
    endIndex,
    totalItems,
    itemsPerPage,
    onPageChange,
    onItemsPerPageChange
  }: {
    currentPage: number;
    totalPages: number;
    startIndex: number;
    endIndex: number;
    totalItems: number;
    itemsPerPage: number;
    onPageChange: (page: number) => void;
    onItemsPerPageChange: (itemsPerPage: number) => void;
  }) => {
    if (totalItems === 0) return null;

    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-4 mt-4">
        <div className="flex flex-col sm:flex-row justify-between items-center space-y-3 sm:space-y-0">
          {/* Items per page selector */}
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-700 dark:text-slate-200">{t("Show:")}</span>
            <select
              value={itemsPerPage}
              onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
              className="px-3 py-1 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-sm text-gray-700 dark:text-slate-200">{t("per page")}</span>
          </div>

          {/* Pagination info */}
          <div className="text-sm text-gray-700 dark:text-slate-200">
            {t("Showing {start} to {end} of {total} results", {
              start: startIndex + 1,
              end: Math.min(endIndex, totalItems),
              total: totalItems
            })}
          </div>

          {/* Page navigation */}
          <div className="flex items-center space-x-1">
            {/* Previous button */}
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className={`px-3 py-1 rounded-lg text-sm font-medium ${
                currentPage === 1
                  ? "bg-gray-100 dark:bg-slate-800 text-gray-400 cursor-not-allowed"
                  : "bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-300 dark:bg-slate-700"
              }`}
            >
              {t("Previous")}
            </button>

            {/* Page numbers */}
            {(() => {
              const pages: number[] = [];
              const maxVisible = 5;
              let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
              const end = Math.min(totalPages, start + maxVisible - 1);

              if (end - start + 1 < maxVisible) {
                start = Math.max(1, end - maxVisible + 1);
              }

              for (let i = start; i <= end; i++) {
                pages.push(i);
              }

              return pages.map((page) => (
                <button
                  key={page}
                  onClick={() => onPageChange(page)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium ${
                    currentPage === page
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-300 dark:bg-slate-700"
                  }`}
                >
                  {page}
                </button>
              ));
            })()}

            {/* Next button */}
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={`px-3 py-1 rounded-lg text-sm font-medium ${
                currentPage === totalPages
                  ? "bg-gray-100 dark:bg-slate-800 text-gray-400 cursor-not-allowed"
                  : "bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-300 dark:bg-slate-700"
              }`}
            >
              {t("Next")}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 dark:text-slate-100 mb-2">
            {t("Product Management")}
          </h1>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <p className="text-gray-600 dark:text-slate-400">
              {t("Manage your product catalog and inventory")}
            </p>
            {totalProducts > 0 && (
              <div className="text-sm text-gray-500 dark:text-slate-400 mt-1 sm:mt-0">
                {hasActiveFilters
                  ? t("{filtered} of {total} products (filtered)", {
                      filtered: totalProducts,
                      total: allProducts.length
                    })
                  : t("{count} total products", { count: totalProducts })}
              </div>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Total Products")}</p>
                <p className="text-xl font-bold text-blue-600">{allProducts.length}</p>
              </div>
              <div className="text-2xl">📦</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {t("Total Inventory Value")}
                </p>
                <p className="text-xl font-bold text-green-600">Rs {stats.totalValue.toFixed(2)}</p>
              </div>
              <div className="text-2xl">💰</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Out of Stock")}</p>
                <p className="text-xl font-bold text-red-600">{stats.outOfStock}</p>
              </div>
              <div className="text-2xl">⚠️</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Actions")}</p>
                <button
                  onClick={openModal}
                  className="mt-1 px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  + {t("Add Product")}
                </button>
              </div>
              <div className="text-2xl">⚡</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Search")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("Search products...")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <button
                  onClick={isScanningBarcode ? stopBarcodeScan : startBarcodeScan}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isScanningBarcode
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  title={isScanningBarcode ? t("Stop scanning") : t("Scan barcode to search")}
                >
                  {isScanningBarcode ? "⏹️ Stop" : "📷"}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Category")}
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">{t("All Categories")}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Stock Status")}
              </label>
              <select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value as "all" | "inStock" | "outOfStock")}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">{t("All Stock")}</option>
                <option value="inStock">{t("In Stock")}</option>
                <option value="outOfStock">{t("Out of Stock")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Min Price")}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder={t("Min price")}
                value={priceRange.min}
                onChange={(e) => setPriceRange((prev) => ({ ...prev, min: e.target.value }))}
                onWheel={(e) => {
                  e.preventDefault();
                  e.currentTarget.blur();
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Max Price")}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder={t("Max price")}
                value={priceRange.max}
                onChange={(e) => setPriceRange((prev) => ({ ...prev, max: e.target.value }))}
                onWheel={(e) => {
                  e.preventDefault();
                  e.currentTarget.blur();
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setSearchTerm("");
                  setCategoryFilter("");
                  setStockFilter("all");
                  setPriceRange({ min: "", max: "" });
                  setCurrentPage(1);
                }}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 text-sm"
              >
                {t("Clear Filters")}
              </button>
            </div>
          </div>
        </div>

        {/* Products Table */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("name")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Product")}</span>
                      {sortField === "name" && (
                        <span className="text-blue-600">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("category")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Category")}</span>
                      {sortField === "category" && (
                        <span className="text-blue-600">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t("Unit")}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("price")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200 ml-auto"
                    >
                      <span>{t("Price")}</span>
                      {sortField === "price" && (
                        <span className="text-blue-600">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t("Cost Price")}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("stock")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200 ml-auto"
                    >
                      <span>{t("Stock")}</span>
                      {sortField === "stock" && (
                        <span className="text-blue-600">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("createdAt")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Created")}</span>
                      {sortField === "createdAt" && (
                        <span className="text-blue-600">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t("Actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-gray-500 dark:text-slate-400"
                    >
                      {t("Loading products...")}
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-gray-500 dark:text-slate-400"
                    >
                      <div className="text-4xl mb-2">📦</div>
                      <p>{t("No products found")}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {totalProducts === 0
                          ? hasActiveFilters
                            ? t("Try adjusting your filters")
                            : t("No products have been created yet")
                          : t("No products on this page")}
                      </p>
                    </td>
                  </tr>
                ) : (
                  products.map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-slate-950">
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        <div>
                          <div className="font-medium">{product.name}</div>
                          {(product.sku || product.brand) && (
                            <div className="text-gray-500 dark:text-slate-400 text-xs">
                              {product.sku && (
                                <span>
                                  {t("SKU")}: {product.sku}
                                </span>
                              )}
                              {product.sku && product.brand && <span> • </span>}
                              {product.brand && <span>{product.brand}</span>}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        {product.category?.name || t("Uncategorized")}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        {product.unit || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-right">
                        <div className="text-green-600">Rs {product.price.toFixed(2)}</div>
                        {product.discountedPrice && product.discountedPrice > 0 && (
                          <div className="text-xs text-orange-600">
                            {t("Sale")}: Rs {product.discountedPrice.toFixed(2)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <div className="text-blue-600">
                          Rs {(product.costPrice ?? 0).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            product.stockLevel > 0
                              ? product.stockLevel > 10
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {formatToThreeDecimalPlaces(product.stockLevel)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        <div>
                          <div className="font-medium">
                            {new Date(product.createdAt).toLocaleDateString()}
                          </div>
                          <div className="text-gray-500 dark:text-slate-400">
                            {new Date(product.createdAt).toLocaleTimeString()}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center space-x-2">
                          <button
                            onClick={() => handleEdit(product)}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            title={t("Edit Product")}
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDelete(product.id, product.name)}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                            title={t("Delete Product")}
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Controls */}
        <InvoicePagination
          currentPage={currentPage}
          totalPages={totalPages}
          startIndex={startIndex}
          endIndex={endIndex}
          totalItems={totalProducts}
          itemsPerPage={itemsPerPage}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
        />

        {/* Product Modal */}
        {isModalOpen && (
          <div
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          >
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="sticky top-0 bg-white dark:bg-slate-900 border-b px-6 py-4 flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg mr-3">
                    <span className="text-blue-600 font-bold">📦</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100">
                    {isEditing ? t("Edit Product") : t("Add New Product")}
                  </h3>
                </div>
                <button
                  onClick={closeModal}
                  className="text-gray-400 hover:text-gray-600 dark:text-slate-400 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <div className="px-6 py-4">
                <form onSubmit={handleSubmit} className="space-y-8">
                  {/* Section 1: Basic Product Information */}
                  <div className=" rounded-lg p-6 border border-gray-200 dark:border-slate-700">
                    <div className="flex items-center mb-6">
                      <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-lg mr-3">
                        <span className="text-blue-600 text-sm">📋</span>
                      </div>
                      <h4 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                        {t("Basic Information")}
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Product Name *")}
                        </label>
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            errors.name ? "border-red-500" : "border-gray-300 dark:border-slate-700"
                          }`}
                          required
                          disabled={loading}
                          placeholder={t("Enter product name")}
                        />
                        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Item Code")} or {t("English Name")}
                        </label>
                        <input
                          type="text"
                          value={formData.englishName}
                          onChange={(e) =>
                            setFormData({ ...formData, englishName: e.target.value })
                          }
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            errors.englishName
                              ? "border-red-500"
                              : "border-gray-300 dark:border-slate-700"
                          }`}
                          disabled={loading}
                          placeholder={t("Enter English name or Item Code")}
                        />
                        {errors.englishName && (
                          <p className="mt-1 text-xs text-red-600">{errors.englishName}</p>
                        )}
                      </div>

                      <div ref={categoryDropdownRef} className="relative">
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Category *")}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={categorySearchTerm}
                            onChange={(e) => {
                              setCategorySearchTerm(e.target.value);
                              setIsCategoryDropdownOpen(true);
                            }}
                            onFocus={() => setIsCategoryDropdownOpen(true)}
                            placeholder={t("Search or select a category")}
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                              errors.categoryId
                                ? "border-red-500"
                                : "border-gray-300 dark:border-slate-700"
                            }`}
                            disabled={loading}
                            autoComplete="off"
                          />
                          {formData.categoryId && (
                            <button
                              type="button"
                              onClick={() => {
                                setFormData((prev) => ({ ...prev, categoryId: "" }));
                                setCategorySearchTerm("");
                                setIsCategoryDropdownOpen(false);
                              }}
                              className="px-3 py-2 text-sm text-gray-600 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg hover:bg-gray-200 dark:bg-slate-800 focus:outline-none disabled:opacity-50"
                              disabled={loading}
                            >
                              {t("Clear")}
                            </button>
                          )}
                        </div>
                        {isCategoryDropdownOpen && (
                          <div className="absolute z-20 mt-1 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {filteredCategoryOptions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500 dark:text-slate-400">
                                {t("No categories found")}
                              </div>
                            ) : (
                              filteredCategoryOptions.map((category) => (
                                <button
                                  type="button"
                                  key={category.id}
                                  onClick={() => {
                                    setFormData((prev) => ({ ...prev, categoryId: category.id }));
                                    setCategorySearchTerm(category.name);
                                    setIsCategoryDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-slate-700 ${
                                    formData.categoryId === category.id
                                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/70 dark:text-blue-200"
                                      : "text-gray-700 dark:text-slate-200"
                                  }`}
                                  disabled={loading}
                                >
                                  {category.name}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                        {errors.categoryId && (
                          <p className="mt-1 text-xs text-red-600">{errors.categoryId}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Brand")}
                        </label>
                        <input
                          type="text"
                          value={formData.brand}
                          onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={loading}
                          placeholder={t("Enter brand name")}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Unit Type")}
                        </label>
                        <select
                          value={formData.unitType}
                          onChange={(e) =>
                            setFormData({ ...formData, unitType: e.target.value, unit: "" })
                          }
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={loading}
                        >
                          <option value="">{t("Select Unit Type")}</option>
                          <option value="Weight">{t("Weight")}</option>
                          <option value="Volume">{t("Volume")}</option>
                          <option value="Count">{t("Count")}</option>
                          <option value="Length">{t("Length")}</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Unit")}
                        </label>
                        <select
                          value={formData.unit}
                          onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={loading || !formData.unitType}
                        >
                          <option value="">{t("Select Unit")}</option>
                          {formData.unitType === "Weight" && (
                            <>
                              <option value="g">{t("g (gram)")}</option>
                              <option value="kg">{t("kg (kilogram)")}</option>
                            </>
                          )}
                          {formData.unitType === "Volume" && (
                            <>
                              <option value="ml">{t("ml (milliliter)")}</option>
                              <option value="L">{t("L (liter)")}</option>
                            </>
                          )}
                          {formData.unitType === "Count" && (
                            <>
                              <option value="pc">{t("pc (piece)")}</option>
                            </>
                          )}
                          {formData.unitType === "Length" && (
                            <>
                              <option value="m">{t("m (meter)")}</option>
                            </>
                          )}
                        </select>
                      </div>
                    </div>

                    <div className="mt-6">
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                        {t("Description")}
                      </label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={3}
                        disabled={loading}
                        placeholder={t("Enter product description")}
                      />
                    </div>
                  </div>

                  {/* Section 2: Product Identification */}
                  <div className="bg-blue-50 dark:bg-slate-900/70 rounded-lg p-6 border border-blue-200 dark:border-slate-700">
                    <div className="flex items-center mb-6">
                      <div className="flex items-center justify-center w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg mr-3">
                        <span className="text-blue-600 text-sm">🏷️</span>
                      </div>
                      <h4 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                        {t("Product Identification")}
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("SKU (Stock Keeping Unit)")}
                        </label>
                        <input
                          type="text"
                          value={formData.sku}
                          onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            errors.sku ? "border-red-500" : "border-gray-300 dark:border-slate-700"
                          }`}
                          disabled={loading}
                          placeholder={t("Enter unique SKU code")}
                        />
                        {errors.sku && <p className="mt-1 text-xs text-red-600">{errors.sku}</p>}
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {t("Unique identifier for inventory tracking")}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Barcode")}
                        </label>
                        <div className="flex space-x-2">
                          <div className="flex-1 relative">
                            <input
                              type="text"
                              value={formData.barcode}
                              onChange={(e) =>
                                setFormData({ ...formData, barcode: e.target.value })
                              }
                              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                errors.barcode
                                  ? "border-red-500"
                                  : "border-gray-300 dark:border-slate-700"
                              } ${isScanningBarcode ? "ring-2 ring-green-400 border-green-400" : ""}`}
                              disabled={loading}
                              placeholder={t("Enter barcode number")}
                            />
                            {isScanningBarcode && (
                              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={isScanningBarcode ? stopBarcodeScan : startBarcodeInputScan}
                            disabled={!scannerEnabled || loading}
                            className={`px-4 py-2 rounded-lg text-white font-medium transition-all duration-200 whitespace-nowrap ${
                              isScanningBarcode
                                ? "bg-red-500 hover:bg-red-600 animate-pulse"
                                : scannerEnabled
                                  ? "bg-blue-500 hover:bg-blue-600"
                                  : "bg-gray-400 cursor-not-allowed"
                            }`}
                            title={isScanningBarcode ? t("Stop scanning") : t("Scan barcode")}
                          >
                            {isScanningBarcode ? t("🔴 Stop Scan") : t("📷 Scan Barcode")}
                          </button>
                        </div>
                        {errors.barcode && (
                          <p className="mt-1 text-xs text-red-600">{errors.barcode}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {t("For barcode scanner integration")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Pricing & Financial Information */}
                  <div className="bg-green-50 dark:bg-slate-900/70 rounded-lg p-6 border border-green-200 dark:border-slate-700">
                    <div className="flex items-center mb-6">
                      <div className="flex items-center justify-center w-8 h-8 bg-green-100 dark:bg-green-900/40 rounded-lg mr-3">
                        <span className="text-green-600 text-sm">💰</span>
                      </div>
                      <h4 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                        {t("Pricing & Financial")}
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Cost Price *")}
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-gray-500 dark:text-slate-400 text-sm">
                            Rs
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={formData.costPrice}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                costPrice: parseFloat(e.target.value) || 0
                              })
                            }
                            onWheel={(e) => {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }}
                            className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${
                              errors.costPrice
                                ? "border-red-500"
                                : "border-gray-300 dark:border-slate-700"
                            }`}
                            disabled={loading}
                            placeholder="0.00"
                          />
                        </div>
                        {errors.costPrice && (
                          <p className="mt-1 text-xs text-red-600">{errors.costPrice}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {t("Used for profit calculations and margin reports")}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Regular Price *")}
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-gray-500 dark:text-slate-400 text-sm">
                            Rs
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            value={formData.price}
                            onChange={(e) =>
                              setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })
                            }
                            onWheel={(e) => {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }}
                            className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${
                              errors.price
                                ? "border-red-500"
                                : "border-gray-300 dark:border-slate-700"
                            }`}
                            required
                            disabled={loading}
                            placeholder="0.00"
                          />
                        </div>
                        {errors.price && (
                          <p className="mt-1 text-xs text-red-600">{errors.price}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Sale/Discounted Price")}
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-gray-500 dark:text-slate-400 text-sm">
                            Rs
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            value={formData.discountedPrice}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                discountedPrice: parseFloat(e.target.value) || 0
                              })
                            }
                            onWheel={(e) => {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }}
                            className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${
                              errors.discountedPrice
                                ? "border-red-500"
                                : "border-gray-300 dark:border-slate-700"
                            }`}
                            disabled={loading}
                            placeholder="0.00"
                          />
                        </div>
                        {errors.discountedPrice && (
                          <p className="mt-1 text-xs text-red-600">{errors.discountedPrice}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {t("Optional promotional price")}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Wholesale")}
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-gray-500 dark:text-slate-400 text-sm">
                            Rs
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            value={formData.wholesale}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                wholesale: parseFloat(e.target.value) || 0
                              })
                            }
                            onWheel={(e) => {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }}
                            className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${
                              errors.wholesale
                                ? "border-red-500"
                                : "border-gray-300 dark:border-slate-700"
                            }`}
                            disabled={loading}
                            placeholder="0.00"
                          />
                        </div>
                        {errors.wholesale && (
                          <p className="mt-1 text-xs text-red-600">{errors.wholesale}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {t("Wholesale price (optional)")}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Tax Rate (%)")}
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.01"
                            value={formData.taxRate}
                            onChange={(e) =>
                              setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 0 })
                            }
                            onWheel={(e) => {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }}
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${
                              errors.taxRate
                                ? "border-red-500"
                                : "border-gray-300 dark:border-slate-700"
                            }`}
                            disabled={loading}
                            placeholder="0.00"
                          />
                          <span className="absolute right-3 top-2 text-gray-500 dark:text-slate-400 text-sm">
                            %
                          </span>
                        </div>
                        {errors.taxRate && (
                          <p className="mt-1 text-xs text-red-600">{errors.taxRate}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {t("Applicable tax percentage")}
                        </p>
                      </div>
                    </div>

                    {/* Price Summary */}
                    {formData.price > 0 && (
                      <div className="mt-6 p-4 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
                        <h5 className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-3">
                          {t("Price Summary")}
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-slate-400">
                              {t("Regular Price:")}
                            </span>
                            <span className="font-medium">Rs {formData.price.toFixed(2)}</span>
                          </div>
                          {formData.discountedPrice > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-slate-400">
                                {t("Sale Price:")}
                              </span>
                              <span className="font-medium text-orange-600">
                                Rs {formData.discountedPrice.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {formData.wholesale > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-slate-400">
                                {t("Wholesale:")}
                              </span>
                              <span className="font-medium text-indigo-600">
                                Rs {formData.wholesale.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {formData.taxRate > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-slate-400">
                                {t("Tax ({taxRate}%):", { taxRate: formData.taxRate })}
                              </span>
                              <span className="font-medium">
                                Rs{" "}
                                {(
                                  ((formData.discountedPrice || formData.price) *
                                    formData.taxRate) /
                                  100
                                ).toFixed(2)}
                              </span>
                            </div>
                          )}
                          {/* {formData.discountedPrice > 0 &&
                            formData.discountedPrice < formData.price && (
                              <div className="flex justify-between text-green-600">
                                <span>You Save:</span>
                                <span className="font-medium">
                                  Rs {(formData.price - formData.discountedPrice).toFixed(2)}
                                </span>
                              </div>
                            )} */}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section 4: Inventory & Stock */}
                  <div className="bg-purple-50 dark:bg-slate-900/70 rounded-lg p-6 border border-purple-200 dark:border-slate-700">
                    <div className="flex items-center mb-6">
                      <div className="flex items-center justify-center w-8 h-8 bg-purple-100 dark:bg-purple-900/40 rounded-lg mr-3">
                        <span className="text-purple-600 text-sm">📊</span>
                      </div>
                      <h4 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                        {t("Inventory & Stock")}
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                          {t("Initial Stock Level")}
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={formData.stockLevel}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              stockLevel: parseFloat(e.target.value) || 0
                            })
                          }
                          onWheel={(e) => {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${
                            errors.stockLevel
                              ? "border-red-500"
                              : "border-gray-300 dark:border-slate-700"
                          }`}
                          disabled={loading}
                          placeholder={t("Enter stock quantity")}
                        />
                        {errors.stockLevel && (
                          <p className="mt-1 text-xs text-red-600">{errors.stockLevel}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {isEditing
                            ? t("Changing this will create an inventory adjustment transaction")
                            : t("Initial stock quantity for new product")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-6 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 bg-gray-200 dark:bg-slate-800 rounded-lg hover:bg-gray-300 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
                      disabled={loading}
                    >
                      {t("Cancel")}
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                      disabled={loading}
                    >
                      {loading
                        ? t("Saving...")
                        : isEditing
                          ? t("Update Product")
                          : t("Create Product")}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductManagement;
