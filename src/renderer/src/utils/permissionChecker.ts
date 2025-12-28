/**
 * Permission Checker Utility
 *
 * This utility provides a centralized way to check user permissions
 * throughout the application, particularly for invoice operations.
 *
 * Example Usage:
 *
 * ```typescript
 * import { PermissionChecker } from '@/utils/permissionChecker';
 *
 * // Initialize with current employee ID
 * const permissionChecker = new PermissionChecker('employee-123');
 *
 * // Check specific permissions
 * if (await permissionChecker.canViewInvoices('daily')) {
 *   // Show daily invoices
 * }
 *
 * if (await permissionChecker.canRefundInvoices()) {
 *   // Show refund button
 * }
 * ```
 */

export class PermissionChecker {
  private employeeId: string;
  private cachedPermissions: Permission[] | null = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  constructor(employeeId: string) {
    this.employeeId = employeeId;
  }

  /**
   * Get all permissions for the current employee with caching
   */
  private async getEmployeePermissions(): Promise<Permission[]> {
    const now = Date.now();

    // Return cached permissions if still valid
    if (this.cachedPermissions && now < this.cacheExpiry) {
      return this.cachedPermissions;
    }

    try {
      this.cachedPermissions = await window.api.rolePermissions.getEmployeePermissions(
        this.employeeId
      );
      this.cacheExpiry = now + this.CACHE_DURATION;
      return this.cachedPermissions || [];
    } catch (error) {
      console.error("Failed to fetch employee permissions:", error);
      return [];
    }
  }

  /**
   * Check if employee has a specific permission
   */
  private async hasPermission(module: string, action: string, scope?: string): Promise<boolean> {
    try {
      return await window.api.rolePermissions.checkEmployeePermission(
        this.employeeId,
        module,
        action,
        scope
      );
    } catch (error) {
      console.error("Permission check failed:", error);
      return false; // Deny access on error for security
    }
  }

  /**
   * Clear permission cache (useful when roles are updated)
   */
  clearCache(): void {
    this.cachedPermissions = null;
    this.cacheExpiry = 0;
  }

  // =================== INVOICE PERMISSIONS ===================

  /**
   * Check if user can view invoices with specific scope
   * @param scope - 'all', 'daily', 'monthly', or undefined for any scope
   */
  async canViewInvoices(scope?: "all" | "daily" | "monthly"): Promise<boolean> {
    return await this.hasPermission("invoices", "view", scope);
  }

  /**
   * Check if user can view invoice details
   */
  async canViewInvoiceDetails(): Promise<boolean> {
    return await this.hasPermission("invoices", "view_detail");
  }

  /**
   * Check if user can create new invoices
   */
  async canCreateInvoices(): Promise<boolean> {
    return await this.hasPermission("invoices", "create");
  }

  /**
   * Check if user can edit existing invoices
   */
  async canEditInvoices(): Promise<boolean> {
    return await this.hasPermission("invoices", "edit");
  }

  /**
   * Check if user can delete invoices
   */
  async canDeleteInvoices(): Promise<boolean> {
    return await this.hasPermission("invoices", "delete");
  }

  /**
   * Check if user can process refunds
   */
  async canRefundInvoices(): Promise<boolean> {
    return await this.hasPermission("invoices", "refund");
  }

  // =================== PRODUCT PERMISSIONS ===================

  /**
   * Check if user can view products
   */
  async canViewProducts(): Promise<boolean> {
    return await this.hasPermission("products", "view");
  }

  /**
   * Check if user can manage product stock
   */
  async canManageStock(): Promise<boolean> {
    return await this.hasPermission("products", "manage_stock");
  }

  // =================== CUSTOMER PERMISSIONS ===================

  /**
   * Check if user can view customers
   */
  async canViewCustomers(): Promise<boolean> {
    return await this.hasPermission("customers", "view");
  }

  /**
   * Check if user can create customers
   */
  async canCreateCustomers(): Promise<boolean> {
    return await this.hasPermission("customers", "create");
  }

  // =================== SETTINGS PERMISSIONS ===================

  /**
   * Check if user can manage roles and permissions
   */
  async canManageRoles(): Promise<boolean> {
    return await this.hasPermission("settings", "manage_roles");
  }

  /**
   * Check if user can edit system settings
   */
  async canEditSettings(): Promise<boolean> {
    return await this.hasPermission("settings", "edit");
  }

  // =================== REPORT PERMISSIONS ===================

  /**
   * Check if user can view reports with specific scope
   */
  async canViewReports(scope?: "all" | "daily" | "monthly"): Promise<boolean> {
    return await this.hasPermission("reports", "view", scope);
  }

  /**
   * Check if user can export reports
   */
  async canExportReports(): Promise<boolean> {
    return await this.hasPermission("reports", "export");
  }

  // =================== BATCH PERMISSION CHECKS ===================

  /**
   * Get all invoice-related permissions for UI rendering
   * Returns an object with boolean flags for each invoice permission
   */
  async getInvoicePermissions() {
    const [
      canViewAll,
      canViewDaily,
      canViewMonthly,
      canViewDetails,
      canCreate,
      canEdit,
      canDelete,
      canRefund
    ] = await Promise.all([
      this.canViewInvoices("all"),
      this.canViewInvoices("daily"),
      this.canViewInvoices("monthly"),
      this.canViewInvoiceDetails(),
      this.canCreateInvoices(),
      this.canEditInvoices(),
      this.canDeleteInvoices(),
      this.canRefundInvoices()
    ]);

    return {
      canViewAll,
      canViewDaily,
      canViewMonthly,
      canViewDetails,
      canCreate,
      canEdit,
      canDelete,
      canRefund,
      // Computed permissions
      canViewAny: canViewAll || canViewDaily || canViewMonthly,
      hasFullAccess: canViewAll && canCreate && canEdit && canDelete && canRefund
    };
  }

  /**
   * Check if user has administrative permissions
   */
  async isAdmin(): Promise<boolean> {
    const permissions = await this.getEmployeePermissions();

    // Check if user has broad permissions across modules
    const hasSettingsAccess = permissions.some(
      (p) => p.module === "settings" && p.action === "manage_roles"
    );

    const hasFullInvoiceAccess = permissions.some(
      (p) => p.module === "invoices" && p.action === "view" && p.scope === "all"
    );

    return hasSettingsAccess && hasFullInvoiceAccess;
  }

  /**
   * Get a summary of all permissions for debugging
   */
  async getPermissionSummary(): Promise<{
    total: number;
    byModule: Record<string, number>;
    permissions: Permission[];
  }> {
    const permissions = await this.getEmployeePermissions();

    const byModule = permissions.reduce(
      (acc, perm) => {
        acc[perm.module] = (acc[perm.module] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      total: permissions.length,
      byModule,
      permissions
    };
  }
}

/**
 * Hook for using permission checker in React components
 */
export function usePermissionChecker(employeeId: string) {
  const checker = new PermissionChecker(employeeId);

  return {
    checker,
    clearCache: () => checker.clearCache()
  };
}

// Types (if not already defined globally)
interface Permission {
  id: string;
  module: string;
  action: string;
  scope?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}
