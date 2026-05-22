import type { ReactNode } from "react";

import type { NavigateFn } from "../../routes";
import { useAuth } from "../auth/AuthProvider";

interface RequireAuthProps {
  children: ReactNode;
  currentPath: string;
  navigate: NavigateFn;
}

export function RequireAuth({ children, currentPath, navigate }: RequireAuthProps) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="page-center-state">
        <div className="loading-spinner" aria-hidden />
        <p>正在恢复会话...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    navigate(`/login?from=${encodeURIComponent(currentPath)}`);
    return null;
  }

  return <>{children}</>;
}
