import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import EmployeeManagement from "./EmployeeManagement";
import { applySettingsRecords, DEFAULT_SETTINGS, useAppData } from "../contexts/AppDataContext";
import { useTranslation } from "../contexts/LanguageContext";
import { SupportedLanguage } from "../i18n/translations";
import { usePermission, PERMISSIONS, MODULES } from "../hooks/usePermission";
import { useCurrentUser } from "../contexts/CurrentUserContext";

type SettingsSection =
  | "general"
  | "employees"
  | "system"
  | "sync"
  | "backup"
  | "security"
  | "notifications"
  | "printer"
  | "scanner"
  | "updates"
  | "help";

interface SettingItem {
  id: string;
  label: string;
  description: string;
  type: "toggle" | "select" | "input" | "button";
  value?: string | number | boolean;
  options?: { value: string; label: string }[];
  action?: () => void;
  labelParams?: Record<string, string | number>;
  descriptionParams?: Record<string, string | number>;
}

// Settings state shape
interface SettingsState {
  darkMode: boolean;
  notifications: boolean;
  autoBackup: boolean;
  backupFrequency: string;
  backupRetention: number;
  language: string;
  currency: string;
  taxRate: number;
  lowStockThreshold: number;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  // Printer settings
  selectedPrinter: string;
  printCopies: number;
  silentPrint: boolean;
  printPreview: boolean;
  // Scanner settings
  scannerEnabled: boolean;
  scannerAutoFocus: boolean;
}

// Database setting record
interface SettingRecord {
  key: string;
  value: string;
  type: "boolean" | "number" | "string";
  category?: string;
  description?: string;
}

interface Role {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  rolePermissions?: RolePermission[];
}

interface Permission {
  id: string;
  module: string;
  action: string;
  scope?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RolePermission {
  roleId: string;
  permissionId: string;
  granted: boolean;
  role: Role;
  permission: Permission;
}

interface PermissionGroup {
  module: string;
  permissions: Permission[];
}

interface UpdateStatePayload {
  state: "checking" | "available" | "not_available" | "downloading" | "downloaded" | "error";
  version?: string;
  releaseNotes?: string | Record<string, unknown>;
  message?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

const SettingsManagement: React.FC = () => {
  const { t, changeLanguage } = useTranslation();
  const { currentUser } = useCurrentUser();
  const { setSettings: setAppSettings } = useAppData();
  const {
    hasPermission,
    loading: permissionsLoading,
    loaded: permissionsLoaded
  } = usePermission(currentUser?.id);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);

  // Printer settings state
  const [printers, setPrinters] = useState<
    Array<{ name: string; displayName: string; isDefault: boolean }>
  >([]);

  // Scanner settings state
  const [scanners, setScanners] = useState<
    Array<{ name: string; vendorId: number; productId: number; type: string }>
  >([]);
  const [scannerStatus, setScannerStatus] = useState<"idle" | "scanning" | "connected">("idle");
  const [loading, setLoading] = useState(false);

  // Role and Permission Management State
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroup[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", description: "" });
  const [backupStats, setBackupStats] = useState<{
    totalBackups: number;
    totalSize: number;
    lastBackup?: Date;
  }>({
    totalBackups: 0,
    totalSize: 0
  });
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatePayload, setUpdatePayload] = useState<UpdateStatePayload | null>(null);

  // useEffect moved to after function definitions

  const loadBackupStats = useCallback(async () => {
    try {
      const stats = await window.api.backup.getStats();
      setBackupStats(stats);
    } catch (error) {
      console.error("Error loading backup stats:", error);
    }
  }, []);

  // Centralized updater for settings with type normalization
  const updateSetting = useCallback(
    (key: string, value: unknown): void => {
      // Normalize numeric values for known numeric keys
      const numericKeys = new Set([
        "taxRate",
        "lowStockThreshold",
        "backupRetention",
        "printCopies"
      ]);
      const integerKeys = new Set(["printCopies", "backupRetention", "lowStockThreshold"]);
      const floatKeys = new Set(["taxRate"]);
      let nextValue = value;
      if (numericKeys.has(key)) {
        if (integerKeys.has(key)) {
          const parsedInt = Number.parseInt(String(value), 10);
          nextValue = Number.isFinite(parsedInt) ? parsedInt : 0;
        } else if (floatKeys.has(key)) {
          const parsedFloat = Number.parseFloat(String(value));
          nextValue = Number.isFinite(parsedFloat) ? parsedFloat : 0;
        }
      }
      if (key === "language") {
        changeLanguage(nextValue as SupportedLanguage);
      }

      if (key === "darkMode") {
        const root = document.documentElement;
        root.classList.toggle("dark", Boolean(nextValue));
        localStorage.setItem("theme", Boolean(nextValue) ? "dark" : "light");
      }

      setSettings((prev) => ({ ...prev, [key]: nextValue }));
    },
    [changeLanguage]
  );

  

  const loadPrinters = useCallback(async (): Promise<void> => {
    try {
      const availablePrinters = await window.api.printer.getPrinters();
      setPrinters(availablePrinters);

      if (availablePrinters.length > 0) {
        // Check if current selectedPrinter is valid
        const isCurrentPrinterValid = availablePrinters.some(
          (p) => p.name === settings.selectedPrinter
        );

        if (!settings.selectedPrinter || !isCurrentPrinterValid) {
          // If current printer is invalid, delete the setting and select first available
          if (settings.selectedPrinter && !isCurrentPrinterValid) {
            await window.api.settings.delete("selectedPrinter");
          }
          updateSetting("selectedPrinter", availablePrinters[0].name);
        }
      }
    } catch (error) {
      console.error("Error loading printers:", error);
      toast.error(t("Failed to load printers. Please check printer connections."));
    }
  }, [settings.selectedPrinter, t, updateSetting]);

