import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ApiError,
  changeCurrentPassword,
  createUser as createServerUser,
  fetchCurrentUser,
  fetchUsers,
  getAuthToken,
  loginByPassword,
  logoutFromServer,
  updateUser as updateServerUser,
} from "../services/apiClient";
import { ToolkitApp } from "../types/app";
import {
  ChangePasswordInput,
  CreatePortalUserInput,
  PortalUser,
  UpdatePortalUserInput,
} from "../types/user";

interface AuthContextValue {
  users: PortalUser[];
  currentUser: PortalUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  error: string;
  login: (account: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  createUser: (input: CreatePortalUserInput) => Promise<PortalUser | null>;
  updateUser: (userId: string, patch: UpdatePortalUserInput) => Promise<PortalUser | null>;
  changePassword: (input: ChangePasswordInput) => Promise<{ ok: boolean; message: string }>;
  canAccessApp: (appId: ToolkitApp["id"]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "请求失败，请稍后重试。";
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [currentUser, setCurrentUser] = useState<PortalUser | null>(null);
  const [isLoading, setIsLoading] = useState(() => Boolean(getAuthToken()));
  const [error, setError] = useState("");

  const refreshUsers = useCallback(async () => {
    const nextUsers = await fetchUsers();
    setUsers(nextUsers);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!getAuthToken()) {
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
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setCurrentUser(null);
          setUsers([]);
          setError(getErrorMessage(bootstrapError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currentUser?.role === "admin") {
      refreshUsers().catch((refreshError) => {
        setError(getErrorMessage(refreshError));
      });
    } else {
      setUsers(currentUser ? [currentUser] : []);
    }
  }, [currentUser, refreshUsers]);

  const login = useCallback(async (account: string, password: string) => {
    setError("");
    setIsLoading(true);

    try {
      const user = await loginByPassword(account, password);
      setCurrentUser(user);
      if (user.role === "admin") {
        setUsers(await fetchUsers());
      } else {
        setUsers([user]);
      }
      return true;
    } catch (loginError) {
      setCurrentUser(null);
      setUsers([]);
      setError(getErrorMessage(loginError));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setError("");
    try {
      await logoutFromServer();
    } catch (logoutError) {
      setError(getErrorMessage(logoutError));
    } finally {
      setCurrentUser(null);
      setUsers([]);
    }
  }, []);

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
        await refreshUsers();
        setCurrentUser((current) => (current?.id === userId ? nextUser : current));
        return nextUser;
      } catch (updateError) {
        setError(getErrorMessage(updateError));
        return null;
      }
    },
    [refreshUsers],
  );

  const changePassword = useCallback<AuthContextValue["changePassword"]>(
    async (input) => {
      setError("");
      try {
        const nextUser = await changeCurrentPassword(input);
        setCurrentUser(nextUser);
        setUsers((currentUsers) => {
          if (currentUsers.some((user) => user.id === nextUser.id)) {
            return currentUsers.map((user) => (user.id === nextUser.id ? nextUser : user));
          }
          return [nextUser];
        });
        return { ok: true, message: "" };
      } catch (changeError) {
        const message = getErrorMessage(changeError);
        setError(message);
        return { ok: false, message };
      }
    },
    [],
  );

  const canAccessApp = useCallback(
    (appId: ToolkitApp["id"]) => {
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
