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
import { matchPath, useLocation } from "react-router-dom";
import {
  enterApp as enterAppOnServer,
  fetchUsageSummaries,
  getAppUsageWebSocketUrl,
  getAuthToken,
  getClientId,
  heartbeatApp,
  leaveAllAppsBeacon,
  leaveApp as leaveAppOnServer,
} from "../services/apiClient";
import { ToolkitApp } from "../types/app";
import { AppUsageSummary } from "../types/user";
import { useAuth } from "./AuthContext";

interface EnterAppOptions {
  confirmedConflict?: boolean;
}

interface AppUsageContextValue {
  summaries: AppUsageSummary[];
  enterApp: (appId: ToolkitApp["id"], options?: EnterAppOptions) => Promise<void>;
  leaveApp: (appId?: ToolkitApp["id"]) => Promise<void>;
  refreshUsage: () => Promise<void>;
  getAppUsage: (appId: ToolkitApp["id"]) => AppUsageSummary;
}

const HEARTBEAT_INTERVAL_MS = 60_000;
const WEBSOCKET_RECONNECT_DELAY_MS = 3_000;

type AppUsageWebSocketMessage = {
  type?: string;
  summaries?: AppUsageSummary[];
};

const AppUsageContext = createContext<AppUsageContextValue | undefined>(undefined);

interface AppUsageProviderProps {
  children: ReactNode;
}

function getEmptySummary(appId: ToolkitApp["id"]): AppUsageSummary {
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

export function AppUsageProvider({ children }: AppUsageProviderProps) {
  const location = useLocation();
  const { currentUser, canAccessApp, isAuthenticated } = useAuth();
  const [summaries, setSummaries] = useState<AppUsageSummary[]>([]);
  const activeAppIdRef = useRef<ToolkitApp["id"] | null>(null);
  const usageTransitionRef = useRef(0);
  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const refreshUsage = useCallback(async () => {
    if (!isAuthenticated) {
      setSummaries([]);
      return;
    }

    const nextSummaries = await fetchUsageSummaries();
    setSummaries(nextSummaries);
  }, [isAuthenticated]);

  const leaveApp = useCallback(
    async (appId?: ToolkitApp["id"]) => {
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
      }

      const nextSummaries = await leaveAppOnServer(targetAppId);

      if (usageTransitionRef.current === transitionId) {
        setSummaries(nextSummaries);
      }
    },
    [currentUser],
  );

  const enterApp = useCallback(
    async (appId: ToolkitApp["id"], options: EnterAppOptions = {}) => {
      if (!currentUser || !canAccessApp(appId)) {
        return;
      }

      const transitionId = usageTransitionRef.current + 1;
      usageTransitionRef.current = transitionId;
      const nextSummaries = await enterAppOnServer(appId, Boolean(options.confirmedConflict));

      if (usageTransitionRef.current === transitionId) {
        activeAppIdRef.current = appId;
        setSummaries(nextSummaries);
      }
    },
    [canAccessApp, currentUser],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      activeAppIdRef.current = null;
      setSummaries([]);
      return;
    }

    refreshUsage().catch(() => {
      setSummaries([]);
    });
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

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connectWebSocket();
      }, WEBSOCKET_RECONNECT_DELAY_MS);
    };

    const sendAuthMessage = (socket: WebSocket) => {
      const token = getAuthToken();
      if (!token) {
        socket.close();
        return;
      }

      socket.send(
        JSON.stringify({
          type: "auth",
          token,
          clientId: getClientId(),
        }),
      );
    };

    const sendActiveAppHeartbeat = (socket: WebSocket) => {
      const activeAppId = activeAppIdRef.current;
      if (!activeAppId || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(JSON.stringify({ type: "heartbeat", appId: activeAppId }));
    };

    function connectWebSocket() {
      if (closedByEffect || !getAuthToken()) {
        return;
      }

      const socket = new WebSocket(getAppUsageWebSocketUrl());
      websocketRef.current = socket;

      socket.addEventListener("open", () => {
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
          // Ignore malformed websocket messages and keep the connection alive.
        }
      });

      socket.addEventListener("close", (event) => {
        if (websocketRef.current === socket) {
          websocketRef.current = null;
        }
        if (event.code !== 4401) {
          scheduleReconnect();
        }
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
    };
  }, [isAuthenticated]);

  useEffect(() => {
    const routeAppId = matchPath("/apps/:appId", location.pathname)?.params
      .appId as ToolkitApp["id"] | undefined;
    const previousAppId = activeAppIdRef.current;

    if (previousAppId && previousAppId !== routeAppId) {
      leaveApp(previousAppId).catch(() => undefined);
    }

    if (routeAppId && canAccessApp(routeAppId)) {
      enterApp(routeAppId).catch(() => undefined);
    }
  }, [canAccessApp, enterApp, leaveApp, location.pathname]);

  useEffect(() => {
    if (!currentUser) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const activeAppId = activeAppIdRef.current;

      if (activeAppId) {
        const socket = websocketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "heartbeat", appId: activeAppId }));
          return;
        }

        heartbeatApp(activeAppId).then(setSummaries).catch(() => undefined);
      }
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
    (appId: ToolkitApp["id"]) =>
      summaries.find((summary) => summary.appId === appId) ?? getEmptySummary(appId),
    [summaries],
  );

  const value = useMemo<AppUsageContextValue>(
    () => ({
      summaries,
      enterApp,
      leaveApp,
      refreshUsage,
      getAppUsage,
    }),
    [enterApp, getAppUsage, leaveApp, refreshUsage, summaries],
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
