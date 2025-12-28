import { formatToThreeDecimalPlaces } from "@renderer/lib/quantityValidation";
import React, { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "../contexts/LanguageContext";
import { usePermission, PERMISSIONS, MODULES, SCOPES } from "../hooks/usePermission";
import { useCurrentUser } from "../contexts/CurrentUserContext";

// Report Types
type ReportType = "sales" | "employees" | "customers" | "outstanding" | "products";

interface DateRange {
  startDate: string;
  endDate: string;
}

interface SalesReport {
  id: string;
  reportDate: Date;
  totalSales: number;
  totalTransactions: number;
  totalTax: number;
  totalDiscount: number;
  totalOutstanding: number;
  outstandingCount: number;
  totalProfit: number;
  createdAt: Date;
}

interface EmployeeReport {
  id: string;
  reportDate: Date;
  employeeId: string;
  totalSales: number;
  totalTransactions: number;
  createdAt: Date;
  employee?: {
    id: string;
    name: string;
    email?: string;
  };
}

interface CustomerReport {
  id: string;
  reportDate: Date;
  customerId: string;
  totalSpent: number;
  transactionsCount: number;
  pointsEarned: number;
  pointsRedeemed: number;
  createdAt: Date;
  customer?: {
    id: string;
    name: string;
    email?: string;
    loyaltyPoints: number;
  };
}
// Use the API types
interface InvoiceSalesDetail {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  originalPrice: number;
  costPrice?: number;
  product?: Product;
}

interface APIInvoice {
  id: string;
  date: Date;
  totalAmount: number;
  taxAmount: number;
  discountAmount: number;
  employeeId: string;
  customerId?: string;
  customer?: { name: string };
  employee?: { name: string };
  refundInvoiceId?: string;
  salesDetails?: InvoiceSalesDetail[];
  payments?: Payment[];
}

interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  paymentMode: string;
  employeeId: string;
  notes?: string;
  createdAt: Date;
  employee?: {
    id: string;
    name: string;
    email?: string;
  };
}

interface Product {
  id: string;
  name: string;
  sku?: string;
  price: number;
  costPrice?: number;
  stockLevel: number;
  category?: { name: string };
}

