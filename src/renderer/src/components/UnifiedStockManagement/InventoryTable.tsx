import React from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import { formatToThreeDecimalPlaces } from "../../lib/quantityValidation";
import { Inventory } from "../../pages/UnifiedStockManagement.types";
import InvoicePagination from "./InvoicePagination";

interface InventoryTableProps {
  inventoryPageItems: Inventory[];
  inventoryTotalItems: number;
  inventoryPage: number;
  totalInventoryPages: number;
  inventoryStartIndex: number;
  inventoryEndIndex: number;
  inventoryItemsPerPage: number;
  handleInventoryPageChange: (page: number) => void;
  handleInventoryItemsPerPageChange: (itemsPerPage: number) => void;
  getStockStatus: (item: Inventory) => string;
  getExpiryStatus: (item: Inventory) => string;
  onAdjustItem: (item: Inventory) => void;
}

const InventoryTable: React.FC<InventoryTableProps> = ({
  inventoryPageItems,
  inventoryTotalItems,
  inventoryPage,
  totalInventoryPages,
  inventoryStartIndex,
  inventoryEndIndex,
  inventoryItemsPerPage,
  handleInventoryPageChange,
  handleInventoryItemsPerPageChange,
  getStockStatus,
  getExpiryStatus,
  onAdjustItem
}) => {
  const { t } = useTranslation();

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden border border-gray-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
          {t("Inventory Items")}({inventoryTotalItems})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
          <thead className="bg-gray-50 dark:bg-slate-950">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                {t("Product Name")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                {t("Current Stock")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                {t("Status")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                {t("Total Value")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                {t("Batch/Expiry")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                {t("Actions")}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
            {inventoryPageItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-slate-400">
                  {t("No inventory items found")}
                </td>
              </tr>
            ) : (
              inventoryPageItems.map((item) => {
                const stockStatus = getStockStatus(item);
                const expiryStatus = getExpiryStatus(item);

                return (
                  <tr key={item.id} className="hover:bg-gray-50  dark:hover:bg-slate-950">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                          {item.product?.name}
                        </div>
                        {item.product?.sku && (
                          <div className="text-sm text-gray-500 dark:text-slate-400">
                            SKU: {item.product.sku}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                        {formatToThreeDecimalPlaces(item.quantity)}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">
                        Reorder: {item.reorderLevel}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            stockStatus === "out-of-stock"
                              ? "bg-red-100 text-red-800"
                              : stockStatus === "low-stock"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-green-100 text-green-800"
                          }`}
                        >
                          {stockStatus === "out-of-stock"
                            ? t("Out of Stock")
                            : stockStatus === "low-stock"
                              ? t("Low Stock")
                              : t("In Stock")}
                        </span>
                        {expiryStatus !== "no-expiry" && (
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              expiryStatus === "expired"
                                ? "bg-red-100 text-red-800"
                                : expiryStatus === "expiring-soon"
                                  ? "bg-orange-100 text-orange-800"
                                  : expiryStatus === "expiring-month"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-green-100 text-green-800"
                            }`}
                          >
                            {expiryStatus === "expired"
                              ? t("Expired")
                              : expiryStatus === "expiring-soon"
                                ? t("Expiring Soon")
                                : expiryStatus === "expiring-month"
                                  ? t("Expiring This Month")
                                  : t("Fresh")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                      Rs {((item.product?.price || 0) * item.quantity).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-100">
                      <div>
                        {item.batchNumber && (
                          <div className="text-xs text-gray-600 dark:text-slate-400">
                            {t("Batch")}: {item.batchNumber}
                          </div>
                        )}
                        {item.expiryDate && (
                          <div className="text-xs text-gray-600 dark:text-slate-400">
                            {t("Exp")}: {new Date(item.expiryDate).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => onAdjustItem(item)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        {t("Adjust")}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <InvoicePagination
        currentPage={inventoryPage}
        totalPages={totalInventoryPages}
        startIndex={inventoryStartIndex}
        endIndex={inventoryEndIndex}
        totalItems={inventoryTotalItems}
        itemsPerPage={inventoryItemsPerPage}
        onPageChange={handleInventoryPageChange}
        onItemsPerPageChange={handleInventoryItemsPerPageChange}
      />
    </div>
  );
};

export default InventoryTable;
