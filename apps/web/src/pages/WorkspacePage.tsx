import { PlaceholderCard } from "../shared/components/PlaceholderCard";
import { moduleEntries } from "../shared/config/modules";
import type { NavigateFn } from "../routes";

type WorkspacePageProps = {
  navigate: NavigateFn;
};

export function WorkspacePage({ navigate }: WorkspacePageProps) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">/workspace</span>
        <h1>统一工作台占位</h1>
        <p>
          当前只建立统一前端骨架和模块入口。四个业务页面仍由 legacy iframe 前端承载，后续阶段再逐个迁入。
        </p>
      </div>

      <div className="module-grid">
        {moduleEntries.map((entry) => (
          <button
            key={entry.slug}
            type="button"
            className="module-card"
            onClick={() => navigate(entry.route)}
          >
            <span className="module-kicker">{entry.code}</span>
            <strong>{entry.name}</strong>
            <span>{entry.description}</span>
          </button>
        ))}
      </div>

      <PlaceholderCard title="本阶段不迁移业务 UI" eyebrow="迁移边界">
        <p>
          `apps/web` 当前只提供统一布局、路由和 API client 骨架。正式业务交互仍在现有 legacy 前端和 iframe 链路中。
        </p>
      </PlaceholderCard>
    </section>
  );
}
