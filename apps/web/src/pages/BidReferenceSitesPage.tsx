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
    return favoriteSites.filter((site) =>
      [site.name, site.url, site.description, site.tag].join(" ").toLowerCase().includes(keyword),
    );
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
    <div className="legacy-portal-ui flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <section className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:flex-row md:p-5">
        <aside className="flex min-h-[360px] shrink-0 flex-col rounded-xl border border-border bg-white shadow-none md:w-[20rem]">
          <div className="border-b border-slate-100 p-4">
            <h1 className="text-lg font-semibold text-slate-950">收藏列表</h1>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              收藏常用入口或添加自定义网站，刷新后仍会保留。
            </p>
            <label className="mt-4 flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm shadow-none focus-within:border-brand-200 focus-within:ring-2 focus-within:ring-brand-200">
              <input
                value={favoriteKeyword}
                onChange={(event) => setFavoriteKeyword(event.target.value)}
                type="search"
                placeholder="搜索收藏网站"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
              <Icon name="search" className="h-4 w-4 text-slate-400" strokeWidth={1.7} />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {visibleFavoriteSites.length ? (
              <div className="space-y-1">
                {visibleFavoriteSites.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    className="group w-full min-w-0 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                    onClick={() => openSite(site.url)}
                    title={site.url}
                  >
                    <span className="block truncate text-sm font-bold text-slate-900 group-hover:text-brand-700">
                      {site.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">{site.url}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid h-full min-h-48 place-items-center text-center text-sm text-slate-500">
                <div>
                  <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-200">
                    <Icon name="book" className="h-8 w-8" strokeWidth={1.5} />
                  </div>
                  <p>暂无收藏</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 p-4">
            <button
              type="button"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 px-4 text-sm font-semibold text-white shadow-none  transition-colors hover:bg-brand-600"
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

        <main className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-border bg-white px-5 py-5 shadow-none">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-1 rounded-full bg-brand-500" />
                <h2 className="truncate text-base font-semibold text-slate-950 md:text-lg">常用网站</h2>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                已收录 {builtinSites.length} 个招投标参考入口，点击网站名称会在新窗口打开。
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {allSites.map((site) => {
              const isFavorite = favoriteSet.has(site.id);
              return (
                <article
                  key={site.id}
                  className="group flex min-h-14 min-w-0 items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-2 shadow-none transition hover:border-brand-200 hover:shadow-none"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openSite(site.url)}
                    title={site.url}
                  >
                    <span className="block truncate text-sm font-bold text-slate-900 group-hover:text-brand-700">
                      {site.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{site.description}</span>
                  </button>
                  <button
                    type="button"
                    className={[
                      "ml-3 inline-grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                      isFavorite ? "bg-brand-50 text-brand-600" : "text-slate-300 hover:bg-brand-50 hover:text-brand-600",
                    ].join(" ")}
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
      </section>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-panel" role="dialog" aria-modal="true" aria-label="新建网站">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">新建网站</h2>
              <button
                type="button"
                className="inline-grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setDialogOpen(false)}
                aria-label="关闭"
              >
                <Icon name="close" className="h-4 w-4" strokeWidth={1.7} />
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleCreate}>
              <label className="grid gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center">
                <span className="text-sm text-slate-600">网站名称：</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className="h-9 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  placeholder="请输入网站名称"
                />
              </label>
              <label className="grid gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center">
                <span className="text-sm text-slate-600">网站链接：</span>
                <input
                  value={form.url}
                  onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                  className="h-9 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  placeholder="请输入网站链接"
                />
              </label>

              {formError ? <p className="rounded-xl bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-danger">{formError}</p> : null}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-600 transition hover:bg-slate-50"
                  onClick={() => setDialogOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="h-9 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600">
                  确定
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
