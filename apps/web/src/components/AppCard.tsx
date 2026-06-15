import { ArrowRight, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { useAppUsage } from "../shared/runtime/AppUsageProvider";
import type { ToolkitApp } from "../shared/types/app";
import { AppEntryConfirmDialog } from "./AppEntryConfirmDialog";
import { AppUsageBadge } from "./AppUsageBadge";

interface AppCardProps {
  app: ToolkitApp;
  navigate: NavigateFn;
  ctaLabelOverride?: string;
}

export function AppCard({ app, navigate, ctaLabelOverride }: AppCardProps) {
  const { canAccessApp } = useAuth();
  const { enterApp, getAppUsage } = useAppUsage();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const usage = getAppUsage(app.id);
  const hasPermission = canAccessApp(app.id);

  const goToApp = async (confirmedConflict = false) => {
    await enterApp(app.id, { confirmedConflict });
    navigate(`/apps/${app.id}`);
  };

  const handleEnter = () => {
    if (!hasPermission) {
      return;
    }

    if (usage.inUse) {
      setIsConfirmOpen(true);
      return;
    }

    goToApp(false).catch(() => undefined);
  };

  return (
    <>
      <article
        className={[
          "group relative flex h-full min-h-80 overflow-hidden rounded-xl border border-border bg-surface shadow-panel lg:min-h-96",
          hasPermission ? "" : "opacity-80",
        ].join(" ")}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface-soft to-brand-50/60" />
        <div className="absolute inset-y-0 right-0 w-3/5 bg-gradient-to-l from-brand-50/72 via-brand-50/28 to-transparent" />
        <img
          src={app.backgroundImage}
          alt={`${app.name} 背景图`}
          className="absolute bottom-0 right-0 h-full w-[74%] object-cover object-center opacity-[0.5] [mask-image:linear-gradient(to_right,transparent,rgba(0,0,0,0.54)_18%,rgb(0,0,0)_38%)] transition-transform duration-500 ease-out motion-reduce:transform-none md:w-[58%] md:scale-105 md:opacity-[0.82] md:group-hover:scale-110 md:group-hover:-translate-y-1 md:group-hover:translate-x-1"
        />

        <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/72 to-surface/8" />
        <div className="absolute inset-0 bg-gradient-to-t from-surface/24 via-transparent to-surface/18" />

        <div className="absolute right-4 top-4 z-20 flex flex-col items-end gap-2 md:right-5 md:top-5">
          <AppUsageBadge usage={usage} />
          {!hasPermission ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface/95 px-3 py-1.5 text-xs font-semibold text-muted shadow-none">
              <LockKeyhole className="h-3.5 w-3.5" />
              无权限
            </span>
          ) : null}
        </div>

        <div className="relative z-10 flex h-full w-full flex-col p-7 md:p-9 lg:p-10">
          <div className="min-w-0 max-w-[82%] space-y-5 md:max-w-[52%] lg:max-w-[50%] lg:space-y-6">
            <div className="space-y-4 md:space-y-5">
              <h2 className="text-2xl font-black leading-tight tracking-normal text-ink md:text-3xl lg:text-[2rem]">
                {app.name}
              </h2>
              <p className="max-w-md text-base font-medium leading-7 text-ink/80 md:text-lg">
                {app.description}
              </p>
            </div>

            <div className="inline-flex max-w-full items-center gap-4 rounded-md border border-brand-100 bg-brand-50/72 px-5 py-3 text-base font-semibold tracking-normal text-brand-600 md:min-w-72 md:px-6 md:text-lg">
              <span className="min-w-0 truncate leading-7">{app.bannerText}</span>
              <ArrowRight className="h-5 w-5 shrink-0" strokeWidth={2} />
            </div>
          </div>

          <div className="mt-auto pt-12 md:pt-16">
            <button
              type="button"
              onClick={handleEnter}
              disabled={!hasPermission}
              className={[
                "inline-flex min-h-12 items-center gap-3 rounded-md border bg-surface/86 px-5 py-3 text-base font-semibold shadow-none transition-all duration-200 motion-reduce:transition-none md:min-h-12 md:px-6 md:text-lg md:group-hover:-translate-y-0.5",
                hasPermission
                  ? "border-brand-200 text-brand-600 hover:bg-brand-50"
                  : "cursor-not-allowed border-border text-muted",
              ].join(" ")}
            >
              {hasPermission ? ctaLabelOverride ?? app.ctaLabel : "暂无权限"}
              {hasPermission ? (
                <ArrowRight className="h-4 w-4 md:h-5 md:w-5" strokeWidth={2} />
              ) : (
                <LockKeyhole className="h-4 w-4 md:h-5 md:w-5" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      </article>

      {isConfirmOpen ? (
        <AppEntryConfirmDialog
          app={app}
          userNames={usage.inUseByOthers ? usage.otherUserNames : usage.userNames}
          onCancel={() => setIsConfirmOpen(false)}
          onConfirm={() => {
            setIsConfirmOpen(false);
            goToApp(true).catch(() => undefined);
          }}
        />
      ) : null}
    </>
  );
}
