import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { EmbeddedAppViewport } from "../components/EmbeddedAppViewport";
import { TopNav } from "../components/TopNav";
import { usePortalShell } from "../contexts/PortalShellContext";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const { activeModule, hasPinnedModule, isEmbeddedModuleView } = usePortalShell();
  const showRouteContent = !isEmbeddedModuleView || !activeModule;
  const shouldOverlayRouteContent =
    hasPinnedModule &&
    (location.pathname === "/knowledge" ||
      location.pathname === "/settings" ||
      location.pathname === "/bid-reference-sites" ||
      location.pathname === "/feedback");

  return (
    <div className="flex h-full min-h-screen flex-col bg-gradient-to-b from-white via-slate-50 to-sky-50 text-slate-900">
      <TopNav />
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeModule ? (
          <EmbeddedAppViewport app={activeModule} isVisible={isEmbeddedModuleView} />
        ) : null}
        {showRouteContent ? (
          <div
            className={[
              "relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden",
              shouldOverlayRouteContent ? "z-10" : "",
            ].join(" ")}
          >
            {children}
          </div>
        ) : null}
      </main>
    </div>
  );
}
