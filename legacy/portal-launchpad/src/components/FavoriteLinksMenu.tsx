import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, ExternalLink, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { favoriteLinks } from "../config/favoriteLinks.config";

export function FavoriteLinksMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const filteredLinks = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return favoriteLinks;
    }

    return favoriteLinks.filter((link) => {
      const searchableText = [link.name, link.description, link.tag, link.url]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(normalizedKeyword);
    });
  }, [keyword]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={[
          "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border px-3 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200",
          isOpen
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
        ].join(" ")}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <Bookmark className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">收藏夹</span>
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed inset-x-3 top-[4.5rem] z-50 max-h-[calc(100vh-6rem)] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/12 md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-[28rem]"
            role="dialog"
            aria-label="常用网站收藏夹"
          >
            <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 via-white to-sky-50 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-slate-950">常用网站收藏夹</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    已收录 {favoriteLinks.length} 个投标审查常用入口，点击后新窗口打开。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                  aria-label="关闭收藏夹"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
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

            <div className="max-h-[min(31rem,calc(100vh-15rem))] overflow-y-auto p-2">
              {filteredLinks.length > 0 ? (
                <div className="space-y-1">
                  {filteredLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                      onClick={() => setIsOpen(false)}
                    >
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100">
                        <Bookmark className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-bold text-slate-900">
                            {link.name}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-500">
                            {link.tag}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {link.description}
                        </span>
                        <span className="mt-1 block truncate text-[0.7rem] text-slate-400">
                          {link.url}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  没有匹配的网站，换个关键词试试。
                </div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
