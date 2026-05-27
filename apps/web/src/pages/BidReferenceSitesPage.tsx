import { FormEvent, useEffect, useMemo, useState } from "react";

import { getBidReferenceSites, type BidReferenceSite } from "../services/bidReferenceSitesService";
import { Icon } from "../shared/components/Icon";

type BookmarkSite = BidReferenceSite & {
  custom?: boolean;
};

type SiteForm = {
  name: string;
  url: string;
};

const builtinSites = getBidReferenceSites();
const customSitesStorageKey = "clover-bid-reference-custom-sites";
const favoriteSitesStorageKey = "clover-bid-reference-favorites";
const emptyForm: SiteForm = { name: "", url: "" };
const categoryTabs = [
  "不限",
  "常用网站",
  "CA办理",
  "公共资源",
  "国企采购",
  "实用工具",
  "招标投标",
  "政府采购",
  "政策法规",
  "文库文档",
  "服务平台",
  "杂志报刊",
  "行业协会",
  "资质查询",
  "采购意向",
];

function readJsonArray<T>(key: string): T[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const value = window.localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function openSite(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function BidReferenceSitesPage() {
  const [favoriteKeyword, setFavoriteKeyword] = useState("");
  const [customSites, setCustomSites] = useState<BookmarkSite[]>(() => readJsonArray<BookmarkSite>(customSitesStorageKey));
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readJsonArray<string>(favoriteSitesStorageKey));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SiteForm>(emptyForm);
  const [formError, setFormError] = useState("");

  const allSites = useMemo<BookmarkSite[]>(() => [...customSites, ...builtinSites], [customSites]);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const favoriteSites = useMemo(() => allSites.filter((site) => favoriteSet.has(site.id)), [allSites, favoriteSet]);
  const visibleFavoriteSites = useMemo(() => {
    const keyword = favoriteKeyword.trim().toLowerCase();
    if (!keyword) {
      return favoriteSites;
    }
    return favoriteSites.filter((site) => [site.name, site.url, site.description, site.tag].join(" ").toLowerCase().includes(keyword));
  }, [favoriteKeyword, favoriteSites]);

  useEffect(() => {
    window.localStorage.setItem(customSitesStorageKey, JSON.stringify(customSites));
  }, [customSites]);

  useEffect(() => {
    window.localStorage.setItem(favoriteSitesStorageKey, JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  const toggleFavorite = (siteId: string) => {
    setFavoriteIds((current) => (current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId]));
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    const name = form.name.trim();
    const url = normalizeUrl(form.url);
    if (!name || !url) {
      setFormError("请填写网站名称和链接。");
      return;
    }
    const site: BookmarkSite = {
      id: `custom-${Date.now()}`,
      name,
      url,
      description: "自定义网站",
      tag: "自定义",
      custom: true,
    };
    setCustomSites((current) => [site, ...current]);
    setFavoriteIds((current) => [site.id, ...current]);
    setForm(emptyForm);
    setDialogOpen(false);
  };

  return (
    <section className="flex min-h-full min-w-0 flex-col bg-slate-50 p-3 text-slate-950 sm:p-4 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto grid min-h-[calc(100vh-96px)] w-full max-w-screen-2xl gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-h-[360px] flex-col rounded-lg bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800">
          <div className="p-4">
            <h1 className="text-lg font-semibold text-slate-950 dark:text-white">收藏列表</h1>
            <label className="mt-4 flex h-8 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950">
              <input
                value={favoriteKeyword}
                onChange={(event) => setFavoriteKeyword(event.target.value)}
                type="search"
                placeholder="搜索网站"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-slate-400"
              />
              <Icon name="search" className="h-4 w-4 text-slate-400" strokeWidth={1.7} />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {visibleFavoriteSites.length ? (
              <div className="grid gap-2">
                {visibleFavoriteSites.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    className="min-w-0 rounded-md px-2 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 hover:text-blue-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => openSite(site.url)}
                    title={site.url}
                  >
                    <span className="block truncate">{site.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid h-full min-h-48 place-items-center text-center text-sm text-slate-400">
                <div>
                  <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl bg-blue-50 text-blue-200 dark:bg-blue-400/10">
                    <Icon name="book" className="h-8 w-8" strokeWidth={1.5} />
                  </div>
                  <p>暂无收藏</p>
                </div>
              </div>
            )}
          </div>

          <div className="p-4">
            <button
              type="button"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700"
              onClick={() => {
                setForm(emptyForm);
                setFormError("");
                setDialogOpen(true);
              }}
            >
              <Icon name="plus" className="h-4 w-4" strokeWidth={1.8} />
              新建网站
            </button>
          </div>
        </aside>

        <main className="min-w-0 rounded-lg bg-white px-5 py-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-3 w-1 rounded-full bg-blue-600" />
              <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white">常用网站</h2>
            </div>
            <a
              href="/workspace"
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded border border-slate-200 bg-white px-3 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
            >
              <Icon name="back" className="h-4 w-4" strokeWidth={1.7} />
              返回首页
            </a>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-slate-100 pb-4 text-sm dark:border-slate-800">
            <span className="text-slate-400">范围选择</span>
            <button type="button" className="h-8 min-w-56 rounded border border-slate-200 bg-white px-3 text-left text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              全国
            </button>
            <button type="button" className="h-8 min-w-56 rounded border border-slate-200 bg-slate-50 px-3 text-left text-slate-400 dark:border-slate-700 dark:bg-slate-950">
              请选择城市
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-slate-100 pb-4 text-sm dark:border-slate-800">
            <span className="text-slate-400">业务类型</span>
            {categoryTabs.map((item) => (
              <button
                key={item}
                type="button"
                className={item === "常用网站" ? "rounded bg-blue-600 px-3 py-1 font-medium text-white" : "text-slate-700 hover:text-blue-700 dark:text-slate-300"}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {allSites.map((site) => {
              const isFavorite = favoriteSet.has(site.id);
              return (
                <article
                  key={site.id}
                  className="group flex h-12 min-w-0 items-center justify-between rounded-lg border border-slate-100 bg-white px-4 shadow-sm transition hover:border-blue-100 hover:shadow-md dark:border-slate-800 dark:bg-slate-950"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-800 group-hover:text-blue-700 dark:text-slate-100"
                    onClick={() => openSite(site.url)}
                    title={site.url}
                  >
                    {site.name}
                  </button>
                  <button
                    type="button"
                    className={["ml-3 inline-grid h-7 w-7 shrink-0 place-items-center rounded text-slate-300 transition hover:bg-blue-50 hover:text-blue-600", isFavorite ? "text-blue-600" : ""].join(" ")}
                    onClick={() => toggleFavorite(site.id)}
                    aria-label={isFavorite ? "取消收藏" : "加入收藏"}
                    title={isFavorite ? "取消收藏" : "加入收藏"}
                  >
                    <Icon name={isFavorite ? "check" : "plus"} className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </article>
              );
            })}
          </div>

          <p className="mt-10 text-center text-sm text-slate-400">-- 没有更多了 --</p>
        </main>
      </div>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-label="新建网站">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">新建网站</h2>
              <button type="button" className="inline-grid h-8 w-8 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" onClick={() => setDialogOpen(false)} aria-label="关闭">
                <Icon name="close" className="h-4 w-4" strokeWidth={1.7} />
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleCreate}>
              <label className="grid gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center">
                <span className="text-sm text-slate-600 dark:text-slate-300">网站名称：</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className="h-9 rounded border border-slate-200 px-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950"
                  placeholder="请输入网站名称"
                />
              </label>
              <label className="grid gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center">
                <span className="text-sm text-slate-600 dark:text-slate-300">网站链接：</span>
                <input
                  value={form.url}
                  onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                  className="h-9 rounded border border-slate-200 px-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950"
                  placeholder="请输入网站链接"
                />
              </label>

              {formError ? <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-400/10 dark:text-rose-300">{formError}</p> : null}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                <button type="button" className="h-9 rounded border border-slate-200 bg-white px-4 text-sm text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300" onClick={() => setDialogOpen(false)}>
                  取消
                </button>
                <button type="submit" className="h-9 rounded bg-blue-600 px-4 text-sm text-white transition hover:bg-blue-700">
                  确定
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
