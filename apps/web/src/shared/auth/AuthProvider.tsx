import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiClient, ApiRequestError } from "../api/client";
import {
  changeCurrentPassword,
  createUser as createServerUser,
  fetchCurrentUser,
  fetchUsers,
  loginByPassword,
  logoutFromServer,
  updateUser as updateServerUser,
} from "../api/portal";
import { clearAccessToken, getAccessToken } from "./token";
import type {
  ChangePasswordInput,
  CreatePortalUserInput,
  ModuleCode,
  PortalUser,
  UpdatePortalUserInput,
} from "../types/portal";

interface AuthContextValue {
  users: PortalUser[];
  currentUser: PortalUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  error: string;
  login: (account: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshCurrentUser: () => Promise<PortalUser | null>;
  refreshUsers: () => Promise<void>;
  createUser: (input: CreatePortalUserInput) => Promise<PortalUser | null>;
  updateUser: (userId: string, patch: UpdatePortalUserInput) => Promise<PortalUser | null>;
  changePassword: (input: ChangePasswordInput) => Promise<{ ok: boolean; message: string }>;
  canAccessApp: (appId: ModuleCode) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [currentUser, setCurrentUser] = useState<PortalUser | null>(null);
  const [isLoading, setIsLoading] = useState(() => Boolean(getAccessToken()));
  const [error, setError] = useState("");

  const clearSession = useCallback(() => {
    clearAccessToken();
    setCurrentUser(null);
    setUsers([]);
  }, []);

  useEffect(() => {
    apiClient.setUnauthorizedHandler(clearSession);
    return () => apiClient.setUnauthorizedHandler(undefined);
  }, [clearSession]);

  const refreshUsers = useCallback(async () => {
    const nextUsers = await fetchUsers();
    setUsers(nextUsers);
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    if (!getAccessToken()) {
      clearSession();
      return null;
    }
    const user = await fetchCurrentUser();
    setCurrentUser(user);
    setUsers((current) => {
      if (user.role === "admin") {
        return current.length ? current : [user];
      }
      return [user];
    });
    return user;
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!getAccessToken()) {
        setIsLoading(false);
        return;
      }

      try {
        const user = await fetchCurrentUser();
        if (cancelled) {
          return;
        }
        setCurrentUser(user);
        if (user.role === "admin") {
          const nextUsers = await fetchUsers();
          if (!cancelled) {
            setUsers(nextUsers);
          }
        } else {
          setUsers([user]);
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          clearSession();
          setError(getErrorMessage(bootstrapError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(async (account: string, password: string) => {
    setError("");
    setIsLoading(true);
    try {
      const user = await loginByPassword(account, password);
      setCurrentUser(user);
      setUsers(user.role === "admin" ? await fetchUsers() : [user]);
      return true;
    } catch (loginError) {
      clearSession();
      setError(getErrorMessage(loginError));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [clearSession]);

  const logout = useCallback(async () => {
    setError("");
    try {
      await logoutFromServer();
    } catch (logoutError) {
      setError(getErrorMessage(logoutError));
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const createUser = useCallback<AuthContextValue["createUser"]>(
    async (input) => {
      setError("");
      try {
        const nextUser = await createServerUser(input);
        await refreshUsers();
        return nextUser;
      } catch (createError) {
        setError(getErrorMessage(createError));
        return null;
      }
    },
    [refreshUsers],
  );

  const updateUser = useCallback<AuthContextValue["updateUser"]>(
    async (userId, patch) => {
      setError("");
      try {
        const nextUser = await updateServerUser(userId, patch);
        setCurrentUser((current) => (current?.id === userId ? nextUser : current));
        await refreshUsers();
        return nextUser;
      } catch (updateError) {
        setError(getErrorMessage(updateError));
        return null;
      }
    },
    [refreshUsers],
  );

  const changePassword = useCallback<AuthContextValue["changePassword"]>(async (input) => {
    setError("");
    try {
      const nextUser = await changeCurrentPassword(input);
      setCurrentUser(nextUser);
      setUsers((currentUsers) =>
        currentUsers.some((user) => user.id === nextUser.id)
          ? currentUsers.map((user) => (user.id === nextUser.id ? nextUser : user))
          : [nextUser],
      );
      return { ok: true, message: "" };
    } catch (changeError) {
      const message = getErrorMessage(changeError);
      setError(message);
      return { ok: false, message };
    }
  }, []);

  const canAccessApp = useCallback(
    (appId: ModuleCode) => {
      if (!currentUser || !currentUser.enabled) {
        return false;
      }
      return currentUser.role === "admin" || currentUser.appPermissions.includes(appId);
    },
    [currentUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      users,
      currentUser,
      isAuthenticated: Boolean(currentUser),
      isAdmin: currentUser?.role === "admin",
      isLoading,
      error,
      login,
      logout,
      refreshCurrentUser,
      refreshUsers,
      createUser,
      updateUser,
      changePassword,
      canAccessApp,
    }),
    [
      canAccessApp,
      changePassword,
      createUser,
      currentUser,
      error,
      isLoading,
      login,
      logout,
      refreshCurrentUser,
      refreshUsers,
      updateUser,
      users,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
