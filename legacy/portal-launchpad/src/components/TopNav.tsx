import { LayoutGroup, motion } from "framer-motion";
import { BookOpen, Globe2, LayoutGrid, LogOut, MessageSquare, Settings2, Undo2, UserRound } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAppUsage } from "../contexts/AppUsageContext";
import { useAuth } from "../contexts/AuthContext";
import { usePortalShell } from "../contexts/PortalShellContext";

function AnimatedPrimaryLabel({ label }: { label: string }) {
  return <span className="block truncate whitespace-nowrap">{label}</span>;
}

function ReturnOverviewButton({ visible }: { visible: boolean }) {
  return (
    <motion.span
      initial={false}
      animate={
        visible
          ? { opacity: 1, scale: 1 }
          : { opacity: 0, scale: 0.96 }
      }
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
    >
      <NavLink
        to="/dashboard"
        aria-label="返回工作台"
        tabIndex={visible ? 0 : -1}
        className={[
          "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
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
      </NavLink>
    </motion.span>
  );
}

export function TopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeModule, isEmbeddedModuleView } = usePortalShell();
  const { currentUser, logout } = useAuth();
  const { leaveApp } = useAppUsage();
  const primaryNavTarget = activeModule ? `/apps/${activeModule.id}` : "/dashboard";
  const primaryNavLabel = activeModule?.name ?? "工作台";
  const userDisplayName = currentUser?.name ?? "未登录";
  const tabWidthClass = "w-32 sm:w-36 md:w-40 lg:w-44";
  const isDashboardRoute = location.pathname === "/" || location.pathname === "/dashboard";
  const shouldShowPrimaryIndicator = isDashboardRoute || isEmbeddedModuleView;
  const secondaryNavItems = [
    { to: "/knowledge", label: "知识库", icon: BookOpen },
    { to: "/settings", label: "用户管理", icon: Settings2 },
    { to: "/bid-reference-sites", label: "招投标网址", icon: Globe2 },
    { to: "/feedback", label: "用户反馈", icon: MessageSquare },
  ];

  const handleLogout = () => {
    leaveApp()
      .catch(() => undefined)
      .finally(() => {
        logout().finally(() => {
          navigate("/login", { replace: true });
        });
      });
  };

  return (
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
                <NavLink
                  to={primaryNavTarget}
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
                </NavLink>
              </motion.span>
              <div className="absolute right-1 top-1/2 -translate-y-1/2 md:right-2">
                <ReturnOverviewButton visible={isEmbeddedModuleView} />
              </div>
              {shouldShowPrimaryIndicator ? (
                <motion.span
                  layoutId="portal-nav-indicator"
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-600"
                />
              ) : null}
            </motion.div>

            {secondaryNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "relative inline-flex h-9 shrink-0 items-center justify-center gap-2 px-2 text-base font-semibold transition-colors md:h-14 md:px-3 md:text-lg",
                    tabWidthClass,
                    isActive ? "text-blue-600" : "text-slate-600 hover:text-slate-900",
                  ].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className="h-5 w-5 md:h-6 md:w-6" />
                    <span className="block whitespace-nowrap">{item.label}</span>
                    {isActive ? (
                      <motion.span
                        layoutId="portal-nav-indicator"
                        className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-600"
                      />
                    ) : null}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </LayoutGroup>

        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          <div className="hidden h-6 w-px bg-slate-200 lg:block" />
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
        </div>
      </div>
    </header>
  );
}
