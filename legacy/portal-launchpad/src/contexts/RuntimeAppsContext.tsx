import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { appsConfig } from "../config/apps.config";
import { RuntimeAppConfig, fetchRuntimeApps } from "../services/apiClient";
import { ToolkitApp } from "../types/app";

interface RuntimeAppsContextValue {
  apps: ToolkitApp[];
  getAppById: (appId: string) => ToolkitApp | undefined;
}

const RuntimeAppsContext = createContext<RuntimeAppsContextValue | undefined>(undefined);
const RUNTIME_APPS_STORAGE_KEY = "portal.launchpad.runtimeApps.v1";

function cacheRuntimeApps(apps: ToolkitApp[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(RUNTIME_APPS_STORAGE_KEY, JSON.stringify(apps));
  } catch {
    // Runtime app caching is only an optimization for cross-page API discovery.
  }
}

function mergeRuntimeApps(runtimeApps: RuntimeAppConfig[]) {
  const runtimeByCode = new Map(runtimeApps.map((app) => [app.code, app]));

  return appsConfig.map((app) => {
    const runtimeApp = runtimeByCode.get(app.id);
    if (!runtimeApp) {
      return app;
    }

    return {
      ...app,
      name: runtimeApp.name || app.name,
      url: runtimeApp.iframeUrl || runtimeApp.url || app.url,
      backendUrl: runtimeApp.backendUrl || app.backendUrl,
      healthUrl: runtimeApp.healthUrl || app.healthUrl,
      status: runtimeApp.enabled ? app.status : "offline",
    } satisfies ToolkitApp;
  });
}

export function RuntimeAppsProvider({ children }: { children: ReactNode }) {
  const [apps, setApps] = useState<ToolkitApp[]>(appsConfig);

  useEffect(() => {
    let cancelled = false;

    fetchRuntimeApps()
      .then((runtimeApps) => {
        if (!cancelled) {
          const mergedApps = mergeRuntimeApps(runtimeApps);
          setApps(mergedApps);
          cacheRuntimeApps(mergedApps);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApps(appsConfig);
          cacheRuntimeApps(appsConfig);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const getAppById = useCallback(
    (appId: string) => apps.find((app) => app.id === appId),
    [apps],
  );

  const value = useMemo(() => ({ apps, getAppById }), [apps, getAppById]);

  return <RuntimeAppsContext.Provider value={value}>{children}</RuntimeAppsContext.Provider>;
}

export function useRuntimeApps() {
  const context = useContext(RuntimeAppsContext);
  if (!context) {
    throw new Error("useRuntimeApps must be used within RuntimeAppsProvider");
  }
  return context;
}
