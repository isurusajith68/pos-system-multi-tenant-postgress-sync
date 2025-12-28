import React from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import { formatToThreeDecimalPlaces } from "../../lib/quantityValidation";
import {
  Inventory,
  QuickAdjustmentForm,
  QuickAdjustmentSummary
} from "../../pages/UnifiedStockManagement.types";

interface QuickAdjustmentModalProps {
  isOpen: boolean;
  selectedItem: Inventory | null;
  adjustmentForm: QuickAdjustmentForm;
  adjustmentSummary: QuickAdjustmentSummary | null;
  onFormChange: React.Dispatch<React.SetStateAction<QuickAdjustmentForm>>;
  onSubmit: () => void;
  onClose: () => void;
}

const QuickAdjustmentModal: React.FC<QuickAdjustmentModalProps> = ({
  isOpen,
  selectedItem,
  adjustmentForm,
  adjustmentSummary,
  onFormChange,
  onSubmit,
  onClose
}) => {
  const { t } = useTranslation();

  const updateForm = (changes: Partial<QuickAdjustmentForm>) => {
    onFormChange((prev) => ({ ...prev, ...changes }));
  };

  if (!isOpen || !selectedItem || !adjustmentSummary) {
    return null;
  }

  const disableApply =
    !adjustmentForm.reason ||
    (adjustmentForm.reason === "other" && !adjustmentForm.customReason) ||
    (adjustmentForm.adjustmentType === "set" && adjustmentForm.newQuantity < 0) ||
    (adjustmentForm.adjustmentType !== "set" && adjustmentForm.changeAmount <= 0);

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}>
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 w-full max-w-3xl">
        <h3 className="text-lg font-semibold mb-4">
          {t("Adjust Stock: {productName}", {
            productName: selectedItem.product?.name || "Unknown Product"
          })}
        </h3>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-5">
            <div className="bg-gray-50 dark:bg-slate-950 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
                    {t("Current Stock Level")}
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    {selectedItem.quantity} {t("units")}
                  </p>
                </div>
                <span className="text-sm text-gray-500 dark:text-slate-400">
                  {t("Reorder")}: {selectedItem.reorderLevel}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                {t("Adjustment Type")}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "set" as const, label: t("Set Exact"), icon: "dYZ_" },
                  { value: "add" as const, label: t("Add Stock"), icon: "ƒz\u0007" },
                  { value: "subtract" as const, label: t("Remove Stock"), icon: "ƒz-" }
                ].map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => updateForm({ adjustmentType: type.value })}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      adjustmentForm.adjustmentType === type.value
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-300 dark:border-slate-700 hover:border-gray-400"
                    }`}
                  >
                    <div className="text-lg">{type.icon}</div>
                    <div className="text-xs font-medium">{type.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                {adjustmentForm.adjustmentType === "set"
                  ? t("New Quantity")
                  : adjustmentForm.adjustmentType === "add"
                    ? t("Amount to Add")
                    : t("Amount to Remove")}
              </label>
              <input
                type="number"
                value={
                  adjustmentForm.adjustmentType === "set"
                    ? formatToThreeDecimalPlaces(adjustmentForm.newQuantity)
                    : adjustmentForm.changeAmount
                }
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (adjustmentForm.adjustmentType === "set") {
                    updateForm({
                      newQuantity: Number.isNaN(value) ? 0 : Math.max(0, value)
                    });
                  } else {
                    updateForm({
                      changeAmount: Number.isNaN(value) ? 0 : Math.max(0, value)
                    });
                  }
                }}
                className="w-full p-3 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500"
                min="0"
                step="0.01"
                placeholder={
                  adjustmentForm.adjustmentType === "set"
                    ? t("Enter exact quantity")
                    : adjustmentForm.adjustmentType === "add"
                      ? t("Enter amount to add")
                      : t("Enter amount to remove")
                }
              />
              <p className="text-xs text-gray-500 dark:text-slate-400">
                {t("Change:")}{" "}
                {(adjustmentSummary.delta >= 0 ? "+" : "") + adjustmentSummary.delta.toFixed(2)}
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                {t("Reason")}
              </label>
              <select
                value={adjustmentForm.reason}
                onChange={(e) => updateForm({ reason: e.target.value })}
                className="w-full p-3 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">{t("Select a reason")}</option>
                <option value="Stock Count Correction">{t("Stock Count Correction")}</option>
                <option value="Damaged Goods">{t("Damaged Goods")}</option>
                <option value="Expired Items">{t("Expired Items")}</option>
                <option value="Theft/Loss">{t("Theft/Loss")}</option>
                <option value="Inventory Reconciliation">{t("Inventory Reconciliation")}</option>
                <option value="Return from Customer">{t("Return from Customer")}</option>
                <option value="Supplier Return">{t("Supplier Return")}</option>
                <option value="Manufacturing Adjustment">{t("Manufacturing Adjustment")}</option>
                <option value="Transfer Adjustment">{t("Transfer Adjustment")}</option>
                <option value="other">{t("Other (Custom)")}</option>
              </select>
            </div>

            {adjustmentForm.reason === "other" && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                  {t("Custom Reason")}
                </label>
                <input
                  type="text"
                  value={adjustmentForm.customReason}
                  onChange={(e) => updateForm({ customReason: e.target.value })}
                  className="w-full p-3 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500"
                  placeholder={t("Enter custom reason")}
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                {t("Notes (Optional)")}
              </label>
              <textarea
                value={adjustmentForm.notes}
                onChange={(e) => updateForm({ notes: e.target.value })}
                className="w-full p-3 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder={t("Additional notes about this adjustment")}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-transparent bg-gradient-to-br from-blue-600 to-indigo-600 text-white p-5 shadow-lg">
              <p className="text-xs uppercase tracking-widest text-blue-200">{t("Adjustment Preview")}</p>
              <div className="flex items-end justify-between mt-3">
                <p className="text-sm text-blue-100">{t("Projected Quantity")}</p>
                <p className="text-2xl font-semibold">
                  {adjustmentSummary.targetQuantity.toFixed(2)} {t("units")}
                </p>
              </div>
              <div className="flex items-center justify-between mt-4">
                <span className="text-sm">{t("Change")}</span>
                <span
                  className={`text-sm font-semibold ${
                    adjustmentSummary.delta > 0
                      ? "text-emerald-200"
                      : adjustmentSummary.delta < 0
                        ? "text-rose-200"
                        : "text-blue-100"
                  }`}
                >
                  {(adjustmentSummary.delta >= 0 ? "+" : "") + adjustmentSummary.delta.toFixed(2)}{" "}
                  {t("units")}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-wide text-blue-100">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    adjustmentSummary.trend === "up"
                      ? "bg-emerald-200"
                      : adjustmentSummary.trend === "down"
                        ? "bg-rose-200"
                        : "bg-blue-200"
                  }`}
                />
                <span>
                  {adjustmentSummary.trend === "up"
                    ? t("Increasing stock")
                    : adjustmentSummary.trend === "down"
                      ? t("Reducing stock")
                      : t("No change")}
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4 space-y-2">
              <p className="text-xs uppercase tracking-widest text-gray-500 dark:text-slate-400">
                {t("Reason Summary")}
              </p>
              <p className="text-sm text-gray-900 dark:text-slate-100">
                {adjustmentSummary.reasonLabel || t("Select a reason to proceed")}
              </p>
              {adjustmentForm.notes && (
                <p className="text-xs text-gray-500 dark:text-slate-400">{adjustmentForm.notes}</p>
              )}
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={onSubmit}
            disabled={disableApply}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {t("Apply Adjustment")}
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-gray-300 dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-800 rounded-md hover:bg-gray-400 dark:hover:bg-slate-600 transition-colors font-medium"
          >
            {t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickAdjustmentModal;
