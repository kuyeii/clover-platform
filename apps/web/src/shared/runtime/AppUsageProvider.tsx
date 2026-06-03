import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getAppUsageWebSocketUrl } from "../api/client";
import {
  enterApp as enterAppOnServer,
  fetchUsageSummaries,
  heartbeatApp,
  leaveAllAppsBeacon,
  leaveApp as leaveAppOnServer,
} from "../api/portal";
import { getAccessToken, getClientId } from "../auth/token";
import { useAuth } from "../auth/AuthProvider";
import { moduleEntries } from "../config/modules";
import type { AppUsageSummary, ModuleCode } from "../types/portal";

interface EnterAppOptions {
  confirmedConflict?: boolean;
}

interface AppUsageContextValue {
  summaries: AppUsageSummary[];
  activeAppId: ModuleCode | null;
  connectionState: "idle" | "connected" | "reconnecting" | "closed";
  enterApp: (appId: ModuleCode, options?: EnterAppOptions) => Promise<void>;
  leaveApp: (appId?: ModuleCode) => Promise<void>;
  refreshUsage: () => Promise<void>;
  getAppUsage: (appId: ModuleCode) => AppUsageSummary;
}

type AppUsageWebSocketMessage = {
  type?: string;
  summaries?: AppUsageSummary[];
};

const AppUsageContext = createContext<AppUsageContextValue | undefined>(undefined);
const HEARTBEAT_INTERVAL_MS = 60_000;
const WEBSOCKET_RECONNECT_DELAY_MS = 3_000;

const modulePathAliases: Record<ModuleCode, string[]> = {
  "bid-generator": ["/apps/bid-generator", "/modules/bid-generator"],
  "contract-review": ["/apps/contract-review", "/modules/contract-review"],
  "competitor-analysis": ["/apps/competitor-analysis", "/modules/competitor-analysis"],
  "patent-disclosure": ["/apps/patent-disclosure", "/modules/patent-disclosure"],
  "rag-web-search": ["/apps/rag-web-search", "/apps/rag", "/modules/rag"],
};

function getEmptySummary(appId: ModuleCode): AppUsageSummary {
  return {
    appId,
    sessions: [],
    otherUserSessions: [],
    currentUserSessions: [],
    inUse: false,
    inUseByOthers: false,
    userNames: [],
    otherUserNames: [],
  };
}

function getRouteAppId(currentPath: string): ModuleCode | null {
  const normalizedPath = currentPath.split("?")[0] || "/";
  for (const module of moduleEntries) {
    const aliases = modulePathAliases[module.code];
    if (aliases.some((alias) => normalizedPath === alias || normalizedPath.startsWith(`${alias}/`))) {
      return module.code;
    }
  }
  return null;
}

