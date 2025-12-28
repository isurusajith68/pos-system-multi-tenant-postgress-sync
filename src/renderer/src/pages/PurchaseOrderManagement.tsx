import React, { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import { formatToThreeDecimalPlaces } from "../lib/quantityValidation";
import { useTranslation } from "../contexts/LanguageContext";

interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Product {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  brand?: string;
  price: number;
  costPrice?: number;
  stockLevel: number;
  category?: Category;
}

interface Category {
  id: string;
  name: string;
}

interface PurchaseOrderItem {
  id: string;
  poId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  receivedDate?: Date;
  product?: Product;
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

interface PurchaseOrderFormData {
  supplierId: string;
  orderDate: string;
  status: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
  }>;
}

const PurchaseOrderManagement: React.FC = () => {
  const { t } = useTranslation();
  // State management
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

  // Form data
  const [formData, setFormData] = useState<PurchaseOrderFormData>({
    supplierId: "",
    orderDate: new Date().toISOString().split("T")[0],
    status: "PENDING",
    items: []
  });

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Sorting
  const [sortField, setSortField] = useState<string>("orderDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Tab management
  const [activeTab, setActiveTab] = useState<"orders" | "suppliers">("orders");

  // Supplier management states
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [isEditingSupplier, setIsEditingSupplier] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierFormData, setSupplierFormData] = useState({
    name: "",
    contactName: "",
    phone: "",
    email: "",
    address: ""
  });
  const [supplierErrors, setSupplierErrors] = useState<Record<string, string>>({});

  // Supplier pagination
  const [supplierCurrentPage, setSupplierCurrentPage] = useState(1);
  const [supplierItemsPerPage, setSupplierItemsPerPage] = useState(10);
  const [supplierSearchTerm, setSupplierSearchTerm] = useState("");

  // Stats
  const stats = useMemo(() => {
    const totalOrders = purchaseOrders.length;
    const pendingOrders = purchaseOrders.filter((po) => po.status === "PENDING").length;
    const completedOrders = purchaseOrders.filter((po) => po.status === "COMPLETED").length;
    const totalValue = purchaseOrders.reduce((sum, po) => sum + po.totalAmount, 0);

    return {
      totalOrders,
      pendingOrders,
      completedOrders,
      totalValue
    };
  }, [purchaseOrders]);

  // Data fetching
  useEffect(() => {
    fetchPurchaseOrders();
    fetchSuppliers();
    fetchProducts();
  }, []);

  const fetchPurchaseOrders = async (): Promise<void> => {
    try {
      setLoading(true);
      const filters = {
        supplier: supplierFilter !== "all" ? supplierFilter : undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: searchTerm || undefined
      };
      const data = await window.api.purchaseOrders.findMany(filters);
      setPurchaseOrders(data);
      // Removed success toast as requested
    } catch (error) {
      console.error("Error fetching purchase orders:", error);
      toast.error(t("Failed to load purchase orders."));
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async (): Promise<void> => {
    try {
      const data = await window.api.suppliers.findMany();
      setSuppliers(data);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      toast.error(t("Failed to load suppliers."));
    }
  };

  const fetchProducts = async (): Promise<void> => {
    try {
      const data = await window.api.products.findMany();
      setProducts(data);
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error(t("Failed to load products."));
    }
  };

  // Filtering and sorting
  const filteredAndSortedPOs = useMemo(() => {
    const filtered = purchaseOrders.filter((po) => {
      const matchesSearch =
        !searchTerm ||
        po.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        po.supplier?.name.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === "all" || po.status === statusFilter;
      const matchesSupplier = supplierFilter === "all" || po.supplierId === supplierFilter;

      const matchesDate =
        (!dateFrom || new Date(po.orderDate) >= new Date(dateFrom)) &&
        (!dateTo || new Date(po.orderDate) <= new Date(dateTo));

      return matchesSearch && matchesStatus && matchesSupplier && matchesDate;
    });

    // Sorting
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (sortField) {
        case "orderDate":
          aValue = new Date(a.orderDate);
          bValue = new Date(b.orderDate);
          break;
        case "supplier":
          aValue = a.supplier?.name || "";
          bValue = b.supplier?.name || "";
          break;
        case "status":
          aValue = a.status;
          bValue = b.status;
          break;
        case "totalAmount":
          aValue = a.totalAmount;
          bValue = b.totalAmount;
          break;
        default:
          aValue = a[sortField as keyof PurchaseOrder];
          bValue = b[sortField as keyof PurchaseOrder];
      }

      if (aValue < bValue) return sortOrder === "asc" ? -1 : 1;
      if (aValue > bValue) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [
    purchaseOrders,
    searchTerm,
    statusFilter,
    supplierFilter,
    dateFrom,
    dateTo,
    sortField,
    sortOrder
  ]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredAndSortedPOs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedPOs = filteredAndSortedPOs.slice(startIndex, endIndex);

  // Pagination handlers
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    },
    [totalPages]
  );

  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1);
  };

  // Sorting handler
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // Form handlers
  const openModal = (po?: PurchaseOrder) => {
    if (po) {
      setIsEditing(true);
      setSelectedPO(po); // Set the selected PO for editing
      setFormData({
        supplierId: po.supplierId,
        orderDate: new Date(po.orderDate).toISOString().split("T")[0],
        status: po.status,
        items:
          po.items?.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice
          })) || []
      });
    } else {
      setIsEditing(false);
      setSelectedPO(null);
      setFormData({
        supplierId: "",
        orderDate: new Date().toISOString().split("T")[0],
        status: "PENDING",
        items: []
      });
    }
    setErrors({});
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedPO(null);
    setIsEditing(false);
  };

  // Add/Remove items from PO
  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { productId: "", quantity: 1, unitPrice: 0 }]
    });
  };

  const removeItem = (index: number) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: newItems });
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };

    // Auto-fill unit price when product is selected
    if (field === "productId" && value) {
      const product = products.find((p) => p.id === value);
      if (product) {
        newItems[index].unitPrice = product.price;
      }
    }

    setFormData({ ...formData, items: newItems });
  };

  // Calculate total amount
  const calculateTotal = () => {
    return formData.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  };

  // Form validation
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // For creation, validate all fields
    if (!isEditing) {
      if (!formData.supplierId) {
        newErrors.supplierId = "Supplier is required";
      }

      if (formData.items.length === 0) {
        newErrors.items = "At least one item is required";
      }

      formData.items.forEach((item, index) => {
        if (!item.productId) {
          newErrors[`items.${index}.productId`] = "Product is required";
        }
        if (item.quantity <= 0) {
          newErrors[`items.${index}.quantity`] = "Quantity must be greater than 0";
        }
        if (item.unitPrice <= 0) {
          newErrors[`items.${index}.unitPrice`] = "Unit price must be greater than 0";
        }
      });
    }

    // For both creation and editing, validate order date
    if (!formData.orderDate) {
      newErrors.orderDate = "Order date is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error(t("Please fix the errors before submitting"));
      return;
    }

    try {
      setLoading(true);

      if (isEditing && selectedPO) {
        // For updates, only send status and orderDate
        const updateData = {
          status: formData.status,
          orderDate: new Date(formData.orderDate)
        };
        await window.api.purchaseOrders.update(selectedPO.id, updateData);
        toast.success(t("Purchase order updated successfully!"));
      } else {
        // For creation, send full data including items
        const poData = {
          supplierId: formData.supplierId,
          orderDate: new Date(formData.orderDate),
          status: formData.status,
          items: formData.items
        };
        await window.api.purchaseOrders.create(poData);
        toast.success(t("Purchase order created successfully!"));
      }

      await fetchPurchaseOrders();
      closeModal();
    } catch (error) {
      console.error("Error saving purchase order:", error);
      toast.error(t("Failed to save purchase order"));
    } finally {
      setLoading(false);
    }
  };

  // View details
  const viewDetails = async (po: PurchaseOrder): Promise<void> => {
    try {
      const detailedPO = await window.api.purchaseOrders.findById(po.id);
      setSelectedPO(detailedPO);
      setShowDetailModal(true);
    } catch (error) {
      console.error("Error fetching PO details:", error);
      toast.error(t("Failed to load purchase order details."));
    }
  };

  // Delete handler
  const handleDelete = async (id: string): Promise<void> => {
    if (window.confirm(t("Are you sure you want to delete this purchase order?"))) {
      try {
        setLoading(true);
        await window.api.purchaseOrders.delete(id);
        toast.success(t("Purchase order deleted successfully!"));
        await fetchPurchaseOrders();
      } catch (error) {
        console.error("Error deleting purchase order:", error);
        toast.error(t("Failed to delete purchase order"));
      } finally {
        setLoading(false);
      }
    }
  };

  // Status badge component
  const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const getStatusColor = (status: string) => {
      switch (status) {
        case "PENDING":
          return "bg-yellow-100 text-yellow-800";
        case "CONFIRMED":
          return "bg-blue-100 text-blue-800";
        case "SHIPPED":
          return "bg-purple-100 text-purple-800";
        case "DELIVERED":
          return "bg-green-100 text-green-800";
        case "CANCELLED":
          return "bg-red-100 text-red-800";
        default:
          return "bg-gray-100 text-gray-800";
      }
    };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(status)}`}>
        {status}
      </span>
    );
  };

  // Pagination component (matching invoice style)
  const InvoicePagination = ({
    currentPage,
    totalPages,
    onPageChange,
    itemsPerPage,
    onItemsPerPageChange,
    totalItems,
    startIndex,
    endIndex
  }: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    itemsPerPage: number;
    onItemsPerPageChange: (items: number) => void;
    totalItems: number;
    startIndex: number;
    endIndex: number;
  }) => (
    <div className="surface-card shadow-sm p-4 mt-4">
      <div className="flex flex-col sm:flex-row justify-between items-center space-y-3 sm:space-y-0">
        {/* Items per page selector */}
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-700 dark:text-slate-200">Show:</span>
          <select
            value={itemsPerPage}
            onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
            className="px-3 py-1 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
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
        <div className="text-sm text-gray-700">
          {t("Showing {start} to {end} of {total} results", {
            start: startIndex + 1,
            end: Math.min(endIndex, totalItems),
            total: totalItems
          })}{" "}
        </div>

        {/* Page navigation */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className={`px-3 py-1 rounded-lg text-sm font-medium ${
              currentPage === 1
                ? "bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-400 cursor-not-allowed"
                : "bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-300 dark:hover:bg-slate-700"
            }`}
          >
            {t("Previous")}
          </button>

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
                    : "bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-300 dark:hover:bg-slate-700"
                }`}
              >
                {page}
              </button>
            ));
          })()}

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className={`px-3 py-1 rounded-lg text-sm font-medium ${
              currentPage === totalPages
                ? "bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-400 cursor-not-allowed"
                : "bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-300 dark:hover:bg-slate-700"
            }`}
          >
            {t("Next")}
          </button>
        </div>
      </div>
    </div>
  );

  // Supplier Management Functions
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(
      (supplier) =>
        supplier.name.toLowerCase().includes(supplierSearchTerm.toLowerCase()) ||
        supplier.contactName?.toLowerCase().includes(supplierSearchTerm.toLowerCase()) ||
        supplier.email?.toLowerCase().includes(supplierSearchTerm.toLowerCase())
    );
  }, [suppliers, supplierSearchTerm]);

  const supplierTotalPages = Math.ceil(filteredSuppliers.length / supplierItemsPerPage);
  const supplierStartIndex = (supplierCurrentPage - 1) * supplierItemsPerPage;
  const supplierEndIndex = supplierStartIndex + supplierItemsPerPage;
  const paginatedSuppliers = filteredSuppliers.slice(supplierStartIndex, supplierEndIndex);

  const handleSupplierPageChange = useCallback(
    (page: number) => {
      setSupplierCurrentPage(Math.max(1, Math.min(page, supplierTotalPages)));
    },
    [supplierTotalPages]
  );

  const validateSupplierForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!supplierFormData.name.trim()) {
      newErrors.name = "Supplier name is required";
    }

    if (supplierFormData.email && !/\S+@\S+\.\S+/.test(supplierFormData.email)) {
      newErrors.email = "Invalid email format";
    }

    setSupplierErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const openSupplierModal = (supplier: Supplier | null = null) => {
    if (supplier) {
      setIsEditingSupplier(true);
      setSelectedSupplier(supplier);
      setSupplierFormData({
        name: supplier.name,
        contactName: supplier.contactName || "",
        phone: supplier.phone || "",
        email: supplier.email || "",
        address: supplier.address || ""
      });
    } else {
      setIsEditingSupplier(false);
      setSelectedSupplier(null);
      setSupplierFormData({
        name: "",
        contactName: "",
        phone: "",
        email: "",
        address: ""
      });
    }
    setSupplierErrors({});
    setShowSupplierModal(true);
  };

  const closeSupplierModal = () => {
    setShowSupplierModal(false);
    setIsEditingSupplier(false);
    setSelectedSupplier(null);
    setSupplierFormData({
      name: "",
      contactName: "",
      phone: "",
      email: "",
      address: ""
    });
    setSupplierErrors({});
  };

  const handleSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateSupplierForm()) {
      toast.error(t("Please fix the validation errors"));
      return;
    }

    try {
      setLoading(true);

      if (isEditingSupplier && selectedSupplier) {
        await window.api.suppliers.update(selectedSupplier.id, supplierFormData);
        toast.success(t("Supplier updated successfully!"));
      } else {
        await window.api.suppliers.create(supplierFormData);
        toast.success(t("Supplier created successfully!"));
      }

      await fetchSuppliers();
      closeSupplierModal();
    } catch (error) {
      console.error("Error saving supplier:", error);
      toast.error(t("Failed to save supplier"));
    } finally {
      setLoading(false);
    }
  };

  const handleSupplierDelete = async (id: string): Promise<void> => {
    if (window.confirm(t("Are you sure you want to delete this supplier?"))) {
      try {
        setLoading(true);
        await window.api.suppliers.delete(id);
        toast.success(t("Supplier deleted successfully!"));
        await fetchSuppliers();
      } catch (error) {
        console.error("Error deleting supplier:", error);
        toast.error(t("Failed to delete supplier"));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            {t("Purchase Order Management")}
          </h1>
          <p className="text-gray-600 dark:text-slate-400">
            {t("Manage suppliers, purchase orders, and track deliveries")}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-gray-200 dark:border-slate-700">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab("orders")}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === "orders"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:border-gray-300 dark:border-slate-700"
                }`}
              >
                {t("Purchase Orders")}
              </button>
              <button
                onClick={() => setActiveTab("suppliers")}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === "suppliers"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:border-gray-300 dark:border-slate-700"
                }`}
              >
                {t("Suppliers")}
              </button>
            </nav>
          </div>
        </div>

        {/* Content based on active tab */}
        {activeTab === "orders" && (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
                    <span className="text-blue-600 text-xl">📋</span>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                      {stats.totalOrders}
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Total Orders")}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-yellow-100 rounded-lg">
                    <span className="text-yellow-600 text-xl">⏳</span>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                      {stats.pendingOrders}
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400 text-sm">
                      {t("Pending Orders")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-green-100 dark:bg-green-900/40 rounded-lg">
                    <span className="text-green-600 text-xl">✅</span>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                      {stats.completedOrders}
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400 text-sm">
                      {t("Completed Orders")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-purple-100 dark:bg-purple-900/40 rounded-lg">
                    <span className="text-purple-600 text-xl">💰</span>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                      Rs {stats.totalValue.toFixed(2)}
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Total Value")}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters and Actions */}
            <div className="surface-card rounded-lg shadow-sm p-6 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                {/* Search and Filters */}
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                  <input
                    type="text"
                    placeholder={t("Search by ID or supplier...")}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="px-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-64 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    <option value="all">{t("All Statuses")}</option>
                    <option value="PENDING">{t("Pending")}</option>
                    <option value="CONFIRMED">{t("Confirmed")}</option>
                    <option value="SHIPPED">{t("Shipped")}</option>
                    <option value="DELIVERED">{t("Delivered")}</option>
                    <option value="CANCELLED">{t("Cancelled")}</option>
                  </select>

                  <select
                    value={supplierFilter}
                    onChange={(e) => setSupplierFilter(e.target.value)}
                    className="px-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    <option value="all">{t("All Suppliers")}</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-3">
                  <button
                    onClick={fetchPurchaseOrders}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    {t("🔄 Refresh")}
                  </button>
                  <button
                    onClick={() => openModal()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {t("➕ New Purchase Order")}
                  </button>
                </div>
              </div>

              {/* Date Range Filter */}
              <div className="mt-4 flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                <div className="flex items-center space-x-2">
                  <label className="text-sm font-medium text-gray-700">{t("From:")}</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <label className="text-sm font-medium text-gray-700">{t("To:")}</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => {
                      setDateFrom("");
                      setDateTo("");
                    }}
                    className="px-3 py-2 text-sm text-slate-900 dark:text-slate-100 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    {t("Clear Dates")}
                  </button>
                )}
              </div>
            </div>

            {/* Purchase Orders Table */}
            <div className="surface-card overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-slate-950 border-b border-gray-200 dark:border-slate-800">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        <button
                          onClick={() => handleSort("id")}
                          className="flex items-center space-x-1 hover:text-gray-700"
                        >
                          <span>{t("Order ID")}</span>
                          {sortField === "id" && (
                            <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        <button
                          onClick={() => handleSort("orderDate")}
                          className="flex items-center space-x-1 hover:text-gray-700"
                        >
                          <span>{t("Order Date")}</span>
                          {sortField === "orderDate" && (
                            <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        <button
                          onClick={() => handleSort("supplier")}
                          className="flex items-center space-x-1 hover:text-gray-700"
                        >
                          <span>{t("Supplier")}</span>
                          {sortField === "supplier" && (
                            <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        <button
                          onClick={() => handleSort("status")}
                          className="flex items-center space-x-1 hover:text-gray-700"
                        >
                          <span>{t("Status")}</span>
                          {sortField === "status" && (
                            <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        <button
                          onClick={() => handleSort("totalAmount")}
                          className="flex items-center space-x-1 hover:text-gray-700 ml-auto"
                        >
                          <span>{t("Total Amount")}</span>
                          {sortField === "totalAmount" && (
                            <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-6 py-8 text-center text-gray-500 dark:text-slate-400"
                        >
                          {t("Loading purchase orders...")}
                        </td>
                      </tr>
                    ) : paginatedPOs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-6 py-8 text-center text-gray-500 dark:text-slate-400"
                        >
                          <div className="text-4xl mb-2">📋</div>
                          <p>{t("No purchase orders found")}</p>
                          <p className="text-sm text-gray-400 dark:text-slate-400 mt-1">
                            {filteredAndSortedPOs.length === 0
                              ? purchaseOrders.length === 0
                                ? t("No purchase orders have been created yet")
                                : t("Try adjusting your filters")
                              : t("No orders on this page")}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      paginatedPOs.map((po) => (
                        <tr key={po.id} className="hover:bg-gray-50 dark:hover:bg-slate-950">
                          <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-slate-100">
                            #{po.id.slice(-8)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-slate-100">
                            {new Date(po.orderDate).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-slate-100">
                            <div>
                              <div className="font-medium">
                                {po.supplier?.name || t("Unknown Supplier")}
                              </div>
                              {po.supplier?.contactName && (
                                <div className="text-gray-500 dark:text-slate-400 text-xs">
                                  {po.supplier.contactName}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-slate-100">
                            <StatusBadge status={po.status} />
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-slate-100 text-right font-semibold">
                            Rs {po.totalAmount.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 text-sm text-center">
                            <div className="flex items-center justify-center space-x-2">
                              <button
                                onClick={() => viewDetails(po)}
                                className="text-blue-600 hover:text-blue-800 font-medium"
                                title="View Details"
                              >
                                👁️
                              </button>
                              <button
                                onClick={() => openModal(po)}
                                className="text-green-600 hover:text-green-800 font-medium"
                                title="Edit"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => handleDelete(po.id)}
                                className="text-red-600 hover:text-red-800 font-medium"
                                title="Delete"
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

              {/* Pagination */}
              {filteredAndSortedPOs.length > 0 && (
                <InvoicePagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                  itemsPerPage={itemsPerPage}
                  onItemsPerPageChange={handleItemsPerPageChange}
                  totalItems={filteredAndSortedPOs.length}
                  startIndex={startIndex}
                  endIndex={endIndex}
                />
              )}
            </div>

            {/* Create/Edit Modal */}
            {showModal && (
              <div
                className="fixed inset-0 flex items-center justify-center p-4 z-50"
                style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
              >
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
                  {/* Modal Header */}
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between bg-white dark:bg-slate-900 rounded-t-lg">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">
                      {isEditing ? t("Edit Purchase Order") : t("Create New Purchase Order")}
                    </h2>
                    <button
                      onClick={closeModal}
                      className="text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-100 text-2xl"
                    >
                      ×
                    </button>
                  </div>

                  {/* Modal Body */}
                  <div className="px-6 py-4">
                    <form onSubmit={handleSubmit} className="space-y-8">
                      {/* Section 1: Purchase Order Information */}
                      <div className="bg-blue-50 dark:bg-slate-950/60 rounded-lg p-6 border border-blue-200 dark:border-slate-700">
                        <div className="flex items-center mb-6">
                          <div className="flex items-center justify-center w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg mr-3">
                            <span className="text-blue-600 dark:text-blue-200 text-sm">📋</span>
                          </div>
                          <h4 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                            {t("Purchase Order Information")}
                          </h4>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                              {t("Supplier *")}
                            </label>
                            <select
                              value={formData.supplierId}
                              onChange={(e) =>
                                setFormData({ ...formData, supplierId: e.target.value })
                              }
                              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${
                                errors.supplierId
                                  ? "border-red-500"
                                  : "border-gray-300 dark:border-slate-700"
                              } ${isEditing ? "bg-gray-100 dark:bg-slate-900/70" : ""}`}
                              required={!isEditing}
                              disabled={loading || isEditing}
                            >
                              <option value="">{t("Select a supplier")}</option>
                              {suppliers.map((supplier) => (
                                <option key={supplier.id} value={supplier.id}>
                                  {supplier.name}
                                </option>
                              ))}
                            </select>
                            {errors.supplierId && (
                              <p className="mt-1 text-xs text-red-600">{errors.supplierId}</p>
                            )}
                            {isEditing && (
                              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                                ⚠️ {t("Supplier cannot be changed when editing")}
                              </p>
                            )}
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                              {t("Order Date *")}
                            </label>
                            <input
                              type="date"
                              value={formData.orderDate}
                              onChange={(e) =>
                                setFormData({ ...formData, orderDate: e.target.value })
                              }
                              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${
                                errors.orderDate
                                  ? "border-red-500"
                                  : "border-gray-300 dark:border-slate-700"
                              }`}
                              required
                              disabled={loading}
                            />
                            {errors.orderDate && (
                              <p className="mt-1 text-xs text-red-600">{errors.orderDate}</p>
                            )}
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                              {t("Status")}
                            </label>
                            <select
                              value={formData.status}
                              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                              disabled={loading}
                            >
                              <option value="PENDING">{t("Pending")}</option>
                              <option value="CONFIRMED">{t("Confirmed")}</option>
                              <option value="SHIPPED">{t("Shipped")}</option>
                              <option value="DELIVERED">{t("Delivered")}</option>
                              <option value="CANCELLED">{t("Cancelled")}</option>
                            </select>
                          </div>
                        </div>

                        {/* Total Amount Display */}
                        <div className="mt-6 p-4 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
                          <div className="flex justify-between items-center">
                            <span className="text-lg font-medium text-gray-700 dark:text-slate-200">
                              {t("Total Amount:")}
                            </span>
                            <span className="text-2xl font-bold text-green-600">
                              Rs {calculateTotal().toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Section 2: Purchase Order Items */}
                      <div className="bg-green-50 dark:bg-slate-950/60 rounded-lg p-6 border border-green-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center">
                            <div className="flex items-center justify-center w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg mr-3">
                              <span className="text-green-600 dark:text-green-200 text-sm">📦</span>
                            </div>
                            <h4 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                              {t("Order Items")}
                            </h4>
                          </div>
                          {!isEditing && (
                            <button
                              type="button"
                              onClick={addItem}
                              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                            >
                              {t("Add Item")}
                            </button>
                          )}
                        </div>

                        {isEditing && (
                          <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                            <div className="flex items-center">
                              <span className="text-yellow-600 text-sm mr-2">ℹ️</span>
                              <p className="text-sm text-yellow-700 dark:text-yellow-200">
                                <strong>{t("Note:")}</strong>{" "}
                                {t(
                                  "Items cannot be modified when editing an existing purchase order. Only status and order date can be updated."
                                )}
                              </p>
                            </div>
                          </div>
                        )}

                        {errors.items && (
                          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg">
                            <p className="text-sm text-red-600 dark:text-red-200">{errors.items}</p>
                          </div>
                        )}

                        {formData.items.length === 0 ? (
                          <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                            <div className="text-4xl mb-2">📦</div>
                            <p>{t("No items added yet")}</p>
                            {!isEditing ? (
                              <p className="text-sm text-gray-400 dark:text-slate-300 mt-1">
                                {t(
                                  "Click 'Add Item' to start adding products to this purchase order"
                                )}
                              </p>
                            ) : (
                              <p className="text-sm text-gray-400 dark:text-slate-300 mt-1">
                                {t("This purchase order has no items")}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
                              <thead className="bg-gray-50 dark:bg-slate-950">
                                <tr>
                                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                                    {t("Product *")}
                                  </th>
                                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-slate-400">
                                    {t("Quantity *")}
                                  </th>
                                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-slate-400">
                                    {t("Unit Price *")}
                                  </th>
                                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-slate-400">
                                    {t("Total")}
                                  </th>
                                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-slate-400">
                                    {t("Actions")}
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="bg-white dark:bg-slate-900">
                                {formData.items.map((item, index) => (
                                  <tr
                                    key={index}
                                    className="border-t border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors"
                                  >
                                    <td className="px-4 py-2">
                                      <select
                                        value={item.productId}
                                        onChange={(e) =>
                                          updateItem(index, "productId", e.target.value)
                                        }
                                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${
                                          errors[`items.${index}.productId`]
                                            ? "border-red-500"
                                            : "border-gray-300 dark:border-slate-700"
                                        }`}
                                        disabled={loading || isEditing}
                                      >
                                        <option value="">{t("Select product")}</option>
                                        {products.map((product) => (
                                          <option key={product.id} value={product.id}>
                                            {product.name} {product.sku && `(${product.sku})`}
                                          </option>
                                        ))}
                                      </select>
                                      {errors[`items.${index}.productId`] && (
                                        <p className="mt-1 text-xs text-red-600">
                                          {errors[`items.${index}.productId`]}
                                        </p>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-gray-900 dark:text-slate-100">
                                      <input
                                        type="number"
                                        min="1"
                                        value={item.quantity}
                                        onChange={(e) =>
                                          updateItem(
                                            index,
                                            "quantity",
                                            parseInt(e.target.value) || 0
                                          )
                                        }
                                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-center bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${
                                          errors[`items.${index}.quantity`]
                                            ? "border-red-500"
                                            : "border-gray-300 dark:border-slate-700"
                                        }`}
                                        disabled={loading || isEditing}
                                      />
                                      {errors[`items.${index}.quantity`] && (
                                        <p className="mt-1 text-xs text-red-600">
                                          {errors[`items.${index}.quantity`]}
                                        </p>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-gray-900 dark:text-slate-100">
                                      <div className="relative">
                                        <span className="absolute left-2 top-2 text-gray-500 text-sm">
                                          Rs
                                        </span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={item.unitPrice}
                                          onChange={(e) =>
                                            updateItem(
                                              index,
                                              "unitPrice",
                                              parseFloat(e.target.value) || 0
                                            )
                                          }
                                          className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-center bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${
                                            errors[`items.${index}.unitPrice`]
                                              ? "border-red-500"
                                              : "border-gray-300 dark:border-slate-700"
                                          }`}
                                          disabled={loading || isEditing}
                                        />
                                      </div>
                                      {errors[`items.${index}.unitPrice`] && (
                                        <p className="mt-1 text-xs text-red-600">
                                          {errors[`items.${index}.unitPrice`]}
                                        </p>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-center font-semibold text-sm text-gray-900 dark:text-slate-100">
                                      Rs{" "}
                                      {(
                                        formatToThreeDecimalPlaces(item.quantity) * item.unitPrice
                                      ).toFixed(2)}
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                      {!isEditing ? (
                                        <button
                                          type="button"
                                          onClick={() => removeItem(index)}
                                          className="text-red-600 hover:text-red-800 font-medium"
                                          title="Remove Item"
                                        >
                                          🗑️
                                        </button>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="bg-gray-50 dark:bg-slate-950">
                                <tr>
                                  <td
                                    colSpan={3}
                                    className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-slate-100"
                                  >
                                    {t("Total Amount:")}
                                  </td>
                                  <td className="px-4 py-3 text-center font-bold text-lg text-green-600">
                                    Rs {calculateTotal().toFixed(2)}
                                  </td>
                                  <td></td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Modal Footer */}
                      <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200 dark:border-slate-700">
                        <button
                          type="button"
                          onClick={closeModal}
                          className="px-6 py-2 text-sm font-medium bg-gray-300 dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-800 rounded-lg hover:bg-gray-400 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors disabled:bg-gray-200 dark:disabled:bg-slate-900"
                          disabled={loading}
                        >
                          {t("Cancel")}
                        </button>
                        <button
                          type="submit"
                          className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                          disabled={loading || formData.items.length === 0}
                        >
                          {loading
                            ? t("Saving...")
                            : isEditing
                              ? t("Update Purchase Order")
                              : t("Create Purchase Order")}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Suppliers Tab Content */}
        {activeTab === "suppliers" && (
          <>
            {/* Supplier Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                    <span className="text-green-600 text-xl">🏢</span>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                      {suppliers.length}
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400 text-sm">
                      {t("Total Suppliers")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                    <span className="text-blue-600 text-xl">✅</span>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                      {suppliers.filter((s) => s.email).length}
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400 text-sm">{t("With Email")}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-lg">
                    <span className="text-purple-600 text-xl">📞</span>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                      {suppliers.filter((s) => s.phone).length}
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400 text-sm">{t("With Phone")}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Supplier Controls */}
            <div className="surface-card rounded-lg shadow-sm p-6 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                  <input
                    type="text"
                    placeholder={t("Search suppliers...")}
                    value={supplierSearchTerm}
                    onChange={(e) => setSupplierSearchTerm(e.target.value)}
                    className="px-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-64 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <button
                  onClick={() => openSupplierModal()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                >
                  <span>+</span>
                  <span>{t("Add New Supplier")}</span>
                </button>
              </div>
            </div>

            {/* Suppliers Table */}
            <div className="surface-card overflow-hidden shadow-sm mb-4">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  <thead className="bg-gray-50 dark:bg-slate-950">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t("Supplier")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t("Contact Info")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t("Email")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t("Address")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t("Actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-12 text-center text-gray-500 dark:text-slate-400"
                        >
                          <div className="flex justify-center items-center space-x-2">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                            <span>{t("Loading suppliers...")}</span>
                          </div>
                        </td>
                      </tr>
                    ) : paginatedSuppliers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-12 text-center text-gray-500 dark:text-slate-400"
                        >
                          {supplierSearchTerm
                            ? t("No suppliers found matching your search.")
                            : t("No suppliers available. Click 'Add Supplier' to get started.")}
                        </td>
                      </tr>
                    ) : (
                      paginatedSuppliers.map((supplier) => (
                        <tr key={supplier.id} className="hover:bg-gray-50 dark:hover:bg-slate-950">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                                {supplier.name}
                              </div>
                              {supplier.contactName && (
                                <div className="text-sm text-gray-500 dark:text-slate-400">
                                  {t("Contact")}: {supplier.contactName}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {supplier.phone || t("N/A")}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {supplier.email || t("N/A")}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-slate-100 max-w-xs truncate">
                            {supplier.address || t("N/A")}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                            <button
                              onClick={() => openSupplierModal(supplier)}
                              className="text-blue-600 hover:text-blue-900 transition-colors"
                            >
                              ✏️ {t("Edit")}
                            </button>
                            <button
                              onClick={() => handleSupplierDelete(supplier.id)}
                              className="text-red-600 hover:text-red-900 transition-colors"
                            >
                              🗑️ {t("Delete")}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Supplier Pagination */}
            <InvoicePagination
              currentPage={supplierCurrentPage}
              totalPages={supplierTotalPages}
              onPageChange={handleSupplierPageChange}
              itemsPerPage={supplierItemsPerPage}
              onItemsPerPageChange={setSupplierItemsPerPage}
              totalItems={filteredSuppliers.length}
              startIndex={supplierStartIndex}
              endIndex={Math.min(supplierEndIndex, filteredSuppliers.length)}
            />
          </>
        )}

        {/* Supplier Modal */}
        {showSupplierModal && (
          <div
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          >
            <div className="surface-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
                    {isEditingSupplier ? t("Edit Supplier") : t("Add New Supplier")}
                  </h2>
                  <button
                    onClick={closeSupplierModal}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSupplierSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">
                      {t("Supplier Name")} *
                    </label>
                    <input
                      type="text"
                      value={supplierFormData.name}
                      onChange={(e) =>
                        setSupplierFormData({ ...supplierFormData, name: e.target.value })
                      }
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${
                        supplierErrors.name
                          ? "border-red-500"
                          : "border-gray-300 dark:border-slate-700"
                      }`}
                      placeholder={t("Enter supplier name")}
                    />
                    {supplierErrors.name && (
                      <p className="text-red-500 text-xs mt-1">{supplierErrors.name}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">
                      {t("Contact Name")}
                    </label>
                    <input
                      type="text"
                      value={supplierFormData.contactName}
                      onChange={(e) =>
                        setSupplierFormData({ ...supplierFormData, contactName: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      placeholder={t("Enter contact person name")}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">
                      {t("Phone")}
                    </label>
                    <input
                      type="tel"
                      value={supplierFormData.phone}
                      onChange={(e) =>
                        setSupplierFormData({ ...supplierFormData, phone: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      placeholder={t("Enter phone number")}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">
                      {t("Email")}
                    </label>
                    <input
                      type="email"
                      value={supplierFormData.email}
                      onChange={(e) =>
                        setSupplierFormData({ ...supplierFormData, email: e.target.value })
                      }
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${
                        supplierErrors.email
                          ? "border-red-500"
                          : "border-gray-300 dark:border-slate-700"
                      }`}
                      placeholder={t("Enter email address")}
                    />
                    {supplierErrors.email && (
                      <p className="text-red-500 text-xs mt-1">{supplierErrors.email}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">
                      {t("Address")}
                    </label>
                    <textarea
                      value={supplierFormData.address}
                      onChange={(e) =>
                        setSupplierFormData({ ...supplierFormData, address: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      placeholder={t("Enter supplier address")}
                      rows={3}
                    />
                  </div>

                  <div className="flex space-x-3 pt-4">
                    <button
                      type="button"
                      onClick={closeSupplierModal}
                      className="flex-1 px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-800 rounded-lg hover:bg-gray-400 dark:hover:bg-slate-600 transition-colors disabled:bg-gray-200 dark:disabled:bg-slate-900"
                    >
                      {t("Cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {loading ? t("Saving...") : isEditingSupplier ? t("Update") : t("Create")}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Purchase Order Modals */}

        {/* Detail View Modal */}
        {showDetailModal && selectedPO && (
          <div
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          >
            <div className="surface-card rounded-lg shadow-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">
                  {t("Purchase Order Details")} - #{selectedPO.id.slice(-8)}
                </h2>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-100 text-2xl"
                >
                  ×
                </button>
              </div>

              {/* Modal Body */}
              <div className="px-6 py-4 space-y-6">
                {/* PO Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-50 dark:bg-slate-900/60 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
                      {t("Order Information")}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-slate-200">{t("Order ID")}:</span>
                        <span className="font-medium">#{selectedPO.id.slice(-8)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-slate-200">
                          {t("Order Date")}:
                        </span>
                        <span className="font-medium">
                          {new Date(selectedPO.orderDate).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-slate-200">{t("Status")}:</span>
                        <StatusBadge status={selectedPO.status} />
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-slate-200">{t("Created")}:</span>
                        <span className="font-medium">
                          {new Date(selectedPO.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-slate-900/60 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
                      {t("Supplier Information")}
                    </h3>
                    {selectedPO.supplier ? (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-slate-200">{t("Name")}:</span>
                          <span className="font-medium">{selectedPO.supplier.name}</span>
                        </div>
                        {selectedPO.supplier.contactName && (
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-slate-200">
                              {t("Contact")}:
                            </span>
                            <span className="font-medium">{selectedPO.supplier.contactName}</span>
                          </div>
                        )}
                        {selectedPO.supplier.phone && (
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-slate-200">{t("Phone")}:</span>
                            <span className="font-medium">{selectedPO.supplier.phone}</span>
                          </div>
                        )}
                        {selectedPO.supplier.email && (
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-slate-200">{t("Email")}:</span>
                            <span className="font-medium">{selectedPO.supplier.email}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        {t("No supplier information available")}
                      </p>
                    )}
                  </div>
                </div>

                {/* Order Items */}
                {selectedPO.items && selectedPO.items.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-3 dark:text-slate-100">
                      {t("Order Items")}
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
                        <thead className="bg-gray-50 dark:bg-slate-950">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                              {t("Product")}
                            </th>
                            <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-slate-400">
                              {t("Quantity")}
                            </th>
                            <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-slate-400">
                              {t("Unit Price")}
                            </th>
                            <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-slate-400">
                              {t("Total")}
                            </th>
                            <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-slate-400">
                              {t("Status")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-900">
                          {selectedPO.items.map((item) => (
                            <tr
                              key={item.id}
                              className="border-t border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors"
                            >
                              <td className="px-4 py-2 text-sm">
                                <div>
                                  <div className="font-medium">
                                    {item.product?.name || t("Unknown Product")}
                                  </div>
                                  {item.product?.sku && (
                                    <div className="text-gray-500 dark:text-slate-400 text-xs">
                                      {t("SKU")}: {item.product.sku}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-sm text-center">
                                {formatToThreeDecimalPlaces(item.quantity)}
                              </td>
                              <td className="px-4 py-2 text-sm text-center">
                                Rs {item.unitPrice.toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-sm text-center font-semibold text-gray-900 dark:text-slate-100">
                                Rs{" "}
                                {(
                                  formatToThreeDecimalPlaces(item.quantity) * item.unitPrice
                                ).toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-sm text-center">
                                {item.receivedDate ? (
                                  <span className="text-green-600 text-xs">
                                    {t("Received")}{" "}
                                    {new Date(item.receivedDate).toLocaleDateString()}
                                  </span>
                                ) : (
                                  <span className="text-yellow-600 text-xs">{t("Pending")}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50 dark:bg-slate-950">
                          <tr>
                            <td
                              colSpan={3}
                              className="px-4 py-3 text-right font-semibold text-gray-900"
                            >
                              {t("Total Amount")}:
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-lg text-green-600">
                              Rs {selectedPO.totalAmount.toFixed(2)}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-slate-800">
                  <button
                    onClick={() => setShowDetailModal(false)}
                    className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-800 rounded-lg hover:bg-gray-400 dark:hover:bg-slate-600 transition-colors"
                  >
                    {t("Close")}
                  </button>
                  <button
                    onClick={() => {
                      setShowDetailModal(false);
                      openModal(selectedPO);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    ✏️ {t("Edit Order")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PurchaseOrderManagement;
