import React, { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { useAppData } from "../contexts/AppDataContext";
import { useTranslation } from "../contexts/LanguageContext";
import { usePermission, PERMISSIONS, MODULES, SCOPES } from "../hooks/usePermission";
import { useCurrentUser } from "../contexts/CurrentUserContext";

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
  outstandingBalance?: number;
  paymentStatus?: string;
  refundInvoiceId?: string;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  customer?: Customer;
  employee?: Employee;
  salesDetails?: SalesDetail[];
  payments?: Payment[];
}

interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  loyaltyPoints: number;
}

interface Employee {
  id: string;
  employee_id: string;
  name: string;
  role: string;
  email: string;
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
  costPrice?: number;
  customProduct?: Product;
}

interface Product {
  id: string;
  name: string;
  price: number;
  costPrice?: number;
  category?: Category;
}

interface Category {
  id: string;
  name: string;
}

interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  paymentMode: string;
  employeeId: string;
  notes?: string;
  createdAt: Date;
  employee?: Employee;
}

const SalesInvoices: React.FC = () => {
  const { t } = useTranslation();
  const { currentUser } = useCurrentUser();
  const { customers, employees, refreshCustomers, refreshEmployees, settings } = useAppData();

  const {
    permissions,
    hasPermission,
    loading: permissionsLoading,
    loaded: permissionsLoaded
  } = usePermission(currentUser?.id);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<SalesInvoice | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const getDefaultDateRange = useCallback((): { from: string; to: string } => {
    const today = new Date();
    const sriLankaDate = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
    const todayStr = sriLankaDate.toISOString().split("T")[0];
    const firstDayOfMonth = new Date(sriLankaDate.getFullYear(), sriLankaDate.getMonth(), 1);
    return {
      from: firstDayOfMonth.toISOString().split("T")[0],
      to: todayStr
    };
  }, []);

  // Filters
  const defaultDateRange = getDefaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaultDateRange.from);
  const [dateTo, setDateTo] = useState(defaultDateRange.to);
  const [selectedEmployee, setSelectedEmployee] = useState("all");
  const [paymentModeFilter, setPaymentModeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Sorting
  const [sortField, setSortField] = useState<string>("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const printerSettings = useMemo(
    () => ({
      selectedPrinter: settings.selectedPrinter,
      printCopies: settings.printCopies,
      silentPrint: settings.silentPrint,
      printPreview: settings.printPreview
    }),
    [settings]
  );

  const storeInfo = useMemo(
    () => ({
      name: settings.companyName || "Zentra Store",
      address: settings.companyAddress || "Your Store Address",
      phone: settings.companyPhone || "+94 XX XXX XXXX",
      email: settings.companyEmail || "info@yourstore.com"
    }),
    [settings]
  );

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SalesInvoice | null>(null);

  const fetchInvoices = useCallback(async (): Promise<SalesInvoice[]> => {
    if (!initialLoadComplete) {
      return [];
    }

    if (permissionsLoading) {
      return [];
    }

    if (!permissionsLoaded && (!permissions || permissions.length === 0)) {
      return [];
    }

    const canView = hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW);

    if (!canView) {
      toast.error(t("You don't have permission to view invoices"));
      return [];
    }

    try {
      setLoading(true);

      let restrictedDateFrom = dateFrom;
      let restrictedDateTo = dateTo;

      if (!hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW, SCOPES.ALL)) {
        // Use Sri Lanka timezone for consistent local date handling
        const today = new Date();
        const sriLankaDate = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
        const todayStr = sriLankaDate.toISOString().split("T")[0];

        if (hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW, SCOPES.MONTHLY)) {
          const firstDayOfMonth = new Date(sriLankaDate.getFullYear(), sriLankaDate.getMonth(), 1);
          restrictedDateFrom = restrictedDateFrom || firstDayOfMonth.toISOString().split("T")[0];
          restrictedDateTo = restrictedDateTo || todayStr;
          setDateFrom(restrictedDateFrom);
          setDateTo(restrictedDateTo);
        } else if (hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW, SCOPES.DAILY)) {
          restrictedDateFrom = todayStr;
          restrictedDateTo = todayStr;
          setDateFrom(restrictedDateFrom);
          setDateTo(restrictedDateTo);
        } else {
          restrictedDateFrom = restrictedDateFrom || todayStr;
          restrictedDateTo = restrictedDateTo || todayStr;
          setDateFrom(restrictedDateFrom);
          setDateTo(restrictedDateTo);
        }
      }

      const filters = {
        dateFrom: restrictedDateFrom || undefined,
        dateTo: restrictedDateTo || undefined,
        employeeId: selectedEmployee !== "all" ? selectedEmployee : undefined,
        paymentMode: paymentModeFilter !== "all" ? paymentModeFilter : undefined
      };

      const data = await window.api.salesInvoices.findMany(filters);

      setInvoices(data);
      return data;

      const negativeInvoicesCount = data.filter(
        (invoice) =>
          invoice.totalAmount < 0 ||
          invoice.subTotal < 0 ||
          invoice.amountReceived < 0 ||
          invoice.discountAmount < 0 ||
          invoice.taxAmount < 0
      ).length;

      if (negativeInvoicesCount > 0) {
        // Removed success toast as requested
      } else {
        // Removed success toast as requested
      }
    } catch (error) {
      console.error("Error fetching invoices:", error);
      toast.error(t("Failed to load invoices. Please try again."));
      return [];
    } finally {
      setLoading(false);
    }
  }, [
    dateFrom,
    dateTo,
    selectedEmployee,
    paymentModeFilter,
    permissionsLoading,
    permissionsLoaded,
    initialLoadComplete,
    hasPermission,
    currentUser?.id,
    permissions,
    t
  ]);

  const fetchEmployees = useCallback(async (): Promise<void> => {
    try {
      await refreshEmployees({ force: true });
    } catch (error) {
      console.error("Error fetching employees:", error);
    }
  }, [refreshEmployees]);

  const fetchCustomers = useCallback(async (): Promise<void> => {
    try {
      await refreshCustomers({ force: true });
    } catch (error) {
      console.error("Error fetching customers:", error);
    }
  }, [refreshCustomers]);

  const calculateInvoiceProfit = useCallback((invoice: SalesInvoice): number => {
    if (!invoice.salesDetails || invoice.salesDetails.length === 0) {
      return 0;
    }

    if (invoice.refundInvoiceId) {
      return 0;
    }

    return invoice.salesDetails.reduce((sum, detail) => {
      const cost = detail.costPrice ?? detail.product?.costPrice ?? 0;
      return sum + (detail.unitPrice - cost) * detail.quantity;
    }, 0);
  }, []);

  const refreshInvoiceDetails = useCallback(
    async (invoiceId: string): Promise<SalesInvoice | null> => {
      try {
        const detailedInvoice = await window.api.salesInvoices.findById(invoiceId);
        setSelectedInvoice(detailedInvoice);
        return detailedInvoice;
      } catch (error) {
        console.error("Error fetching invoice details:", error);
        toast.error(t("Failed to load invoice details."));
        return null;
      }
    },
    [t]
  );

  const hasInvoiceDetails = (invoice: SalesInvoice): boolean => {
    return (
      Array.isArray(invoice.salesDetails) &&
      Array.isArray(invoice.payments) &&
      !!invoice.employee &&
      (invoice.customerId ? !!invoice.customer : true)
    );
  };

  const handleAddPayment = useCallback(async (): Promise<void> => {
    if (!selectedInvoice) return;
    if (paymentLoading) return;

    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) {
      toast.error(t("Please enter a valid payment amount!"));
      return;
    }

    if (amount > (selectedInvoice.outstandingBalance || 0)) {
      toast.error(t("Payment amount cannot exceed outstanding balance!"));
      return;
    }

    const employeeId =
      currentUser?.id || employees.find((emp) => emp.employee_id === "ADMIN001")?.id;
    if (!employeeId) {
      toast.error(t("Employee not found. Please contact system administrator."));
      return;
    }

    try {
      setPaymentLoading(true);
      const toastId = "payment-processing";
      toast.loading(t("Processing..."), { id: toastId });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await window.api.payments.create({
        invoiceId: selectedInvoice.id,
        amount: amount,
        paymentMode: paymentMode,
        employeeId: employeeId,
        notes: paymentNotes || undefined
      });

      toast.success(t("Payment added successfully!"), { id: toastId });
      setShowPaymentModal(false);
      setPaymentAmount("");
      setPaymentNotes("");

      // Refresh invoice data
      const invoiceId = selectedInvoice.id;
      void fetchInvoices().then((updatedInvoices) => {
        const updatedInvoice = updatedInvoices.find((inv) => inv.id === invoiceId);
        if (updatedInvoice) {
          setSelectedInvoice(updatedInvoice);
        } else {
          void refreshInvoiceDetails(invoiceId);
        }
      });
    } catch (error) {
      console.error("Error adding payment:", error);
      toast.error(t("Failed to add payment. Please try again."), { id: "payment-processing" });
    } finally {
      setPaymentLoading(false);
    }
  }, [
    selectedInvoice,
    paymentLoading,
    paymentAmount,
    paymentMode,
    paymentNotes,
    employees,
    fetchInvoices,
    refreshInvoiceDetails,
    currentUser?.id,
    t
  ]);

  const openPaymentModal = useCallback((invoice: SalesInvoice): void => {
    setSelectedInvoice(invoice);
    setShowPaymentModal(true);
    setPaymentAmount("");
    setPaymentMode("cash");
    setPaymentNotes("");
  }, []);

  useEffect(() => {
    const loadInitialData = async (): Promise<void> => {
      await Promise.all([fetchEmployees(), fetchCustomers()]);
      setInitialLoadComplete(true);
    };

    void loadInitialData();
  }, [fetchEmployees, fetchCustomers]);

  // Separate effect for fetchInvoices to run when permissions are ready
  useEffect(() => {
    if (permissionsLoaded || (permissions && permissions.length > 0)) {
      fetchInvoices();
    }
  }, [fetchInvoices, permissionsLoaded, permissions]);
  console.log(invoices, "invoices");
  const filteredInvoices = invoices.filter((invoice) => {
    const searchLower = searchTerm.toLowerCase();
    const invoiceId = String(invoice.id ?? "").toLowerCase();
    const customerName = invoice.customer?.name ? invoice.customer.name.toLowerCase() : "";
    const employeeName = invoice.employee?.name ? invoice.employee.name.toLowerCase() : "";
    const matchesSearch =
      invoiceId.includes(searchLower) ||
      customerName.includes(searchLower) ||
      employeeName.includes(searchLower);

    const matchesEmployee = selectedEmployee === "all" || invoice.employeeId === selectedEmployee;
    const matchesPaymentMode =
      paymentModeFilter === "all" || invoice.paymentMode === paymentModeFilter;
    const matchesCustomer = customerFilter === "all" || invoice.customerId === customerFilter;

    // Calculate payment status for filtering
    const totalPayments = invoice.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
    const outstanding = Math.max(0, invoice.totalAmount - totalPayments);
    let paymentStatus = "paid";
    if (outstanding > 0) {
      paymentStatus = totalPayments > 0 ? "partial" : "unpaid";
    }
    const matchesStatus = statusFilter === "all" || paymentStatus === statusFilter;

    const invoiceDate = new Date(invoice.date);
    const invoiceDateStr = invoiceDate.toLocaleDateString("en-CA");
    const matchesDateFrom = !dateFrom || invoiceDateStr >= dateFrom;
    const matchesDateTo = !dateTo || invoiceDateStr <= dateTo;

    // Filter out invoices with negative values
    const hasValidAmounts =
      invoice.totalAmount >= 0 &&
      invoice.subTotal >= 0 &&
      invoice.amountReceived >= 0 &&
      invoice.discountAmount >= 0 &&
      invoice.taxAmount >= 0;

    return (
      matchesSearch &&
      matchesEmployee &&
      matchesPaymentMode &&
      matchesCustomer &&
      matchesStatus &&
      matchesDateFrom &&
      matchesDateTo &&
      hasValidAmounts
    );
  });

  // Sort filtered invoices
  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
    const getValue = (invoice: SalesInvoice, field: string): string | number => {
      switch (field) {
        case "date":
          return new Date(invoice.date).getTime();
        case "totalAmount":
          return invoice.totalAmount;
        case "customer":
          return invoice.customer?.name || "Walk-in Customer";
        case "employee":
          return invoice.employee?.name || "";
        case "paymentMode":
          return invoice.paymentMode;
        case "id":
          return invoice.id;
        default:
          return "";
      }
    };

    const valueA = getValue(a, sortField);
    const valueB = getValue(b, sortField);

    if (typeof valueA === "number" && typeof valueB === "number") {
      return sortOrder === "asc" ? valueA - valueB : valueB - valueA;
    }

    const stringA = String(valueA).toLowerCase();
    const stringB = String(valueB).toLowerCase();

    if (sortOrder === "asc") {
      return stringA.localeCompare(stringB);
    } else {
      return stringB.localeCompare(stringA);
    }
  });

  // Handle sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // Update pagination when sorted invoices change
  useEffect(() => {
    setCurrentPage(1); // Reset to first page when filters change
  }, [sortedInvoices.length]);

  // Calculate pagination
  const totalPages = Math.ceil(sortedInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedInvoices = sortedInvoices.slice(startIndex, endIndex);

  // Pagination handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1); // Reset to first page when changing items per page
  };

  const viewInvoiceDetails = async (invoice: SalesInvoice): Promise<void> => {
    if (!canViewInvoiceDetails) {
      toast.error(t("You don't have permission to view invoice details"));
      return;
    }

    setSelectedInvoice(invoice);
    setShowDetails(true);

    if (!hasInvoiceDetails(invoice)) {
      await refreshInvoiceDetails(invoice.id);
    }
  };

  const handleRefund = async (invoice: SalesInvoice): Promise<void> => {
    if (!canRefundInvoices) {
      toast.error(t("You don't have permission to process refunds"));
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to refund invoice #${invoice.id.slice(-8)}? This will restore stock and reverse loyalty points.`
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      const result = await window.api.salesInvoices.refund(invoice.id, {
        employeeId: invoice.employeeId,
        reason: "Full refund"
      });

      toast.success(`${t("Refund created:")} ${result.refundInvoice.id.slice(-8)}`);
      // Refresh list and details
      const updatedInvoices = await fetchInvoices();
      if (selectedInvoice && selectedInvoice.id === invoice.id) {
        const updatedInvoice = updatedInvoices.find((inv) => inv.id === invoice.id);
        if (updatedInvoice) {
          setSelectedInvoice(updatedInvoice);
        } else {
          await refreshInvoiceDetails(invoice.id);
        }
      }
    } catch (error: any) {
      console.error("Refund failed:", error);
      toast.error(error?.message || t("Refund failed. See console for details."));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInvoice = (invoice: SalesInvoice): void => {
    if (!canDeleteInvoices) {
      toast.error(t("You don't have permission to delete invoices"));
      return;
    }

    setInvoiceToDelete(invoice);
    setShowDeleteModal(true);
  };

  const confirmDeleteInvoice = async (): Promise<void> => {
    if (!invoiceToDelete) return;

    try {
      setLoading(true);
      await window.api.salesInvoices.delete(invoiceToDelete.id);
      toast.success(`${t("Invoice")} ${invoiceToDelete.id.slice(-8)} ${t("deleted successfully")}`);

      setShowDeleteModal(false);
      setInvoiceToDelete(null);
      await fetchInvoices();

      // Close details if the deleted invoice was selected
      if (selectedInvoice && selectedInvoice.id === invoiceToDelete.id) {
        setSelectedInvoice(null);
        setShowDetails(false);
      }
    } catch (error: any) {
      console.error("Delete failed:", error);
      toast.error(error?.message || t("Delete failed. See console for details."));
    } finally {
      setLoading(false);
    }
  };

  const generatePrintableInvoice = async (invoice: SalesInvoice): Promise<void> => {
    try {
      // Calculate total amount received from payments
      const totalReceived = invoice.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;

      // For credit payments, don't show change (outstanding balance will be shown separately)
      const change = invoice.paymentMode === "credit" ? 0 : totalReceived - invoice.totalAmount;

      // Convert invoice data to receipt format
      const receiptData = {
        header: storeInfo.name,
        storeName: storeInfo.name,
        storeAddress: storeInfo.address,
        storePhone: storeInfo.phone,
        invoiceNumber: invoice.id.slice(-8), // Last 8 characters for receipt
        date: new Date(invoice.date).toLocaleDateString(),
        time: new Date(invoice.date).toLocaleTimeString(),
        items: invoice.salesDetails
          ? invoice.salesDetails.map((detail) => ({
              name:
                (detail.product?.name || detail.customProduct?.name || "Unknown Product").length >
                20
                  ? (
                      detail.product?.name ||
                      detail.customProduct?.name ||
                      "Unknown Product"
                    ).substring(0, 17) + "..."
                  : detail.product?.name || detail.customProduct?.name || "Unknown Product",
              quantity: detail.quantity,
              price: detail.unitPrice,
              total: detail.quantity * detail.unitPrice,
              unit: detail.unit || "pcs",
              originalPrice: detail.originalPrice
            }))
          : [],
        subtotal: invoice.subTotal,
        tax: invoice.taxAmount,
        discount: invoice.discountAmount,
        total: invoice.totalAmount,
        paymentMethod: invoice.paymentMode,
        amountReceived: totalReceived,
        change: change,
        footer: `${invoice.employee?.name || "N/A"}`
      };

      // Print configuration from settings
      const printConfig = {
        width: 300,
        height: 600,
        margin: "0 0 0 0",
        copies: printerSettings.printCopies,
        preview: printerSettings.printPreview,
        silent: printerSettings.silentPrint
      };

      // Print the receipt using the printer service
      const result = await window.api.printer.printReceipt(
        receiptData,
        printerSettings.selectedPrinter || undefined,
        printConfig
      );

      if (result.success) {
        toast.success(t("Invoice printed successfully!"));
      } else {
        toast.error(`${t("Print failed:")} ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error printing invoice:", error);
      toast.error(t("Failed to print invoice. Please check printer settings."));
    }
  };

  const exportToCSV = (): void => {
    if (!canExportReports) {
      toast.error(t("You don't have permission to export reports"));
      return;
    }

    const headers = [
      "Invoice ID",
      "Date",
      "Customer",
      "Employee",
      "Subtotal",
      "Discount",
      "Tax",
      "Total Amount",
      "Profit",
      "Payment Mode",
      "Total Received",
      "Outstanding Balance",
      "Payment Status"
    ];

    const csvData = [
      headers.join(","),
      ...sortedInvoices.map((invoice) => {
        const totalReceived = invoice.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
        const profit = calculateInvoiceProfit(invoice);
        return [
          invoice.id,
          new Date(invoice.date).toLocaleDateString(),
          invoice.customer?.name || "Walk-in",
          invoice.employee?.name || "",
          invoice.subTotal.toFixed(2),
          invoice.discountAmount.toFixed(2),
          invoice.taxAmount.toFixed(2),
          invoice.totalAmount.toFixed(2),
          profit.toFixed(2),
          invoice.paymentMode,
          totalReceived.toFixed(2),
          (invoice.outstandingBalance || 0).toFixed(2),
          invoice.paymentStatus || "paid"
        ].join(",");
      })
    ].join("\n");

    const blob = new Blob([csvData], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales_invoices_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success(t("Invoice data exported to CSV!"));
  };

  const generateSummaryReport = (): void => {
    if (!canViewReports || !canExportReports) {
      toast.error(t("You don't have permission to generate reports"));
      return;
    }

    // Additional filtering for summary report - ensure no negative values
    const validInvoices = sortedInvoices.filter(
      (invoice) =>
        invoice.totalAmount >= 0 &&
        invoice.subTotal >= 0 &&
        invoice.discountAmount >= 0 &&
        invoice.taxAmount >= 0
    );

    const summary = {
      totalInvoices: validInvoices.length,
      totalRevenue: validInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0),
      totalProfit: validInvoices.reduce((sum, inv) => sum + calculateInvoiceProfit(inv), 0),
      totalReceived: validInvoices.reduce(
        (sum, inv) => sum + (inv.payments?.reduce((pSum, p) => pSum + p.amount, 0) || 0),
        0
      ),
      totalDiscounts: validInvoices.reduce((sum, inv) => sum + inv.discountAmount, 0),
      totalTax: validInvoices.reduce((sum, inv) => sum + inv.taxAmount, 0),
      averageOrderValue:
        validInvoices.length > 0
          ? validInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0) / validInvoices.length
          : 0,
      paymentMethodBreakdown: {
        cash: validInvoices.filter((inv) => inv.paymentMode === "cash").length,
        card: validInvoices.filter((inv) => inv.paymentMode === "card").length,
        mobile: validInvoices.filter((inv) => inv.paymentMode === "mobile").length
      },
      dateRange: {
        from: dateFrom || "All time",
        to: dateTo || "Present"
      }
    };

    const reportContent = `
SUMMARY REPORT - Sales Invoices
Generated on: ${new Date().toLocaleString()}
Date Range: ${summary.dateRange.from} to ${summary.dateRange.to}
Filters Applied: ${searchTerm ? `Search: "${searchTerm}"` : "None"}, Employee: ${selectedEmployee === "all" ? "All" : employees.find((e) => e.id === selectedEmployee)?.name || "Unknown"}, Payment: ${paymentModeFilter === "all" ? "All" : paymentModeFilter}

═══════════════════════════════════════════════════════════════

INVOICE STATISTICS:
• Total Valid Invoices: ${summary.totalInvoices}
• Total Revenue: Rs ${summary.totalRevenue.toFixed(2)}
• Total Profit: Rs ${summary.totalProfit.toFixed(2)}
• Total Received: Rs ${summary.totalReceived.toFixed(2)}
• Total Discounts Applied: Rs ${summary.totalDiscounts.toFixed(2)}
• Total Tax Collected: Rs ${summary.totalTax.toFixed(2)}
• Average Order Value: Rs ${summary.averageOrderValue.toFixed(2)}

PAYMENT METHOD BREAKDOWN:
• Cash Payments: ${summary.paymentMethodBreakdown.cash}
• Card Payments: ${summary.paymentMethodBreakdown.card}
• Mobile Payments: ${summary.paymentMethodBreakdown.mobile}

═══════════════════════════════════════════════════════════════

Note: This report excludes ${invoices.length - validInvoices.length} invoices with negative values for data integrity.
    `.trim();

    const blob = new Blob([reportContent], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales_summary_report_${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success(t("Summary report generated and downloaded!"));
  };

  const exportFilteredCSV = (includeNegativeValues: boolean = false): void => {
    if (!canExportReports) {
      toast.error(t("You don't have permission to export reports"));
      return;
    }

    let exportData = sortedInvoices;

    if (!includeNegativeValues) {
      // Apply additional negative value filtering for export
      exportData = sortedInvoices.filter(
        (invoice) =>
          invoice.totalAmount >= 0 &&
          invoice.subTotal >= 0 &&
          invoice.amountReceived >= 0 &&
          invoice.discountAmount >= 0 &&
          invoice.taxAmount >= 0
      );
    }

    const headers = [
      "Invoice ID",
      "Date",
      "Time",
      "Customer",
      "Employee",
      "Subtotal",
      "Discount",
      "Tax",
      "Total Amount",
      "Payment Mode",
      "Amount Received",
      "Change",
      "Status"
    ];

    const csvData = [
      headers.join(","),
      ...exportData.map((invoice) => {
        const change = invoice.amountReceived - invoice.totalAmount;
        const status = change >= 0 ? "Completed" : "Pending";

        return [
          invoice.id,
          new Date(invoice.date).toLocaleDateString(),
          new Date(invoice.date).toLocaleTimeString(),
          invoice.customer?.name || "Walk-in",
          invoice.employee?.name || "",
          invoice.subTotal.toFixed(2),
          invoice.discountAmount.toFixed(2),
          invoice.taxAmount.toFixed(2),
          invoice.totalAmount.toFixed(2),
          invoice.paymentMode,
          invoice.amountReceived.toFixed(2),
          change.toFixed(2),
          status
        ].join(",");
      })
    ].join("\n");

    const blob = new Blob([csvData], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `filtered_sales_invoices_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    const filteredCount = invoices.length - exportData.length;
    if (filteredCount > 0) {
      toast.success(
        `${t("CSV exported!")} (${filteredCount} ${t("invoices with negative values excluded")})`
      );
    } else {
      toast.success(t("Filtered CSV exported successfully!"));
    }
  };

  // Permission helper functions (memoized to prevent re-renders)
  const canViewInvoices = React.useMemo(
    () => hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW),
    [hasPermission]
  );
  const canViewInvoiceDetails = React.useMemo(
    () => hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW_DETAIL),
    [hasPermission]
  );
  const canEditInvoices = React.useMemo(
    () => hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.EDIT),
    [hasPermission]
  );
  const canDeleteInvoices = React.useMemo(
    () => hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.DELETE),
    [hasPermission]
  );
  const canRefundInvoices = React.useMemo(
    () => hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.REFUND),
    [hasPermission]
  );
  const canViewReports = React.useMemo(
    () => hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.VIEW),
    [hasPermission]
  );
  const canExportReports = React.useMemo(
    () => hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.EXPORT),
    [hasPermission]
  );

  const canViewAllInvoices = React.useMemo(
    () => hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW, SCOPES.ALL),
    [hasPermission]
  );
  const canViewDailyInvoices = React.useMemo(
    () => hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW, SCOPES.DAILY),
    [hasPermission]
  );
  const canViewMonthlyInvoices = React.useMemo(
    () => hasPermission(MODULES.INVOICES, PERMISSIONS.INVOICES.VIEW, SCOPES.MONTHLY),
    [hasPermission]
  );

  const getTotalStats = () => {
    const totalRevenue = sortedInvoices
      .filter((invoice) => !invoice.refundInvoiceId)
      .reduce((sum, invoice) => sum + invoice.totalAmount, 0);
    const totalDiscount = sortedInvoices.reduce((sum, invoice) => sum + invoice.discountAmount, 0);
    const totalTax = sortedInvoices.reduce((sum, invoice) => sum + invoice.taxAmount, 0);
    const totalOutstandingAmount = sortedInvoices
      .filter((invoice) => !invoice.refundInvoiceId)
      .reduce((sum, invoice) => {
        const totalPayments = invoice.payments?.reduce((pSum, p) => pSum + p.amount, 0) || 0;
        const outstanding = Math.max(0, invoice.totalAmount - totalPayments);
        return sum + outstanding;
      }, 0);
    const totalOutstandingCount = sortedInvoices
      .filter((invoice) => !invoice.refundInvoiceId)
      .filter((invoice) => {
        const totalPayments = invoice.payments?.reduce((pSum, p) => pSum + p.amount, 0) || 0;
        return invoice.totalAmount - totalPayments > 0;
      }).length;

    const totalProfit = sortedInvoices
      .filter((invoice) => !invoice.refundInvoiceId)
      .reduce((sum, invoice) => sum + calculateInvoiceProfit(invoice), 0);

    return {
      totalRevenue,
      totalDiscount,
      totalTax,
      totalOutstandingAmount,
      totalOutstandingCount,
      totalProfit
    };
  };

  const stats = getTotalStats();
  const selectedInvoiceProfit = selectedInvoice ? calculateInvoiceProfit(selectedInvoice) : 0;

  // Show loading state while permissions are being checked
  if (permissionsLoading || !permissionsLoaded) {
    return (
      <div className="p-4 lg:p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-slate-400">{t("Loading permissions...")}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show access denied if user doesn't have permission to view invoices
  // Only check permissions after they've finished loading and been loaded
  if (permissionsLoaded && !permissionsLoading && !canViewInvoices) {
    return (
      <div className="p-4 lg:p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="text-6xl mb-4">🔒</div>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-2">
                {t("Access Denied")}
              </h2>
              <p className="text-gray-600 dark:text-slate-400">
                {t("You don't have permission to view sales invoices.")}
              </p>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
                {t("Please contact your administrator for access.")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 dark:text-slate-100 mb-2">
            {t("Sales Invoices")}
          </h1>
          {/* Permission Indicator */}
          <div className="flex items-center space-x-2 mb-2">
            {canViewAllInvoices && (
              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                {t("Full Access")}
              </span>
            )}
            {!canViewAllInvoices && canViewMonthlyInvoices && (
              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                {t("Monthly Access")}
              </span>
            )}
            {!canViewAllInvoices && !canViewMonthlyInvoices && canViewDailyInvoices && (
              <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">
                {t("Daily Access Only")}
              </span>
            )}
            {currentUser && (
              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                {t("Logged in as:")} {currentUser.name}
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <p className="text-gray-600 dark:text-slate-400">
              {t("Manage and view sales transaction records")}
            </p>
            {sortedInvoices.length > 0 && (
              <div className="text-sm text-gray-500 dark:text-slate-400 mt-1 sm:mt-0">
                {sortedInvoices.length === invoices.length
                  ? `${sortedInvoices.length} total invoices`
                  : `${sortedInvoices.length} of ${invoices.length} invoices (filtered)`}
              </div>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Total Revenue")}</p>
                <p className="text-xl font-bold text-green-600">
                  Rs {stats.totalRevenue.toFixed(2)}
                </p>
              </div>
              <div className="text-2xl">💰</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Total Profit")}</p>
                <p className="text-xl font-bold text-emerald-600">
                  Rs {stats.totalProfit.toFixed(2)}
                </p>
              </div>
              <div className="text-2xl">💹</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Total Invoices")}</p>
                <p className="text-xl font-bold text-purple-600">{sortedInvoices.length}</p>
              </div>
              <div className="text-2xl">📄</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Total Discounts")}</p>
                <p className="text-xl font-bold text-orange-600">
                  Rs {stats.totalDiscount.toFixed(2)}
                </p>
              </div>
              <div className="text-2xl">🏷️</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {t("Total Outstanding")}
                </p>
                <p className="text-xl font-bold text-red-600">
                  Rs {stats.totalOutstandingAmount.toFixed(2)}
                </p>
              </div>
              <div className="text-2xl">⚠️</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {t("Outstanding Count")}
                </p>
                <p className="text-xl font-bold text-red-600">
                  {stats.totalOutstandingCount} invoices
                </p>
              </div>
              <div className="text-2xl">�</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-8 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Search")}
              </label>
              <input
                type="text"
                placeholder={t("Search invoices...")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("From Date")}
              </label>
              <input
                type="date"
                value={dateFrom}
                disabled={!canViewAllInvoices}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("To Date")}
              </label>
              <input
                type="date"
                value={dateTo}
                disabled={!canViewAllInvoices}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Employee")}
              </label>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">{t("All Employees")}</option>
                {employees.map((employee, index) => (
                  <option
                    key={employee.id ?? employee.employee_id ?? `employee-${index}`}
                    value={employee.id}
                  >
                    {employee.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Payment Mode")}
              </label>
              <select
                value={paymentModeFilter}
                onChange={(e) => setPaymentModeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">{t("All Payments")}</option>
                <option value="cash">{t("Cash")}</option>
                <option value="card">{t("Card")}</option>
                <option value="credit">{t("Credit")}</option>
                <option value="mobile">{t("Mobile Payment")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Status")}
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">{t("All Status")}</option>
                <option value="paid">{t("Paid")}</option>
                <option value="partial">{t("Partial")}</option>
                <option value="unpaid">{t("Unpaid")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Customer")}
              </label>
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">{t("All Customers")}</option>
                {customers.map((customer, index) => (
                  <option key={customer.id ?? `customer-${index}`} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end space-x-2">
              {canExportReports && (
                <>
                  <button
                    onClick={exportToCSV}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
                  >
                    📊 {t("Export CSV")}
                  </button>
                  <button
                    onClick={() => exportFilteredCSV(false)}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                  >
                    📈 {t("Filtered CSV")}
                  </button>
                </>
              )}
              {canViewReports && canExportReports && (
                <button
                  onClick={generateSummaryReport}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  📋 {t("Summary Report")}
                </button>
              )}
              {!canExportReports && (
                <div className="flex-1 px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-500 dark:text-slate-400 rounded-lg text-sm text-center">
                  {t("Export restricted")}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Invoices Table */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("id")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Invoice ID")}</span>
                      {sortField === "id" && (
                        <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("date")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Date & Time")}</span>
                      {sortField === "date" && (
                        <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("customer")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Customer")}</span>
                      {sortField === "customer" && (
                        <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("employee")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Employee")}</span>
                      {sortField === "employee" && (
                        <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("totalAmount")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200 ml-auto"
                    >
                      <span>{t("Total Amount")}</span>
                      {sortField === "totalAmount" && (
                        <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("paymentMode")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Payment")}</span>
                      {sortField === "paymentMode" && (
                        <span className="text-blue-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t("Status")}
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
                      {t("Loading invoices...")}
                    </td>
                  </tr>
                ) : paginatedInvoices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-gray-500 dark:text-slate-400"
                    >
                      <div className="text-4xl mb-2">📄</div>
                      <p>{t("No invoices found")}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {filteredInvoices.length === 0
                          ? invoices.length === 0
                            ? t("No sales have been recorded yet")
                            : t("Try adjusting your filters")
                          : t("No invoices on this page")}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className={`hover:bg-gray-50 dark:hover:bg-slate-950 ${
                        invoice.refundInvoiceId
                          ? "bg-red-50 dark:bg-slate-800 border-l-4 border-red-400"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">
                        #{invoice.id}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        <div>
                          <div className="font-medium">
                            {new Date(invoice.date).toLocaleDateString()}
                          </div>
                          <div className="text-gray-500 dark:text-slate-400">
                            {new Date(invoice.date).toLocaleTimeString()}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        {invoice.customer ? (
                          <div>
                            <div className="font-medium">{invoice.customer.name}</div>
                            {invoice.customer.phone && (
                              <div className="text-gray-500 dark:text-slate-400">
                                {invoice.customer.phone}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-500 dark:text-slate-400">
                            {t("Walk-in Customer")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        {invoice.employee?.name || t("Unknown")}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-green-600 text-right">
                        Rs {invoice.totalAmount.toFixed(2)}
                        {invoice.discountAmount > 0 && (
                          <div className="text-xs text-orange-600">
                            -Rs {invoice.discountAmount.toFixed(2)} {t("discount")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            invoice.paymentMode === "cash"
                              ? "bg-green-100 text-green-800"
                              : invoice.paymentMode === "card"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {invoice.paymentMode.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        <div className="flex flex-col space-y-1">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              (invoice.paymentStatus || "paid") === "paid"
                                ? "bg-green-100 text-green-800"
                                : (invoice.paymentStatus || "paid") === "partial"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                            }`}
                          >
                            {(invoice.paymentStatus || "paid").toUpperCase()}
                          </span>
                          {(invoice.outstandingBalance || 0) > 0 && (
                            <span className="text-xs text-red-600">
                              {t("Outstanding:")} Rs {(invoice.outstandingBalance || 0).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center space-x-2">
                          {canViewInvoiceDetails && (
                            <button
                              onClick={() => viewInvoiceDetails(invoice)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                              title={t("View Details")}
                            >
                              👁️
                            </button>
                          )}
                          <button
                            onClick={async () => await generatePrintableInvoice(invoice)}
                            className="text-green-600 hover:text-green-800 text-sm font-medium"
                            title={t("Print Invoice")}
                          >
                            🖨️
                          </button>
                          {canEditInvoices && (invoice.outstandingBalance || 0) > 0 && (
                            <button
                              onClick={() => openPaymentModal(invoice)}
                              className="text-orange-600 hover:text-orange-800 text-sm font-medium"
                              title={t("Add Payment")}
                            >
                              💰
                            </button>
                          )}
                          {canRefundInvoices && (
                            <button
                              onClick={() => handleRefund(invoice)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium"
                              title={t("Refund Invoice")}
                              disabled={!!invoice.refundInvoiceId}
                            >
                              {invoice.refundInvoiceId ? t("Refunded") : t("Refund")}
                            </button>
                          )}
                          {canDeleteInvoices && (
                            <button
                              onClick={() => handleDeleteInvoice(invoice)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium"
                              title={t("Delete Invoice")}
                            >
                              🗑️
                            </button>
                          )}
                          {!canViewInvoiceDetails && !canRefundInvoices && !canDeleteInvoices && (
                            <span className="text-gray-400 text-sm">
                              {t("No actions available")}
                            </span>
                          )}
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
        {sortedInvoices.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-4 mt-4">
            <div className="flex flex-col sm:flex-row justify-between items-center space-y-3 sm:space-y-0">
              {/* Items per page selector */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-700 dark:text-slate-200">{t("Show:")}</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
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
                  end: Math.min(endIndex, sortedInvoices.length),
                  total: sortedInvoices.length
                })}
              </div>

              {/* Page navigation */}
              <div className="flex items-center space-x-1">
                {/* Previous button */}
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
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
                      onClick={() => handlePageChange(page)}
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
                  onClick={() => handlePageChange(currentPage + 1)}
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
        )}

        {showDetails && selectedInvoice && (
          <div
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          >
            <div className="bg-white dark:bg-slate-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-800 dark:text-slate-100">
                    {t("Invoice Details")} #{selectedInvoice.id.slice(-8)}
                  </h2>
                  <button
                    onClick={() => setShowDetails(false)}
                    className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:text-slate-200 text-2xl"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
                      {t("Invoice Information")}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div>
                        <strong>{t("Date:")}</strong>{" "}
                        {new Date(selectedInvoice.date).toLocaleString()}
                      </div>
                      <div>
                        <strong>{t("Employee:")}</strong>{" "}
                        {selectedInvoice.employee?.name || t("Unknown")}
                      </div>
                      <div>
                        <strong>{t("Payment Mode:")}</strong> {selectedInvoice.paymentMode}
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
                      {t("Customer Information")}
                    </h3>
                    {selectedInvoice.customer ? (
                      <div className="space-y-2 text-sm">
                        <div>
                          <strong>{t("Name:")}</strong> {selectedInvoice.customer.name}
                        </div>
                        {selectedInvoice.customer.email && (
                          <div>
                            <strong>{t("Email:")}</strong> {selectedInvoice.customer.email}
                          </div>
                        )}
                        {selectedInvoice.customer.phone && (
                          <div>
                            <strong>{t("Phone:")}</strong> {selectedInvoice.customer.phone}
                          </div>
                        )}
                        <div>
                          <strong>{t("Loyalty Points:")}</strong>{" "}
                          {selectedInvoice.customer.loyaltyPoints}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        {t("Walk-in Customer")}
                      </p>
                    )}
                  </div>
                </div>

                {/* Payment History */}
                {selectedInvoice.payments && selectedInvoice.payments.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
                      {t("Payment History")}
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border border-gray-200 dark:border-slate-700 rounded-lg">
                        <thead className="bg-gray-50 dark:bg-slate-950">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Date")}
                            </th>
                            <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Amount")}
                            </th>
                            <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Method")}
                            </th>
                            <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Employee")}
                            </th>
                            <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Notes")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedInvoice.payments.map((payment) => (
                            <tr
                              key={payment.id}
                              className="border-t border-gray-200 dark:border-slate-700"
                            >
                              <td className="px-4 py-2 text-sm text-gray-900 dark:text-slate-100">
                                {new Date(payment.createdAt).toLocaleDateString()}{" "}
                                {new Date(payment.createdAt).toLocaleTimeString()}
                              </td>
                              <td className="px-4 py-2 text-right text-sm text-gray-900 dark:text-slate-100">
                                Rs {payment.amount.toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900 dark:text-slate-100">
                                <span
                                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                    payment.paymentMode === "cash"
                                      ? "bg-green-100 text-green-800"
                                      : payment.paymentMode === "card"
                                        ? "bg-blue-100 text-blue-800"
                                        : "bg-purple-100 text-purple-800"
                                  }`}
                                >
                                  {payment.paymentMode.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900 dark:text-slate-100">
                                {payment.employee?.name || "Unknown"}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900 dark:text-slate-100">
                                {payment.notes || "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedInvoice.salesDetails && selectedInvoice.salesDetails.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
                      {t("Items Purchased")}
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border border-gray-200 dark:border-slate-700 rounded-lg">
                        <thead className="bg-gray-50 dark:bg-slate-950">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Product")}
                            </th>
                            <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Quantity")}
                            </th>
                            <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Unit Price")}
                            </th>
                            <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-slate-200">
                              {t("Total")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedInvoice.salesDetails.map((detail) => (
                            <tr
                              key={detail.id}
                              className="border-t border-gray-200 dark:border-slate-700"
                            >
                              <td className="px-4 py-2 text-sm">
                                {detail.product?.name ||
                                  detail.customProduct?.name ||
                                  "Unknown Product"}
                              </td>
                              <td className="px-4 py-2 text-sm text-right">{detail.quantity}</td>
                              <td className="px-4 py-2 text-sm text-right">
                                Rs {detail.unitPrice.toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-sm text-right font-semibold">
                                Rs {(detail.quantity * detail.unitPrice).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="bg-gray-50 dark:bg-slate-950 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3">
                    {t("Payment Summary")}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>{t("Subtotal")}:</span>
                      <span>Rs {selectedInvoice.subTotal.toFixed(2)}</span>
                    </div>
                    {selectedInvoice.discountAmount > 0 && (
                      <div className="flex justify-between text-orange-600">
                        <span>{t("Discount:")}</span>
                        <span>-Rs {selectedInvoice.discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {selectedInvoice.taxAmount > 0 && (
                      <div className="flex justify-between">
                        <span>{t("Tax:")}</span>
                        <span>Rs {selectedInvoice.taxAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold border-t border-gray-300 dark:border-slate-700 pt-2">
                      <span>{t("Total:")}</span>
                      <span>Rs {selectedInvoice.totalAmount.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>{t("Profit:")}</span>
                      <span>Rs {selectedInvoiceProfit.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between font-semibold border-t border-gray-200 dark:border-slate-700 pt-2">
                      <span>{t("Total Received:")}</span>
                      <span>
                        Rs{" "}
                        {(() => {
                          const totalPayments =
                            selectedInvoice.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
                          return totalPayments.toFixed(2);
                        })()}
                      </span>
                    </div>
                    {selectedInvoice.outstandingBalance &&
                    selectedInvoice.outstandingBalance > 0 ? (
                      <div className="flex justify-between text-red-600 font-semibold">
                        <span>{t("Outstanding Balance:")}</span>
                        <span>Rs {selectedInvoice.outstandingBalance.toFixed(2)}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-green-600 font-semibold">
                        <span>{t("Change:")}</span>
                        <span>
                          Rs{" "}
                          {(
                            (selectedInvoice.payments?.reduce((sum, p) => sum + p.amount, 0) || 0) -
                            selectedInvoice.totalAmount
                          ).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setShowDetails(false)}
                    className="px-4 py-2 bg-gray-50 dark:bg-slate-500 text-white rounded-lg hover:bg-gray-600"
                  >
                    {t("Close")}
                  </button>
                  <button
                    onClick={async () => await generatePrintableInvoice(selectedInvoice)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    🖨️ {t("Print Invoice")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && selectedInvoice && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 w-full max-w-md relative">
            {paymentLoading && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10 dark:bg-slate-900/70 rounded-lg">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Processing...")}</p>
                </div>
              </div>
            )}
            <h3 className="text-lg font-semibold mb-4">{t("Add Payment")}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  {t("Invoice:")} {selectedInvoice.id}
                </label>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {t("Total:")} Rs {selectedInvoice.totalAmount.toFixed(2)} | {t("Outstanding:")} Rs{" "}
                  {(selectedInvoice.outstandingBalance || 0).toFixed(2)}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  {t("Payment Amount")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t("Enter payment amount")}
                  min="0"
                  max={selectedInvoice.outstandingBalance || 0}
                  disabled={paymentLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  {t("Payment Method")}
                </label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={paymentLoading}
                >
                  <option value="cash">{t("Cash")}</option>
                  <option value="card">{t("Card")}</option>
                  <option value="mobile">{t("Mobile Payment")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  {t("Notes (Optional)")}
                </label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t("Payment notes...")}
                  rows={3}
                  disabled={paymentLoading}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors disabled:bg-gray-200 dark:disabled:bg-slate-900"
                disabled={paymentLoading}
              >
                {t("Cancel")}
              </button>
              <button
                onClick={handleAddPayment}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={paymentLoading}
              >
                {paymentLoading ? t("Processing...") : t("Add Payment")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && invoiceToDelete && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 text-red-600">{t("Delete Invoice")}</h3>
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">
                      {t("Are you sure you want to delete this invoice?")}
                    </h3>
                    <div className="mt-2 text-sm text-red-700">
                      <p>
                        {t("Invoice:")} <strong>{invoiceToDelete.id}</strong>
                      </p>
                      <p>
                        {t("Total Amount:")}{" "}
                        <strong>Rs {invoiceToDelete.totalAmount.toFixed(2)}</strong>
                      </p>
                      <p>
                        {t("Customer:")} <strong>{invoiceToDelete.customer?.name || "N/A"}</strong>
                      </p>
                    </div>
                    <div className="mt-3 text-sm text-red-600">
                      <p>{t("This action cannot be undone. The following will happen:")}</p>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        <li>{t("Product stock levels will be restored")}</li>
                        <li>{t("All payment records will be deleted")}</li>
                        <li>{t("Customer loyalty points will be reversed")}</li>
                        <li>{t("All related transaction records will be removed")}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setInvoiceToDelete(null);
                }}
                className="px-4 py-2 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors disabled:bg-gray-200 dark:disabled:bg-slate-900"
                disabled={loading}
              >
                {t("Cancel")}
              </button>
              <button
                onClick={confirmDeleteInvoice}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? t("Deleting...") : t("Delete Invoice")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesInvoices;