  const loadScanners = useCallback(async (): Promise<void> => {
    try {
      console.log("Settings: Loading scanners");
      const availableScanners = await window.api.scanner.getDevices();
      setScanners(availableScanners);

      if (availableScanners.length > 0) {
        setScannerStatus("connected");
      } else {
        setScannerStatus("idle");
      }
    } catch (error) {
      console.error("Error loading scanners:", error);
      toast.error(t("Failed to load scanners. Please check scanner connections."));
      setScannerStatus("idle");
    }
  }, [t]);

  const handleStartScanning = async (): Promise<void> => {
    try {
      setLoading(true);
      const result = await window.api.scanner.startScanning();
      if (result.success) {
        setScannerStatus("scanning");
        toast.success(t("Scanner started successfully!"));
      } else {
        toast.error(t("Failed to start scanner"));
      }
    } catch (error) {
      console.error("Error starting scanner:", error);
      toast.error(t("Failed to start scanner"));
    } finally {
      setLoading(false);
    }
  };

  const handleStopScanning = async (): Promise<void> => {
    try {
      setLoading(true);
      const result = await window.api.scanner.stopScanning();
      if (result.success) {
        setScannerStatus("idle");
        toast.success(t("Scanner stopped successfully!"));
      } else {
        toast.error(t("Failed to stop scanner"));
      }
    } catch (error) {
      console.error("Error stopping scanner:", error);
      toast.error(t("Failed to stop scanner"));
    } finally {
      setLoading(false);
    }
  };

