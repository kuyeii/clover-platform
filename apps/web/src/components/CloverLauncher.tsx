import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Globe2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { NavigateFn } from "../routes";
import type { ToolkitApp } from "../shared/types/app";
import { AppCard } from "./AppCard";

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

const pageVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? "100%" : "-100%",
  }),
  center: {
    x: 0,
    transition: {
      duration: 0.52,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? "-100%" : "100%",
    transition: {
      duration: 0.52,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
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
};

function BidReferenceSitesCard({
  item,
  navigate,
}: {
  item: Extract<LauncherItem, { type: "reference-sites" }>;
  navigate: NavigateFn;
}) {
  return (
    <article className="group relative flex h-full min-h-80 overflow-hidden rounded-xl border border-border bg-surface shadow-panel lg:min-h-96">
      <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface-soft to-brand-50/60" />
      <div className="absolute inset-y-0 right-0 w-3/5 bg-gradient-to-l from-brand-50/72 via-brand-50/28 to-transparent" />
      <div className="absolute bottom-8 right-8 hidden h-44 w-44 items-center justify-center rounded-full border border-brand-100 bg-white/50 text-brand-500 md:flex lg:h-52 lg:w-52">
        <Globe2 className="h-20 w-20 lg:h-24 lg:w-24" strokeWidth={1.45} />
      </div>
      <div className="absolute bottom-0 right-0 h-full w-[74%] bg-[radial-gradient(circle_at_65%_62%,rgba(2,132,199,0.18),transparent_34%),linear-gradient(135deg,transparent_0%,rgba(238,248,252,0.82)_100%)] opacity-80 [mask-image:linear-gradient(to_right,transparent,rgba(0,0,0,0.54)_18%,rgb(0,0,0)_38%)] md:w-[58%]" />
      <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/72 to-surface/8" />
      <div className="absolute inset-0 bg-gradient-to-t from-surface/24 via-transparent to-surface/18" />

      <div className="relative z-10 flex h-full w-full flex-col p-7 md:p-9 lg:p-10">
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

        <div className="mt-auto pt-12 md:pt-16">
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
  const [direction, setDirection] = useState(1);
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

  const goToPage = (nextPageIndex: number) => {
    if (nextPageIndex === pageIndex) {
      return;
    }
    setDirection(nextPageIndex > pageIndex ? 1 : -1);
    setPageIndex(nextPageIndex);
  };

  const goToPreviousPage = () => {
    const nextPageIndex = pageIndex === 0 ? pages.length - 1 : pageIndex - 1;
    setDirection(-1);
    setPageIndex(nextPageIndex);
  };

  const goToNextPage = () => {
    const nextPageIndex = pageIndex === pages.length - 1 ? 0 : pageIndex + 1;
    setDirection(1);
    setPageIndex(nextPageIndex);
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-auto bg-mist px-5 pb-8 pt-6 md:px-8 md:pb-10 md:pt-7 lg:px-12 lg:pb-12 lg:pt-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-surface-soft to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-brand-50/44 to-transparent" />

      <div className="relative flex-1 overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none invisible grid min-h-full w-full grid-cols-1 gap-5 md:grid-cols-2 md:grid-rows-2 md:gap-6 lg:gap-8"
        >
          {activeItems.map((item) => (
            <div
              key={item.type === "app" ? `size-${item.app.id}` : `size-${item.id}`}
              className="h-full min-h-80 lg:min-h-96"
            />
          ))}
        </div>
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={pageIndex}
            custom={direction}
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="absolute inset-0 grid h-full w-full grid-cols-1 gap-5 md:grid-cols-2 md:grid-rows-2 md:gap-6 lg:gap-8"
            style={{ willChange: "transform" }}
          >
            {activeItems.map((item, index) => (
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
                  <AppCard app={item.app} navigate={navigate} ctaLabelOverride="进入应用" />
                ) : (
                  <BidReferenceSitesCard item={item} navigate={navigate} />
                )}
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative z-10 flex shrink-0 items-center justify-end">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white/92 p-1.5 shadow-panel">
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
    </section>
  );
}
