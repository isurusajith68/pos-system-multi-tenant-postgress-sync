import React from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import { formatToThreeDecimalPlaces } from "../../lib/quantityValidation";
import { StockSyncInfo } from "../../pages/UnifiedStockManagement.types";

interface StockSyncModalProps {
  isOpen: boolean;
  product: StockSyncInfo | null;
  loading: boolean;
  onClose: () => void;
  syncInventoryToProduct: (productId: string) => void;
  syncProductToInventory: (productId: string) => void;
}

const StockSyncModal: React.FC<StockSyncModalProps> = ({
  isOpen,
  product,
  loading,
  onClose,
  syncInventoryToProduct,
  syncProductToInventory
}) => {
  const { t } = useTranslation();

  if (!isOpen || !product) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100">
            {t("Stock Sync Details")}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-slate-400"
          >
            ƒo\u0007
          </button>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-50 dark:bg-slate-950 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">
              {product.productName}
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-slate-400">Product Stock Level:</span>
                <span className="ml-2 font-medium">
                  {formatToThreeDecimalPlaces(product.productStockLevel)}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-slate-400">Inventory Total:</span>
                <span className="ml-2 font-medium">
                  {formatToThreeDecimalPlaces(product.inventoryTotal)}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-600 dark:text-slate-400">Status:</span>
                <span
                  className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${
                    product.isInSync ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                  }`}
                >
                  {product.isInSync ? "In Sync" : "Out of Sync"}
                </span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-gray-900 dark:text-slate-100 mb-3">
              {t("Inventory Summary")}
            </h4>
            <div className="bg-gray-50 dark:bg-slate-950 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-slate-400">Total Inventory:</span>
                <span className="text-lg font-semibold text-blue-600">
                  {product.inventoryTotal} units
                </span>
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-semibold text-gray-900 dark:text-slate-100 mb-3">
              {t("Sync Actions")}
            </h4>
            <div className="space-y-3">
              <button
                onClick={() => {
                  syncInventoryToProduct(product.productId);
                  onClose();
                }}
                disabled={loading}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 text-left"
              >
                <div>
                  <p className="font-medium">{t("Update Product Stock to Match Inventory")}</p>
                  <p className="text-sm text-blue-100">
                    {t("Set product stock level to {total}", {
                      total: product.inventoryTotal
                    })}
                  </p>
                </div>
              </button>

              <button
                onClick={() => {
                  syncProductToInventory(product.productId);
                  onClose();
                }}
                disabled={loading}
                className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 text-left"
              >
                <div>
                  <p className="font-medium">{t("Update Inventory to Match Product Stock")}</p>
                  <p className="text-sm text-green-100">
                    {t("Set inventory total to {stock}", {
                      stock: formatToThreeDecimalPlaces(product.productStockLevel)
                    })}
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StockSyncModal;
