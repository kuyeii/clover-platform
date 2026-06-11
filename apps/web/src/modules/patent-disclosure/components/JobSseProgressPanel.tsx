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
  const steps = buildWorkflowSteps(currentStep, progress, status, events);

  return (
    <section className="pd-panel pd-progress-panel" aria-labelledby="pd-progress-title">
      <div className="pd-panel-header">
        <div>
          <p className="pd-eyebrow">进度</p>
          <h2 id="pd-progress-title">任务进度</h2>
        </div>
        <span className={`pd-live-dot ${connected ? "is-on" : ""}`}>{connected ? "运行中" : formatStatus(status)}</span>
      </div>

      <div className="pd-progress-summary">
        <div>
          <strong>{formatStatus(status)} {progress}%</strong>
          <span>{currentStep}</span>
        </div>
        <b>{progress}%</b>
      </div>
      <div className="pd-progress-track" aria-label="生成进度">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="pd-workflow-card">
        <ol className="pd-step-list">
          {steps.map((step) => (
            <li className={`pd-step-item is-${step.state}`} key={step.key}>
              <span className="pd-step-marker" aria-hidden="true" />
              <span>
                <strong>{step.title}</strong>
              </span>
            </li>
          ))}
        </ol>
      </div>

    </section>
  );
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

type StepState = "done" | "active" | "pending" | "failed";

const WORKFLOW_STEPS = [
  {
    key: "scan",
    title: "扫描项目",
    description: "解析技术方案与相关源代码",
    tokens: ["扫描", "项目", "文档", "材料", "解析"],
  },
  {
    key: "mine",
    title: "提取专利点",
    description: "识别和归纳技术创新特征",
    tokens: ["专利点", "挖掘", "创新", "特征", "候选"],
  },
  {
    key: "search",
    title: "联网查新与对比",
    description: "检索公开专利并整理差异",
    tokens: ["查新", "检索", "对比", "现有技术", "CNIPA", "国知局"],
  },
  {
    key: "draft",
    title: "撰写交底书",
    description: "生成结构化文档及 Mermaid 图表",
    tokens: ["撰写", "交底书", "初稿", "生成", "Mermaid", "文档"],
  },
  {
    key: "check",
    title: "生成 DOCX",
    description: "导出最终 Word 文档",
    tokens: ["自检", "校验", "优化", "一致性", "导出", "完成", "docx", "word", "export"],
  },
];

function buildWorkflowSteps(
  currentStep: string,
  progress: number,
  status: string,
  events: PatentProgressEvent[],
) {
  const haystack = [
    currentStep,
    ...events.flatMap((event) => [event.step, event.currentStep, event.message, event.error]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const matchedIndex = WORKFLOW_STEPS.findIndex((step) =>
    step.tokens.some((token) => haystack.includes(token.toLowerCase())),
  );
  const fallbackIndex = Math.min(WORKFLOW_STEPS.length - 1, Math.floor(progress / 20));
  const activeIndex = matchedIndex >= 0 ? matchedIndex : fallbackIndex;
  const isFailed = status === "failed";
  const isDone = status === "succeeded" || status === "completed" || progress >= 100;
  const hasStarted = events.length > 0 || status === "pending" || status === "running" || progress > 0;

  return WORKFLOW_STEPS.map((step, index) => {
    let state: StepState = "pending";
    if (hasStarted && (isDone || index < activeIndex)) state = "done";
    if (hasStarted && !isDone && index === activeIndex) state = isFailed ? "failed" : "active";
    if (isFailed && index < activeIndex) state = "done";
    return { ...step, state };
  });
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    idle: "待开始",
    pending: "排队中",
    running: "生成中",
    succeeded: "已完成",
    completed: "已完成",
    failed: "失败",
  };
  return labels[status] || status || "未知";
}
