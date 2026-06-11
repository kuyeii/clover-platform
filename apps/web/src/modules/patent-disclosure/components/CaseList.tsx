import type { PatentCase } from "../types";

type Props = {
  cases: PatentCase[];
  activeCaseId?: string;
  isLoading: boolean;
  onCreateNew: () => void;
  onSelect: (caseId: string) => void;
};

export function CaseList({ cases, activeCaseId, isLoading, onCreateNew, onSelect }: Props) {
  const historyCount = cases.length;

  return (
    <section className="pd-case-list" aria-labelledby="pd-case-list-title">
      <button type="button" className="pd-sidebar-new-button" onClick={onCreateNew}>
        <span className="pd-sidebar-plus" aria-hidden />
        <span>新建案件</span>
      </button>

      <div className="pd-sidebar-history-box">
        <div className="pd-sidebar-history-title">
          <h2 id="pd-case-list-title">历史记录</h2>
          <span>{historyCount}</span>
        </div>

      {isLoading ? (
        <div className="pd-sidebar-loading">
          <div className="loading-spinner" aria-hidden />
          <span>加载记录...</span>
        </div>
      ) : cases.length === 0 ? (
        <div className="pd-sidebar-empty">
          <span className="pd-sidebar-empty-icon" aria-hidden />
          <strong>暂无案件</strong>
          <small>点击“新建案件”开始</small>
        </div>
      ) : (
        <div className="pd-sidebar-history-list" role="list">
          {cases.map((item) => (
            <button
              className={`pd-sidebar-history-entry ${item.id === activeCaseId ? "is-active" : ""} ${isRunningStatus(item.status) ? "is-running" : ""}`}
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
            >
              <strong title={item.title}>{item.title}</strong>
              <span>{formatCaseTime(item.updatedAt || item.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}

function isRunningStatus(status?: string) {
  return status === "running" || status === "pending";
}

function formatCaseTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}
