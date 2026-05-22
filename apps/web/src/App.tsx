import { MouseEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AppLayout } from "./layouts/AppLayout";
import { resolveRoute } from "./routes";

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((href: string) => {
    const nextPath = normalizePath(href);
    if (nextPath !== currentPath) {
      window.history.pushState(null, "", nextPath);
      setCurrentPath(nextPath);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentPath]);

  const onNavigate = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }, [navigate]);

  const route = useMemo(() => resolveRoute(currentPath), [currentPath]);

  return (
    <AppLayout currentPath={currentPath} onNavigate={onNavigate}>
      {route.render({ navigate })}
    </AppLayout>
  );
}
