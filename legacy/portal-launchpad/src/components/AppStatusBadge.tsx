import { AppStatus } from "../types/app";

const statusClassMap: Record<AppStatus, string> = {
  incubating: "bg-blue-50 text-blue-700 border-blue-200",
  running: "bg-sky-50 text-sky-700 border-sky-200",
  available: "bg-emerald-50 text-emerald-700 border-emerald-200",
  maintenance: "bg-amber-50 text-amber-700 border-amber-200",
  offline: "bg-slate-100 text-slate-600 border-slate-200",
  deprecated: "bg-rose-50 text-rose-700 border-rose-200",
};

const statusLabelMap: Record<AppStatus, string> = {
  incubating: "孵化中",
  running: "运行中",
  available: "可用",
  maintenance: "维护中",
  offline: "未启动",
  deprecated: "已弃用",
};

interface AppStatusBadgeProps {
  status: AppStatus;
}

export function AppStatusBadge({ status }: AppStatusBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold",
        statusClassMap[status],
      ].join(" ")}
    >
      <span className="h-2 w-2 rounded-full bg-current opacity-90" />
      {statusLabelMap[status]}
    </span>
  );
}
