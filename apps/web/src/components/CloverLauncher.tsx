import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { NavigateFn } from "../routes";
import { useAppUsage } from "../shared/runtime/AppUsageProvider";
import type { ToolkitApp } from "../shared/types/app";
import { AppCard } from "./AppCard";
import { AppEntryConfirmDialog } from "./AppEntryConfirmDialog";

interface CloverLauncherProps {
  apps: ToolkitApp[];
  navigate: NavigateFn;
}

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.985 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.32,
      delay: index * 0.05,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
  hover: {
    scale: 1.012,
    transition: {
      duration: 0.18,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

type LauncherItem =
  | {
      type: "app";
      app: ToolkitApp;
    }
  | {
      type: "reference-sites";
      id: "bid-reference-sites";
      name: string;
      description: string;
      bannerText: string;
      ctaLabel: string;
      route: string;
      backgroundImage: string;
    };

const pageAppIds = [
  ["bid-generator", "contract-review", "competitor-analysis", "rag-web-search"],
  ["contract-review", "patent-disclosure", "rag-web-search"],
] as const;

const bidReferenceSitesItem: LauncherItem = {
  type: "reference-sites",
  id: "bid-reference-sites",
  name: "招投标网址",
  description: "集中管理常用招投标参考入口，收藏和打开高频网站。",
  bannerText: "常用网站 · 收藏入口 · 快速访问",
  ctaLabel: "进入应用",
  route: "/bid-reference-sites",
  backgroundImage: "/app-backgrounds/site_colletions.png",
};

function BidReferenceSitesCard({
  item,
  navigate,
}: {
  item: Extract<LauncherItem, { type: "reference-sites" }>;
  navigate: NavigateFn;
}) {
  return (
    <article className="group relative flex h-full min-h-[260px] overflow-hidden rounded-xl border-0 bg-surface shadow-panel md:min-h-0">
      <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface-soft to-brand-50/60" />
      <div className="absolute inset-y-0 right-0 w-3/5 bg-gradient-to-l from-brand-50/72 via-brand-50/28 to-transparent" />
      <img
        src={item.backgroundImage}
        alt={`${item.name} 背景图`}
        className="absolute bottom-0 right-0 h-full w-[74%] object-cover object-center opacity-[0.5] [mask-image:linear-gradient(to_right,transparent,rgba(0,0,0,0.54)_18%,rgb(0,0,0)_38%)] transition-transform duration-500 ease-out motion-reduce:transform-none md:w-[58%] md:scale-105 md:opacity-[0.82] md:group-hover:scale-110 md:group-hover:-translate-y-1 md:group-hover:translate-x-1"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/72 to-surface/8" />
      <div className="absolute inset-0 bg-gradient-to-t from-surface/24 via-transparent to-surface/18" />

      <div className="relative z-10 flex h-full w-full flex-col p-6 md:p-7 lg:p-8">
        <div className="min-w-0 max-w-[82%] space-y-5 md:max-w-[52%] lg:max-w-[50%] lg:space-y-6">
          <div className="space-y-4 md:space-y-5">
            <h2 className="text-2xl font-black leading-tight tracking-normal text-ink md:text-3xl lg:text-[2rem]">
              {item.name}
            </h2>
            <p className="max-w-md text-base font-medium leading-7 text-ink/80 md:text-lg">
              {item.description}
            </p>
          </div>

          <div className="inline-flex max-w-full items-center gap-4 rounded-md border border-brand-100 bg-brand-50/72 px-5 py-3 text-base font-semibold tracking-normal text-brand-600 md:min-w-72 md:px-6 md:text-lg">
            <span className="min-w-0 truncate leading-7">{item.bannerText}</span>
            <ArrowRight className="h-5 w-5 shrink-0" strokeWidth={2} />
          </div>
        </div>

        <div className="mt-auto pt-8 md:pt-10">
          <button
            type="button"
            onClick={() => navigate(item.route)}
            className="inline-flex min-h-12 items-center gap-3 rounded-md border border-brand-200 bg-surface/86 px-5 py-3 text-base font-semibold text-brand-600 shadow-none transition-all duration-200 hover:bg-brand-50 motion-reduce:transition-none md:min-h-12 md:px-6 md:text-lg md:group-hover:-translate-y-0.5"
          >
            {item.ctaLabel}
            <ArrowRight className="h-4 w-4 md:h-5 md:w-5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function CloverLauncher({ apps, navigate }: CloverLauncherProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pendingOccupiedApp, setPendingOccupiedApp] = useState<ToolkitApp | null>(null);
  const { enterApp, getAppUsage } = useAppUsage();
  const pages = useMemo(() => {
    const appById = new Map(apps.map((app) => [app.id, app]));
    return pageAppIds.map((ids, index) => {
      const appItems = ids.flatMap<LauncherItem>((id) => {
        const app = appById.get(id);
        return app ? [{ type: "app", app }] : [];
      });
      return index === 1 ? [...appItems, bidReferenceSitesItem] : appItems;
    });
  }, [apps]);
  const activeItems = pages[pageIndex] ?? pages[0] ?? [];
  const pendingUsage = pendingOccupiedApp ? getAppUsage(pendingOccupiedApp.id) : null;

  const goToPage = (nextPageIndex: number) => {
    if (nextPageIndex === pageIndex) {
      return;
    }
    setPageIndex(nextPageIndex);
  };

  const goToPreviousPage = () => {
    const nextPageIndex = pageIndex === 0 ? pages.length - 1 : pageIndex - 1;
    goToPage(nextPageIndex);
  };

  const goToNextPage = () => {
    const nextPageIndex = pageIndex === pages.length - 1 ? 0 : pageIndex + 1;
    goToPage(nextPageIndex);
  };

  const confirmOccupiedEntry = () => {
    if (!pendingOccupiedApp) {
      return;
    }
    const appId = pendingOccupiedApp.id;
    setPendingOccupiedApp(null);
    enterApp(appId, { confirmedConflict: true })
      .then(() => navigate(`/apps/${appId}`))
      .catch(() => undefined);
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-mist px-5 pb-6 pt-7 md:px-8 md:pb-7 md:pt-9 lg:px-12 lg:pb-8 lg:pt-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-surface-soft to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-brand-50/44 to-transparent" />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none invisible grid min-h-full w-full grid-cols-1 gap-5 md:grid-cols-2 md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:gap-5 lg:gap-6"
        >
          {activeItems.map((item) => (
            <div
              key={item.type === "app" ? `size-${item.app.id}` : `size-${item.id}`}
              className="h-full min-h-[260px] md:min-h-0"
            />
          ))}
        </div>
        <motion.div
          className="absolute inset-0 flex h-full"
          animate={{ x: `-${pageIndex * (100 / pages.length)}%` }}
          transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
          style={{ width: `${pages.length * 100}%`, willChange: "transform" }}
        >
          {pages.map((pageItems, pageItemIndex) => (
            <div
              key={pageItemIndex}
              className="grid h-full min-w-0 shrink-0 grid-cols-1 gap-5 md:grid-cols-2 md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:gap-5 lg:gap-6"
              style={{ width: `${100 / pages.length}%` }}
            >
              {pageItems.map((item, index) => (
                <motion.div
                  key={item.type === "app" ? item.app.id : item.id}
                  custom={index}
                  variants={cardVariants}
                  initial={false}
                  animate="visible"
                  whileHover="hover"
                  className="h-full min-h-0"
                >
                  {item.type === "app" ? (
                    <AppCard
                      app={item.app}
                      navigate={navigate}
                      ctaLabelOverride="进入应用"
                      onRequestOccupiedEntry={setPendingOccupiedApp}
                    />
                  ) : (
                    <BidReferenceSitesCard item={item} navigate={navigate} />
                  )}
                </motion.div>
              ))}
            </div>
          ))}
        </motion.div>
      </div>

      <div className="relative z-10 mt-5 flex shrink-0 items-center justify-end md:mt-6">
        <div className="inline-flex items-center gap-2 rounded-full border-0 bg-white/92 p-1.5 shadow-panel">
          <button
            type="button"
            onClick={goToPreviousPage}
            className="inline-grid h-9 w-9 place-items-center rounded-full text-brand-600 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
            aria-label="切换到上一组模块"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.1} />
          </button>

          {pages.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => goToPage(index)}
              className={[
                "inline-grid h-9 w-9 place-items-center rounded-full text-sm font-black tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
                pageIndex === index
                  ? "bg-brand-500 text-white"
                  : "border border-brand-100 bg-brand-50 text-brand-600 hover:bg-brand-100",
              ].join(" ")}
              aria-label={`切换到第 ${index + 1} 组模块`}
              aria-current={pageIndex === index ? "page" : undefined}
            >
              {index + 1}
            </button>
          ))}

          <button
            type="button"
            onClick={goToNextPage}
            className="inline-grid h-9 w-9 place-items-center rounded-full text-brand-600 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
            aria-label="切换到下一组模块"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.1} />
          </button>
        </div>
      </div>

      {pendingOccupiedApp ? (
        <AppEntryConfirmDialog
          app={pendingOccupiedApp}
          userNames={pendingUsage?.inUseByOthers ? pendingUsage.otherUserNames : pendingUsage?.userNames ?? []}
          onCancel={() => setPendingOccupiedApp(null)}
          onConfirm={confirmOccupiedEntry}
        />
      ) : null}
    </section>
  );
}