  const handleTestScan = async (): Promise<void> => {
    try {
      setLoading(true);
      const result = await window.api.scanner.testScan();
      if (result.success) {
        toast.success(t("Test scan completed! Check console for scanned data."));
      } else {
        toast.error(t("Test scan failed"));
      }
    } catch (error) {
      console.error("Error testing scanner:", error);
      toast.error(t("Test scan failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async (): Promise<void> => {
    try {
      setLoading(true);
      const result = await window.api.backup.create();
      if (result.success) {
        toast.success(
          t("Backup created successfully! Saved to: {path}", { path: result.path ?? "" })
        );
        await loadBackupStats();
      } else {
        toast.error(t("Backup failed: {error}", { error: result.error ?? t("Unknown error") }));
      }
    } catch (error) {
      console.error("Error creating backup:", error);
      toast.error(t("Failed to create backup"));
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreBackup = async (): Promise<void> => {
    try {
      const backups = await window.api.backup.list();
      if (backups.length === 0) {
        toast.error(t("No backups available"));
        return;
      }

      // For now, restore the most recent backup
      const latestBackup = backups[0];
      const confirmed = window.confirm(
        t(
          'Are you sure you want to restore from backup "{name}"? This will replace your current data.',
          { name: latestBackup.name }
        )
      );

      if (!confirmed) return;

      setLoading(true);
      const result = await window.api.backup.restore(latestBackup.path);
      if (result.success) {
        toast.success(t("Backup restored successfully! Please restart the application."));
      } else {
        toast.error(t("Restore failed: {error}", { error: result.error ?? t("Unknown error") }));
      }
    } catch (error) {
      console.error("Error restoring backup:", error);
      toast.error(t("Failed to restore backup"));
    } finally {
      setLoading(false);
    }
  };

  const handleViewBackups = async (): Promise<void> => {
    try {
      const backups = await window.api.backup.list();
      const backupList = backups
        .map(
          (backup) =>
            `${backup.name} (${(backup.size / 1024 / 1024).toFixed(2)} MB) - ${backup.createdAt.toLocaleDateString()}`
        )
        .join("\n");

      if (backupList) {
        alert(`${t("Available Backups:")}\n\n${backupList}`);
      } else {
        alert(t("No backups found"));
      }
    } catch (error) {
      console.error("Error listing backups:", error);
      toast.error(t("Failed to load backup list"));
    }
  };

  const loadSettings = async (): Promise<void> => {
    try {
      setLoading(true);
      const dbSettings: SettingRecord[] = await window.api.settings.findMany();
      const settingsObj = applySettingsRecords(dbSettings, DEFAULT_SETTINGS);
      setSettings(settingsObj);
      setAppSettings(settingsObj);
    } catch (error) {
      console.error("Error loading settings:", error);
      toast.error(t("Failed to load settings"));
    } finally {
      setLoading(false);
    }
  };

  // updateSetting is defined above with useCallback

  const saveSettings = async (): Promise<void> => {
    try {
      setLoading(true);

      // Convert settings object to database format
      const settingsArray = Object.entries(settings).map(([key, value]) => ({
        key,
        value: String(value),
        type:
          typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string",
        category: getSettingCategory(key),
        description: getSettingDescription(key)
      }));

      await window.api.settings.updateBulk(settingsArray);
      setAppSettings(settings);
      toast.success(t("Settings saved successfully!"));
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error(t("Failed to save settings"));
    } finally {
      setLoading(false);
    }
  };

  const getSettingCategory = (key: string): string => {
    const generalKeys = [
      "companyName",
      "companyAddress",
      "companyPhone",
      "companyEmail",
      "currency",
      "taxRate"
    ];
    const systemKeys = ["darkMode", "language", "lowStockThreshold"];
    const notificationKeys = ["notifications", "lowStockNotifications", "salesNotifications"];
    const backupKeys = ["autoBackup", "backupFrequency", "backupRetention"];
    const printerKeys = ["selectedPrinter", "printCopies", "silentPrint", "printPreview"];
    const scannerKeys = ["scannerEnabled", "scannerAutoFocus"];

    if (generalKeys.includes(key)) return "general";
    if (systemKeys.includes(key)) return "system";
    if (notificationKeys.includes(key)) return "notifications";
    if (backupKeys.includes(key)) return "backup";
    if (printerKeys.includes(key)) return "printer";
    if (scannerKeys.includes(key)) return "scanner";
    return "general";
  };

  const getSettingDescription = (key: string): string => {
    const descriptions: { [key: string]: string } = {
      companyName: "Your business name that appears on receipts and invoices",
      companyAddress: "Business address for invoices and receipts",
      companyPhone: "Contact phone number",
      companyEmail: "Business email address",
      currency: "Currency used for pricing and transactions",
      taxRate: "Default tax percentage applied to sales",
      darkMode: "Switch between light and dark theme",
      language: "Interface language",
      lowStockThreshold: "Alert when stock falls below this number",
      notifications: "Receive system notifications",
      autoBackup: "Automatically backup data daily",
      backupFrequency: "How often to create automatic backups",
      backupRetention: "Number of days to keep backup files",
      selectedPrinter: "Default printer for receipt printing",
      printCopies: "Number of copies to print for each receipt",
      silentPrint: "Print receipts without showing print dialog",
      printPreview: "Show print preview dialog before printing",
      scannerEnabled: "Enable barcode/QR code scanner functionality",
      scannerAutoFocus: "Automatically focus input field when scanner is active"
    };
    return descriptions[key] || "";
  };

  // Role and Permission Management Functions
  const loadRoles = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const rolesData = await window.api.roles.findMany();
      setRoles(rolesData);
    } catch (error) {
      console.error("Error loading roles:", error);
      toast.error(t("Failed to load roles"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadPermissions = useCallback(async (): Promise<void> => {
    try {
      const permissionsData = await window.api.permissions.findMany();

      // Group permissions by module
      const grouped = permissionsData.reduce(
        (acc: { [key: string]: Permission[] }, perm: Permission) => {
          if (!acc[perm.module]) {
            acc[perm.module] = [];
          }
          acc[perm.module].push(perm);
          return acc;
        },
        {}
      );

      const groups: PermissionGroup[] = Object.entries(grouped).map(([module, permissions]) => ({
        module,
        permissions: permissions as Permission[]
      }));

      setPermissionGroups(groups);
    } catch (error) {
      console.error("Error loading permissions:", error);
      toast.error(t("Failed to load permissions"));
    }
  }, [t]);

  useEffect(() => {
    const removeListener = window.api.updates.onState((payload) => {
      setUpdatePayload(payload);
      setCheckingUpdates(payload.state === "checking");
    });

    return removeListener;
  }, []);

  useEffect(() => {
    if (!updatePayload) {
      return;
    }

    if (updatePayload.state === "available") {
      toast(t("Update {version} is available", { version: updatePayload.version ?? "" }), {
        icon: "ℹ️",
        duration: 3000
      });
    } else if (updatePayload.state === "downloaded") {
      toast.success(t("Update downloaded and ready to install"), { duration: 4000 });
    } else if (updatePayload.state === "error") {
      toast.error(updatePayload.message ?? t("Automatic update failed"), { duration: 4000 });
    }
  }, [updatePayload?.state, t]);

  const handleCheckForUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    try {
      const response = await window.api.updates.check();
      if (!response.success) {
        toast.error(response.message ?? t("Failed to reach update server"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingUpdates(false);
    }
  }, [t]);

  const handleInstallUpdate = useCallback(async () => {
    try {
      const response = await window.api.updates.install();
      if (!response.success) {
        toast.error(response.message ?? t("Install request failed"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  const handleSyncOut = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.electron.ipcRenderer.invoke("sync:push");
      toast.success(
        t("Uploaded {count} changes", { count: result?.acked ?? 0 })
      );
    } catch (error) {
      console.error("Error pushing sync:", error);
      toast.error(t("Failed to sync out"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleSyncIn = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.electron.ipcRenderer.invoke("sync:pull");
      toast.success(
        t("Pulled {count} changes", { count: result?.applied ?? 0 })
      );
    } catch (error) {
      console.error("Error pulling sync:", error);
      toast.error(t("Failed to sync in"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const createRole = useCallback(
    async (name: string, description: string): Promise<void> => {
      try {
        setLoading(true);
        await window.api.roles.create({
          name,
          description,
          isSystem: false
        });

        toast.success(t("Role created successfully!"));
        await loadRoles();
        setNewRole({ name: "", description: "" });
        setShowCreateRoleModal(false);
      } catch (error) {
        console.error("Error creating role:", error);
        toast.error(t("Failed to create role"));
      } finally {
        setLoading(false);
      }
    },
    [t, loadRoles]
  );

  const loadRolePermissions = useCallback(
    async (roleId: string): Promise<void> => {
      try {
        const rolePermissionsData = await window.api.rolePermissions.getRolePermissions(roleId);
        setRolePermissions(rolePermissionsData);
      } catch (error) {
        console.error("Error loading role permissions:", error);
        toast.error(t("Failed to load role permissions"));
      }
    },
    [t]
  );

  const updateRolePermission = useCallback(
    async (roleId: string, permissionId: string, granted: boolean): Promise<void> => {
      try {
        if (granted) {
          await window.api.rolePermissions.grant(roleId, permissionId);
        } else {
          await window.api.rolePermissions.revoke(roleId, permissionId);
        }
        toast.success(t("Permission updated successfully!"));
        // Reload permissions after update
        await loadRolePermissions(roleId);
      } catch (error) {
        console.error("Error updating role permission:", error);
        toast.error(t("Failed to update permission"));
      }
    },
    [t, loadRolePermissions]
  );

  const sections = [
  { key: "general", label: "General Settings", icon: "G" },
  { key: "employees", label: "Employee", icon: "E" },
  { key: "printer", label: "Printer", icon: "P" },
  { key: "scanner", label: "Scanner", icon: "S" },
  { key: "system", label: "System Preferences", icon: "SYS" },
  { key: "sync", label: "Sync", icon: "SYNC" },
  { key: "backup", label: "Backup", icon: "B" },
  { key: "security", label: "Security", icon: "SEC" },
  { key: "notifications", label: "Notifications", icon: "N" },
  { key: "updates", label: "Updates", icon: "U" },
  { key: "help", label: "Help", icon: "H" }
];

  const downloadPercent = Math.min(100, Math.max(0, updatePayload?.percent ?? 0));
  const releaseNotesText =
    typeof updatePayload?.releaseNotes === "string"
      ? updatePayload.releaseNotes
      : updatePayload?.releaseNotes
        ? JSON.stringify(updatePayload.releaseNotes)
        : "";
  const updateStatusLabel = (() => {
    switch (updatePayload?.state) {
      case "checking":
        return t("Checking for updates…");
      case "available":
        return t("Update {version} is available", { version: updatePayload?.version ?? "" });
      case "downloading":
        return t("Downloading update ({percent}%)", { percent: downloadPercent.toFixed(0) });
      case "downloaded":
        return t("Update downloaded and ready to install");
      case "not_available":
        return t("You are running the latest version");
      case "error":
        return updatePayload?.message ?? t("Automatic update failed");
      default:
        return t("Automatic updates");
    }
  })();

  const generalSettings: SettingItem[] = [
    {
      id: "companyName",
      label: "Company Name",
      description: "Your business name that appears on receipts and invoices",
      type: "input",
      value: settings.companyName
    },
    {
      id: "companyAddress",
      label: "Company Address",
      description: "Business address for invoices and receipts",
      type: "input",
      value: settings.companyAddress
    },
    {
      id: "companyPhone",
      label: "Company Phone",
      description: "Contact phone number",
      type: "input",
      value: settings.companyPhone
    },
    {
      id: "companyEmail",
      label: "Company Email",
      description: "Business email address",
      type: "input",
      value: settings.companyEmail
    },
    {
      id: "currency",
      label: "Default Currency",
      description: "Currency used for pricing and transactions",
      type: "select",
      value: settings.currency,
      options: [
        { value: "LKR", label: "Sri Lankan Rupee (LKR)" },
        { value: "USD", label: "US Dollar (USD)" },
        { value: "EUR", label: "Euro (EUR)" },
        { value: "GBP", label: "British Pound (GBP)" }
      ]
    },
    {
      id: "taxRate",
      label: "Default Tax Rate (%)",
      description: "Default tax percentage applied to sales",
      type: "input",
      value: settings.taxRate
    }
  ];

  const systemSettings: SettingItem[] = [
    {
      id: "darkMode",
      label: "Dark Mode",
      description: "Switch between light and dark theme",
      type: "toggle",
      value: settings.darkMode
    },
    {
      id: "language",
      label: "Language",
      description: "Interface language",
      type: "select",
      value: settings.language,
      options: [
        { value: "en", label: "English" },
        { value: "si", label: "Sinhala" },
        { value: "ta", label: "Tamil" }
      ]
    },
    {
      id: "lowStockThreshold",
      label: "Low Stock Alert Threshold",
      description: "Alert when stock falls below this number",
      type: "input",
      value: settings.lowStockThreshold
    }
  ];

  const syncSettings: SettingItem[] = [
    {
      id: "syncOut",
      label: "Sync Out",
      description: "Upload local changes to the server",
      type: "button",
      action: handleSyncOut
    },
    {
      id: "syncIn",
      label: "Sync In",
      description: "Download server changes to this device",
      type: "button",
      action: handleSyncIn
    }
  ];

  const backupSettings: SettingItem[] = [
    {
      id: "backupStats",
      label: "Backup Statistics",
      description: `Total backups: ${backupStats.totalBackups}, Size: ${(backupStats.totalSize / 1024 / 1024).toFixed(2)} MB${backupStats.lastBackup ? `, Last: ${backupStats.lastBackup.toLocaleDateString()}` : ""}`,
      type: "input",
      value: ""
    },
    {
      id: "autoBackup",
      label: "Auto Backup",
      description: "Automatically backup data daily",
      type: "toggle",
      value: settings.autoBackup
    },
    {
      id: "backupFrequency",
      label: "Backup Frequency",
      description: "How often to create automatic backups",
      type: "select",
      value: settings.backupFrequency,
      options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
        { value: "monthly", label: "Monthly" }
      ]
    },
    {
      id: "backupRetention",
      label: "Backup Retention (days)",
      description: "Number of days to keep backup files",
      type: "input",
      value: settings.backupRetention
    },
    {
      id: "createBackup",
      label: "Create Backup Now",
      description: "Manually create a backup of your data",
      type: "button",
      action: handleCreateBackup
    },
    {
      id: "restoreBackup",
      label: "Restore from Backup",
      description: "Restore data from a previous backup",
      type: "button",
      action: handleRestoreBackup
    },
    {
      id: "viewBackups",
      label: "View Backup History",
      description: "View and manage existing backups",
      type: "button",
      action: handleViewBackups
    }
  ];

  // Memoize permission checks
  const canManageRoles = React.useMemo(
    () => hasPermission(MODULES.SETTINGS, PERMISSIONS.SETTINGS.MANAGE_ROLES),
    [hasPermission]
  );
  const canEditSettings = React.useMemo(
    () => hasPermission(MODULES.SETTINGS, PERMISSIONS.SETTINGS.EDIT),
    [hasPermission]
  );
  const canViewSettings = React.useMemo(
    () => hasPermission(MODULES.SETTINGS, PERMISSIONS.SETTINGS.VIEW),
    [hasPermission]
  );

  const securitySettings: SettingItem[] = [
    {
      id: "createRole",
      label: "Create New Role",
      description: "Add a new user role with custom permissions",
      type: "button",
      action: () => {
        if (!canManageRoles) {
          toast.error(t("You don't have permission to manage roles"));
          return;
        }
        setShowCreateRoleModal(true);
      }
    },
    {
      id: "managePermissions",
      label: "Manage Role Permissions",
      description: "Configure permissions for existing roles",
      type: "button",
      action: () => {
        if (!canManageRoles) {
          toast.error(t("You don't have permission to manage roles"));
          return;
        }
        setShowPermissionModal(true);
      }
    },
    {
      id: "changePassword",
      label: "Change Password",
      description: "Update your account password",
      type: "button",
      action: () => alert(t("Password change functionality"))
    },
    {
      id: "twoFactor",
      label: "Two-Factor Authentication",
      description: "Add an extra layer of security",
      type: "toggle",
      value: false
    }
  ];

  const notificationSettings: SettingItem[] = [
    {
      id: "notifications",
      label: "Enable Notifications",
      description: "Receive system notifications",
      type: "toggle",
      value: settings.notifications
    },
    {
      id: "lowStockNotifications",
      label: "Low Stock Alerts",
      description: "Get notified when items are running low",
      type: "toggle",
      value: true
    },
    {
      id: "salesNotifications",
      label: "Sales Notifications",
      description: "Daily sales summary notifications",
      type: "toggle",
      value: true
    }
  ];

  const printerSettings: SettingItem[] = [
    {
      id: "selectedPrinter",
      label: "Default Printer",
      description: "Select the default printer for receipts",
      type: "select",
      value: settings.selectedPrinter,
      options: [
        { value: "", label: "Default Printer" },
        ...printers.map((printer) => ({
          value: printer.name,
          label: printer.displayName
        }))
      ]
    },
    {
      id: "printCopies",
      label: "Print Copies",
      description: "Number of copies to print for each receipt",
      type: "select",
      value: settings.printCopies.toString(),
      options: [
        { value: "1", label: "1 Copy" },
        { value: "2", label: "2 Copies" },
        { value: "3", label: "3 Copies" }
      ]
    },
    {
      id: "silentPrint",
      label: "Silent Print",
      description: "Print receipts without showing print dialog",
      type: "toggle",
      value: settings.silentPrint
    },
    {
      id: "printPreview",
      label: "Show Print Preview",
      description: "Show print preview dialog before printing",
      type: "toggle",
      value: settings.printPreview
    },
    {
      id: "testPrint",
      label: "Test Print Receipt",
      description: "Print a test receipt to verify printer settings",
      type: "button",
      action: async () => {
        try {
          const result = await window.api.printer.testPrint(settings.selectedPrinter || undefined);
          if (result.success) {
            toast.success(t("Test receipt printed successfully!"));
          } else {
            const errorMessage = result.error || t("Unknown error");
            toast.error(t("Test print failed: {error}", { error: errorMessage }));
          }
        } catch (error) {
          console.error("Settings: Error in test print:", error);
          toast.error(t("Failed to print test receipt"));
        }
      }
    },
    {
      id: "refreshPrinters",
      label: "Refresh Printer List",
      description: "Reload available printers from system",
      type: "button",
      action: loadPrinters
    }
  ];

  const scannerStatusMessage =
    scannerStatus === "connected"
      ? "Scanner connected and ready"
      : scannerStatus === "scanning"
        ? "Scanner is active"
        : "No scanner connected";

  const scannerSettings: SettingItem[] = [
    {
      id: "scannerEnabled",
      label: "Enable Scanner",
      description: "Enable barcode/QR code scanner functionality",
      type: "toggle",
      value: settings.scannerEnabled
    },
    {
      id: "scannerAutoFocus",
      label: "Auto Focus",
      description: "Automatically focus input field when scanner is active",
      type: "toggle",
      value: settings.scannerAutoFocus
    },
    {
      id: "connectedScanners",
      label: "Connected Scanners",
      description: "Found {count} scanner(s)",
      descriptionParams: { count: scanners.length },
      type: "input",
      value:
        scanners.length > 0
          ? scanners.map((s) => `${s.name} (VID:${s.vendorId})`).join(", ")
          : "No scanners detected"
    },
    {
      id: "scannerStatus",
      label: "Scanner Status",
      description: "Current status: {status}",
      descriptionParams: { status: t(scannerStatusMessage) },
      type: "input",
      value: scannerStatusMessage
    },
    {
      id: "startScanning",
      label: "Start Scanning",
      description: "Enable scanner to listen for barcode/QR code input",
      type: "button",
      action: handleStartScanning
    },
    {
      id: "stopScanning",
      label: "Stop Scanning",
      description: "Disable scanner input",
      type: "button",
      action: handleStopScanning
    },
    {
      id: "testScan",
      label: "Test Scanner",
      description: "Send a test scan event to verify scanner functionality",
      type: "button",
      action: handleTestScan
    },
    {
      id: "refreshScanners",
      label: "Refresh Scanner List",
      description: "Reload available scanners from system",
      type: "button",
      action: loadScanners
    }
  ];

  const renderSettingItem = (item: SettingItem): React.ReactNode => {
    const translatedLabel = t(item.label, item.labelParams);
    const translatedDescription = t(item.description, item.descriptionParams);

    switch (item.type) {
      case "toggle":
        return (
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-slate-100">{translatedLabel}</h4>
              <p className="text-sm text-gray-500 dark:text-slate-400">{translatedDescription}</p>
            </div>
            <button
              onClick={() => canEditSettings && updateSetting(item.id, !item.value)}
              disabled={!canEditSettings}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                item.value ? "bg-blue-600" : "bg-gray-200 dark:bg-slate-800"
              } ${!canEditSettings ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-slate-900 transition-transform ${
                  item.value ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        );

      case "select":
        return (
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-1">{translatedLabel}</h4>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">{translatedDescription}</p>
            <select
              value={String(item.value ?? "")}
              onChange={(e) => updateSetting(item.id, e.target.value)}
              disabled={!canEditSettings}
              className={`w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                !canEditSettings ? "bg-gray-100 dark:bg-slate-800 cursor-not-allowed" : ""
              }`}
            >
              {item.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>
        );

      case "input":
        return (
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-1">{translatedLabel}</h4>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">{translatedDescription}</p>
            <input
              type={
                ["taxRate", "lowStockThreshold", "backupRetention"].includes(item.id)
                  ? "number"
                  : "text"
              }
              value={typeof item.value === "number" ? item.value : String(item.value ?? "")}
              onChange={(e) => updateSetting(item.id, e.target.value)}
              disabled={!canEditSettings}
              className={`w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                !canEditSettings ? "bg-gray-100 dark:bg-slate-800 cursor-not-allowed" : ""
              }`}
            />
          </div>
        );

      case "button":
        return (
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-slate-100">{translatedLabel}</h4>
              <p className="text-sm text-gray-500 dark:text-slate-400">{translatedDescription}</p>
            </div>
            <button
              onClick={item.action}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("Execute")}
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  useEffect(() => {
    loadSettings();
    loadBackupStats();
    loadPrinters();
    loadScanners();
    loadRoles();
    loadPermissions();
    // We intentionally run this effect only once on mount to prevent reloading
    // settings on every dependency change which can overwrite unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCurrentSettings = (): SettingItem[] => {
    switch (activeSection) {
      case "general":
        return generalSettings;
      case "printer":
        return printerSettings;
      case "scanner":
        return scannerSettings;
      case "system":
        return systemSettings;
      case "sync":
        return syncSettings;
      case "backup":
        return backupSettings;
      case "security":
        return securitySettings;
      case "notifications":
        return notificationSettings;
      case "updates":
        return [];
      default:
        return [];
    }
  };

  const renderContent = (): React.ReactNode => {
    if (activeSection === "updates") {
      return (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm p-6 space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{t("Automatic Updates")}</h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                {t(
                  "Keep your Zentra POS up to date: check for new releases, download installers, and apply fixes automatically."
                )}
              </p>
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium text-gray-700 dark:text-slate-200">{updateStatusLabel}</div>
                {updatePayload?.version && (
                  <span className="text-xs text-gray-500 dark:text-slate-400">v{updatePayload.version}</span>
                )}
              </div>
              {releaseNotesText && (
                <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed whitespace-pre-line">
                  {releaseNotesText}
                </p>
              )}
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full bg-blue-500 transition-all duration-200`}
                  style={{ width: `${downloadPercent}%` }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleCheckForUpdates}
                disabled={checkingUpdates || updatePayload?.state === "downloading"}
                className="px-4 py-2 text-sm font-semibold rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkingUpdates ? t("Checking…") : t("Check for updates")}
              </button>
              {updatePayload?.state === "downloaded" && (
                <button
                  onClick={handleInstallUpdate}
                  className="px-4 py-2 text-sm font-semibold rounded border border-blue-500 bg-blue-500 text-white hover:bg-blue-600"
                >
                  {t("Install now")}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    if (activeSection === "employees") {
      if (permissionsLoaded && !permissionsLoading && !canManageRoles) {
        return (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            <div className="text-center py-8">
              <div className="text-6xl mb-4">🔒</div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">{t("Access Denied")}</h3>
              <p className="text-gray-600 dark:text-slate-400">{t("You don't have permission to manage employees.")}</p>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
                {t("Contact your administrator if you need access to this section.")}
              </p>
            </div>
          </div>
        );
      }

      return <EmployeeManagement />;
    }

    if (activeSection === "security") {
      if (permissionsLoaded && !permissionsLoading && !canManageRoles && !canEditSettings) {
        return (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            <div className="text-center py-8">
              <div className="text-6xl mb-4">🔒</div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">{t("Access Denied")}</h3>
              <p className="text-gray-600 dark:text-slate-400">
                {t("You don't have permission to access security settings.")}
              </p>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
                {t("Contact your administrator if you need access to this section.")}
              </p>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-6">
          {canManageRoles && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">{t("System Management")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {securitySettings.slice(0, 2).map((item) => (
                  <div key={item.id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-4">
                    {renderSettingItem(item)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canManageRoles && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{t("User Roles")}</h3>
                <button
                  onClick={() => {
                    if (!canManageRoles) {
                      toast.error(t("You don't have permission to manage roles"));
                      return;
                    }
                    setShowCreateRoleModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {t("Create Role")}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {roles.map((role) => (
                  <div key={role.id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium text-gray-900 dark:text-slate-100">{role.name}</h4>
                      {role.isSystem && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                          {t("System")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">{role.description}</p>
                    <div className="flex space-x-2">
                      <button
                        onClick={async () => {
                          setSelectedRole(role);
                          setShowPermissionModal(true);
                          await loadRolePermissions(role.id);
                        }}
                        className="text-xs bg-green-100 text-green-800 px-3 py-1 rounded-full hover:bg-green-200 transition-colors"
                      >
                        {t("Configure Permissions")}
                      </button>
                      {!role.isSystem && canManageRoles && (
                        <button
                          onClick={async () => {
                            if (!canManageRoles) {
                              toast.error(t("You don't have permission to delete roles"));
                              return;
                            }
                            if (window.confirm(t("Are you sure you want to delete this role?"))) {
                              try {
                                // Check if any employees are assigned to this role
                                const roleUsage = await window.electron.ipcRenderer.invoke(
                                  "check-role-usage",
                                  role.id
                                );

                                if (roleUsage && roleUsage.count > 0) {
                                  alert(
                                    `Cannot delete role "${role.name}". It is assigned to ${roleUsage.count} employee(s). Please reassign those employees to other roles first.`
                                  );
                                  return;
                                }

                                // Delete the role
                                const result = await window.electron.ipcRenderer.invoke(
                                  "delete-role",
                                  role.id
                                );

                                if (result.success) {
                                  // Refresh roles list
                                  const updatedRoles =
                                    await window.electron.ipcRenderer.invoke("get-all-roles");
                                  setRoles(updatedRoles);

                                  alert("Role deleted successfully!");
                                } else {
                                  alert(
                                    "Failed to delete role: " + (result.error || "Unknown error")
                                  );
                                }
                              } catch (error) {
                                console.error("Error deleting role:", error);
                                alert(
                                  "Error deleting role: " +
                                    (error instanceof Error ? error.message : "Unknown error")
                                );
                              }
                            }
                          }}
                          className="text-xs bg-red-100 text-red-800 px-3 py-1 rounded-full hover:bg-red-200 transition-colors"
                        >
                          {t("Delete")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {roles.length === 0 && (
                  <div className="col-span-full text-center py-8 text-gray-500 dark:text-slate-400">
                    <p>{t("No roles found. Initialize default permissions first.")}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Permission Groups Overview */}
          {canManageRoles && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">
                {t("Available Permissions")}
              </h3>

              <div className="space-y-4">
                {permissionGroups.map((group) => (
                  <div key={group.module} className="border border-gray-100 dark:border-slate-700 rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 dark:text-slate-100 mb-2 capitalize">
                      {t(group.module)} {t("Permissions")}
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {group.permissions.map((permission) => (
                        <div key={permission.id} className="text-sm">
                          <span className="bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 px-2 py-1 rounded text-xs">
                            {permission.action}
                            {permission.scope && ` (${permission.scope})`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {permissionGroups.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                    <p>{t("No permissions found. Initialize default permissions first.")}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {canEditSettings && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">{t("Security Settings")}</h3>
              <div className="space-y-4">
                {securitySettings.slice(3).map((item) => (
                  <div key={item.id}>{renderSettingItem(item)}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (activeSection === "help") {
      return (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">{t("Developer Contact")}</h3>
            <div className="space-y-4">
              <div className="flex items-center space-x-4">
                <div className="text-4xl">👨‍💻</div>
                <div>
                  <h4 className="text-md font-medium text-gray-900 dark:text-slate-100">Isuru Sajith</h4>
                  <p className="text-sm text-gray-600 dark:text-slate-400">Lead Developer</p>
                </div>
              </div>
              <div className="border-t pt-4">
                <h5 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                  {t("Contact Information")}
                </h5>
                <div className="space-y-2 text-sm text-gray-600 dark:text-slate-400">
                  <p>
                    <strong>Phone:</strong>{" "}
                    <a href="tel:+94765280144" className="text-blue-600 hover:text-blue-800">
                      +94 7652 80144
                    </a>
                  </p>
                  <p>
                    <strong>Email:</strong>{" "}
                    <a
                      href="mailto:isurusajith.dev@gmail.com"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      isurusajith.dev@gmail.com
                    </a>
                  </p>
                  <p>
                    <strong>GitHub:</strong>{" "}
                    <a
                      href="https://github.com/isurusajith68"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      github.com/isurusajith68
                    </a>
                  </p>
                  <p>
                    <strong>LinkedIn:</strong>{" "}
                    <a
                      href="https://www.linkedin.com/in/isuru-sajith-rajapaksha/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      linkedin.com/in/isuru-sajith-rajapaksha
                    </a>
                  </p>
                </div>
              </div>
              <div className="border-t pt-4">
                <h5 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                  {t("Project Information")}
                </h5>
                <div className="space-y-2 text-sm text-gray-600 dark:text-slate-400">
                  <p>
                    <strong>Project:</strong> Zentra POS System
                  </p>

                  <p>
                    <strong>Technology:</strong> Electron + React + TypeScript + PostgreSQL
                  </p>
                </div>
              </div>
              <div className="border-t pt-4">
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {t(
                    "For technical support, feature requests, or bug reports, please contact the developer using the information above."
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeSection === "backup") {
      return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
          <div className="text-center py-8">
            <div className="text-6xl mb-4">🔒</div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">{t("Access Denied")}</h3>
            <p className="text-gray-600 dark:text-slate-400">{t("Don't have permission to view backup settings.")}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
              {t("Contact developer if you need access to this section.")}
            </p>
          </div>
        </div>
      );
    }

    if (permissionsLoaded && !permissionsLoading && !canViewSettings && !canEditSettings) {
      return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
          <div className="text-center py-8">
            <div className="text-6xl mb-4">🔒</div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">{t("Access Denied")}</h3>
            <p className="text-gray-600 dark:text-slate-400">{t("You don't have permission to view settings.")}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
              {t("Contact your administrator if you need access to this section.")}
            </p>
          </div>
        </div>
      );
    }

    const currentSettings = getCurrentSettings();

    return (
      <div className="space-y-6">
        {currentSettings.map((item) => (
          <div key={item.id} className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            {renderSettingItem(item)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">{t("Settings Dashboard")}</h1>
              <p className="text-gray-600 dark:text-slate-400">
                {t("Manage your Zentra POS system settings and configurations")}
              </p>
            </div>
          </div>
        </div>

        {/* Settings Navigation */}
        <div className="mb-6">
          <div className="border-b border-gray-200 dark:border-slate-700">
            <nav className="-mb-px flex space-x-8 overflow-x-auto">
              {sections.map((section) => (
                <button
                  key={section.key}
                  onClick={() => setActiveSection(section.key as SettingsSection)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                    activeSection === section.key
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:text-slate-200 hover:border-gray-300 dark:border-slate-700"
                  }`}
                >
                  {section.icon} {t(section.label)}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Settings Content */}
        <div className="bg-gray-50 dark:bg-slate-950">
          {activeSection !== "employees" && (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">
                {t(sections.find((s) => s.key === activeSection)?.label ?? "")}
              </h2>
              <p className="text-gray-600 dark:text-slate-400">
                {activeSection === "general" &&
                  t("Configure basic business information and preferences")}
                {activeSection === "printer" &&
                  t("Configure printer settings and test receipt printing")}
                {activeSection === "scanner" &&
                  t("Configure barcode/QR code scanner settings and test functionality")}
                {activeSection === "system" && t("Customize system behavior and appearance")}
                {activeSection === "sync" && t("Push local changes or pull server updates")}
                {activeSection === "backup" && t("Manage data backup and restore operations")}
                {activeSection === "security" &&
                  t("Configure role-based permissions and security settings")}
                {activeSection === "notifications" && t("Manage notification preferences")}
                {activeSection === "help" && t("Get developer contact information and support")}
              </p>
            </div>
          )}

          {renderContent()}
        </div>

        {activeSection !== "employees" &&
          activeSection !== "security" &&
          activeSection !== "updates" &&
          canEditSettings && (
            <div className="mt-8 flex justify-end">
              <button
                onClick={saveSettings}
                disabled={loading}
                className={`px-6 py-3 rounded-lg transition-colors font-medium ${
                  loading
                    ? "bg-gray-400 text-gray-600 dark:text-slate-400 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {loading ? t("Saving...") : t("Save Changes")}
              </button>
            </div>
          )}

        {showCreateRoleModal && (
          <div
            className="fixed inset-0  bg-opacity-50 flex items-center justify-center p-4 z-50"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          >
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full mx-4">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{t("Create New Role")}</h3>
                  <button
                    onClick={() => setShowCreateRoleModal(false)}
                    className="text-gray-400 hover:text-gray-600 dark:text-slate-400"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                      {t("Role Name")}
                    </label>
                    <input
                      type="text"
                      value={newRole.name}
                      onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={t("Enter role name")}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                      {t("Description")}
                    </label>
                    <textarea
                      value={newRole.description}
                      onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                      placeholder={t("Enter role description")}
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setShowCreateRoleModal(false)}
                    className="px-4 py-2 text-gray-700 dark:text-slate-200 bg-gray-200 dark:bg-slate-800 rounded-lg hover:bg-gray-300 dark:bg-slate-700 transition-colors"
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    onClick={() => createRole(newRole.name, newRole.description)}
                    disabled={!newRole.name.trim() || loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                  >
                    {loading ? t("Creating...") : t("Create Role")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showPermissionModal && (
          <div
            className="fixed inset-0  bg-opacity-50 flex items-center justify-center p-4 z-50"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          >
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                    {t("Manage Permissions")}
                    {selectedRole && ` - ${selectedRole.name}`}
                  </h3>
                  <button
                    onClick={() => {
                      setShowPermissionModal(false);
                      setSelectedRole(null);
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:text-slate-400"
                  >
                    ✕
                  </button>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                    {t("Select Role to Configure")}
                  </label>
                  <select
                    value={selectedRole?.id || ""}
                    onChange={async (e) => {
                      const role = roles.find((r) => r.id === e.target.value);
                      setSelectedRole(role || null);
                      if (role) {
                        await loadRolePermissions(role.id);
                      } else {
                        setRolePermissions([]);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t("Select a role...")}</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name} {role.isSystem ? `(${t("System")})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedRole && (
                  <div className="max-h-96 overflow-y-auto">
                    <div className="space-y-6">
                      {permissionGroups.map((group) => (
                        <div key={group.module} className="border border-gray-200 dark:border-slate-700 rounded-lg p-4">
                          <h4 className="text-lg font-medium text-gray-900 dark:text-slate-100 mb-3 capitalize">
                            {t(group.module)} {t("Module")}
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {group.permissions.map((permission) => (
                              <div
                                key={permission.id}
                                className="flex items-center justify-between p-2 bg-gray-50 dark:bg-slate-950 rounded"
                              >
                                <div className="flex-1">
                                  <div className="font-medium text-sm text-gray-900 dark:text-slate-100">
                                    {permission.action}
                                    {permission.scope && ` (${permission.scope})`}
                                  </div>
                                  {permission.description && (
                                    <div className="text-xs text-gray-600 dark:text-slate-400">
                                      {permission.description}
                                    </div>
                                  )}
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer ml-3">
                                  <input
                                    type="checkbox"
                                    checked={rolePermissions.some(
                                      (rp) => rp.permissionId === permission.id && rp.granted
                                    )}
                                    onChange={(e) =>
                                      updateRolePermission(
                                        selectedRole.id,
                                        permission.id,
                                        e.target.checked
                                      )
                                    }
                                    className="sr-only peer"
                                  />
                                  <div className="w-11 h-6 bg-gray-200 dark:bg-slate-800 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white dark:bg-slate-900 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end mt-6">
                  <button
                    onClick={() => {
                      setShowPermissionModal(false);
                      setSelectedRole(null);
                    }}
                    className="px-4 py-2 bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-300 dark:bg-slate-700 transition-colors"
                  >
                    {t("Close")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsManagement;

