import { useState } from "react";

import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { Icon } from "../shared/components/Icon";
import { useAppUsage } from "../shared/runtime/AppUsageProvider";
import { useRuntimeApps } from "../shared/runtime/RuntimeAppsProvider";
import type { ModuleCode, PortalModule } from "../shared/types/portal";

function ModuleIcon({ code }: { code: ModuleCode }) {
  if (code === "competitor-analysis") {
    return <Icon name="chart" />;
  }
  if (code === "rag-web-search") {
    return <Icon name="message" />;
  }
  if (code === "contract-review") {
    return <Icon name="shield" />;
  }
  return <Icon name="file" />;
}

function UsageBadge({ appId }: { appId: ModuleCode }) {
  const { getAppUsage } = useAppUsage();
  const usage = getAppUsage(appId);
  if (!usage.inUse) {
    return null;
  }
  const label = usage.inUseByOthers
    ? usage.otherUserNames.length > 1
      ? `${usage.otherUserNames.length} 人使用中`
      : `${usage.otherUserNames[0] || "其他用户"} 使用中`
    : "我正在使用";
  return <span className={usage.inUseByOthers ? "usage-badge warning" : "usage-badge"}>{label}</span>;
}

function ModuleCard({ module, navigate }: { module: PortalModule; navigate: NavigateFn }) {
  const { canAccessApp } = useAuth();
  const { enterApp, getAppUsage } = useAppUsage();
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const usage = getAppUsage(module.code);
  const allowed = canAccessApp(module.code);
  const isNative =
    module.code === "competitor-analysis" || module.code === "rag-web-search" || module.code === "contract-review";

  const go = async (confirmedConflict = false) => {
    if (!allowed) {
      return;
    }
    try {
      await enterApp(module.code, { confirmedConflict });
      navigate(module.route);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "进入应用失败。");
    }
  };

  const handleEnter = () => {
    setLocalError("");
    if (usage.inUseByOthers) {
      setConfirming(true);
      return;
    }
    void go(false);
  };

  return (
    <article className={allowed ? "workspace-card" : "workspace-card disabled"}>
      <div className="workspace-card-head">
        <span className="module-icon">
          <ModuleIcon code={module.code} />
        </span>
        <UsageBadge appId={module.code} />
      </div>
      <div className="workspace-card-copy">
        <span className="eyebrow">{isNative ? "Native page" : "Iframe bridge"}</span>
        <h2>{module.name}</h2>
        <p>{module.description}</p>
      </div>
      {localError ? <p className="form-error">{localError}</p> : null}
      <button type="button" className="secondary-button" disabled={!allowed} onClick={handleEnter}>
        {allowed ? (isNative ? "打开原生页面" : "进入 iframe") : "暂无权限"}
        <Icon name={allowed ? "arrow" : "lock"} />
      </button>

      {confirming ? (
        <div className="modal-backdrop">
          <section className="dialog" role="dialog" aria-modal="true">
            <button className="icon-button dialog-close" type="button" onClick={() => setConfirming(false)}>
              <Icon name="close" />
            </button>
            <span className="dialog-icon warning">
              <Icon name="users" />
            </span>
            <h3>应用正在被使用</h3>
            <p>{usage.otherUserNames.join("、") || "其他用户"} 当前正在使用 {module.name}，确认后会同时进入，不会中断对方会话。</p>
            <div className="dialog-actions">
              <button type="button" className="ghost-button" onClick={() => setConfirming(false)}>取消</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setConfirming(false);
                  void go(true);
                }}
              >
                确认进入
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}

export function WorkspacePage({ navigate }: { navigate: NavigateFn }) {
  const { currentUser } = useAuth();
  const { modules, error, refreshRuntimeApps } = useRuntimeApps();
  const { summaries, refreshUsage } = useAppUsage();
  const accessibleCount = modules.filter((module) =>
    currentUser?.role === "admin" || currentUser?.appPermissions.includes(module.code),
  ).length;

  return (
    <section className="page-stack">
      <header className="page-hero compact">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>统一工作台</h1>
          <p>Portal 平台能力已迁入 apps/web。竞对分析、RAG 和合同审查是原生页面，标书生成仍通过可信 iframe 接入。</p>
        </div>
        <div className="hero-metrics">
          <div>
            <span>可访问模块</span>
            <strong>{accessibleCount}/{modules.length}</strong>
          </div>
          <div>
            <span>占用模块</span>
            <strong>{summaries.filter((item) => item.inUse).length}</strong>
          </div>
        </div>
      </header>

      {error ? (
        <div className="notice warning">
          <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => void refreshRuntimeApps()}>
            重试
          </button>
        </div>
      ) : null}

      <div className="workspace-grid">
        {modules.map((module) => (
          <ModuleCard key={module.code} module={module} navigate={navigate} />
        ))}
      </div>

      <section className="ops-strip">
        <button type="button" className="ghost-button" onClick={() => void refreshUsage()}>
          <Icon name="refresh" />
          刷新占用状态
        </button>
        <button type="button" className="ghost-button" onClick={() => navigate("/users")}>
          <Icon name="users" />
          用户管理
        </button>
        <button type="button" className="ghost-button" onClick={() => navigate("/feedback")}>
          <Icon name="message" />
          用户反馈
        </button>
      </section>
    </section>
  );
}
