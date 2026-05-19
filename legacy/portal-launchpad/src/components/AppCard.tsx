import { ArrowRight, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppUsage } from "../contexts/AppUsageContext";
import { useAuth } from "../contexts/AuthContext";
import { AppTheme, ToolkitApp } from "../types/app";
import { AppEntryConfirmDialog } from "./AppEntryConfirmDialog";
import { AppUsageBadge } from "./AppUsageBadge";

const themeMap: Record<
  AppTheme,
  {
    banner: string;
    button: string;
    glowPrimary: string;
    glowSecondary: string;
  }
> = {
  blue: {
    banner: "from-blue-600 via-blue-500/92 to-blue-500/0 text-white",
    button: "border-blue-300 text-blue-700 hover:bg-blue-50",
    glowPrimary: "bg-blue-300/40",
    glowSecondary: "bg-sky-200/40",
  },
  emerald: {
    banner: "from-blue-600 via-blue-500/92 to-blue-500/0 text-white",
    button: "border-blue-300 text-blue-700 hover:bg-blue-50",
    glowPrimary: "bg-blue-300/35",
    glowSecondary: "bg-cyan-200/40",
  },
  amber: {
    banner: "from-blue-600 via-blue-500/92 to-blue-500/0 text-white",
    button: "border-blue-300 text-blue-700 hover:bg-blue-50",
    glowPrimary: "bg-blue-300/35",
    glowSecondary: "bg-sky-200/35",
  },
  orange: {
    banner: "from-blue-600 via-blue-500/92 to-blue-500/0 text-white",
    button: "border-blue-300 text-blue-700 hover:bg-blue-50",
    glowPrimary: "bg-blue-300/35",
    glowSecondary: "bg-cyan-200/35",
  },
};

interface AppCardProps {
  app: ToolkitApp;
}

export function AppCard({ app }: AppCardProps) {
  const navigate = useNavigate();
  const { canAccessApp } = useAuth();
  const { enterApp, getAppUsage } = useAppUsage();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const theme = themeMap[app.theme];
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

    if (usage.inUseByOthers) {
      setIsConfirmOpen(true);
      return;
    }

    goToApp(false).catch(() => undefined);
  };

  return (
    <>
      <article
        className={[
          "group relative flex h-full min-h-64 overflow-hidden rounded-3xl bg-slate-50 shadow-panel",
          hasPermission ? "" : "opacity-80",
        ].join(" ")}
      >
        <img
          src={app.backgroundImage}
          alt={`${app.name} 背景图`}
          className="absolute inset-0 h-full w-full object-contain object-right transition-transform duration-500 ease-out motion-reduce:transform-none md:scale-110 md:group-hover:scale-115 md:group-hover:-translate-y-1 md:group-hover:translate-x-1"
        />

        <div className="absolute inset-0 bg-white/12" />
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/84 to-white/10 md:from-white md:via-white/80 md:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-white/14 via-transparent to-white/26" />

        <div
          className={[
            "absolute -left-10 bottom-6 h-28 w-40 rounded-full blur-3xl transition-all duration-500 motion-reduce:transition-none md:group-hover:left-0 md:group-hover:bottom-8 md:group-hover:scale-110",
            theme.glowPrimary,
          ].join(" ")}
        />
        <div
          className={[
            "absolute right-8 top-8 h-24 w-24 rounded-full blur-3xl opacity-0 transition-all duration-500 motion-reduce:transition-none md:group-hover:right-10 md:group-hover:top-10 md:group-hover:opacity-100",
            theme.glowSecondary,
          ].join(" ")}
        />

        <div className="absolute right-5 top-5 z-20 flex flex-col items-end gap-2">
          <AppUsageBadge usage={usage} />
          {!hasPermission ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm backdrop-blur-sm">
              <LockKeyhole className="h-3.5 w-3.5" />
              无权限
            </span>
          ) : null}
        </div>

        <div className="relative z-10 flex h-full w-full flex-col justify-between p-6 md:p-7 lg:p-8">
          <div className="min-w-0 max-w-full space-y-3 md:max-w-md lg:max-w-lg">
            <div className="space-y-2">
              <h2 className="text-3xl font-black tracking-normal text-slate-950 md:text-4xl lg:text-5xl">
                {app.name}
              </h2>
              <p className="max-w-lg text-base leading-7 text-slate-700 md:text-lg">
                {app.description}
              </p>
            </div>

            <div
              className={[
                "flex w-full items-center bg-gradient-to-r px-5 py-2 text-base font-medium tracking-normal md:w-11/12 md:px-6 md:text-lg lg:w-full lg:px-8",
                theme.banner,
              ].join(" ")}
            >
              <span className="leading-6">{app.bannerText}</span>
            </div>
          </div>

          <div className="pt-6 md:pt-8">
            <button
              type="button"
              onClick={handleEnter}
              disabled={!hasPermission}
              className={[
                "inline-flex items-center gap-3 rounded-full border bg-white/92 px-5 py-3 text-base font-semibold shadow-sm transition-all duration-200 motion-reduce:transition-none md:px-7 md:text-lg md:group-hover:-translate-y-0.5",
                hasPermission
                  ? theme.button
                  : "cursor-not-allowed border-slate-200 text-slate-400",
              ].join(" ")}
            >
              {hasPermission ? app.ctaLabel : "暂无权限"}
              {hasPermission ? (
                <ArrowRight className="h-5 w-5 md:h-6 md:w-6" strokeWidth={2} />
              ) : (
                <LockKeyhole className="h-5 w-5 md:h-6 md:w-6" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      </article>

      {isConfirmOpen ? (
        <AppEntryConfirmDialog
          app={app}
          userNames={usage.otherUserNames}
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
