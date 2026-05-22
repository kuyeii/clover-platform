import { PlaceholderCard } from "../../shared/components/PlaceholderCard";
import { getModuleEntry } from "../../shared/config/modules";

const moduleEntry = getModuleEntry("rag");

export function RagPage() {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">{moduleEntry.route}</span>
        <h1>{moduleEntry.name}</h1>
        <p>{moduleEntry.description}</p>
      </div>

      <PlaceholderCard title="迁移状态" eyebrow={moduleEntry.code}>
        <ul className="clean-list">
          <li>当前真实前端仍在 legacy iframe 中。</li>
          <li>当前 apps/api 后端已完成主要业务 API direct 迁移收口。</li>
          <li>后续第 10-D 将迁入当前统一前端。</li>
          <li>本阶段不实现 RAG 聊天、知识库或上传 UI。</li>
        </ul>
      </PlaceholderCard>
    </section>
  );
}
