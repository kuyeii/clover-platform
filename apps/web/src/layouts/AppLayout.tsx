import { MouseEvent, ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { AccountSettingsPanel } from "../shared/components/AccountSettingsPanel";
import { BrandMark } from "../shared/components/BrandMark";
import { Icon } from "../shared/components/Icon";
import { getModuleByRoute } from "../shared/config/modules";
import { useAppUsage } from "../shared/runtime/AppUsageProvider";

type AppLayoutProps = {
  children: ReactNode;
  currentPath: string;
  navigate: NavigateFn;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

const secondaryLinks = [
  { href: "/knowledge", label: "知识库", icon: "book" as const },
  { href: "/users", label: "用户管理", icon: "users" as const },
  { href: "/bid-reference-sites", label: "招投标网址", icon: "globe" as const },
  { href: "/feedback", label: "用户反馈", icon: "message" as const },
];

type ThemeMode = "light" | "dark";

const themeStorageKey = "clover-theme-mode";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored === "dark" ? "dark" : "light";
}

export function AppLayout({ children, currentPath, navigate, onNavigate }: AppLayoutProps) {
  const { currentUser, isAuthenticated, logout } = useAuth();
  const { leaveApp } = useAppUsage();
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const isLogin = currentPath === "/login";
  const isWorkspace = currentPath === "/" || currentPath === "/workspace";
  const activeModule = getModuleByRoute(currentPath);
  const primaryHref = activeModule?.route || "/workspace";
  const primaryLabel = activeModule?.name || "工作台";
  const showReturnWorkspace = Boolean(activeModule);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    window.localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  const handleLogout = () => {
    leaveApp()
      .catch(() => undefined)
      .finally(() => {
        logout().finally(() => navigate("/login"));
      });
  };

  const handleToggleTheme = () => {
    setThemeMode((mode) => (mode === "dark" ? "light" : "dark"));
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
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4" onClick={() => setAccountPanelOpen(false)}>
            <section
              className="relative max-h-[calc(100vh-32px)] w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-950/20 dark:border-slate-800 dark:bg-slate-950"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="用户设置"
            >
              <button
                type="button"
                className="absolute -right-3 -top-3 z-10 inline-grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-lg transition hover:bg-slate-100 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
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
    <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="z-20 shrink-0 border-b border-slate-100 bg-white/95 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex min-h-14 min-w-0 items-center gap-2 px-2 py-1 sm:min-h-16 sm:gap-4 sm:px-4 md:px-6 lg:gap-8 lg:px-8">
          <a
            className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3"
            href="/workspace"
            onClick={(event) => onNavigate(event, "/workspace")}
            aria-label="企智方工作台"
          >
            <BrandMark compact />
          </a>

          <nav className="flex min-w-0 flex-1 items-center justify-start gap-1 overflow-x-auto px-1 sm:justify-center sm:gap-2" aria-label="平台导航">
            <div
              className={[
                "relative inline-flex h-12 w-auto min-w-12 shrink-0 items-center justify-center gap-2 px-2 text-sm font-semibold transition sm:h-14 sm:w-36 sm:text-base lg:w-40 lg:text-lg",
                isWorkspace || activeModule
                  ? "text-blue-600 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-blue-600 dark:text-blue-300 dark:after:bg-blue-300"
                  : "text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white",
              ].join(" ")}
            >
              <a
                href={primaryHref}
                className={[
                  "inline-flex min-w-0 items-center justify-center gap-2",
                  showReturnWorkspace ? "pr-7" : "",
                ].join(" ")}
                onClick={(event) => onNavigate(event, primaryHref)}
              >
                <Icon name="grid" className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.7} />
                <span className="hidden max-w-28 truncate min-[420px]:inline">{primaryLabel}</span>
              </a>
              {showReturnWorkspace ? (
                <button
                  type="button"
                  className="absolute right-0 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-blue-500 hover:bg-blue-50 hover:text-blue-700 sm:right-1 dark:hover:bg-blue-500/10"
                  onClick={() => navigate("/workspace")}
                  aria-label="返回工作台"
                >
                  <Icon name="back" className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={1.7} />
                </button>
              ) : null}
            </div>
            {secondaryLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={[
                  "relative inline-flex h-12 w-auto min-w-12 shrink-0 items-center justify-center gap-2 px-2 text-sm font-semibold transition sm:h-14 sm:w-36 sm:text-base lg:w-40 lg:text-lg",
                  currentPath === link.href
                    ? "text-blue-600 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-blue-600 dark:text-blue-300 dark:after:bg-blue-300"
                    : "text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white",
                ].join(" ")}
                onClick={(event) => onNavigate(event, link.href)}
              >
                <Icon name={link.icon} className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.7} />
                <span className={currentPath === link.href ? "max-w-28 truncate min-[420px]:inline" : "hidden max-w-28 truncate sm:inline"}>
                  {link.label}
                </span>
              </a>
            ))}
          </nav>

          <div className="flex min-w-0 shrink-0 items-center justify-end gap-1 sm:gap-2">
            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 sm:h-10 sm:w-auto sm:max-w-44 sm:px-3 sm:text-base sm:font-semibold dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => setAccountPanelOpen((open) => !open)}
                  aria-expanded={accountPanelOpen}
                  aria-label="打开用户设置"
                >
                  <Icon name="user" strokeWidth={1.7} />
                  <span className="hidden truncate sm:inline">{currentUser?.name || currentUser?.account}</span>
                </button>
                <button
                  type="button"
                  className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 sm:h-10 sm:w-10 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  onClick={handleToggleTheme}
                  aria-label={themeMode === "dark" ? "切换为日间模式" : "切换为夜间模式"}
                  title={themeMode === "dark" ? "日间模式" : "夜间模式"}
                >
                  <Icon name={themeMode === "dark" ? "sun" : "moon"} strokeWidth={1.7} />
                </button>
                <button
                  type="button"
                  className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 sm:h-10 sm:w-10 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  onClick={handleLogout}
                  aria-label="退出登录"
                >
                  <Icon name="logout" strokeWidth={1.7} />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      {accountDialog}
    </div>
  );
}
