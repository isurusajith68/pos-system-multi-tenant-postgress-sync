import { useState, useEffect, useCallback } from "react";

interface Permission {
  id: string;
  module: string;
  action: string;
  scope?: string;
  description: string;
}

interface UsePermissionReturn {
  permissions: Permission[];
  hasPermission: (module: string, action: string, scope?: string) => boolean;
  checkPermission: (module: string, action: string, scope?: string) => Promise<boolean>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  refreshPermissions: () => Promise<void>;
}

export const usePermission = (employeeId?: string): UsePermissionReturn => {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = useCallback(async () => {
    if (!employeeId) {
      console.log("usePermission: No employeeId provided");
      setPermissions([]);
      setLoaded(true);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const employeePermissions = await window.electron.ipcRenderer.invoke(
        "rolePermissions:getEmployeePermissions",
        employeeId
      );

      setPermissions(employeePermissions || []);
      console.log(
        `usePermission: Loaded ${(employeePermissions || []).length} permissions for employee ${employeeId}`
      );
    } catch (err) {
      console.error("Error fetching permissions:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch permissions");
      setPermissions([]);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [employeeId]);

  const hasPermission = useCallback(
    (module: string, action: string, scope?: string): boolean => {
      // Don't check permissions if they haven't been loaded yet
      if (!loaded) {
        return false;
      }

      const result = permissions.some(
        (permission) =>
          permission.module === module &&
          permission.action === action &&
          // If no specific scope is requested, match any permission with this module:action
          // If a scope is requested, match exact scope OR "all" scope
          (!scope ||
            permission.scope === scope ||
            permission.scope === "all" ||
            permission.scope === null ||
            permission.scope === undefined)
      );

      return result;
    },
    [permissions, loaded]
  );

  const checkPermission = useCallback(
    async (module: string, action: string, scope?: string): Promise<boolean> => {
      if (!employeeId) return false;

      try {
        const hasPermissionResult = await window.electron.ipcRenderer.invoke(
          "rolePermissions:checkEmployeePermission",
          employeeId,
          module,
          action,
          scope
        );

        return hasPermissionResult || false;
      } catch (err) {
        console.error("Error checking permission:", err);
        return false;
      }
    },
    [employeeId]
  );

  const refreshPermissions = useCallback(async () => {
    await fetchPermissions();
  }, [fetchPermissions]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  return {
    permissions,
    hasPermission,
    checkPermission,
    loading,
    loaded,
    error,
    refreshPermissions
  };
};

// Permission constants for easy reference
export const PERMISSIONS = {
  INVOICES: {
    VIEW: "view",
    VIEW_DETAIL: "view_detail",
    CREATE: "create",
    EDIT: "edit",
    DELETE: "delete",
    REFUND: "refund"
  },
  PRODUCTS: {
    VIEW: "view",
    CREATE: "create",
    EDIT: "edit",
    DELETE: "delete",
    MANAGE_STOCK: "manage_stock"
  },
  CUSTOMERS: {
    VIEW: "view",
    CREATE: "create",
    EDIT: "edit",
    DELETE: "delete"
  },
  REPORTS: {
    VIEW: "view",
    EXPORT: "export"
  },
  SETTINGS: {
    VIEW: "view",
    EDIT: "edit",
    MANAGE_ROLES: "manage_roles"
  },
  EMPLOYEES: {
    VIEW: "view",
    CREATE: "create",
    EDIT: "edit",
    DELETE: "delete"
  }
} as const;

export const MODULES = {
  INVOICES: "invoices",
  PRODUCTS: "products",
  CUSTOMERS: "customers",
  REPORTS: "reports",
  SETTINGS: "settings",
  EMPLOYEES: "employees"
} as const;

export const SCOPES = {
  ALL: "all",
  DAILY: "daily",
  MONTHLY: "monthly"
} as const;
