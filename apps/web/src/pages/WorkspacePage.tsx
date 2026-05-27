import { useState } from "react";

import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { Icon } from "../shared/components/Icon";
import { useAppUsage } from "../shared/runtime/AppUsageProvider";
import { useRuntimeApps } from "../shared/runtime/RuntimeAppsProvider";
import type { ModuleCode, PortalModule } from "../shared/types/portal";

const moduleToneMap: Record<ModuleCode, { banner: string; button: string }> = {
  "competitor-analysis": {
    banner: "from-blue-50 via-sky-50 to-transparent text-blue-700 dark:from-blue-500/15 dark:via-blue-400/10 dark:to-transparent dark:text-blue-200",
    button: "text-blue-700 hover:bg-blue-50",
  },
  "rag-web-search": {
    banner: "from-sky-50 via-blue-50 to-transparent text-blue-700 dark:from-sky-500/15 dark:via-blue-400/10 dark:to-transparent dark:text-blue-200",
    button: "text-cyan-700 hover:bg-cyan-50",
  },
  "contract-review": {
    banner: "from-blue-50 via-slate-50 to-transparent text-blue-700 dark:from-blue-500/15 dark:via-slate-800 dark:to-transparent dark:text-blue-200",
    button: "text-blue-700 hover:bg-blue-50",
  },
  "bid-generator": {
    banner: "from-blue-50 via-sky-50 to-transparent text-blue-700 dark:from-blue-500/15 dark:via-sky-400/10 dark:to-transparent dark:text-blue-200",
    button: "text-blue-700 hover:bg-blue-50",
  },
};

