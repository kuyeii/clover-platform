import { MouseEvent, ReactNode } from "react";

import { moduleEntries } from "../shared/config/modules";

type AppLayoutProps = {
  children: ReactNode;
  currentPath: string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

const primaryLinks = [
  { href: "/workspace", label: "工作台" },
  { href: "/login", label: "登录占位" },
];

export function AppLayout({ children, currentPath, onNavigate }: AppLayoutProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="统一前端导航">
        <a className="brand" href="/workspace" onClick={(event) => onNavigate(event, "/workspace")}>
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>
            <strong>Clover Platform</strong>
            <small>第 10-A 骨架</small>
          </span>
        </a>

        <nav className="nav-section" aria-label="基础页面">
          <span className="nav-title">基础页面</span>
          {primaryLinks.map((link) => (
            <a
              key={link.href}
              className="nav-link"
              href={link.href}
              aria-current={currentPath === link.href || (currentPath === "/" && link.href === "/workspace") ? "page" : undefined}
              onClick={(event) => onNavigate(event, link.href)}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <nav className="nav-section" aria-label="模块占位">
          <span className="nav-title">模块占位</span>
          {moduleEntries.map((entry) => (
            <a
              key={entry.slug}
              className="nav-link"
              href={entry.route}
              aria-current={currentPath === entry.route ? "page" : undefined}
              onClick={(event) => onNavigate(event, entry.route)}
            >
              {entry.name}
            </a>
          ))}
        </nav>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <span>统一前端入口骨架</span>
          <span>legacy Portal 仍为正式入口</span>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
