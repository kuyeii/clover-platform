import { HealthStatus } from "../types/app";

const healthToneMap: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500 text-emerald-700",
  unhealthy: "bg-rose-500 text-rose-700",
  unknown: "bg-slate-400 text-slate-600",
  checking: "bg-amber-500 text-amber-700",
};

const healthLabelMap: Record<HealthStatus, string> = {
  healthy: "健康",
  unhealthy: "异常",
  unknown: "未知",
  checking: "检查中",
};

interface HealthIndicatorProps {
  healthStatus: HealthStatus;
}

export function HealthIndicator({ healthStatus }: HealthIndicatorProps) {
  return (
    <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
      <span
        className={[
          "h-2.5 w-2.5 rounded-full",
          healthToneMap[healthStatus].split(" ")[0],
        ].join(" ")}
      />
      <span>{healthLabelMap[healthStatus]}</span>
    </div>
  );
}
