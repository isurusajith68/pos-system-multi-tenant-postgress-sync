import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import toast from "react-hot-toast";

interface Employee {
  id: string;
  employee_id: string;
  name: string;
  role: string;
  email: string;
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

  const isAuthenticated = currentUser !== null;

  const setActiveSchema = async (schemaName: string | null) => {
    await window.electron.ipcRenderer.invoke("tenants:setActiveSchema", schemaName);
  };

  const clearActiveSchema = async () => {
    await setActiveSchema(null);
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      // Multi-tenant login flow:
      // 1. Check if email exists in public.tenant_users
      // 2. Check subscription status in public.subscriptions
      // 3. Get tenant schema from public.tenants
      // 4. Connect to tenant schema and verify employee credentials
      await clearActiveSchema();

      // Step 1: Find tenant user by email in public schema
      const tenantUser = await window.electron.ipcRenderer.invoke("tenantUsers:findByEmail", email);
      console.log(tenantUser)
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

      await setActiveSchema(schemaName);
      await window.electron.ipcRenderer.invoke("sync:setTenant", tenantUser.tenantId);

      let employee = await window.electron.ipcRenderer.invoke(
        "employees:findByEmail",
        email,
        schemaName
      );
      if (!employee) {
        employee = await window.electron.ipcRenderer.invoke(
          "employees:findByEmailOnline",
          email,
          schemaName
        );
      }
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

        const userWithTenant = {
          ...(employeeWithRoles || employee),
          tenantId: tenantUser.tenantId,
          schemaName: schemaName,
          companyName: tenantUser.businessName,
          subscription: {
            planName: subscription.planName,
            joinedAt: subscription.joinedAt,
            expiresAt: subscription.expiresAt,
            status: subscription.status
          }
        };

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
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setCurrentUser(null);
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

          // Validate that the user still exists in the database
          try {
            let schemaName =
              typeof user.schemaName === "string" && user.schemaName.trim().length > 0
                ? user.schemaName
                : null;

            if (!schemaName) {
              await clearActiveSchema();
              const tenantUser = await window.electron.ipcRenderer.invoke(
                "tenantUsers:findByEmail",
                user.email
              );
              schemaName = tenantUser?.schemaName ?? null;
              if (tenantUser?.tenantId) {
                await window.electron.ipcRenderer.invoke("sync:setTenant", tenantUser.tenantId);
              }
            }
            await setActiveSchema(schemaName);
            if (user.tenantId) {
              await window.electron.ipcRenderer.invoke("sync:setTenant", user.tenantId);
            }
            const employee = await window.electron.ipcRenderer.invoke(
              "employees:findByEmail",
              user.email,
              schemaName
            );

            if (employee && employee.id === user.id) {
              // User still exists, use the stored data
              setCurrentUser(user);
              console.log("CurrentUser: Loaded from localStorage:", user.email);
            } else {
              // User no longer exists or ID mismatch, clear localStorage
              console.log("CurrentUser: Stored user no longer valid, clearing localStorage");
              localStorage.removeItem("currentUser");
              setCurrentUser(null);
              await clearActiveSchema();
            }
          } catch (error) {
            console.error("Error validating stored user:", error);
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

    console.log("starting....")
    loadStoredUser();
  }, []);

  // Save user to localStorage when currentUser changes
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
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
