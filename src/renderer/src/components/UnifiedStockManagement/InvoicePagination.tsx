import React from "react";
import { useTranslation } from "../../contexts/LanguageContext";

interface InvoicePaginationProps {
  currentPage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (itemsPerPage: number) => void;
}

const InvoicePagination: React.FC<InvoicePaginationProps> = ({
  currentPage,
  totalPages,
  startIndex,
  endIndex,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange
}) => {
  const { t } = useTranslation();

  if (totalItems === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-4 mt-4">
      <div className="flex flex-col sm:flex-row justify-between items-center space-y-3 sm:space-y-0">
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

        <div className="text-sm text-gray-700 dark:text-slate-200">
          {t("Showing {start} to {end} of {total} results", {
            start: startIndex + 1,
            end: Math.min(endIndex, totalItems),
            total: totalItems
          })}{" "}
        </div>

        <div className="flex items-center space-x-1">
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

          {(() => {
            const pages: number[] = [];
            const maxVisible = 5;
            let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            const end = Math.min(totalPages, start + maxVisible - 1);

            if (end - start + 1 < maxVisible) {
              start = Math.max(1, end - maxVisible + 1);
            }

            for (let i = start; i <= end; i += 1) {
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

export default InvoicePagination;
