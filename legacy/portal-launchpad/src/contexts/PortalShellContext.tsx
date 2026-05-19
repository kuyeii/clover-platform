import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { getAppById } from "../config/apps.config";
import { ToolkitApp } from "../types/app";
import { useAuth } from "./AuthContext";

interface PortalShellContextValue {
  activeModule: ToolkitApp | null;
  isEmbeddedModuleView: boolean;
  hasPinnedModule: boolean;
}

const PortalShellContext = createContext<PortalShellContextValue | undefined>(
  undefined,
);

interface PortalShellProviderProps {
  children: ReactNode;
}

export function PortalShellProvider({ children }: PortalShellProviderProps) {
  const location = useLocation();
  const { canAccessApp } = useAuth();
  const moduleRouteMatch = matchPath("/apps/:appId", location.pathname);
  const routeAppId = moduleRouteMatch?.params.appId;
  const [activeModule, setActiveModule] = useState<ToolkitApp | null>(null);
  const isDashboardRoute = location.pathname === "/" || location.pathname === "/dashboard";

  useEffect(() => {
    if (routeAppId) {
      const routeApp = getAppById(routeAppId);
      setActiveModule(routeApp && canAccessApp(routeApp.id) ? routeApp : null);
      return;
    }

    if (isDashboardRoute) {
      setActiveModule(null);
    }
  }, [canAccessApp, isDashboardRoute, routeAppId]);

  return (
    <PortalShellContext.Provider
      value={{
        activeModule,
        isEmbeddedModuleView: Boolean(moduleRouteMatch),
        hasPinnedModule: Boolean(activeModule),
      }}
    >
      {children}
    </PortalShellContext.Provider>
  );
}

export function usePortalShell() {
  const context = useContext(PortalShellContext);

  if (!context) {
    throw new Error("usePortalShell must be used within PortalShellProvider");
  }

  return context;
}
