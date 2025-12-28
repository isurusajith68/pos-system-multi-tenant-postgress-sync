import React, { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import { useAppData } from "../contexts/AppDataContext";
import { useTranslation } from "../contexts/LanguageContext";

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

interface FormErrors {
  name?: string;
  parentCategoryId?: string;
}

type SortField = "name" | "createdAt";
type SortDirection = "asc" | "desc";

const CategoryManagement: React.FC = () => {
  const { t } = useTranslation();
  const { categories, refreshCategories } = useAppData();
  const [formData, setFormData] = useState({
    name: "",
    parentCategoryId: ""
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // Filter and search states
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const fetchCategories = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      await refreshCategories({ force: true });
      // Removed success toast as requested
    } catch (error) {
      console.error("Error fetching categories:", error);
      toast.error(t("Failed to load categories"));
    } finally {
      setLoading(false);
    }
  }, [refreshCategories, t]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const openModal = (): void => {
    setIsModalOpen(true);
    setIsEditing(false);
    setEditingId(null);
    setFormData({
      name: "",
      parentCategoryId: ""
    });
    setErrors({});
  };

  const closeModal = useCallback((): void => {
    setIsModalOpen(false);
    setFormData({
      name: "",
      parentCategoryId: ""
    });
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

  // Filtered and sorted categories
  const filteredCategories = useMemo(() => {
    const filtered = categories.filter((category) => {
      const matchesSearch = category.name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });

    // Sort filtered categories
    filtered.sort((a, b) => {
      let aValue: string | number, bValue: string | number;

      switch (sortField) {
        case "name":
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case "createdAt":
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [categories, searchTerm, sortField, sortDirection]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredCategories.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCategories = filteredCategories.slice(startIndex, endIndex);

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

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = t("Category name is required");
    } else if (formData.name.trim().length < 2) {
      newErrors.name = t("Category name must be at least 2 characters");
    } else if (formData.name.trim().length > 50) {
      newErrors.name = t("Category name cannot exceed 50 characters");
    }

    // Check for duplicate category names
    const isDuplicate = categories.some(
      (category) =>
        category.name.toLowerCase() === formData.name.trim().toLowerCase() &&
        category.id !== editingId
    );

    if (isDuplicate) {
      newErrors.name = t("A category with this name already exists");
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
      const categoryData = {
        name: formData.name.trim(),
        parentCategoryId: formData.parentCategoryId || undefined
      };

      if (isEditing && editingId) {
        await window.api.categories.update(editingId, categoryData);
        toast.success(t("Category updated successfully!"));
      } else {
        await window.api.categories.create(categoryData);
        toast.success(t("Category created successfully!"));
      }

      closeModal();
      await fetchCategories();
    } catch (error) {
      console.error("Error saving category:", error);
      toast.error(t("Failed to save category. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (category: Category): void => {
    setFormData({
      name: category.name,
      parentCategoryId: category.parentCategoryId || ""
    });
    setIsEditing(true);
    setEditingId(category.id);
    setIsModalOpen(true);
    setErrors({});
  };

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!confirm(t('Are you sure you want to delete the category "{name}"?', { name }))) {
      return;
    }

    try {
      setLoading(true);
      await window.api.categories.delete(id);
      toast.success(t("Category deleted successfully!"));
      await fetchCategories();
    } catch (error) {
      console.error("Error deleting category:", error);
      toast.error(t("Failed to delete category. Please try again."));
    } finally {
      setLoading(false);
    }
  };
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
              Previous
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
              Next
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
            {t("Category Management")}
          </h1>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <p className="text-gray-600 dark:text-slate-400">
              {t("Manage product categories and hierarchies")}
            </p>
            {filteredCategories.length > 0 && (
              <div className="text-sm text-gray-500 dark:text-slate-400 mt-1 sm:mt-0">
                {filteredCategories.length === categories.length
                  ? `${filteredCategories.length} total categories`
                  : `${filteredCategories.length} of ${categories.length} categories (filtered)`}
              </div>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Total Categories")}</p>
                <p className="text-xl font-bold text-blue-600">{categories.length}</p>
              </div>
              <div className="text-2xl">📂</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {t("Parent Categories")}
                </p>
                <p className="text-xl font-bold text-green-600">
                  {categories.filter((cat) => !cat.parentCategoryId).length}
                </p>
              </div>
              <div className="text-2xl">🏠</div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">{t("Sub Categories")}</p>
                <p className="text-xl font-bold text-orange-600">
                  {categories.filter((cat) => cat.parentCategoryId).length}
                </p>
              </div>
              <div className="text-2xl">📁</div>
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
                  {t("+ Add Category")}
                </button>
              </div>
              <div className="text-2xl">⚡</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Search")}
              </label>
              <input
                type="text"
                placeholder={t("Search categories...")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Sort By")}
              </label>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="name">{t("Name")}</option>
                <option value="createdAt">{t("Date Created")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Sort Order")}
              </label>
              <select
                value={sortDirection}
                onChange={(e) => setSortDirection(e.target.value as SortDirection)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="asc">{t("Ascending")}</option>
                <option value="desc">{t("Descending")}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Categories Table */}
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
                      <span>{t("Category Name")}</span>
                      {sortField === "name" && (
                        <span className="text-blue-600">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {t("Parent Category")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort("createdAt")}
                      className="flex items-center space-x-1 hover:text-gray-700 dark:text-slate-200"
                    >
                      <span>{t("Created Date")}</span>
                      {sortField === "createdAt" && (
                        <span className="text-blue-600">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-gray-500 dark:text-slate-400"
                    >
                      Loading categories...
                    </td>
                  </tr>
                ) : paginatedCategories.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-gray-500 dark:text-slate-400 "
                    >
                      <div className="text-4xl mb-2">📂</div>
                      <p>{t("No categories found")}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {filteredCategories.length === 0
                          ? categories.length === 0
                            ? t("No categories have been created yet")
                            : t("Try adjusting your search")
                          : t("No categories on this page")}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedCategories.map((category) => (
                    <tr key={category.id} className="hover:bg-gray-50  dark:hover:bg-slate-950">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">
                        <div className="flex items-center">
                          <span className="mr-2">{category.parentCategoryId ? "📁" : "🏠"}</span>
                          {category.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        {category.parentCategory?.name || (
                          <span className="text-gray-400 italic">{t("Root Category")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        <div>
                          <div className="font-medium">
                            {new Date(category.createdAt).toLocaleDateString()}
                          </div>
                          <div className="text-gray-500 dark:text-slate-400">
                            {new Date(category.createdAt).toLocaleTimeString()}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center space-x-2">
                          <button
                            onClick={() => handleEdit(category)}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            title={t("Edit Category")}
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDelete(category.id, category.name)}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                            title={t("Delete Category")}
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
          totalItems={filteredCategories.length}
          itemsPerPage={itemsPerPage}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
        />

        {/* Category Modal */}
        {isModalOpen && (
          <div
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
            onClick={closeModal}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="sticky top-0 bg-white dark:bg-slate-900 border-b px-6 py-4 flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg mr-3">
                    <span className="text-blue-600 font-bold">📂</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100">
                    {isEditing ? t("Edit Category") : t("Add New Category")}
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
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 rounded-lg p-4 lg:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                        {t("Category Name *")}
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
                        placeholder={t("Enter category name")}
                      />
                      {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                        {t("Parent Category")}
                      </label>
                      <select
                        value={formData.parentCategoryId}
                        onChange={(e) =>
                          setFormData({ ...formData, parentCategoryId: e.target.value })
                        }
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300 dark:border-slate-700"
                        disabled={loading}
                      >
                        <option value="">Root Category</option>
                        {categories
                          .filter((cat) => cat.id !== editingId && !cat.parentCategoryId)
                          .map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="flex justify-end space-x-3 pt-4 border-t">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 bg-gray-200 dark:bg-slate-800 rounded-lg hover:bg-gray-300 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                      disabled={loading}
                    >
                      {t("Cancel")}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      disabled={loading}
                    >
                      {loading
                        ? t("Saving...")
                        : isEditing
                          ? t("Update Category")
                          : t("Create Category")}
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

export default CategoryManagement;
