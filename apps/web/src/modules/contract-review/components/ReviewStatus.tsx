import { Icon } from "../../../shared/components/Icon";
import type { ReviewMeta } from "../types";

export function ReviewStatus(props: {
  meta: ReviewMeta | null;
  runId: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const progress = computeProgress(props.meta);
  const status = String(props.meta?.status || "").toLowerCase();
  const failed = status === "failed";
  const completed = status === "completed";

  return (
    <section className="contract-status-panel">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">Review Status</span>
          <h2>{completed ? "审查完成" : failed ? "审查失败" : props.runId ? "审查进行中" : "等待提交"}</h2>
        </div>
        <button type="button" className="ghost-button small" onClick={props.onRefresh} disabled={!props.runId || props.loading}>
          <Icon name="refresh" />
          刷新
        </button>
      </div>

      {props.runId ? (
        <div className="contract-run-card">
          <div>
            <span>run_id</span>
            <strong>{props.runId}</strong>
          </div>
          <div>
            <span>文件</span>
            <strong>{props.meta?.file_name || "处理中"}</strong>
          </div>
          <div>
            <span>状态</span>
            <strong>{statusLabel(props.meta?.status)}</strong>
          </div>
        </div>
      ) : (
        <div className="contract-empty-state">上传合同并选择审查视角后，系统会创建审查任务。</div>
      )}

      {props.runId ? (
        <div className={`contract-progress ${failed ? "failed" : ""}`}>
          <div className="contract-progress-track">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="contract-progress-copy">
            <strong>{progress.percent}%</strong>
            <span>{failed ? props.meta?.error || props.meta?.error_detail || "审查失败，请查看后端日志。" : progress.label}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function computeProgress(meta: ReviewMeta | null) {
  if (!meta) {
    return { percent: 0, label: "等待上传" };
  }
  const status = String(meta.status || "").toLowerCase();
  if (status === "completed") {
    return { percent: 100, label: meta.warning ? `完成：${meta.warning}` : "结果已生成" };
  }
  if (status === "failed") {
    return { percent: 100, label: meta.error || "审查失败" };
  }
  if (typeof meta.progress === "number" && Number.isFinite(meta.progress)) {
    return {
      percent: Math.max(1, Math.min(99, Math.round(meta.progress))),
      label: meta.step || "处理中",
    };
  }
  if (status === "queued") {
    return { percent: 12, label: meta.step || "排队中" };
  }
  return { percent: 48, label: meta.step || "处理中" };
}

function statusLabel(status?: string) {
  if (status === "completed") {
    return "已完成";
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
  return status || "未开始";
}
