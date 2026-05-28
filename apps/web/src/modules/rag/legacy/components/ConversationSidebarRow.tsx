import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import type { Conversation } from "@/types/conversation";

type Props = {
  conversation: Conversation;
  label: string;
  active: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function formatConversationTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function ConversationSidebarRow({
  conversation: c,
  label,
  active,
  onSelect,
  onTogglePin,
  onRename,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }

    let retryCount = 0;
    let rafId = 0;

    const placeMenu = () => {
      const btn = menuBtnRef.current;
      const panel = menuPanelRef.current;
      if (!btn || !panel) return;
      const margin = 8;
      const gap = 6;
      const br = btn.getBoundingClientRect();
      const ph = panel.offsetHeight;
      const pw = panel.offsetWidth;
      if ((ph === 0 || pw === 0) && retryCount < 8) {
        retryCount += 1;
        rafId = requestAnimationFrame(placeMenu);
        return;
      }
      if (ph === 0 || pw === 0) return;

      let top = br.bottom + gap;
      if (top + ph > window.innerHeight - margin) {
        top = br.top - ph - gap;
      }
      top = Math.max(margin, Math.min(top, window.innerHeight - ph - margin));

      let left = br.right - pw;
      left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));

      setMenuPos({ top, left });
    };

    placeMenu();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => placeMenu())
        : null;
    if (menuPanelRef.current && ro) {
      ro.observe(menuPanelRef.current);
    }

    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuBtnRef.current?.contains(t)) return;
      if (menuPanelRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const pinned = Boolean(c.pinned);
  const time = formatConversationTime(c.updatedAt || c.createdAt);

  return (
    <>
      <div
        className={[
          "group relative flex min-h-16 items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors duration-200",
          active
            ? "bg-brand-50 text-brand-900"
            : "text-slate-700 hover:bg-surface-soft",
        ].join(" ")}
      >
        <span
          aria-hidden
          className={[
            "h-2 w-2 shrink-0 rounded-full transition-colors",
            active ? "bg-brand-500" : "bg-slate-300 group-hover:bg-brand-500",
          ].join(" ")}
        />
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
        >
          <span
            className={[
              "block truncate text-sm font-medium leading-tight",
              active ? "text-brand-900" : "text-slate-800",
            ].join(" ")}
          >
            {label}
          </span>
          {time ? (
            <span className="mt-1 block truncate text-xs leading-none text-muted">
              {time}
            </span>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {pinned ? (
            <Pin
              aria-hidden
              size={14}
              className="pointer-events-none shrink-0 text-brand-500"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          <button
            ref={menuBtnRef}
            type="button"
            aria-label="对话选项"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={[
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors",
              "opacity-0 hover:bg-brand-50 hover:text-brand-600 group-hover:opacity-100",
              menuOpen ? "bg-brand-50 text-brand-600 opacity-100" : "",
            ].join(" ")}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {menuOpen
        ? createPortal(
            <div
              ref={menuPanelRef}
              role="menu"
              className="fixed z-[300] w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-panel "
              style={{
                top: menuPos?.top ?? 0,
                left: menuPos?.left ?? 0,
                visibility: menuPos ? "visible" : "hidden",
                pointerEvents: menuPos ? "auto" : "none",
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-brand-50 hover:text-ink"
                onClick={() => {
                  setMenuOpen(false);
                  onTogglePin();
                }}
              >
                <Pin className="h-4 w-4 shrink-0 text-brand-500" aria-hidden />
                {pinned ? "取消置顶聊天" : "置顶聊天"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-brand-50 hover:text-ink"
                onClick={() => {
                  setMenuOpen(false);
                  onRename();
                }}
              >
                <Pencil className="h-4 w-4 shrink-0 text-brand-500" aria-hidden />
                重命名
              </button>
              <div className="my-1 h-px bg-slate-100" />
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-danger transition hover:bg-[var(--color-danger-bg)]"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4 shrink-0 text-danger" aria-hidden />
                删除
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
