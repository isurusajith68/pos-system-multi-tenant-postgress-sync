import React, { useState, useEffect } from "react";
import { useAppData } from "../contexts/AppDataContext";
import { useCurrentUser } from "../contexts/CurrentUserContext";
import { LanguageProvider } from "../contexts/LanguageContext";
import LoginComponent from "../auth/Login";
import POSSystem2 from "../pages/POSSystem2";
import CategoryManagement from "../pages/CategoryManagement";
import ProductManagement from "../pages/ProductManagement";
import CustomerManagement from "../pages/CustomerManagement";
import SalesInvoices from "../pages/SalesInvoices";
import UnifiedStockManagement from "../pages/UnifiedStockManagement";
import PurchaseOrderManagement from "../pages/PurchaseOrderManagement";
import ReportsManagement from "../pages/ReportsManagement";
import SettingsManagement from "../pages/SettingsManagement";
import logo from "../assets/logo.png";

interface AuthenticatedLayoutProps {
  children?: React.ReactNode;
}

const AuthenticatedLayout: React.FC<AuthenticatedLayoutProps> = ({ children }) => {
  const { isAuthenticated, isLoading, currentUser: user, logout } = useCurrentUser();
  const { settings } = useAppData();
  const [currentPage, setCurrentPage] = useState("pos");
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", settings.darkMode);
    localStorage.setItem("theme", settings.darkMode ? "dark" : "light");
  }, [settings.darkMode]);

  const getNavButtonClass = (isActive: boolean) =>
    `px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 rounded-lg font-medium transition-colors text-sm sm:text-sm ${
      isActive
        ? "bg-white text-blue-600 dark:bg-slate-900 dark:text-blue-300 border border-white/50 dark:border-slate-700 shadow-sm"
        : "bg-blue-500 dark:bg-slate-800 hover:bg-blue-400 dark:hover:bg-slate-700 text-white"
    }`;

  const renderPage = () => {
    switch (currentPage) {
      case "pos":
        return <POSSystem2 />;
      case "categories":
        return <CategoryManagement />;
      case "products":
        return <ProductManagement />;
      case "customers":
        return <CustomerManagement />;
      case "invoices":
        return <SalesInvoices />;
      case "purchase-orders":
        return <PurchaseOrderManagement />;
      case "reports":
        return <ReportsManagement />;
      case "inventory":
      case "smart-inventory":
      case "stock-transactions":
      case "stock-hub":
        return <UnifiedStockManagement />;
      case "settings":
        return <SettingsManagement />;
      default:
        return <POSSystem2 />;
    }
  };

  const layoutMarkup = (
    <div className="h-screen flex flex-col">
      <header className="bg-[#2b83ff] text-white shadow-lg dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center space-x-3 mb-2 sm:mb-0">
            <img src={logo} alt="Zentra Logo" className="h-10 w-10 rounded-full bg-white" />
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold">Zentra</h1>
          </div>

          <div
            className="flex flex-wrap gap-1 sm:gap-2 w-full sm:w-auto"
            onClick={() => setShowProfileDropdown(false)}
          >
            <button
              onClick={() => setCurrentPage("pos")}
              className={getNavButtonClass(currentPage === "pos")}
            >
              <span className="hidden sm:inline">🛒 </span>
              {"POS"}
            </button>
            <button
              onClick={() => setCurrentPage("categories")}
              className={getNavButtonClass(currentPage === "categories")}
            >
              <span className="hidden sm:inline">📂 </span>
              {"Categories"}
            </button>
            <button
              onClick={() => setCurrentPage("products")}
              className={getNavButtonClass(currentPage === "products")}
            >
              <span className="hidden sm:inline">📦 </span>
              {"Products"}
            </button>
            <button
              onClick={() => setCurrentPage("customers")}
              className={getNavButtonClass(currentPage === "customers")}
            >
              <span className="hidden sm:inline">👥 </span>
              {"Customers"}
            </button>
            <button
              onClick={() => setCurrentPage("invoices")}
              className={getNavButtonClass(currentPage === "invoices")}
            >
              <span className="hidden sm:inline">📄 </span>
              {"Invoices"}
            </button>
            <button
              onClick={() => setCurrentPage("purchase-orders")}
              className={getNavButtonClass(currentPage === "purchase-orders")}
            >
              <span className="hidden sm:inline">📋 </span>
              {"PO"}
            </button>
            <button
              onClick={() => setCurrentPage("inventory")}
              className={getNavButtonClass(
                currentPage === "inventory" ||
                  currentPage === "stock-hub" ||
                  currentPage === "stock-transactions"
              )}
            >
              <span className="hidden sm:inline">📊 </span>
              {"Stock "}
            </button>
            <button
              onClick={() => setCurrentPage("reports")}
              className={getNavButtonClass(currentPage === "reports")}
            >
              <span className="hidden sm:inline">📊 </span>
              {"Reports"}
            </button>
            <button
              onClick={() => setCurrentPage("settings")}
              className={getNavButtonClass(currentPage === "settings")}
            >
              <span className="hidden sm:inline">⚙️ </span>
              {"Settings"}
            </button>
            {/* <button
              onClick={() => setCurrentPage("xp")}
              className={`px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 rounded-lg font-medium transition-colors text-sm sm:text-sm ${
                currentPage === "xp"
                  ? "bg-white text-blue-600"
                  : "bg-blue-500 hover:bg-blue-400 text-white"
              }`}
            >
              <span className="hidden sm:inline">🛒 </span>
              {"XP"}
            </button> */}
          </div>

          <div className="flex items-center space-x-4 mt-2 sm:mt-0">
            <div className="relative z-10">
              <div className="flex items-center gap-5">
                <div className="text-right leading-tight">
                  <h3 className="font-bold text-base text-white capitalize tracking-wide px-1">
                    {user?.companyName}
                  </h3>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800">
                    {user?.role}
                  </span>
                </div>

                <div className="h-8 w-px bg-white/20"></div>

                <button
                  onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                  className="group relative flex items-center justify-center w-8 h-8 rounded-full
               bg-gradient-to-br from-white/15 to-white/5 hover:from-white/25 hover:to-white/10
               transition-all duration-300 transform hover:scale-105 active:scale-95
               focus:outline-none focus:ring-2 focus:ring-white/40 shadow-lg backdrop-blur-sm
               border border-white/20 hover:border-white/30"
                >
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  <div
                    className="w-9 h-9 rounded-full bg-gradient-to-br from-white/20 to-white/10
                    flex items-center justify-center group-hover:from-white/30 group-hover:to-white/20
                    transition-all duration-300 shadow-inner"
                  >
                    <span className="text-lg group-hover:scale-110 transition-transform duration-200">
                      👤
                    </span>
                  </div>
                </button>
              </div>

              {showProfileDropdown && (
                <div className="absolute right-0 w-72 bg-blue-100 dark:bg-slate-800 rounded-xl border border-blue-500 dark:border-slate-700 z-50 transform transition-all duration-200 shadow-2xl ease-out mt-2">
                  {/* Header with close button */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700 rounded-t-xl">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
                      Profile Menu
                    </h3>
                    <button
                      onClick={() => setShowProfileDropdown(false)}
                      className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-slate-800 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      aria-label="Close profile menu"
                    >
                      <span className="text-gray-500 text-lg leading-none">×</span>
                    </button>
                  </div>

                  {/* User Info Section */}
                  <div className="px-4 py-4 border-b border-gray-100 dark:border-slate-700 ">
                    <div className="flex items-center space-x-3 mb-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-md">
                        <span className="text-white text-lg">👤</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                          {user?.name}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-slate-400 truncate">
                          {user?.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-base font-bold text-blue-500 dark:text-blue-300 capitalize">
                        {user?.companyName}
                      </span>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800">
                        <div className="w-1.5 h-1.5 bg-blue-600 rounded-full mr-1 animate-pulse"></div>
                        {user?.role}
                      </span>
                    </div>
                    {user?.subscription && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 dark:text-slate-400">Plan:</span>
                          <span className="text-xs font-medium text-gray-900 dark:text-white">
                            {user.subscription.planName}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 dark:text-slate-400">Joined:</span>
                          <span className="text-xs font-medium text-gray-900 dark:text-white">
                            {new Date(user.subscription.joinedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 dark:text-slate-400">
                            Expires:
                          </span>
                          <span
                            className={`text-xs font-medium ${
                              new Date(user.subscription.expiresAt) < new Date()
                                ? "text-red-600 dark:text-red-400"
                                : "text-green-600 dark:text-green-400"
                            }`}
                          >
                            {new Date(user.subscription.expiresAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Menu Items */}
                  <div className="py-2">
                    <button
                      onClick={() => {
                        setCurrentPage("settings");
                        setShowProfileDropdown(false);
                      }}
                      className="w-full flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors duration-150 group dark:text-gray-100"
                    >
                      <span className="mr-3 text-gray-400 group-hover:text-blue-500">⚙️</span>
                      <span className="font-medium">Settings</span>
                    </button>
                    <button
                      onClick={() => {
                        setCurrentPage("settings"); // Assuming employee management is under settings
                        setShowProfileDropdown(false);
                      }}
                      className="w-full flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors duration-150 group dark:text-gray-100"
                    >
                      <span className="mr-3 text-gray-400 group-hover:text-blue-500">👥</span>
                      <span className="font-medium">Manage Employees</span>
                    </button>
                  </div>

                  {/* Logout */}
                  <div className="border-t border-gray-100 dark:border-slate-700 pt-2  rounded-xl">
                    <button
                      onClick={() => {
                        logout();
                        setShowProfileDropdown(false);
                      }}
                      className="w-full flex items-center px-4 py-3 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 hover:rounded-b-xl transition-colors duration-150 group"
                    >
                      <span className="mr-3 text-red-400 group-hover:text-red-500">🚪</span>
                      <span className="font-medium">Logout</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
        onClick={() => setShowProfileDropdown(false)}
      >
        {children || renderPage()}
      </main>
    </div>
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="min-h-screen bg-gray-100 dark:bg-slate-950 flex items-center justify-center text-slate-900 dark:text-slate-100">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-300">{"Loading..."}</p>
          </div>
        </div>
      );
    }

    if (!isAuthenticated) {
      return <LoginComponent />;
    }

    return <LanguageProvider>{layoutMarkup}</LanguageProvider>;
  };

  return <>{renderContent()}</>;
};

export default AuthenticatedLayout;
