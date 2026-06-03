import type { PatentGenerationJob, PatentProgressEvent } from "../types";

type Props = {
  job: PatentGenerationJob | null;
  events: PatentProgressEvent[];
  connected: boolean;
};

export function JobSseProgressPanel({ job, events, connected }: Props) {
  const latest = events[events.length - 1];
  const progress = clampProgress(latest?.progress ?? job?.progress ?? 0);
  const status = latest?.status || job?.status || "idle";
  const currentStep = latest?.currentStep || latest?.step || job?.currentStep || "等待任务";

  return (
    <section className="pd-panel" aria-labelledby="pd-progress-title">
      <div className="pd-panel-header">
        <div>
          <p className="pd-eyebrow">SSE 进度</p>
          <h2 id="pd-progress-title">生成任务</h2>
        </div>
        <span className={`pd-live-dot ${connected ? "is-on" : ""}`}>{connected ? "已连接" : "未连接"}</span>
      </div>
      <div className="pd-progress-head">
        <strong>{currentStep}</strong>
        <span>{progress}%</span>
      </div>
      <div className="pd-progress-track" aria-label="生成进度">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="pd-job-meta">
        <span>状态：{status}</span>
        <span>任务：{job?.id || "暂无"}</span>
      </div>
      <div className="pd-event-log">
        {events.length === 0 ? (
          <div className="pd-empty">任务事件会通过 EventSource 实时进入这里。</div>
        ) : (
          events.slice(-6).map((event, index) => (
            <div className="pd-event-row" key={`${index}-${event.message || event.step || event.status}`}>
              <strong>{event.currentStep || event.step || event.status || event.type || "事件"}</strong>
              <span>{event.message || event.error || "已更新"}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