const ReportsManagement: React.FC = () => {
  const { t } = useTranslation();
  const { currentUser } = useCurrentUser();
  const {
    hasPermission,
    loading: permissionsLoading,
    loaded: permissionsLoaded
  } = usePermission(currentUser?.id);

  const getDefaultDateRange = React.useCallback((): DateRange => {
    const today = new Date();
    const sriLankaDate = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
    const todayStr = sriLankaDate.toISOString().split("T")[0];

    if (hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.VIEW, SCOPES.ALL)) {
      return {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        endDate: todayStr
      };
    } else if (hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.VIEW, SCOPES.MONTHLY)) {
      const firstDayOfMonth = new Date(sriLankaDate.getFullYear(), sriLankaDate.getMonth(), 1);
      return {
        startDate: firstDayOfMonth.toISOString().split("T")[0],
        endDate: todayStr
      };
    } else if (hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.VIEW, SCOPES.DAILY)) {
      return {
        startDate: todayStr,
        endDate: todayStr
      };
    }

    // Default fallback
    return {
      startDate: todayStr,
      endDate: todayStr
    };
  }, [hasPermission]);

  // State management
  const [activeReportType, setActiveReportType] = useState<ReportType>("sales");
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());

  // Data states
  const [salesReports, setSalesReports] = useState<SalesReport[]>([]);
  const [employeeReports, setEmployeeReports] = useState<EmployeeReport[]>([]);
  const [customerReports, setCustomerReports] = useState<CustomerReport[]>([]);
  const [salesInvoices, setSalesInvoices] = useState<APIInvoice[]>([]);
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Filter states
  const [searchTerm, setSearchTerm] = useState("");

  const [showCharts, setShowCharts] = useState(false);

  const canViewReports = React.useMemo(
    () => hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.VIEW),
    [hasPermission]
  );
  const canViewAllReports = React.useMemo(
    () => hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.VIEW, SCOPES.ALL),
    [hasPermission]
  );
  const canViewMonthlyReports = React.useMemo(
    () => hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.VIEW, SCOPES.MONTHLY),
    [hasPermission]
  );
  const canViewDailyReports = React.useMemo(
    () => hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.VIEW, SCOPES.DAILY),
    [hasPermission]
  );
  const canExportReports = React.useMemo(
    () => hasPermission(MODULES.REPORTS, PERMISSIONS.REPORTS.EXPORT),
    [hasPermission]
  );
  const calculateInvoiceProfit = (invoice: APIInvoice): number => {
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
  };

  useEffect(() => {
    if (permissionsLoaded && !permissionsLoading) {
      const newDateRange = getDefaultDateRange();
      setDateRange(newDateRange);
    }
  }, [permissionsLoaded, permissionsLoading, getDefaultDateRange]);

  // Validate and enforce date range based on permissions
  const handleDateRangeChange = (field: "startDate" | "endDate", value: string): void => {
    const today = new Date();
    const sriLankaDate = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));

    // Users with DAILY access can't change dates
    if (canViewDailyReports && !canViewMonthlyReports && !canViewAllReports) {
      toast.error(t("You can only view today's data."));
      return;
    }

    // Users with MONTHLY access can only select dates within current month
    if (canViewMonthlyReports && !canViewAllReports) {
      const selectedDate = new Date(value);
      const firstDayOfMonth = new Date(sriLankaDate.getFullYear(), sriLankaDate.getMonth(), 1);
      const lastDayOfMonth = new Date(sriLankaDate.getFullYear(), sriLankaDate.getMonth() + 1, 0);

      if (selectedDate < firstDayOfMonth || selectedDate > lastDayOfMonth) {
        toast.error(t("You can only select dates within the current month."));
        return;
      }
    }

    // Update the date range
    setDateRange({ ...dateRange, [field]: value });
  };

  const fetchReportData = async (): Promise<void> => {
    try {
      setLoading(true);

    switch (activeReportType) {
      case "sales":
        await fetchSalesData();
        break;
      case "employees":
        await fetchEmployeeData();
        break;
        case "customers":
          await fetchCustomerData();
          break;
      }
    } catch (error) {
      console.error("Error fetching report data:", error);
      toast.error(t("Failed to load report data"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReportType, dateRange]);

  const fetchSalesData = async (): Promise<void> => {
    try {
      const invoices = await window.api.salesInvoices.findMany({
        dateFrom: dateRange.startDate,
        dateTo: dateRange.endDate
      });
      setSalesInvoices(invoices);

      // Count invoices with negative values and refunded invoices
      const negativeInvoicesCount = invoices.filter(
        (invoice) => invoice.totalAmount < 0 || invoice.discountAmount < 0 || invoice.taxAmount < 0
      ).length;

      const refundedInvoicesCount = invoices.filter((invoice) => invoice.refundInvoiceId).length;

      // Generate daily sales summary
      const dailySummary = generateDailySalesSummary(invoices);
      setSalesReports(dailySummary);

      const excludedItems: string[] = [];

      if (negativeInvoicesCount > 0) {
        excludedItems.push(`${negativeInvoicesCount} invoices with negative values`);
      }

      if (refundedInvoicesCount > 0) {
        excludedItems.push(`${refundedInvoicesCount} refunded invoices`);
      }

      // Log excluded items for debugging
      if (excludedItems.length > 0) {
        console.log(`Sales reports generated (${excludedItems.join(" and ")} filtered out)`);
      }
    } catch (error) {
      throw error;
    }
  };

  const fetchEmployeeData = async (): Promise<void> => {
    try {
      const invoices = await window.api.salesInvoices.findMany({
        dateFrom: dateRange.startDate,
        dateTo: dateRange.endDate
      });

      const employeeData = generateEmployeeReports(invoices);
      setEmployeeReports(employeeData);

      // Count refunded invoices for feedback
      const refundedInvoicesCount = invoices.filter((invoice) => invoice.refundInvoiceId).length;
      if (refundedInvoicesCount > 0) {
        console.log(`Employee reports: ${refundedInvoicesCount} refunded invoices filtered`);
      }
    } catch (error) {
      throw error;
    }
  };

  const fetchCustomerData = async (): Promise<void> => {
    try {
      const invoices = await window.api.salesInvoices.findMany({
        dateFrom: dateRange.startDate,
        dateTo: dateRange.endDate
      });

      const customerData = generateCustomerReports(invoices);
      setCustomerReports(customerData);

      // Count refunded invoices for feedback
      const refundedInvoicesCount = invoices.filter((invoice) => invoice.refundInvoiceId).length;
      if (refundedInvoicesCount > 0) {
        console.log(`Customer reports: ${refundedInvoicesCount} refunded invoices filtered`);
      }
    } catch (error) {
      throw error;
    }
  };

  // Report generation functions
  const generateDailySalesSummary = (invoices: APIInvoice[]): SalesReport[] => {
    // Filter out invoices with negative values and refunded invoices for data integrity
    const validInvoices = invoices.filter(
      (invoice) =>
        invoice.totalAmount >= 0 &&
        invoice.discountAmount >= 0 &&
        invoice.taxAmount >= 0 &&
        !invoice.refundInvoiceId // Exclude refunded invoices from revenue calculations
    );

    const dailyData: { [key: string]: SalesReport } = {};

    validInvoices.forEach((invoice) => {
      const dateKey = new Date(invoice.date).toISOString().split("T")[0];

      if (!dailyData[dateKey]) {
        dailyData[dateKey] = {
          id: `daily-${dateKey}`,
          reportDate: new Date(dateKey),
          totalSales: 0,
          totalTransactions: 0,
          totalTax: 0,
          totalDiscount: 0,
          totalOutstanding: 0,
          outstandingCount: 0,
          totalProfit: 0,
          createdAt: new Date()
        };
      }

      dailyData[dateKey].totalSales += invoice.totalAmount;
      dailyData[dateKey].totalProfit += calculateInvoiceProfit(invoice);
      dailyData[dateKey].totalTransactions += 1;
      dailyData[dateKey].totalTax += invoice.taxAmount;
      dailyData[dateKey].totalDiscount += invoice.discountAmount;

      // Calculate outstanding balance for this invoice
      const totalPayments =
        invoice.payments?.reduce((sum, payment) => sum + payment.amount, 0) || 0;
      const outstanding = Math.max(0, invoice.totalAmount - totalPayments);
      dailyData[dateKey].totalOutstanding += outstanding;
      if (outstanding > 0) {
        dailyData[dateKey].outstandingCount += 1;
      }
    });

    return Object.values(dailyData).sort(
      (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
    );
  };

  const generateEmployeeReports = (invoices: APIInvoice[]): EmployeeReport[] => {
    // Filter out invoices with negative values and refunded invoices for data integrity
    const validInvoices = invoices.filter(
      (invoice) =>
        invoice.totalAmount >= 0 &&
        invoice.discountAmount >= 0 &&
        invoice.taxAmount >= 0 &&
        !invoice.refundInvoiceId // Exclude refunded invoices from revenue calculations
    );

    const employeeData: { [key: string]: EmployeeReport } = {};

    validInvoices.forEach((invoice) => {
      const employeeId = invoice.employeeId;

      if (!employeeData[employeeId]) {
        employeeData[employeeId] = {
          id: `emp-${employeeId}`,
          reportDate: new Date(),
          employeeId,
          totalSales: 0,
          totalTransactions: 0,
          createdAt: new Date(),
          employee: invoice.employee
            ? {
                id: employeeId,
                name: invoice.employee.name,
                email: undefined
              }
            : undefined
        };
      }

      employeeData[employeeId].totalSales += invoice.totalAmount;
      employeeData[employeeId].totalTransactions += 1;
    });

    return Object.values(employeeData).sort((a, b) => b.totalSales - a.totalSales);
  };

  const generateCustomerReports = (invoices: APIInvoice[]): CustomerReport[] => {
    // Filter out invoices with negative values and refunded invoices for data integrity
    const validInvoices = invoices.filter(
      (invoice) =>
        invoice.totalAmount >= 0 &&
        invoice.discountAmount >= 0 &&
        invoice.taxAmount >= 0 &&
        !invoice.refundInvoiceId // Exclude refunded invoices from revenue calculations
    );

    const customerData: { [key: string]: CustomerReport } = {};

    validInvoices.forEach((invoice) => {
      if (!invoice.customerId) return;

      const customerId = invoice.customerId;

      if (!customerData[customerId]) {
        customerData[customerId] = {
          id: `cust-${customerId}`,
          reportDate: new Date(),
          customerId,
          totalSpent: 0,
          transactionsCount: 0,
          pointsEarned: 0,
          pointsRedeemed: 0,
          createdAt: new Date(),
          customer: invoice.customer
            ? {
                id: customerId,
                name: invoice.customer.name,
                email: undefined,
                loyaltyPoints: 0
              }
            : undefined
        };
      }

      customerData[customerId].totalSpent += invoice.totalAmount;
      customerData[customerId].transactionsCount += 1;
      customerData[customerId].pointsEarned += Math.floor(invoice.totalAmount / 100); // 1 point per Rs 100
    });

    return Object.values(customerData).sort((a, b) => b.totalSpent - a.totalSpent);
  };

  // Stats calculations
  const salesStats = useMemo(() => {
    // Filter out invoices with negative values and refunded invoices for accurate stats
    const validInvoices = salesInvoices.filter(
      (invoice) =>
        invoice.totalAmount >= 0 &&
        invoice.discountAmount >= 0 &&
        invoice.taxAmount >= 0 &&
        !invoice.refundInvoiceId // Exclude refunded invoices from revenue calculations
    );

    const totalRevenue = validInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0);
    const totalTransactions = validInvoices.length;
    const totalTax = validInvoices.reduce((sum, invoice) => sum + invoice.taxAmount, 0);
    const totalDiscount = validInvoices.reduce((sum, invoice) => sum + invoice.discountAmount, 0);
    const averageOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

    // Calculate outstanding balances
    const totalOutstandingAmount = validInvoices.reduce((sum, invoice) => {
      const totalPayments = invoice.payments?.reduce((pSum, p) => pSum + p.amount, 0) || 0;
      return sum + Math.max(0, invoice.totalAmount - totalPayments);
    }, 0);

    const totalOutstandingCount = validInvoices.filter((invoice) => {
      const totalPayments = invoice.payments?.reduce((pSum, p) => pSum + p.amount, 0) || 0;
      return invoice.totalAmount - totalPayments > 0;
    }).length;

    const totalProfit = validInvoices.reduce(
      (sum, invoice) => sum + calculateInvoiceProfit(invoice),
      0
    );

    return {
      totalRevenue,
      totalTransactions,
      totalTax,
      totalDiscount,
      averageOrderValue,
      totalOutstandingAmount,
      totalOutstandingCount,
      totalProfit
    };
  }, [salesInvoices]);

  // Chart data preparation
  const chartData = useMemo(() => {
    switch (activeReportType) {
      case "sales":
        return salesReports.map((report) => ({
          date: new Date(report.reportDate).toLocaleDateString(),
          sales: report.totalSales,
          profit: report.totalProfit,
          transactions: report.totalTransactions,
          tax: report.totalTax,
          discount: report.totalDiscount
        }));
      case "employees":
        return employeeReports.slice(0, 10).map((report) => ({
          name: report.employee?.name || "Unknown",
          sales: report.totalSales,
          transactions: report.totalTransactions
        }));
      case "customers":
        return customerReports.slice(0, 10).map((report) => ({
          name: report.customer?.name || "Unknown",
          spent: report.totalSpent,
          transactions: report.transactionsCount
        }));
      default:
        return [];
    }
  }, [activeReportType, salesReports, employeeReports, customerReports]);

  // Pagination logic
  const getCurrentData = () => {
    switch (activeReportType) {
      case "sales":
        return salesReports;
      case "employees":
        return employeeReports;
      case "customers":
        return customerReports;
      default:
        return [];
    }
  };

  const filteredData = useMemo(() => {
    const data = getCurrentData();
    if (!searchTerm) return data;

    return data.filter((item: any) => {
      const searchFields = [
        item.employee?.name,
        item.customer?.name,
        item.product?.name,
        item.name,
        item.sku,
        item.id
      ].filter(Boolean);

      return searchFields.some((field) => field.toLowerCase().includes(searchTerm.toLowerCase()));
    });
  }, [
    activeReportType,
    searchTerm,
    salesReports,
    employeeReports,
    customerReports
  ]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, endIndex);

  // Export functions
  const exportToCSV = () => {
    if (!canExportReports) {
      toast.error(t("You don't have permission to export reports"));
      return;
    }

    const data = filteredData;
    if (data.length === 0) {
      toast.error(t("No data to export"));
      return;
    }

    let csvContent = "";
    let headers: string[] = [];

    switch (activeReportType) {
      case "sales":
        headers = [
          "Date",
          "Total Sales",
          "Transactions",
          "Tax",
          "Discount",
          "Outstanding Amount",
          "Outstanding Count"
        ];
        csvContent = headers.join(",") + "\n";
        (data as SalesReport[]).forEach((row) => {
          csvContent +=
            [
              new Date(row.reportDate).toLocaleDateString(),
              row.totalSales.toFixed(2),
              row.totalTransactions,
              row.totalTax.toFixed(2),
              row.totalDiscount.toFixed(2),
              (row.totalOutstanding || 0).toFixed(2),
              row.outstandingCount || 0
            ].join(",") + "\n";
        });
        break;
      case "employees":
        headers = ["Employee", "Total Sales", "Transactions"];
        csvContent = headers.join(",") + "\n";
        (data as EmployeeReport[]).forEach((row) => {
          csvContent +=
            [
              row.employee?.name || "Unknown",
              row.totalSales.toFixed(2),
              row.totalTransactions
            ].join(",") + "\n";
        });
        break;
      case "customers":
        headers = ["Customer", "Total Spent", "Transactions", "Points Earned"];
        csvContent = headers.join(",") + "\n";
        (data as CustomerReport[]).forEach((row) => {
          csvContent +=
            [
              row.customer?.name || "Unknown",
              row.totalSpent.toFixed(2),
              row.transactionsCount,
              row.pointsEarned
            ].join(",") + "\n";
        });
        break;
    }

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeReportType}_report_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    // Calculate filtered negative values for sales reports
    let filteredNegativeCount = 0;
    if (activeReportType === "sales") {
      const originalData = getCurrentData();
      filteredNegativeCount = originalData.length - data.length;
    }

    if (filteredNegativeCount > 0) {
      toast.success(
        `Report exported! (${filteredNegativeCount} entries with negative values filtered out)`
      );
    } else {
      toast.success(t("Report exported successfully!"));
    }
  };

  const printReport = (): void => {
    window.print();
    toast.success(t("Print dialog opened!"));
  };

  const generateSummaryReport = (): void => {
    if (!canExportReports) {
      toast.error(t("You don't have permission to export reports"));
      return;
    }

    const summary = {
      totalRevenue: salesStats.totalRevenue,
      totalProfit: salesStats.totalProfit,
      totalTransactions: salesStats.totalTransactions,
      totalTax: salesStats.totalTax,
      totalDiscount: salesStats.totalDiscount,
      averageOrderValue: salesStats.averageOrderValue,
      totalOutstandingAmount: salesStats.totalOutstandingAmount,
      totalOutstandingCount: salesStats.totalOutstandingCount,
      dateRange: {
        from: dateRange.startDate,
        to: dateRange.endDate
      }
    };

    const reportContent = `
SALES SUMMARY REPORT
Generated on: ${new Date().toLocaleString()}
Date Range: ${summary.dateRange.from} to ${summary.dateRange.to}
Filters Applied: ${searchTerm ? `Search: "${searchTerm}"` : "None"}

═══════════════════════════════════════════════════════════════

FINANCIAL SUMMARY:
• Total Revenue: Rs ${summary.totalRevenue.toFixed(2)}
• Total Profit: Rs ${summary.totalProfit.toFixed(2)}
• Total Transactions: ${summary.totalTransactions}
• Total Tax Collected: Rs ${summary.totalTax.toFixed(2)}
• Total Discounts Applied: Rs ${summary.totalDiscount.toFixed(2)}
• Average Order Value: Rs ${summary.averageOrderValue.toFixed(2)}
• Total Outstanding Amount: Rs ${summary.totalOutstandingAmount.toFixed(2)}
• Outstanding Invoices: ${summary.totalOutstandingCount}

═══════════════════════════════════════════════════════════════

Note: This report excludes refunded invoices from revenue calculations for accurate financial reporting.
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

  // Pagination component
  const Pagination = () => (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-4 mt-4">
      <div className="flex flex-col sm:flex-row justify-between items-center space-y-3 sm:space-y-0">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-700 dark:text-slate-200">{t("Show")}</span>
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span className="text-sm text-gray-700 dark:text-slate-200">{t("entries")}</span>
        </div>

        <div className="text-sm text-gray-700 dark:text-slate-200">
          {t("Showing {start} to {end} of {total} results", {
            start: startIndex + 1,
            end: Math.min(endIndex, filteredData.length),
            total: filteredData.length
          })}{" "}
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 border border-gray-300 dark:border-slate-700 rounded-lg text-sm hover:bg-gray-50 dark:bg-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t("Previous")}
          </button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (currentPage <= 3) {
              pageNum = i + 1;
            } else if (currentPage >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = currentPage - 2 + i;
            }

            if (pageNum < 1 || pageNum > totalPages) return null;

            return (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`px-3 py-1 border rounded-lg text-sm transition-colors ${
                  currentPage === pageNum
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-gray-300 dark:border-slate-700 hover:bg-gray-50 dark:bg-slate-950"
                }`}
              >
                {pageNum}
              </button>
            );
          })}

          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 border border-gray-300 dark:border-slate-700 rounded-lg text-sm hover:bg-gray-50 dark:bg-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t("Next")}
          </button>
        </div>
      </div>
    </div>
  );

  // Show loading state while permissions are being checked
  if (permissionsLoading || !permissionsLoaded) {
    return (
      <div className="p-4 lg:p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-slate-400">{t("Loading permissions...")}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show access denied if user doesn't have permission to view reports
  if (permissionsLoaded && !permissionsLoading && !canViewReports) {
    return (
      <div className="p-4 lg:p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-12">
            <div className="text-center">
              <div className="text-6xl mb-4">🔒</div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">{t("Access Denied")}</h2>
              <p className="text-gray-600 dark:text-slate-400 mb-4">
                {t("You don't have permission to view reports.")}
              </p>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {t("Contact your administrator if you need access to this module.")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">{t("📊 Reports & Analytics")}</h1>
          <p className="text-gray-600 dark:text-slate-400">{t("Comprehensive business insights and reporting")}</p>

          {/* Permission Indicator */}
          <div className="flex items-center space-x-2 mt-2">
            {canViewAllReports && (
              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                {t("Full Access")}
              </span>
            )}
            {!canViewAllReports && canViewMonthlyReports && (
              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                {t("Monthly Access")}
              </span>
            )}
            {!canViewAllReports && !canViewMonthlyReports && canViewDailyReports && (
              <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">
                {t("Daily Access Only")}
              </span>
            )}
            {!canExportReports && (
              <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                {t("Export Restricted")}
              </span>
            )}
            {currentUser && (
              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                {t("Logged in as:")} {currentUser.name}
              </span>
            )}
          </div>
        </div>

        {/* Report Type Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200 dark:border-slate-700">
            <nav className="-mb-px flex space-x-8 overflow-x-auto">
              {[
                { key: "sales", label: t("Sales Reports"), icon: "💰" },
                { key: "employees", label: t("Employee Performance"), icon: "👥" },
                { key: "customers", label: t("Customer Analytics"), icon: "👤" }
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveReportType(tab.key as ReportType);
                    setCurrentPage(1);
                  }}
                  className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                    activeReportType === tab.key
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:text-slate-200 hover:border-gray-300 dark:border-slate-700"
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Stats Cards */}
        {activeReportType === "sales" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-6 mb-6">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center">
                <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg">
                  <span className="text-green-600 text-xl">💰</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    Rs {salesStats.totalRevenue.toFixed(2)}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Total Revenue")}</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center">
                <div className="flex items-center justify-center w-12 h-12 bg-emerald-100 rounded-lg">
                  <span className="text-emerald-600 text-xl">💹</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    Rs {salesStats.totalProfit.toFixed(2)}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Total Profit")}</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center">
                <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
                  <span className="text-blue-600 text-xl">🧾</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    {salesStats.totalTransactions}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Total Transactions")}</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center">
                <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-lg">
                  <span className="text-purple-600 text-xl">📊</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    Rs {salesStats.averageOrderValue.toFixed(2)}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Avg Order Value")}</p>
                </div>
              </div>
            </div>

            {/* <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center">
                <div className="flex items-center justify-center w-12 h-12 bg-yellow-100 rounded-lg">
                  <span className="text-yellow-600 text-xl">🏷️</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    Rs {salesStats.totalTax.toFixed(2)}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">Total Tax</p>
                </div>
              </div>
            </div> */}

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center">
                <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-lg">
                  <span className="text-red-600 text-xl">🏷️</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    Rs {salesStats.totalDiscount.toFixed(2)}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Total Discounts")}</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center">
                <div className="flex items-center justify-center w-12 h-12 bg-orange-100 rounded-lg">
                  <span className="text-orange-600 text-xl">⏳</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    Rs {salesStats.totalOutstandingAmount.toFixed(2)}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Outstanding Amount")}</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center">
                <div className="flex items-center justify-center w-12 h-12 bg-indigo-100 rounded-lg">
                  <span className="text-indigo-600 text-xl">📋</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    {salesStats.totalOutstandingCount}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{t("Outstanding Invoices")}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            {/* Date Range & Search */}
            <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700 dark:text-slate-200">{t("From:")}:</label>
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                  disabled={canViewDailyReports && !canViewMonthlyReports && !canViewAllReports}
                  className="px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 disabled:bg-gray-100 dark:disabled:bg-slate-800 disabled:cursor-not-allowed"
                />
              </div>

              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700 dark:text-slate-200">{t("To:")}</label>
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                  disabled={canViewDailyReports && !canViewMonthlyReports && !canViewAllReports}
                  className="px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 disabled:bg-gray-100 dark:disabled:bg-slate-800 disabled:cursor-not-allowed"
                />
              </div>

              <input
                type="text"
                placeholder={t("Search reports...")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-64"
              />
            </div>

            {/* Actions */}
            <div className="flex space-x-2">
              <button
                onClick={() => setShowCharts(!showCharts)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center space-x-2"
              >
                <span>{showCharts ? "📊" : "📈"}</span>
                <span>{showCharts ? t("Hide Charts") : t("Show Charts")}</span>
              </button>

              {canExportReports ? (
                <>
                  <button
                    onClick={exportToCSV}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
                  >
                    <span>📥</span>
                    <span>{t("Export CSV")}</span>
                  </button>

                  {activeReportType === "sales" && (
                    <button
                      onClick={generateSummaryReport}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center space-x-2"
                    >
                      <span>📋</span>
                      <span>{t("Summary Report")}</span>
                    </button>
                  )}

                  <button
                    onClick={printReport}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                  >
                    <span>🖨️</span>
                    <span>{t("Print")}</span>
                  </button>
                </>
              ) : (
                <div
                  className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-600 dark:text-slate-400 rounded-lg flex items-center space-x-2 cursor-not-allowed"
                  title={t("Export permission required")}
                >
                  <span>🔒</span>
                  <span>{t("Export Restricted")}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Charts Section */}
        {showCharts && chartData.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">{t("📈 Visual Analytics")}</h3>

            {activeReportType === "sales" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Simple bar chart representation */}
                <div>
                  <h4 className="text-md font-medium text-gray-700 dark:text-slate-200 mb-3">
                    {t("Daily Sales Trend")}
                  </h4>
                  <div className="space-y-2">
                    {chartData.slice(0, 7).map((data: any, index) => (
                      <div key={index} className="flex items-center space-x-3">
                        <span className="text-xs text-gray-600 dark:text-slate-400 w-16">{data.date}</span>
                        <div className="flex-1 bg-gray-200 dark:bg-slate-800 rounded-full h-6 relative">
                          <div
                            className="bg-blue-600 h-6 rounded-full"
                            style={{
                              width: `${Math.min(100, (data.sales / Math.max(...chartData.map((d: any) => d.sales))) * 100)}%`
                            }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                            Rs {data.sales.toFixed(0)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-md font-medium text-gray-700 dark:text-slate-200 mb-3">
                    {t("Transaction Volume")}
                  </h4>
                  <div className="space-y-2">
                    {chartData.slice(0, 7).map((data: any, index) => (
                      <div key={index} className="flex items-center space-x-3">
                        <span className="text-xs text-gray-600 dark:text-slate-400 w-16">{data.date}</span>
                        <div className="flex-1 bg-gray-200 dark:bg-slate-800 rounded-full h-6 relative">
                          <div
                            className="bg-green-600 h-6 rounded-full"
                            style={{
                              width: `${Math.min(100, (data.transactions / Math.max(...chartData.map((d: any) => d.transactions))) * 100)}%`
                            }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                            {data.transactions}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeReportType === "employees" && (
              <div>
                <h4 className="text-md font-medium text-gray-700 dark:text-slate-200 mb-3">
                  {t("Top Performing Employees")}
                </h4>
                <div className="space-y-2">
                  {chartData.map((data: any, index) => (
                    <div key={index} className="flex items-center space-x-3">
                      <span className="text-xs text-gray-600 dark:text-slate-400 w-24 truncate">{data.name}</span>
                      <div className="flex-1 bg-gray-200 dark:bg-slate-800 rounded-full h-6 relative">
                        <div
                          className="bg-purple-600 h-6 rounded-full"
                          style={{
                            width: `${Math.min(100, (data.sales / Math.max(...chartData.map((d: any) => d.sales))) * 100)}%`
                          }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                          Rs {data.sales.toFixed(0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeReportType === "customers" && (
              <div>
                <h4 className="text-md font-medium text-gray-700 dark:text-slate-200 mb-3">
                  {t("Top Customers by Spending")}
                </h4>
                <div className="space-y-2">
                  {chartData.map((data: any, index) => (
                    <div key={index} className="flex items-center space-x-3">
                      <span className="text-xs text-gray-600 dark:text-slate-400 w-24 truncate">{data.name}</span>
                      <div className="flex-1 bg-gray-200 dark:bg-slate-800 rounded-full h-6 relative">
                        <div
                          className="bg-orange-600 h-6 rounded-full"
                          style={{
                            width: `${Math.min(100, (data.spent / Math.max(...chartData.map((d: any) => d.spent))) * 100)}%`
                          }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                          Rs {data.spent.toFixed(0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Report Table */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden mb-4">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 dark:bg-slate-950">
                <tr>
                  {activeReportType === "sales" ? (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Date")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Total Sales")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Total Profit")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Transactions")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Tax")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Discounts")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Outstanding Amount")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Outstanding Invoices")}
                      </th>
                    </>
                  ) : activeReportType === "employees" ? (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Employee")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Total Sales")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Transactions")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Avg Per Transaction")}
                      </th>
                    </>
                  ) : activeReportType === "customers" ? (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Customer")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Total Spent")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Transactions")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Avg Per Transaction")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Points Earned")}
                      </th>
                    </>
                  ) : activeReportType === "products" ? (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Product")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("SKU")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Category")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Price")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Stock")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        {t("Status")}
                      </th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                      <div className="flex justify-center items-center space-x-2">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                        <span>{t("Loading report data...")}</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                      {searchTerm
                        ? t("No data found matching your search.")
                        : t("No data available for the selected date range.")}
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((item: any, index) => (
                    <tr key={index} className="hover:bg-gray-50 hover:dark:bg-slate-950 transition-colors">
                      {activeReportType === "sales" ? (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {new Date(item.reportDate).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-slate-100">
                            Rs {item.totalSales.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            Rs {item.totalProfit.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {item.totalTransactions}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            Rs {item.totalTax.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            Rs {item.totalDiscount.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-orange-600">
                            Rs {item.totalOutstanding?.toFixed(2) || "0.00"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {item.outstandingCount || 0}
                          </td>
                        </>
                      ) : activeReportType === "employees" ? (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                              {item.employee?.name || "Unknown"}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-slate-100">
                            Rs {item.totalSales.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {item.totalTransactions}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            Rs {(item.totalSales / item.totalTransactions).toFixed(2)}
                          </td>
                        </>
                      ) : activeReportType === "customers" ? (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                              {item.customer?.name || "Unknown"}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-slate-100">
                            Rs {item.totalSpent.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {item.transactionsCount}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            Rs {(item.totalSpent / item.transactionsCount).toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {item.pointsEarned}
                          </td>
                        </>
                      ) : activeReportType === "products" ? (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{item.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {item.sku || "N/A"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {item.category?.name || "N/A"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            Rs {item.price.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                            {item.stockLevel}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                item.stockLevel === 0
                                  ? "bg-red-100 text-red-800"
                                  : item.stockLevel <= 10
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-green-100 text-green-800"
                              }`}
                            >
                              {item.stockLevel === 0
                                ? "Out of Stock"
                                : item.stockLevel <= 10
                                  ? "Low Stock"
                                  : "In Stock"}
                            </span>
                          </td>
                        </>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        <Pagination />
      </div>
    </div>
  );
};

export default ReportsManagement;
