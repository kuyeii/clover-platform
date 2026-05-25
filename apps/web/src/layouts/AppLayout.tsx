import { MouseEvent, ReactNode } from "react";

import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { Icon } from "../shared/components/Icon";
import { moduleEntries } from "../shared/config/modules";
import { useAppUsage } from "../shared/runtime/AppUsageProvider";

type AppLayoutProps = {
  children: ReactNode;
  currentPath: string;
  navigate: NavigateFn;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

const secondaryLinks = [
  { href: "/users", label: "用户管理", icon: "users" as const },
  { href: "/feedback", label: "用户反馈", icon: "message" as const },
];

export function AppLayout({ children, currentPath, navigate, onNavigate }: AppLayoutProps) {
  const { currentUser, isAuthenticated, logout } = useAuth();
  const { leaveApp, connectionState } = useAppUsage();
  const isLogin = currentPath === "/login";
  const isNativeModule = (code: string) =>
    code === "competitor-analysis" || code === "rag-web-search" || code === "contract-review" || code === "bid-generator";

  const handleLogout = () => {
    leaveApp()
      .catch(() => undefined)
      .finally(() => {
        logout().finally(() => navigate("/login"));
      });
  };

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <a className="portal-brand" href="/workspace" onClick={(event) => onNavigate(event, "/workspace")}>
          <span className="portal-brand-mark">C</span>
          <span>
            <strong>Clover Platform</strong>
            <small>第 10-E 统一前端入口</small>
          </span>
        </a>

        <nav className="portal-nav" aria-label="平台导航">
          <a
            href="/workspace"
            className={currentPath === "/" || currentPath === "/workspace" ? "portal-nav-link active" : "portal-nav-link"}
            onClick={(event) => onNavigate(event, "/workspace")}
          >
            <Icon name="grid" />
            工作台
          </a>
          {secondaryLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={currentPath === link.href ? "portal-nav-link active" : "portal-nav-link"}
              onClick={(event) => onNavigate(event, link.href)}
            >
              <Icon name={link.icon} />
              {link.label}
            </a>
          ))}
        </nav>

        <div className="portal-account">
          <span className={`ws-state ws-state--${connectionState}`}>{connectionState === "connected" ? "占用状态在线" : "占用状态同步中"}</span>
          {isAuthenticated ? (
            <>
              <span className="account-pill">
                <Icon name="user" />
                {currentUser?.name || currentUser?.account}
              </span>
              <button type="button" className="icon-button" onClick={handleLogout} aria-label="退出登录">
                <Icon name="logout" />
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="portal-body">
        <aside className="portal-sidebar" aria-label="模块导航">
          <span className="nav-title">业务模块</span>
          {moduleEntries.map((entry) => (
            <a
              key={entry.code}
              href={entry.route}
              className={currentPath === entry.route ? "sidebar-link active" : "sidebar-link"}
              onClick={(event) => onNavigate(event, entry.route)}
            >
              <span className="sidebar-link-icon">
                <Icon name={entry.code === "competitor-analysis" ? "chart" : entry.code === "rag-web-search" ? "message" : entry.code === "contract-review" ? "shield" : "file"} />
              </span>
              <span>
                <strong>{entry.name}</strong>
                <small>{isNativeModule(entry.code) ? "原生页面" : "iframe"}</small>
              </span>
            </a>
          ))}
        </aside>

        <main className="portal-main">{children}</main>
      </div>
    </div>
  );
}
