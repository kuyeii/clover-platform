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
    let retryTimer: number | undefined;

    const applyFallback = () => {
      if (cancelled) {
        return;
      }
      setApps(appsConfig);
      cacheRuntimeApps(appsConfig);
    };

    const loadRuntimeApps = async (allowRetry: boolean) => {
      try {
        const runtimeApps = await fetchRuntimeApps();
        if (cancelled) {
          return;
        }
        const mergedApps = mergeRuntimeApps(runtimeApps);
        setApps(mergedApps);
        cacheRuntimeApps(mergedApps);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (allowRetry) {
          console.warn("Runtime apps 请求失败，将在 1 秒后重试。", error);
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            void loadRuntimeApps(false);
          }, RUNTIME_APPS_RETRY_DELAY_MS);
          return;
        }

        console.warn("Runtime apps 重试失败，使用静态应用配置。", error);
        applyFallback();
      }
    };

    void loadRuntimeApps(true);

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
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
