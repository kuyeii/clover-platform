import { MouseEvent, ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutGroup, motion } from "framer-motion";
import {
  BookOpen,
  ChevronLeft,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Settings2,
  UserRound,
} from "lucide-react";

import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { AccountSettingsPanel } from "../shared/components/AccountSettingsPanel";
import { BrandMark } from "../shared/components/BrandMark";
import { Icon } from "../shared/components/Icon";
import { moduleEntries } from "../shared/config/modules";
import { useAppUsage } from "../shared/runtime/AppUsageProvider";
import type { PortalModule } from "../shared/types/portal";

type AppLayoutProps = {
  children: ReactNode;
  currentPath: string;
  lastActiveModuleCode?: PortalModule["code"] | string | null;
  navigate: NavigateFn;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

const legacyAppRoutes: Record<PortalModule["code"], string> = {
  "bid-generator": "/apps/bid-generator",
  "contract-review": "/apps/contract-review",
  "competitor-analysis": "/apps/competitor-analysis",
  "patent-disclosure": "/apps/patent-disclosure",
  "rag-web-search": "/apps/rag-web-search",
};

const modulePathAliases: Record<PortalModule["code"], string[]> = {
  "bid-generator": ["/apps/bid-generator", "/modules/bid-generator"],
  "contract-review": ["/apps/contract-review", "/modules/contract-review"],
  "competitor-analysis": ["/apps/competitor-analysis", "/modules/competitor-analysis"],
  "patent-disclosure": ["/apps/patent-disclosure", "/modules/patent-disclosure"],
  "rag-web-search": ["/apps/rag-web-search", "/apps/rag", "/modules/rag"],
};

const secondaryNavItems = [
  { to: "/knowledge", label: "知识库", icon: BookOpen, aliases: ["/knowledge"] },
  { to: "/settings", label: "用户管理", icon: Settings2, aliases: ["/settings", "/users", "/admin/users"] },
  { to: "/feedback", label: "用户反馈", icon: MessageSquare, aliases: ["/feedback"] },
];

const workspaceFeatureRoutes = [
  { path: "/bid-reference-sites", label: "招投标网址" },
] as const;

function getActiveModule(currentPath: string): PortalModule | undefined {
  return moduleEntries.find((entry) => modulePathAliases[entry.code].includes(currentPath));
}

function getActiveWorkspaceFeature(currentPath: string) {
  return workspaceFeatureRoutes.find((item) => item.path === currentPath);
}

function ResponsiveNavLabel({
  label,
  active,
  className = "",
}: {
  label: string;
  active: boolean;
  className?: string;
}) {
  return (
    <span className={["min-w-0 truncate whitespace-nowrap", active ? "block" : "hidden xl:block", className].join(" ")}>
      {label}
    </span>
  );
}

function ReturnOverviewButton({
  visible,
  navigate,
}: {
  visible: boolean;
  navigate: NavigateFn;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!visible) {
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate("/workspace");
  };

  return (
    <motion.span
      initial={false}
      animate={visible ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
    >
      <a
        href="/workspace"
        aria-label="返回工作台"
        tabIndex={visible ? 0 : -1}
        onClick={handleClick}
        className={[
          "relative z-10 inline-flex h-7 w-7 items-center justify-center text-center leading-none",
          visible
            ? "pointer-events-auto text-brand-500"
            : "pointer-events-none text-slate-300",
        ].join(" ")}
      >
        <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </a>
    </motion.span>
  );
}

export function AppLayout({ children, currentPath, lastActiveModuleCode, navigate, onNavigate }: AppLayoutProps) {
  const { currentUser, isAuthenticated, logout } = useAuth();
  const { leaveApp } = useAppUsage();
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const isLogin = currentPath === "/login";
  const activeModule = getActiveModule(currentPath);
  const lastActiveModule = !activeModule && lastActiveModuleCode
    ? moduleEntries.find((entry) => entry.code === lastActiveModuleCode)
    : undefined;
  const activeWorkspaceFeature = getActiveWorkspaceFeature(currentPath);
  const isWorkspaceFeatureView = Boolean(activeModule || activeWorkspaceFeature);
  const primaryModule = activeModule || lastActiveModule;
  const primaryNavTarget = primaryModule
    ? legacyAppRoutes[primaryModule.code]
    : activeWorkspaceFeature
      ? activeWorkspaceFeature.path
      : "/workspace";
  const primaryNavLabel = primaryModule?.name ?? activeWorkspaceFeature?.label ?? "工作台";
  const userDisplayName = currentUser?.name ?? currentUser?.account ?? "未登录";
  const navItemWidthClass = "w-11 sm:w-12 md:w-14 xl:w-36 2xl:w-40";
  const activeNavItemWidthClass = "w-28 sm:w-32 md:w-36 xl:w-36 2xl:w-40";
  const isDashboardRoute = currentPath === "/" || currentPath === "/workspace" || currentPath === "/dashboard";
  const shouldShowPrimaryIndicator = isDashboardRoute || isWorkspaceFeatureView;

  const handleLogout = () => {
    leaveApp()
      .catch(() => undefined)
      .finally(() => {
        logout().finally(() => {
          navigate("/login");
        });
      });
  };

  useEffect(() => {
    setAccountPanelOpen(false);
  }, [currentPath]);

  if (isLogin) {
    return <>{children}</>;
  }

  const accountDialog =
    accountPanelOpen && currentUser
      ? createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4"
            onClick={() => setAccountPanelOpen(false)}
          >
            <section
              className="relative max-h-[calc(100vh-32px)] w-full max-w-md rounded-xl border border-border bg-white p-5 shadow-panel"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="用户设置"
            >
              <button
                type="button"
                className="absolute -right-3 -top-3 z-10 inline-grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-white text-muted shadow-panel transition hover:bg-mist hover:text-ink"
                onClick={() => setAccountPanelOpen(false)}
                aria-label="关闭用户设置"
              >
                <Icon name="close" strokeWidth={1.7} />
              </button>
              <div className="max-h-[calc(100vh-72px)] overflow-y-auto">
                <AccountSettingsPanel currentUser={currentUser} />
              </div>
            </section>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="legacy-portal-ui flex h-full min-h-screen flex-col bg-mist text-ink">
      <header className="sticky top-0 z-20 w-full border-b border-border bg-white/95 shadow-panel backdrop-blur-sm">
        <div className="flex min-h-14 w-full items-center gap-2 px-3 py-1 sm:gap-3 sm:px-4 md:px-5 md:py-0 lg:gap-5 lg:px-6 2xl:gap-8 2xl:px-8">
          <a
            className="flex min-w-0 shrink-0 items-center"
            href="/workspace"
            onClick={(event) => onNavigate(event, "/workspace")}
            aria-label="企智方工作台"
          >
            <BrandMark compact />
          </a>

          <LayoutGroup>
            <nav className="flex min-w-0 flex-1 items-center justify-center overflow-x-auto">
              <motion.div
                className={[
                  "relative inline-flex h-9 shrink-0 items-center justify-center px-1 text-sm font-semibold transition-[width] md:h-14 md:text-base xl:px-3 xl:text-lg",
                  shouldShowPrimaryIndicator ? activeNavItemWidthClass : navItemWidthClass,
                ].join(" ")}
              >
                <motion.span
                  initial={false}
                  animate={isWorkspaceFeatureView ? { x: -14 } : { x: 0 }}
                  transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                  className="inline-flex min-w-0 items-center justify-center"
                >
                  <a
                    href={primaryNavTarget}
                    onClick={(event) => onNavigate(event, primaryNavTarget)}
                    className={[
                      "inline-flex min-w-0 items-center justify-center gap-3 transition-colors",
                      shouldShowPrimaryIndicator
                        ? "text-brand-500"
                        : primaryModule
                          ? "text-slate-700 hover:text-slate-900"
                          : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    <LayoutGrid className="h-5 w-5 shrink-0 md:h-6 md:w-6" />
                    <ResponsiveNavLabel label={primaryNavLabel} active={shouldShowPrimaryIndicator} />
                  </a>
                </motion.span>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 md:right-1">
                  <ReturnOverviewButton visible={isWorkspaceFeatureView} navigate={navigate} />
                </div>
                {shouldShowPrimaryIndicator ? (
                  <motion.span
                    layoutId="portal-nav-indicator"
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-500"
                  />
                ) : null}
              </motion.div>

              {secondaryNavItems.map((item) => {
                const isActive = item.aliases.includes(currentPath);
                return (
                  <a
                    key={item.to}
                    href={item.to}
                    onClick={(event) => onNavigate(event, item.to)}
                    className={[
                      "relative inline-flex h-9 shrink-0 items-center justify-center gap-2 px-1 text-sm font-semibold transition-[width,color] md:h-14 md:text-base xl:px-3 xl:text-lg",
                      isActive ? activeNavItemWidthClass : navItemWidthClass,
                      isActive ? "text-brand-500" : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    <item.icon className="h-5 w-5 md:h-6 md:w-6" />
                    <ResponsiveNavLabel label={item.label} active={isActive} />
                    {isActive ? (
                      <motion.span
                        layoutId="portal-nav-indicator"
                        className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-500"
                      />
                    ) : null}
                  </a>
                );
              })}
            </nav>
          </LayoutGroup>

          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <div className="hidden h-6 w-px bg-slate-200 lg:block" />
            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  onClick={() => setAccountPanelOpen((open) => !open)}
                  className="inline-flex max-w-48 items-center gap-2 rounded-full border border-border bg-white px-2 py-1 shadow-none transition-colors hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                  title={`当前用户：${userDisplayName}`}
                  aria-label="打开用户设置"
                  aria-expanded={accountPanelOpen}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white"
                    aria-hidden="true"
                  >
                    <UserRound className="h-4 w-4" />
                  </span>
                  <span className="hidden min-w-0 truncate pr-1 text-sm font-semibold text-slate-800 sm:block">
                    {userDisplayName}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-mist hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                  aria-label="退出登录"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </main>
      {accountDialog}
    </div>
  );
}
