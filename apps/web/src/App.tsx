import { MouseEvent, ReactElement, useCallback, useEffect, useMemo, useState } from "react";

import { AppLayout } from "./layouts/AppLayout";
import { resolveRoute } from "./routes";
import { AuthProvider } from "./shared/auth/AuthProvider";
import { AppUsageProvider } from "./shared/runtime/AppUsageProvider";
import { RuntimeAppsProvider } from "./shared/runtime/RuntimeAppsProvider";

type KeepAlivePage = {
  key: string;
  element: ReactElement;
};

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
  const [keepAlivePages, setKeepAlivePages] = useState<KeepAlivePage[]>([]);
  const [lastActiveKeepAliveKey, setLastActiveKeepAliveKey] = useState<string | null>(null);
  const activeKeepAliveKey = route.keepAliveKey;
  const visibleKeepAlivePages = useMemo(() => {
    if (!activeKeepAliveKey || keepAlivePages.some((page) => page.key === activeKeepAliveKey)) {
      return keepAlivePages;
    }
    return [
      ...keepAlivePages,
      {
        key: activeKeepAliveKey,
        element: route.render({ navigate, currentPath }),
      },
    ];
  }, [activeKeepAliveKey, currentPath, keepAlivePages, navigate, route]);

  useEffect(() => {
    if (pathname === "/login") {
      setKeepAlivePages([]);
      setLastActiveKeepAliveKey(null);
      return;
    }
    if (!activeKeepAliveKey) {
      return;
    }
    setLastActiveKeepAliveKey(activeKeepAliveKey);

    setKeepAlivePages((pages) => {
      if (pages.some((page) => page.key === activeKeepAliveKey)) {
        return pages;
      }
      return [
        ...pages,
        {
          key: activeKeepAliveKey,
          element: route.render({ navigate, currentPath }),
        },
      ];
    });
  }, [activeKeepAliveKey, currentPath, navigate, route]);

  const routeContent = (
    <>
      {visibleKeepAlivePages.map((page) => (
        <div
          key={page.key}
          className="portal-keepalive-page"
          hidden={page.key !== activeKeepAliveKey}
          aria-hidden={page.key !== activeKeepAliveKey}
        >
          {page.element}
        </div>
      ))}
      {!activeKeepAliveKey ? route.render({ navigate, currentPath }) : null}
    </>
  );

  return (
    <RuntimeAppsProvider>
      <AuthProvider>
        <AppUsageProvider currentPath={pathname}>
          <AppLayout
            currentPath={pathname}
            lastActiveModuleCode={lastActiveKeepAliveKey}
            onNavigate={onNavigate}
            navigate={navigate}
          >
            {routeContent}
          </AppLayout>
        </AppUsageProvider>
      </AuthProvider>
    </RuntimeAppsProvider>
  );
}
