import { ExternalLink, Globe2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  BidReferenceSite,
  bidReferenceSites,
} from "../config/bidReferenceSites.config";

function getInitialSite(): BidReferenceSite {
  return bidReferenceSites[0];
}

export function BidReferenceSitesPage() {
  const [keyword, setKeyword] = useState("");
  const [activeSite, setActiveSite] = useState<BidReferenceSite>(() => getInitialSite());

  const filteredSites = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return bidReferenceSites;
    }

    return bidReferenceSites.filter((site) => {
      const searchableText = [site.name, site.description, site.tag, site.url]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(normalizedKeyword);
    });
  }, [keyword]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <section className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:flex-row md:p-5">
        <aside className="flex min-h-0 shrink-0 flex-col rounded-3xl border border-white/80 bg-white shadow-lg md:w-[22rem]">
          <div className="border-b border-slate-100 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Globe2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-slate-950">招投标网址汇集</h1>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  已收录 {bidReferenceSites.length} 个招投标参考入口，点击左侧条目后在右侧展示网页。
                </p>
              </div>
            </div>

            <label className="mt-4 flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm shadow-sm focus-within:border-blue-200 focus-within:ring-2 focus-within:ring-blue-100">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                type="search"
                placeholder="搜索网站、用途或分类…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filteredSites.length > 0 ? (
              <div className="space-y-1">
                {filteredSites.map((site) => {
                  const isActive = site.id === activeSite.id;

                  return (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() => setActiveSite(site)}
                      className={[
                        "group flex w-full gap-3 rounded-2xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200",
                        isActive ? "bg-blue-50" : "hover:bg-slate-50",
                      ].join(" ")}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span
                        className={[
                          "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                          isActive
                            ? "bg-blue-100 text-blue-700"
                            : "bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600",
                        ].join(" ")}
                      >
                        <Globe2 className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span
                            className={[
                              "truncate text-sm font-bold",
                              isActive ? "text-blue-800" : "text-slate-900",
                            ].join(" ")}
                          >
                            {site.name}
                          </span>
                          <span
                            className={[
                              "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
                              isActive ? "bg-white text-blue-700" : "bg-slate-100 text-slate-500",
                            ].join(" ")}
                          >
                            {site.tag}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {site.description}
                        </span>
                        <span className="mt-1 block truncate text-[0.7rem] text-slate-400">
                          {site.url}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                没有匹配的网站，换个关键词试试。
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/80 bg-white shadow-lg">
          <div className="flex shrink-0 flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-slate-950 md:text-lg">
                  {activeSite.name}
                </h2>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {activeSite.tag}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">{activeSite.url}</p>
            </div>

            <a
              href={activeSite.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              新窗口打开
            </a>
          </div>

          <div className="relative min-h-0 flex-1 bg-slate-100">
            <iframe
              key={activeSite.id}
              title={`${activeSite.name} 网页预览`}
              src={activeSite.url}
              allow="clipboard-read; clipboard-write; fullscreen"
              className="block h-full min-h-0 w-full border-0 bg-white"
            />
          </div>
        </section>
      </section>
    </div>
  );
}