function UsageBadge({ appId }: { appId: ModuleCode }) {
  const { getAppUsage } = useAppUsage();
  const usage = getAppUsage(appId);
  if (!usage.inUse) {
    return (
      <span className="inline-flex items-center rounded-lg bg-blue-50 px-3 py-1 text-base font-bold text-blue-600 dark:bg-blue-400/10 dark:text-blue-200">
        可用
      </span>
    );
  }
  const label = usage.inUseByOthers
    ? usage.otherUserNames.length > 1
      ? `${usage.otherUserNames.length} 人使用中`
      : `${usage.otherUserNames[0] || "其他用户"} 使用中`
    : "我正在使用";
  return (
    <span
      className={[
        "inline-flex max-w-40 items-center rounded-lg px-3 py-1 text-base font-bold",
        usage.inUseByOthers
          ? "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
          : "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300",
      ].join(" ")}
      title={label}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function ModuleCard({ module, navigate }: { module: PortalModule; navigate: NavigateFn }) {
  const { canAccessApp } = useAuth();
  const { enterApp, getAppUsage } = useAppUsage();
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const usage = getAppUsage(module.code);
  const allowed = canAccessApp(module.code);
  const tone = moduleToneMap[module.code];

  const go = async (confirmedConflict = false) => {
    if (!allowed) {
      return;
    }
    try {
      await enterApp(module.code, { confirmedConflict });
      navigate(module.route);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "进入应用失败。");
    }
  };

  const handleEnter = () => {
    setLocalError("");
    if (usage.inUseByOthers) {
      setConfirming(true);
      return;
    }
    void go(false);
  };

  return (
    <article
      className={[
        "group relative flex min-h-72 min-w-0 overflow-hidden rounded-2xl bg-white shadow-xl shadow-slate-200/70 transition duration-300 hover:-translate-y-0.5 sm:min-h-80 dark:bg-slate-900 dark:shadow-slate-950/40",
        allowed ? "" : "opacity-75",
      ].join(" ")}
    >
      <img
        src={module.backgroundImage}
        alt={`${module.name} 背景图`}
        className="absolute inset-y-0 right-0 h-full w-full object-contain object-right transition duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
      <div className="absolute inset-0 bg-white/10 dark:bg-slate-950/40" />
      <div className="absolute inset-0 bg-gradient-to-r from-white via-white/95 to-white/35 md:via-white/88 md:to-transparent dark:from-slate-950 dark:via-slate-950/90 dark:to-slate-950/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-white/10 via-transparent to-white/35 dark:from-slate-950/20 dark:to-slate-950/20" />

      <div className="absolute right-5 top-5 z-20 flex items-center justify-end">
        <UsageBadge appId={module.code} />
      </div>

      <div className="relative z-10 flex min-h-0 w-full max-w-[28rem] flex-col justify-center gap-8 px-6 py-8 sm:gap-9 sm:px-8 lg:px-10">
        <div className="min-w-0 space-y-6">
          <div className="space-y-4">
            <h2 className="truncate text-3xl font-bold leading-tight tracking-normal text-slate-950 md:text-4xl dark:text-white">
              {module.name}
            </h2>
            <p className="max-w-sm text-base font-normal leading-7 text-slate-700 dark:text-slate-300">
              {module.description}
            </p>
          </div>
          <div
            className={[
              "flex h-10 w-full max-w-[22rem] items-center rounded-sm bg-gradient-to-r px-4 text-base font-medium sm:px-5",
              tone.banner,
            ].join(" ")}
          >
            <span className="min-w-0 truncate">{module.bannerText}</span>
          </div>
        </div>

        <div className="grid justify-start gap-3">
          {localError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-base font-medium text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">
              {localError}
            </p>
          ) : null}
          <button
            type="button"
            className={[
              "inline-flex h-11 w-fit min-w-32 items-center justify-center gap-3 rounded-lg border border-blue-300 bg-white/90 px-5 text-base font-semibold shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 dark:border-blue-500/30 dark:bg-slate-950/90 dark:disabled:border-slate-700 dark:disabled:text-slate-600",
              allowed ? tone.button : "",
            ].join(" ")}
            disabled={!allowed}
            onClick={handleEnter}
          >
            <span className="truncate">{allowed ? module.ctaLabel : "暂无权限"}</span>
            <Icon name={allowed ? "arrow" : "lock"} />
          </button>
        </div>
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5">
          <section className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl shadow-slate-950/20 dark:bg-slate-900 dark:shadow-slate-950/50" role="dialog" aria-modal="true">
            <button
              className="absolute right-4 top-4 inline-grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              type="button"
              onClick={() => setConfirming(false)}
              aria-label="关闭"
            >
              <Icon name="close" />
            </button>
            <span className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
              <Icon name="users" />
            </span>
            <h3 className="text-lg font-bold text-slate-950 dark:text-white">应用正在被使用</h3>
            <p className="mt-2 text-base leading-7 text-slate-600 dark:text-slate-300">
              {usage.otherUserNames.join("、") || "其他用户"} 当前正在使用 {module.name}，确认后会同时进入，不会中断对方会话。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="inline-flex h-11 min-w-20 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-base font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => setConfirming(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex h-11 min-w-24 items-center justify-center rounded-lg bg-blue-600 px-4 text-base font-bold text-white hover:bg-blue-700"
                onClick={() => {
                  setConfirming(false);
                  void go(true);
                }}
              >
                确认进入
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}

export function WorkspacePage({ navigate }: { navigate: NavigateFn }) {
  const { modules, error, refreshRuntimeApps } = useRuntimeApps();

  return (
    <section className="relative flex min-h-full min-w-0 flex-col overflow-auto bg-slate-50 px-4 py-4 sm:px-6 lg:overflow-hidden lg:px-10 lg:py-8 xl:px-12 dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-blue-50 to-transparent dark:from-blue-950/40" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-sky-50 to-transparent dark:from-slate-900" />
      {error ? (
        <div className="relative z-10 mx-auto mb-4 flex w-full max-w-screen-2xl shrink-0 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-base font-medium text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300">
          <span className="min-w-0 truncate">{error}</span>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center rounded-lg border border-amber-200 bg-white px-3 text-base font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-400/20 dark:bg-slate-950 dark:text-amber-300 dark:hover:bg-slate-900"
            onClick={() => void refreshRuntimeApps()}
          >
            重试
          </button>
        </div>
      ) : null}

      <div className="relative z-10 mx-auto grid w-full max-w-screen-2xl flex-1 grid-cols-1 gap-5 md:grid-cols-2 md:grid-rows-2 lg:min-h-0">
        {modules.map((module) => (
          <ModuleCard key={module.code} module={module} navigate={navigate} />
        ))}
      </div>
    </section>
  );
}
