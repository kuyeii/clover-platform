import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { fetchRuntimeApps } from "../api/portal";
import { moduleEntries } from "../config/modules";
import type { ModuleCode, PortalModule, RuntimeAppConfig } from "../types/portal";

interface RuntimeAppsContextValue {
  modules: PortalModule[];
  runtimeApps: RuntimeAppConfig[];
  error: string;
  getModuleByCode: (appId: ModuleCode) => PortalModule | undefined;
  getRuntimeAppByCode: (appId: ModuleCode) => RuntimeAppConfig | undefined;
  refreshRuntimeApps: () => Promise<void>;
}

const RuntimeAppsContext = createContext<RuntimeAppsContextValue | undefined>(undefined);
const RUNTIME_APPS_RETRY_DELAY_MS = 1_000;

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
  const [runtimeApps, setRuntimeApps] = useState<RuntimeAppConfig[]>([]);
  const [modules, setModules] = useState<PortalModule[]>(moduleEntries);
  const [error, setError] = useState("");

  const refreshRuntimeApps = useCallback(async () => {
    const apps = await fetchRuntimeApps();
    setRuntimeApps(apps);
    setModules(mergeRuntimeApps(apps));
    setError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    async function load(allowRetry: boolean) {
      try {
        const apps = await fetchRuntimeApps();
        if (cancelled) {
          return;
        }
        setRuntimeApps(apps);
        setModules(mergeRuntimeApps(apps));
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
      modules,
      runtimeApps,
      error,
      getModuleByCode,
      getRuntimeAppByCode,
      refreshRuntimeApps,
    }),
    [error, getModuleByCode, getRuntimeAppByCode, modules, refreshRuntimeApps, runtimeApps],
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
