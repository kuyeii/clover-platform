import { PlaceholderCard } from "../../shared/components/PlaceholderCard";
import { getModuleEntry } from "../../shared/config/modules";

const moduleEntry = getModuleEntry("contract-review");

export function ContractReviewPage() {
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
          <li>后续第 10-E 将迁入当前统一前端。</li>
          <li>本阶段不实现合同上传、风险审查或 DOCX 批注 UI。</li>
        </ul>
      </PlaceholderCard>
    </section>
  );
}