export function AppUsageProvider({
  children,
  currentPath,
}: {
  children: ReactNode;
  currentPath: string;
}) {
  const { currentUser, canAccessApp, isAuthenticated } = useAuth();
  const [summaries, setSummaries] = useState<AppUsageSummary[]>([]);
  const [activeAppId, setActiveAppId] = useState<ModuleCode | null>(null);
  const [connectionState, setConnectionState] = useState<AppUsageContextValue["connectionState"]>("idle");
  const activeAppIdRef = useRef<ModuleCode | null>(null);
  const usageTransitionRef = useRef(0);
  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const refreshUsage = useCallback(async () => {
    if (!isAuthenticated) {
      setSummaries([]);
      return;
    }
    setSummaries(await fetchUsageSummaries());
  }, [isAuthenticated]);

  const leaveApp = useCallback(
    async (appId?: ModuleCode) => {
      if (!currentUser) {
        return;
      }
      const targetAppId = appId ?? activeAppIdRef.current;
      if (!targetAppId) {
        return;
      }

      const transitionId = usageTransitionRef.current + 1;
      usageTransitionRef.current = transitionId;
      if (activeAppIdRef.current === targetAppId) {
        activeAppIdRef.current = null;
        setActiveAppId(null);
      }
      const nextSummaries = await leaveAppOnServer(targetAppId);
      if (usageTransitionRef.current === transitionId) {
        setSummaries(nextSummaries);
      }
    },
    [currentUser],
  );

  const enterApp = useCallback(
    async (appId: ModuleCode, options: EnterAppOptions = {}) => {
      if (!currentUser || !canAccessApp(appId)) {
        return;
      }
      const transitionId = usageTransitionRef.current + 1;
      usageTransitionRef.current = transitionId;
      const nextSummaries = await enterAppOnServer(appId, Boolean(options.confirmedConflict));
      if (usageTransitionRef.current === transitionId) {
        activeAppIdRef.current = appId;
        setActiveAppId(appId);
        setSummaries(nextSummaries);
      }
    },
    [canAccessApp, currentUser],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      activeAppIdRef.current = null;
      setActiveAppId(null);
      setSummaries([]);
      setConnectionState("idle");
      return;
    }
    refreshUsage().catch(() => setSummaries([]));
  }, [isAuthenticated, refreshUsage]);

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }

    let closedByEffect = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (closedByEffect || reconnectTimerRef.current !== null) {
        return;
      }
      setConnectionState("reconnecting");
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connectWebSocket();
      }, WEBSOCKET_RECONNECT_DELAY_MS);
    };

    const sendAuthMessage = (socket: WebSocket) => {
      const token = getAccessToken();
      if (!token) {
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ type: "auth", token, clientId: getClientId() }));
    };

    const sendActiveAppHeartbeat = (socket: WebSocket) => {
      const currentAppId = activeAppIdRef.current;
      if (currentAppId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "heartbeat", appId: currentAppId }));
      }
    };

    function connectWebSocket() {
      if (closedByEffect || !getAccessToken()) {
        return;
      }
      const socket = new WebSocket(getAppUsageWebSocketUrl());
      websocketRef.current = socket;

      socket.addEventListener("open", () => {
        setConnectionState("connected");
        sendAuthMessage(socket);
      });

      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data) as AppUsageWebSocketMessage;
          if (
            (message.type === "snapshot" || message.type === "app_usage_changed") &&
            Array.isArray(message.summaries)
          ) {
            setSummaries(message.summaries);
            sendActiveAppHeartbeat(socket);
          }
        } catch {
          // Ignore malformed websocket payloads.
        }
      });

      socket.addEventListener("close", (event) => {
        if (websocketRef.current === socket) {
          websocketRef.current = null;
        }
        if (event.code === 4401) {
          setConnectionState("closed");
          return;
        }
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    }

    connectWebSocket();
    return () => {
      closedByEffect = true;
      clearReconnectTimer();
      websocketRef.current?.close();
      websocketRef.current = null;
      setConnectionState("closed");
    };
  }, [isAuthenticated]);

  useEffect(() => {
    const routeAppId = getRouteAppId(currentPath);
    const previousAppId = activeAppIdRef.current;

    if (previousAppId && previousAppId !== routeAppId) {
      leaveApp(previousAppId).catch(() => undefined);
    }

    if (routeAppId && routeAppId !== previousAppId && canAccessApp(routeAppId)) {
      enterApp(routeAppId).catch(() => undefined);
    }
  }, [canAccessApp, currentPath, enterApp, leaveApp]);

  useEffect(() => {
    if (!currentUser) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      const currentAppId = activeAppIdRef.current;
      if (!currentAppId) {
        return;
      }
      const socket = websocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "heartbeat", appId: currentAppId }));
        return;
      }
      heartbeatApp(currentAppId).then(setSummaries).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [currentUser]);

  useEffect(() => {
    const handlePageExit = () => {
      if (activeAppIdRef.current) {
        leaveAllAppsBeacon();
      }
    };

    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);
    return () => {
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
      if (activeAppIdRef.current) {
        leaveApp(activeAppIdRef.current).catch(() => undefined);
      }
    };
  }, [leaveApp]);

  const getAppUsage = useCallback(
    (appId: ModuleCode) => summaries.find((summary) => summary.appId === appId) ?? getEmptySummary(appId),
    [summaries],
  );

  const value = useMemo<AppUsageContextValue>(
    () => ({
      summaries,
      activeAppId,
      connectionState,
      enterApp,
      leaveApp,
      refreshUsage,
      getAppUsage,
    }),
    [activeAppId, connectionState, enterApp, getAppUsage, leaveApp, refreshUsage, summaries],
  );

  return <AppUsageContext.Provider value={value}>{children}</AppUsageContext.Provider>;
}

export function useAppUsage() {
  const context = useContext(AppUsageContext);
  if (!context) {
    throw new Error("useAppUsage must be used within AppUsageProvider");
  }
  return context;
}
