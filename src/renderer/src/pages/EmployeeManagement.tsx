import React, { useState, useEffect } from "react";
import { useAppData } from "../contexts/AppDataContext";
import { useTranslation } from "../contexts/LanguageContext";
import { useCurrentUser } from "../contexts/CurrentUserContext";

interface Employee {
  id: string;
  employee_id: string;
  name: string;
  role: string; // Legacy role field
  email: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
  employeeRoles?: {
    role: {
      id: string;
      name: string;
      description?: string;
      isSystem: boolean;
    };
  }[];
}

interface Role {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
}

const EmployeeManagement: React.FC = () => {
  const { t } = useTranslation();
  const { currentUser } = useCurrentUser();
  const { employees, refreshEmployees } = useAppData();
  const [roles, setRoles] = useState<Role[]>([]);
  const [formData, setFormData] = useState({
    employee_id: "",
    name: "",
    role: "", // Keep legacy role for backwards compatibility
    roleId: "", // New role ID field
    email: "",
    address: "",
    password: ""
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);

  const getEmployeeRoleLabel = (employee: Employee): string | undefined => {
    const roleNames =
      employee.employeeRoles
        ?.map((entry) => entry.role?.name)
        .filter((name): name is string => Boolean(name)) ?? [];

    if (roleNames.length > 0) {
      return roleNames.join(", ");
    }

    return employee.role || undefined;
  };

  useEffect(() => {
    fetchEmployees();
    fetchRoles();
  }, []);

  useEffect(() => {
    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const fetchEmployees = async (): Promise<void> => {
    try {
      setLoading(true);
      await refreshEmployees({ force: true });
    } catch (error) {
      console.error("Error fetching employees:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async (): Promise<void> => {
    try {
      const data = await window.api.roles.findMany();
      setRoles(data);
    } catch (error) {
      console.error("Error fetching roles:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (
      !formData.employee_id ||
      !formData.name ||
      !formData.email ||
      (!formData.roleId && !formData.role)
    ) {
      alert(t("Please fill in all required fields"));
      return;
    }

    try {
      setLoading(true);

      if (!currentUser?.tenantId) {
        alert(t("Tenant information is missing. Please log in again."));
        return;
      }

      if (!isOnline && !isEditing) {
        alert(t("Internet connection is required to add employees."));
        return;
      }

      const password_hash = await window.api.employees.hashPassword(formData.password);

      if (isEditing && editingId) {
        const updateData: {
          employee_id: string;
          name: string;
          email: string;
          address?: string;
          password_hash?: string;
          roleId?: string;
          tenantId?: string;
          previousEmail?: string;
        } = {
          employee_id: formData.employee_id,
          name: formData.name,
          email: formData.email,
          address: formData.address || undefined,
          roleId: formData.roleId || undefined,
          tenantId: currentUser.tenantId,
          previousEmail: editingEmail || undefined
        };

        if (formData.password) {
          updateData.password_hash = password_hash;
        }

        // Use new role-based update method
        await window.electron.ipcRenderer.invoke("employees:updateWithRole", editingId, updateData);
      } else {
        if (!formData.password) {
          alert(t("Password is required for new employees"));
          return;
        }

        // Use new role-based create method
        await window.electron.ipcRenderer.invoke("employees:createWithRole", {
          employee_id: formData.employee_id,
          name: formData.name,
          email: formData.email,
          address: formData.address || undefined,
          password_hash: password_hash,
          roleId: formData.roleId || undefined,
          tenantId: currentUser.tenantId
        });
      }

      await fetchEmployees();
      resetForm();
    } catch (error) {
      console.error("Error saving employee:", error);
      alert(t("Error saving employee. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (employee: Employee): void => {
    // Get the current role ID from employee roles
    const currentRole = employee.employeeRoles?.[0]?.role;

    setFormData({
      employee_id: employee.employee_id,
      name: employee.name,
      role: currentRole?.name || employee.role || "", // Keep the displayed role name in sync
      roleId: currentRole?.id || "", // New role ID field
      email: employee.email,
      address: employee.address || "",
      password: ""
    });

    setIsEditing(true);
    setEditingId(employee.id);
    setEditingEmail(employee.email);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (confirm(t("Are you sure you want to delete this employee?"))) {
      try {
        setLoading(true);
        await window.api.employees.delete(id);
        await fetchEmployees();
      } catch (error) {
        console.error("Error deleting employee:", error);
      } finally {
        setLoading(false);
      }
    }
  };

  const resetForm = (): void => {
    setFormData({
      employee_id: "",
      name: "",
      role: "",
      roleId: "",
      email: "",
      address: "",
      password: ""
    });
    setIsEditing(false);
    setEditingId(null);
    setEditingEmail(null);
    setShowPassword(false);
  };

  const generateEmployeeId = (): void => {
    const timestamp = Date.now().toString().slice(-6);
    const randomNum = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    setFormData({ ...formData, employee_id: `EMP${timestamp}${randomNum}` });
  };

  return (
    <div className="p-6 bg-gray-50 dark:bg-slate-950 min-h-screen text-gray-900 dark:text-slate-100">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">
            {" "}
            {t("Employee Management")}
          </h1>
          <p className="text-gray-600 dark:text-slate-400">
            {t("Manage employee accounts and permissions")}
          </p>
        </div>

        {/* Content */}
        <div className="">
          {/* Form */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-slate-100">
              {isEditing ? t("Edit Employee") : t("Add New Employee")}
            </h2>
            {!isOnline && !isEditing && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
                {t("Internet connection is required to add employees.")}
              </p>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("Employee ID")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.employee_id}
                      onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                      required
                      disabled={loading}
                      placeholder="EMP123456789"
                    />
                    <button
                      type="button"
                      onClick={generateEmployeeId}
                      className="px-3 py-2 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-200 dark:hover:bg-slate-700 text-xs font-medium transition-colors"
                    >
                      {t("Generate")}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("Full Name")}
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                    required
                    disabled={loading}
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("Role")}
                  </label>
                  <select
                    value={formData.roleId}
                    onChange={(e) => {
                      const selectedRole = roles.find((r) => r.id === e.target.value);
                      setFormData({
                        ...formData,
                        roleId: e.target.value,
                        role: selectedRole?.name || "" // Update legacy role field too
                      });
                    }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                    required
                    disabled={loading}
                  >
                    <option value="">{t("Select Role")}</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name} {role.isSystem ? `(${t("System")})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("Email")}
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                    required
                    disabled={loading}
                    placeholder="john.doe@company.com"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("Address")}
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                    disabled={loading}
                    placeholder={t("Enter address")}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("Password")} {isEditing && t("(Leave empty to keep current password)")}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 pr-10"
                      required={!isEditing}
                      disabled={loading}
                      placeholder={
                        isEditing ? t("Enter new password (optional)") : t("Enter password")
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                    >
                      {showPassword ? "👁️" : "👁️‍🗨️"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                <button
                  type="submit"
                  disabled={loading || (!isOnline && !isEditing)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 text-sm font-medium"
                >
                  {loading ? t("Processing...") : isEditing ? t("Update") : t("Add")}{" "}
                  {t("Employee")}
                </button>
                {isEditing && (
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 text-sm font-medium"
                  >
                    {t("Cancel")}
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Employees List */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900">{t("Employees")}</h2>
            {loading && <p className="text-gray-500 text-sm">{t("Loading...")}</p>}

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-3">
              {employees.map((employee) => (
                <div
                  key={employee.id}
                  className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 bg-gray-50 dark:bg-slate-800"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900 text-sm">{employee.name}</h4>
                      <p className="text-gray-600 font-medium text-xs">
                        {t("ID:")} {employee.employee_id}
                      </p>
                    </div>
                    <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-medium">
                      {getEmployeeRoleLabel(employee) || t("No Role")}
                    </span>
                  </div>
                  <div className="space-y-1 mb-3">
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">{t("Email:")}</span> {employee.email}
                    </p>
                    {employee.address && (
                      <p className="text-xs text-gray-600">
                        <span className="font-medium">{t("Address:")}</span> {employee.address}
                      </p>
                    )}
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">{t("Joined:")}</span>{" "}
                      {new Date(employee.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(employee)}
                      disabled={loading}
                      className="flex-1 px-3 py-2 bg-yellow-500 text-white rounded text-xs font-medium hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500 disabled:opacity-50 transition-colors"
                    >
                      {t("Edit")}
                    </button>
                    <button
                      onClick={() => handleDelete(employee.id)}
                      disabled={loading}
                      className="flex-1 px-3 py-2 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 transition-colors"
                    >
                      {t("Delete")}
                    </button>
                  </div>
                </div>
              ))}
              {employees.length === 0 && !loading && (
                <p className="text-gray-500 text-center py-8 text-sm">{t("No employees found.")}</p>
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
              <table className="min-w-full table-auto bg-white dark:bg-slate-900">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-950">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                      {t("Employee ID")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                      {t("Name")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                      {t("Role")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                      {t("Email")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                      {t("Address")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                      {t("Joined")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-400">
                      {t("Actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <tr
                      key={employee.id}
                      className="border-t border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-200 font-medium">
                        {employee.employee_id}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100 font-medium">
                        {employee.name}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-1 bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200 rounded-full text-xs font-medium">
                          {getEmployeeRoleLabel(employee) || t("No Role")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        {employee.email}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        {employee.address || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                        {new Date(employee.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm space-x-2">
                        <button
                          onClick={() => handleEdit(employee)}
                          disabled={loading || currentUser?.id === employee.id}
                          className="px-3 py-1.5 bg-yellow-500 text-white rounded hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500 disabled:opacity-50 text-xs font-medium"
                        >
                          {t("Edit")}
                        </button>
                        <button
                          onClick={() => handleDelete(employee.id)}
                          disabled={
                            loading ||
                            employee.role === "Administrator" ||
                            employee.employeeRoles?.some((entry) => entry.role?.name === "Administrator")
                          }
                          className="px-3 py-1.5 bg-red-500 text-white rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 text-xs font-medium"
                        >
                          {t("Delete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {employees.length === 0 && !loading && (
                <p className="text-gray-500 text-center py-8">{t("No employees found.")}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeManagement;
