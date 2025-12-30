import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import toast from "react-hot-toast";

interface Employee {
  id: string;
  employee_id: string;
  name: string;
  role: string;
  email: string;
  loginExpiresAt?: string;
  employeeRoles?: {
    role: {
      id: string;
      name: string;
      description?: string;
      isSystem: boolean;
    };
  }[];
  tenantId?: string;
  schemaName?: string;
  companyName?: string;
  subscription?: {
    planName: string;
    joinedAt: string;
    expiresAt: string;
    status: string;
  };
}

interface CurrentUserContextType {
  currentUser: Employee | null;
  setCurrentUser: (user: Employee | null) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const CurrentUserContext = createContext<CurrentUserContextType | undefined>(undefined);

export const useCurrentUser = (): CurrentUserContextType => {
  const context = useContext(CurrentUserContext);
  if (!context) {
    throw new Error("useCurrentUser must be used within a CurrentUserProvider");
  }
  return context;
};

interface CurrentUserProviderProps {
  children: ReactNode;
}

export const CurrentUserProvider: React.FC<CurrentUserProviderProps> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const sessionTtlMs = 24 * 60 * 60 * 1000; //1 day

  const isAuthenticated = currentUser !== null;

  const isNetworkError = (error: unknown): boolean => {
    const message = String(error ?? "");
    return (
      message.includes("Can't reach database server") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.includes("network") ||
      message.includes("NetworkError")
    );
  };

  const setActiveSchema = async (
    schemaName: string | null,
    options?: { skipTenantLookup?: boolean }
  ) => {
    await window.electron.ipcRenderer.invoke("tenants:setActiveSchema", schemaName, options);
  };

  const clearActiveSchema = async () => {
    await setActiveSchema(null);
  };

  const maybeClearLocalDbForTenantSwitch = async (
    nextSchema: string | null,
    nextTenantId?: string | null,
    options?: { prompt?: boolean }
  ): Promise<boolean> => {
    if (!nextSchema) {
      return true;
    }

    const lastSchema = await window.electron.ipcRenderer.invoke(
      "localMeta:get",
      "last_login_schema"
    );
    const lastTenant = await window.electron.ipcRenderer.invoke(
      "localMeta:get",
      "last_login_tenant"
    );

    const hasLocalData = await window.electron.ipcRenderer.invoke("localDb:hasData");

    const schemaChanged = lastSchema && String(lastSchema) !== String(nextSchema);
    const tenantChanged = nextTenantId && lastTenant && String(lastTenant) !== String(nextTenantId);
    const missingLastLogin = !lastSchema || !lastTenant;

   
    if (schemaChanged || tenantChanged || (hasLocalData && missingLastLogin)) {
      if (options?.prompt) {
        const confirmed = window.confirm(
          "Detected schema change. Local data may be cleared and missing. Are you sure?"
        );
        if (!confirmed) {
          return false;
        }
      }
      console.log("Clearing local SQLite for tenant switch");
      await window.electron.ipcRenderer.invoke("localDb:clearForTenantSwitch");
    }
    return true;
  };

  const attemptOfflineLogin = async (email: string, password: string): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase();
    const cached = await window.electron.ipcRenderer.invoke(
      "credentialCache:findByEmail",
      normalizedEmail
    );
    if (!cached) {
      toast.error("Internet connection required for first login.");
      return false;
    }

