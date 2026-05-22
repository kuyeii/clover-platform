import { useEffect, type ReactNode } from "react";

import type { NavigateFn } from "../../routes";
import { useAuth } from "../auth/AuthProvider";

interface RequireAuthProps {
  children: ReactNode;
  currentPath: string;
  navigate: NavigateFn;
}

export function RequireAuth({ children, currentPath, navigate }: RequireAuthProps) {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate(`/login?from=${encodeURIComponent(currentPath)}`);
    }
  }, [currentPath, isAuthenticated, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="page-center-state">
        <div className="loading-spinner" aria-hidden />
        <p>正在恢复会话...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
