import type { PatentCase, PatentMaterial } from "../types";

type Props = {
  activeCase?: PatentCase | null;
  materials: PatentMaterial[];
};

export function CaseDetailPanel({ activeCase, materials }: Props) {
  if (!activeCase) {
    return (
      <section className="pd-panel pd-detail-panel">
        <div className="pd-empty pd-empty-large">选择或创建案件后，材料、生成进度和交付物会在这里汇总。</div>
      </section>
    );
  }

  return (
    <section className="pd-panel pd-detail-panel" aria-labelledby="pd-detail-title">
      <div className="pd-panel-header">
        <div>
          <p className="pd-eyebrow">案件概览</p>
          <h2 id="pd-detail-title">{activeCase.title}</h2>
        </div>
        <span className="pd-status">{activeCase.status || "draft"}</span>
      </div>
      <div className="pd-detail-grid">
        <DetailItem label="技术领域" value={activeCase.technicalField || activeCase.technicalTopic || "未填写"} />
        <DetailItem label="专利类型" value={formatPatentType(activeCase.inventionType)} />
        <DetailItem label="申请主体" value={activeCase.owner || activeCase.applicant || "未填写"} />
        <DetailItem label="发明人" value={activeCase.inventor || "未填写"} />
        <DetailItem label="材料数量" value={`${materials.length || activeCase.materialCount || 0} 份`} />
        <DetailItem label="更新时间" value={formatDate(activeCase.updatedAt)} />
      </div>
      {activeCase.summary || activeCase.description ? <p className="pd-summary">{activeCase.summary || activeCase.description}</p> : null}
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="pd-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatPatentType(value?: string) {
  if (value === "utility_model") return "实用新型";
  if (value === "design") return "外观设计";
  return "发明";
}

function formatDate(value?: string) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
