import { Icon } from "../../../shared/components/Icon";
import type { ReviewHistoryItem } from "../types";

export function ReviewHistory(props: {
  items: ReviewHistoryItem[];
  loading: boolean;
  activeRunId: string | null;
  onOpen: (item: ReviewHistoryItem) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="contract-history-panel">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">History</span>
          <h2>审查记录</h2>
        </div>
        <button type="button" className="icon-button small" aria-label="刷新历史" onClick={props.onRefresh}>
          <Icon name="refresh" />
        </button>
      </div>
      <div className="contract-history-list">
        {props.loading ? (
          <div className="page-center-state small">
            <div className="loading-spinner" aria-hidden />
            <span>加载记录...</span>
          </div>
        ) : null}
        {!props.loading && props.items.length === 0 ? (
          <div className="contract-empty-state">暂无审查记录。</div>
        ) : null}
        {props.items.map((item) => (
          <button
            key={item.run_id}
            type="button"
            className={props.activeRunId === item.run_id ? "contract-history-row active" : "contract-history-row"}
            onClick={() => props.onOpen(item)}
          >
            <span className="contract-history-file" title={item.file_name || item.run_id}>
              <Icon name="file" />
              <strong>{item.file_name || item.run_id}</strong>
            </span>
            <span>{formatReviewTime(item.updated_at)}</span>
            <span className={`contract-status-pill ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function statusClass(status?: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "running" || normalized === "queued") {
    return "running";
  }
  return "pending";
}

function statusLabel(status?: string) {
  if (status === "completed") {
    return "完成";
  }
  if (status === "running") {
    return "审查中";
  }
  if (status === "queued") {
    return "排队中";
  }
  if (status === "failed") {
    return "失败";
  }
  return status || "未知";
}

function formatReviewTime(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
