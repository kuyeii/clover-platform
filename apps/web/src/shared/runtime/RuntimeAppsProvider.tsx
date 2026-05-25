import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { fetchRuntimeApps } from "../api/portal";
import { appsConfig } from "../config/apps.config";
import { moduleEntries } from "../config/modules";
import type { ToolkitApp } from "../types/app";
import type { ModuleCode, PortalModule, RuntimeAppConfig } from "../types/portal";

interface RuntimeAppsContextValue {
  apps: ToolkitApp[];
  modules: PortalModule[];
  runtimeApps: RuntimeAppConfig[];
  error: string;
  getAppById: (appId: ModuleCode) => ToolkitApp | undefined;
  getModuleByCode: (appId: ModuleCode) => PortalModule | undefined;
  getRuntimeAppByCode: (appId: ModuleCode) => RuntimeAppConfig | undefined;
  refreshRuntimeApps: () => Promise<void>;
}

const RuntimeAppsContext = createContext<RuntimeAppsContextValue | undefined>(undefined);
const RUNTIME_APPS_STORAGE_KEY = "portal.launchpad.runtimeApps.v1";
const RUNTIME_APPS_RETRY_DELAY_MS = 1_000;

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

function mergeRuntimeToolkitApps(runtimeApps: RuntimeAppConfig[]): ToolkitApp[] {
  const runtimeByCode = new Map(runtimeApps.map((app) => [app.code, app]));

  return appsConfig.map((app) => {
    const runtimeApp = runtimeByCode.get(app.id);
    if (!runtimeApp) {
      return app;
    }

    return {
      ...app,
      name: runtimeApp.name || app.name,
      url: runtimeApp.iframeUrl || runtimeApp.url || runtimeApp.frontendUrl || app.url,
      backendUrl: runtimeApp.backendUrl || app.backendUrl,
      healthUrl: runtimeApp.healthUrl || app.healthUrl,
      status: runtimeApp.enabled ? app.status : "offline",
    };
  });
}

function mergeRuntimeApps(runtimeApps: RuntimeAppConfig[]): PortalModule[] {
  const runtimeByCode = new Map(runtimeApps.map((app) => [app.code, app]));
  return moduleEntries.map((module) => {
    const runtimeApp = runtimeByCode.get(module.code);
    if (!runtimeApp) {
      return module;
    }
    return {
      ...module,
      name: runtimeApp.name || module.name,
      status: runtimeApp.enabled ? module.status : "offline",
    };
  });
}

export function RuntimeAppsProvider({ children }: { children: ReactNode }) {
  const [apps, setApps] = useState<ToolkitApp[]>(appsConfig);
  const [runtimeApps, setRuntimeApps] = useState<RuntimeAppConfig[]>([]);
  const [modules, setModules] = useState<PortalModule[]>(moduleEntries);
  const [error, setError] = useState("");

  const refreshRuntimeApps = useCallback(async () => {
    const nextRuntimeApps = await fetchRuntimeApps();
    const nextApps = mergeRuntimeToolkitApps(nextRuntimeApps);
    setApps(nextApps);
    cacheRuntimeApps(nextApps);
    setRuntimeApps(nextRuntimeApps);
    setModules(mergeRuntimeApps(nextRuntimeApps));
    setError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    async function load(allowRetry: boolean) {
      try {
        const nextRuntimeApps = await fetchRuntimeApps();
        if (cancelled) {
          return;
        }
        const nextApps = mergeRuntimeToolkitApps(nextRuntimeApps);
        setApps(nextApps);
        cacheRuntimeApps(nextApps);
        setRuntimeApps(nextRuntimeApps);
        setModules(mergeRuntimeApps(nextRuntimeApps));
        setError("");
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (allowRetry) {
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            void load(false);
          }, RUNTIME_APPS_RETRY_DELAY_MS);
          return;
        }
        setApps(appsConfig);
        cacheRuntimeApps(appsConfig);
        setRuntimeApps([]);
        setModules(moduleEntries);
        setError(loadError instanceof Error ? loadError.message : "runtime apps 加载失败，已使用静态配置。");
      }
    }

    void load(true);
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  const getAppById = useCallback(
    (appId: ModuleCode) => apps.find((app) => app.id === appId),
    [apps],
  );
  const getModuleByCode = useCallback(
    (appId: ModuleCode) => modules.find((module) => module.code === appId),
    [modules],
  );
  const getRuntimeAppByCode = useCallback(
    (appId: ModuleCode) => runtimeApps.find((app) => app.code === appId),
    [runtimeApps],
  );

  const value = useMemo(
    () => ({
      apps,
      modules,
      runtimeApps,
      error,
      getAppById,
      getModuleByCode,
      getRuntimeAppByCode,
      refreshRuntimeApps,
    }),
    [apps, error, getAppById, getModuleByCode, getRuntimeAppByCode, modules, refreshRuntimeApps, runtimeApps],
  );

  return <RuntimeAppsContext.Provider value={value}>{children}</RuntimeAppsContext.Provider>;
}

export function useRuntimeApps() {
  const context = useContext(RuntimeAppsContext);
  if (!context) {
    throw new Error("useRuntimeApps must be used within RuntimeAppsProvider");
  }
  return context;
}
