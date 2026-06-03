import type { PatentCase } from "../types";

type Props = {
  cases: PatentCase[];
  activeCaseId?: string;
  isLoading: boolean;
  onSelect: (caseId: string) => void;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  ready: "材料就绪",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  archived: "已归档",
};

export function CaseList({ cases, activeCaseId, isLoading, onSelect }: Props) {
  return (
    <section className="pd-panel pd-case-list" aria-labelledby="pd-case-list-title">
      <div className="pd-panel-header">
        <div>
          <p className="pd-eyebrow">案件队列</p>
          <h2 id="pd-case-list-title">最近案件</h2>
        </div>
        <span className="pd-count">{cases.length}</span>
      </div>
      {isLoading ? (
        <div className="pd-empty">正在加载案件列表</div>
      ) : cases.length === 0 ? (
        <div className="pd-empty">暂无案件，先创建一个工作单。</div>
      ) : (
        <div className="pd-list" role="list">
          {cases.map((item) => (
            <button
              className={`pd-case-row ${item.id === activeCaseId ? "is-active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
            >
              <span className="pd-case-row-main">
                <strong>{item.title}</strong>
                <small>{item.technicalField || item.technicalTopic || "未填写技术领域"}</small>
              </span>
              <span className={`pd-status pd-status-${normalizeStatus(item.status)}`}>
                {STATUS_LABELS[item.status] || item.status || "未知"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function normalizeStatus(status: string) {
  return String(status || "draft").replace(/[^a-z0-9_-]/gi, "_");
}
