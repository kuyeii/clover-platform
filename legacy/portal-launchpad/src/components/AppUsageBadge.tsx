import { UsersRound } from "lucide-react";
import { AppUsageSummary } from "../types/user";

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
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-sm",
        usage.inUseByOthers
          ? "border-amber-200 bg-amber-50/95 text-amber-700"
          : "border-sky-200 bg-sky-50/95 text-sky-700",
      ].join(" ")}
      title={usage.userNames.join("、")}
    >
      <UsersRound className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}
