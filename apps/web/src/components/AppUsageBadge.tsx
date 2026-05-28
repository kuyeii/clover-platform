import { UsersRound } from "lucide-react";
import type { AppUsageSummary } from "../shared/types/portal";

interface AppUsageBadgeProps {
  usage: AppUsageSummary;
}

export function AppUsageBadge({ usage }: AppUsageBadgeProps) {
  if (!usage.inUse) {
    return null;
  }

  const names = usage.inUseByOthers ? usage.otherUserNames : usage.userNames;
  const label = usage.inUseByOthers
    ? names.length > 1
      ? `${names.length} 人使用中`
      : `${names[0]} 使用中`
    : "我正在使用";

  return (
    <div
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-none",
        usage.inUseByOthers
          ? "border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-warning"
          : "border-[var(--color-info-border)] bg-[var(--color-info-bg)] text-brand-600",
      ].join(" ")}
      title={usage.userNames.join("、")}
    >
      <UsersRound className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}