    const expiresAt = cached.expires_at ? new Date(cached.expires_at) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      toast.error("Offline login expired. Please connect to the internet.");
      return false;
    }

    const isValidPassword = await window.electron.ipcRenderer.invoke(
      "employees:verifyPassword",
      password,
      cached.password_hash
    );

    if (!isValidPassword) {
      await window.electron.ipcRenderer.invoke(
        "credentialCache:recordFailedAttempt",
        normalizedEmail
      );
      toast.error("Invalid email or password");
      return false;
    }

    await window.electron.ipcRenderer.invoke(
      "credentialCache:resetFailedAttempts",
      normalizedEmail
    );

    const storedUserRaw =
      localStorage.getItem("currentUser") ?? localStorage.getItem("lastUserProfile");
    let storedUser = storedUserRaw ? JSON.parse(storedUserRaw) : null;

    if (!storedUser) {
      const lastEmail = await window.electron.ipcRenderer.invoke(
        "localMeta:get",
        "last_login_email"
      );
      const lastSchema = await window.electron.ipcRenderer.invoke(
        "localMeta:get",
        "last_login_schema"
      );
      const lastTenant = await window.electron.ipcRenderer.invoke(
        "localMeta:get",
        "last_login_tenant"
      );
      if (lastEmail && lastEmail !== normalizedEmail) {
        toast.error("Offline login requires a previous online login.");
        return false;
      }

      storedUser = {
        email: normalizedEmail,
        schemaName: lastSchema,
        tenantId: lastTenant
      };
    }

    if (
      !storedUser?.schemaName ||
      String(storedUser.email ?? "")
        .trim()
        .toLowerCase() !== normalizedEmail
    ) {
      toast.error("Offline login requires a previous online login.");
      return false;
    }

    await setActiveSchema(storedUser.schemaName, { skipTenantLookup: true });
    if (storedUser.tenantId) {
      await window.electron.ipcRenderer.invoke("sync:setTenant", storedUser.tenantId);
    }

    const localEmployee = await window.electron.ipcRenderer.invoke(
      "employees:findByEmail",
      normalizedEmail,
      storedUser.schemaName
    );
    if (!localEmployee && !storedUser?.id) {
      toast.error("Offline login unavailable. Please connect to the internet.");
      return false;
    }

    setCurrentUser({
      ...storedUser,
      ...(localEmployee ?? {}),
      loginExpiresAt: cached.expires_at
    });
    return true;
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      console.log("Login attempt email:", normalizedEmail);
      if (!navigator.onLine) {
        return await attemptOfflineLogin(normalizedEmail, password);
      }
      console.log("try with internet");
      await clearActiveSchema();

      // Step 1: Find tenant user by email in public schema
      const tenantUser = await window.electron.ipcRenderer.invoke(
        "tenantUsers:findByEmail",
        normalizedEmail
      );

      if (!tenantUser) {
        console.log("No tenant user found for email:", email);
        toast.error("Invalid email or password");
        return false;
      }

      // Step 2: Check subscription status
      const subscription = await window.electron.ipcRenderer.invoke(
        "subscriptions:findByTenantId",
        tenantUser.tenantId
      );
      if (!subscription) {
        console.log("No subscription found for tenant:", tenantUser.tenantId);
        toast.error("No active subscription found. Please contact support.");
        return false;
      }

      // Check if subscription is active and not expired
      const now = new Date();
      const expiresAt = new Date(subscription.expiresAt);

      if (subscription.status !== "active") {
        console.log("Subscription is not active:", subscription.status);
        toast.error("Your subscription is not active. Please renew your subscription.");
        return false;
      }

      if (expiresAt < now) {
        console.log("Subscription has expired:", expiresAt);
        toast.error("Your subscription has expired. Please renew your subscription.");
        return false;
      }

      // Step 3: Get tenant schema name
      const schemaName = tenantUser.schemaName;
      if (!schemaName) {
        console.error("No schema name found for tenant user");
        toast.error("System configuration error. Please contact support.");
        return false;
      }

      const proceed = await maybeClearLocalDbForTenantSwitch(schemaName, tenantUser.tenantId, {
        prompt: true
      });
      if (!proceed) {
        return false;
      }

      await setActiveSchema(schemaName);
      await window.electron.ipcRenderer.invoke("sync:setTenant", tenantUser.tenantId);

      const employee = await window.electron.ipcRenderer.invoke(
        "employees:findByEmailOnline",
        normalizedEmail,
        schemaName
      );
      if (!employee) {
        console.log("No employee found in tenant schema for email:", email);
        await clearActiveSchema();
        toast.error("Invalid email or password");
        return false;
      }

      console.log("Found employee in tenant schema:", employee);

      const isValidPassword = await window.electron.ipcRenderer.invoke(
        "employees:verifyPassword",
        password,
        employee.password_hash,
        schemaName
      );

      if (isValidPassword) {
        const employees = await window.electron.ipcRenderer.invoke(
          "employees:findMany",
          schemaName
        );
        const employeeWithRoles = employees.find((emp: Employee) => emp.id === employee.id);

        const nowIso = new Date().toISOString();
        const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
        const userWithTenant = {
          ...(employeeWithRoles || employee),
          tenantId: tenantUser.tenantId,
          schemaName: schemaName,
          companyName: tenantUser.businessName,
          loginExpiresAt: expiresAt,
          subscription: {
            planName: subscription.planName,
            joinedAt: subscription.joinedAt,
            expiresAt: subscription.expiresAt,
            status: subscription.status
          }
        };

        await window.electron.ipcRenderer.invoke("credentialCache:upsert", {
          userId: employee.id,
          email: normalizedEmail,
          passwordHash: employee.password_hash,
          roles: JSON.stringify(userWithTenant.employeeRoles ?? []),
          lastVerifiedAt: nowIso,
          expiresAt
        });
        await window.electron.ipcRenderer.invoke(
          "localMeta:set",
          "last_login_email",
          normalizedEmail
        );
        await window.electron.ipcRenderer.invoke("localMeta:set", "last_login_schema", schemaName);
        await window.electron.ipcRenderer.invoke(
          "localMeta:set",
          "last_login_tenant",
          tenantUser.tenantId
        );

        setCurrentUser(userWithTenant);
        return true;
      }

      console.log("Invalid password for email:", email);
      await clearActiveSchema();
      toast.error("Invalid email or password");
      return false;
    } catch (error) {
      console.error("Login error:", error);
      try {
        await clearActiveSchema();
      } catch (schemaError) {
        console.error("Failed to clear active schema after login error:", schemaError);
      }

      if (isNetworkError(error)) {
        const offlineSuccess = await attemptOfflineLogin(email.trim().toLowerCase(), password);
        return offlineSuccess;
      }

      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    const email = currentUser?.email;
    setCurrentUser(null);
    if (email) {
      void window.electron.ipcRenderer
        .invoke("credentialCache:deleteByEmail", email)
        .catch((error) => {
          console.error("Failed to clear credential cache:", error);
        });
    }
    void clearActiveSchema().catch((error) => {
      console.error("Failed to clear active schema on logout:", error);
    });
  };

  useEffect(() => {
    const loadStoredUser = async () => {
      const storedUser = localStorage.getItem("currentUser");
      if (storedUser) {
        try {
          const user = JSON.parse(storedUser);

          const expiresAt = user?.loginExpiresAt ? new Date(user.loginExpiresAt) : null;
          if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
            toast.error("Session expired. Please login again.");
            localStorage.removeItem("currentUser");
            setCurrentUser(null);
            await clearActiveSchema();
            return;
          }

          try {
            let schemaName =
              typeof user.schemaName === "string" && user.schemaName.trim().length > 0
                ? user.schemaName
                : null;
            let tenantId = user.tenantId ?? null;

            if (!schemaName) {
              const lastSchema = await window.electron.ipcRenderer.invoke(
                "localMeta:get",
                "last_login_schema"
              );
              const lastTenant = await window.electron.ipcRenderer.invoke(
                "localMeta:get",
                "last_login_tenant"
              );
              const lastEmail = await window.electron.ipcRenderer.invoke(
                "localMeta:get",
                "last_login_email"
              );
              if (
                lastEmail &&
                String(lastEmail).toLowerCase() === String(user.email).toLowerCase()
              ) {
                schemaName = lastSchema ?? null;
                tenantId = lastTenant ?? tenantId;
              }
            }

            if (!schemaName && navigator.onLine) {
              await clearActiveSchema();
              const tenantUser = await window.electron.ipcRenderer.invoke(
                "tenantUsers:findByEmail",
                user.email
              );
              schemaName = tenantUser?.schemaName ?? null;
              if (tenantUser?.tenantId) {
                tenantId = tenantUser.tenantId;
              }
            }

            if (!schemaName) {
              localStorage.removeItem("currentUser");
              setCurrentUser(null);
              await clearActiveSchema();
              return;
            }

            await maybeClearLocalDbForTenantSwitch(schemaName, tenantId);

            await setActiveSchema(schemaName, { skipTenantLookup: !navigator.onLine });
            if (tenantId) {
              await window.electron.ipcRenderer.invoke("sync:setTenant", tenantId);
            }

            setCurrentUser({ ...user, schemaName, tenantId });
            console.log("CurrentUser: Loaded from localStorage:", user.email);
          } catch (error) {
            console.error("Error restoring stored user:", error);
            localStorage.removeItem("currentUser");
            setCurrentUser(null);
            await clearActiveSchema();
          }
        } catch (error) {
          console.error("Error parsing stored user:", error);
          localStorage.removeItem("currentUser");
          await clearActiveSchema();
        }
      }
    };

    console.log("starting....");
    loadStoredUser();
  }, []);

  useEffect(() => {
    if (!currentUser?.loginExpiresAt) {
      return;
    }

    const expiresAt = new Date(currentUser.loginExpiresAt).getTime();
    if (Number.isNaN(expiresAt)) {
      return;
    }

    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      toast.error("Session expired. Please login again.");
      logout();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      toast.error("Session expired. Please login again.");
      logout();
    }, remaining);

    return () => window.clearTimeout(timeoutId);
  }, [currentUser]);

  // Save user to localStorage when currentUser changes
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      localStorage.setItem("lastUserProfile", JSON.stringify(currentUser));
    } else {
      localStorage.removeItem("currentUser");
    }
  }, [currentUser]);

  const value: CurrentUserContextType = {
    currentUser,
    setCurrentUser,
    isAuthenticated,
    isLoading,
    login,
    logout
  };

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
};
