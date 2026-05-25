import { MouseEvent, ReactNode } from "react";
import { LayoutGroup, motion } from "framer-motion";
import {
  BookOpen,
  Globe2,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Settings2,
  Undo2,
  UserRound,
} from "lucide-react";

import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { moduleEntries } from "../shared/config/modules";
import { useAppUsage } from "../shared/runtime/AppUsageProvider";
import type { PortalModule } from "../shared/types/portal";

type AppLayoutProps = {
  children: ReactNode;
  currentPath: string;
  navigate: NavigateFn;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

const legacyAppRoutes: Record<PortalModule["code"], string> = {
  "bid-generator": "/apps/bid-generator",
  "contract-review": "/apps/contract-review",
  "competitor-analysis": "/apps/competitor-analysis",
  "rag-web-search": "/apps/rag-web-search",
};

const modulePathAliases: Record<PortalModule["code"], string[]> = {
  "bid-generator": ["/apps/bid-generator", "/modules/bid-generator"],
  "contract-review": ["/apps/contract-review", "/modules/contract-review"],
  "competitor-analysis": ["/apps/competitor-analysis", "/modules/competitor-analysis"],
  "rag-web-search": ["/apps/rag-web-search", "/apps/rag", "/modules/rag"],
};

const secondaryNavItems = [
  { to: "/knowledge", label: "知识库", icon: BookOpen, aliases: ["/knowledge"] },
  { to: "/settings", label: "用户管理", icon: Settings2, aliases: ["/settings", "/users", "/admin/users"] },
  { to: "/bid-reference-sites", label: "招投标网址", icon: Globe2, aliases: ["/bid-reference-sites"] },
  { to: "/feedback", label: "用户反馈", icon: MessageSquare, aliases: ["/feedback"] },
];

function getActiveModule(currentPath: string): PortalModule | undefined {
  return moduleEntries.find((entry) => modulePathAliases[entry.code].includes(currentPath));
}

function AnimatedPrimaryLabel({ label }: { label: string }) {
  return <span className="block truncate whitespace-nowrap">{label}</span>;
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
          "relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
          visible
            ? "pointer-events-auto text-blue-500 hover:text-blue-600"
            : "pointer-events-none text-slate-300",
        ].join(" ")}
      >
        <motion.span
          initial={false}
          whileHover={{ x: -1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="inline-flex"
        >
          <Undo2 className="h-4 w-4 md:h-5 md:w-5" />
        </motion.span>
      </a>
    </motion.span>
  );
}

export function AppLayout({ children, currentPath, navigate, onNavigate }: AppLayoutProps) {
  const { currentUser, isAuthenticated, logout } = useAuth();
  const { leaveApp } = useAppUsage();
  const isLogin = currentPath === "/login";
  const activeModule = getActiveModule(currentPath);
  const isEmbeddedModuleView = Boolean(activeModule);
  const primaryNavTarget = activeModule ? legacyAppRoutes[activeModule.code] : "/workspace";
  const primaryNavLabel = activeModule?.name ?? "工作台";
  const userDisplayName = currentUser?.name ?? currentUser?.account ?? "未登录";
  const tabWidthClass = "w-32 sm:w-36 md:w-40 lg:w-44";
  const isDashboardRoute = currentPath === "/" || currentPath === "/workspace" || currentPath === "/dashboard";
  const shouldShowPrimaryIndicator = isDashboardRoute || isEmbeddedModuleView;

  const handleLogout = () => {
    leaveApp()
      .catch(() => undefined)
      .finally(() => {
        logout().finally(() => {
          navigate("/login");
        });
      });
  };

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="legacy-portal-ui flex h-full min-h-screen flex-col bg-gradient-to-b from-white via-slate-50 to-sky-50 text-slate-900">
      <header className="sticky top-0 z-20 w-full border-b border-slate-100 bg-white/95 shadow-sm backdrop-blur-sm">
        <div className="flex min-h-14 w-full items-center gap-6 px-4 py-1 sm:gap-8 md:gap-10 md:px-6 md:py-0 lg:gap-12 lg:px-8">
          <LayoutGroup>
            <nav className="flex min-w-0 flex-1 items-center justify-center overflow-x-auto">
              <motion.div
                className={[
                  "relative inline-flex h-9 shrink-0 items-center justify-center px-2 text-base font-semibold md:h-14 md:px-3 md:text-lg",
                  tabWidthClass,
                ].join(" ")}
              >
                <motion.span
                  initial={false}
                  animate={isEmbeddedModuleView ? { x: -2 } : { x: 0 }}
                  transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                  className="inline-flex min-w-0 items-center justify-center"
                >
                  <a
                    href={primaryNavTarget}
                    onClick={(event) => onNavigate(event, primaryNavTarget)}
                    className={[
                      "inline-flex min-w-0 items-center gap-2 transition-colors",
                      shouldShowPrimaryIndicator
                        ? "text-blue-600"
                        : activeModule
                          ? "text-slate-700 hover:text-slate-900"
                          : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    <LayoutGrid className="h-5 w-5 shrink-0 md:h-6 md:w-6" />
                    <AnimatedPrimaryLabel label={primaryNavLabel} />
                  </a>
                </motion.span>
                <div className="absolute right-1 top-1/2 -translate-y-1/2 md:right-2">
                  <ReturnOverviewButton visible={isEmbeddedModuleView} navigate={navigate} />
                </div>
                {shouldShowPrimaryIndicator ? (
                  <motion.span
                    layoutId="portal-nav-indicator"
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-600"
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
                      "relative inline-flex h-9 shrink-0 items-center justify-center gap-2 px-2 text-base font-semibold transition-colors md:h-14 md:px-3 md:text-lg",
                      tabWidthClass,
                      isActive ? "text-blue-600" : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    <item.icon className="h-5 w-5 md:h-6 md:w-6" />
                    <span className="block whitespace-nowrap">{item.label}</span>
                    {isActive ? (
                      <motion.span
                        layoutId="portal-nav-indicator"
                        className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-600"
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
                <div
                  className="inline-flex max-w-48 items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm"
                  title={`当前用户：${userDisplayName}`}
                  aria-label={`当前用户：${userDisplayName}`}
                >
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white"
                    aria-hidden="true"
                  >
                    <UserRound className="h-4 w-4" />
                  </div>
                  <span className="hidden min-w-0 truncate pr-1 text-sm font-semibold text-slate-800 sm:block">
                    {userDisplayName}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">{children}</div>
      </main>
    </div>
  );
}
