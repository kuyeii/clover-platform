import { MouseEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AppLayout } from "./layouts/AppLayout";
import { resolveRoute } from "./routes";
import { AuthProvider } from "./shared/auth/AuthProvider";
import { AppUsageProvider } from "./shared/runtime/AppUsageProvider";
import { RuntimeAppsProvider } from "./shared/runtime/RuntimeAppsProvider";

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function currentPathWithSearch() {
  return `${normalizePath(window.location.pathname)}${window.location.search || ""}`;
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => currentPathWithSearch());

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(currentPathWithSearch());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((href: string) => {
    const nextUrl = new URL(href, window.location.origin);
    const nextPath = `${normalizePath(nextUrl.pathname)}${nextUrl.search}`;
    if (nextPath !== currentPathWithSearch()) {
      window.history.pushState(null, "", nextPath);
      setCurrentPath(nextPath);
      window.scrollTo({ top: 0 });
      return;
    }
    setCurrentPath(nextPath);
  }, []);

  const onNavigate = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }, [navigate]);

  const pathname = useMemo(() => normalizePath(currentPath.split("?")[0] || "/"), [currentPath]);
  const route = useMemo(() => resolveRoute(pathname), [pathname]);

  return (
    <RuntimeAppsProvider>
      <AuthProvider>
        <AppUsageProvider currentPath={pathname}>
          <AppLayout currentPath={pathname} onNavigate={onNavigate} navigate={navigate}>
            {route.render({ navigate, currentPath })}
          </AppLayout>
        </AppUsageProvider>
      </AuthProvider>
    </RuntimeAppsProvider>
  );
}
