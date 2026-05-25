import { Code2, Copy } from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";

import { languageLabelFromCodeClassName } from "@/lib/markdownFenceLanguageLabel";
import { reactNodeToPlainText, tableReactNodeToTsv } from "@/lib/reactNodeToPlainText";

type Variant = "assistant" | "user";

type FactoryOpts = {
  variant: Variant;
  onCopied?: () => void;
};

function shellClass(variant: Variant): string {
  return variant === "assistant"
    ? "overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100/90 shadow-sm"
    : "overflow-hidden rounded-xl border border-white/20 bg-black/25 shadow-sm";
}

function headerClass(variant: Variant): string {
  return variant === "assistant"
    ? "flex items-center justify-between gap-2 border-b border-slate-200/80 bg-brand-50 px-3 py-2"
    : "flex items-center justify-between gap-2 border-b border-white/15 bg-white/10 px-3 py-2";
}

function headerLeftClass(variant: Variant): string {
  return variant === "assistant"
    ? "flex min-h-[28px] min-w-0 flex-1 items-center gap-2 text-xs font-medium text-slate-600"
    : "flex min-h-[28px] min-w-0 flex-1 items-center gap-2 text-xs font-medium text-slate-200";
}

function copyBtnClass(variant: Variant): string {
  return variant === "assistant"
    ? "rounded-md p-1.5 text-slate-600 transition hover:bg-brand-100/70 hover:text-ink"
    : "rounded-md p-1.5 text-slate-200 transition hover:bg-white/15 hover:text-white";
}

function preBodyClass(variant: Variant): string {
  return variant === "assistant"
    ? "m-0 overflow-x-hidden rounded-none border-0 bg-slate-100 px-3 py-3 font-mono text-[13px] leading-relaxed text-slate-800"
    : "m-0 overflow-x-hidden rounded-none border-0 bg-black/35 px-3 py-3 font-mono text-[13px] leading-relaxed text-slate-100";
}

function tableShellClass(variant: Variant): string {
  return shellClass(variant);
}

function tableBodyWrapClass(variant: Variant): string {
  return variant === "assistant" ? "overflow-x-hidden bg-white/60" : "overflow-x-hidden bg-black/20";
}

function tableClass(variant: Variant): string {
  const cellsA =
    "[&_th]:border [&_th]:border-slate-300 [&_th]:px-3 [&_th]:py-2.5 [&_th]:align-top [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top";
  const cellsU =
    "[&_th]:border [&_th]:border-white/25 [&_th]:px-3 [&_th]:py-2.5 [&_th]:align-top [&_td]:border [&_td]:border-white/25 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top";
  return variant === "assistant"
    ? `w-full min-w-0 table-fixed border-collapse text-sm text-ink [&_td]:break-words [&_th]:break-words ${cellsA}`
    : `w-full min-w-0 table-fixed border-collapse text-sm text-slate-100 [&_td]:break-words [&_th]:break-words ${cellsU}`;
}

function normalizePreChild(children: ReactNode): ReactElement<{ className?: string; children?: ReactNode }> | null {
  const only = Children.toArray(children).filter((c) => c != null);
  if (only.length !== 1 || !isValidElement(only[0])) return null;
  const el = only[0] as ReactElement<{ className?: string; children?: ReactNode }>;
  if (typeof el.type === "string" && el.type === "code") return el;
  return null;
}

async function writeClipboard(text: string, onCopied?: () => void) {
  try {
    await navigator.clipboard.writeText(text);
    onCopied?.();
  } catch {
    /* ignore */
  }
}

export function buildMarkdownCopyChromeComponents(opts: FactoryOpts): Pick<Components, "pre" | "table"> {
  const { variant, onCopied } = opts;

  const Pre: Components["pre"] = ({ children, node: _node, className, ...rest }) => {
    const codeEl = normalizePreChild(children);
    const label = codeEl ? languageLabelFromCodeClassName(codeEl.props.className) : null;
    const copySource = codeEl
      ? reactNodeToPlainText(codeEl.props.children)
      : reactNodeToPlainText(children);

    const preInner = codeEl ? (
      cloneElement(codeEl, {
        ...codeEl.props,
        className: [codeEl.props.className, "block min-w-0 whitespace-pre-wrap break-words"].filter(Boolean).join(" "),
      })
    ) : (
      children
    );

    return (
      <div className={`not-prose my-4 ${shellClass(variant)}`}>
        <div className={headerClass(variant)}>
          <div className={headerLeftClass(variant)}>
            {label ? (
              <>
                <Code2 className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                <span className="truncate">{label}</span>
              </>
            ) : null}
          </div>
          <span className="group/mcopy relative inline-flex shrink-0">
            <button
              type="button"
              className={copyBtnClass(variant)}
              aria-label="复制此代码块"
              onClick={() => void writeClipboard(copySource, onCopied)}
            >
              <Copy className="h-4 w-4" />
            </button>
            <span
              role="tooltip"
              className={
                variant === "assistant"
                  ? "pointer-events-none absolute right-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover/mcopy:opacity-100"
                  : "pointer-events-none absolute right-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink opacity-0 shadow-md transition-opacity duration-150 group-hover/mcopy:opacity-100"
              }
            >
              复制
            </span>
          </span>
        </div>
        <pre {...rest} className={`${preBodyClass(variant)} ${className ?? ""}`.trim()}>
          {preInner}
        </pre>
      </div>
    );
  };

  const Table: Components["table"] = ({ children, node: _node, className, ...rest }) => {
    const tsv = tableReactNodeToTsv(children);
    return (
      <div className={`not-prose my-4 ${tableShellClass(variant)}`}>
        <div className={headerClass(variant)}>
          <div className={headerLeftClass(variant)}>
            <span className="truncate">表格</span>
          </div>
          <span className="group/tcopy relative inline-flex shrink-0">
            <button
              type="button"
              className={copyBtnClass(variant)}
              aria-label="复制表格（TSV）"
              onClick={() => void writeClipboard(tsv, onCopied)}
            >
              <Copy className="h-4 w-4" />
            </button>
            <span
              role="tooltip"
              className={
                variant === "assistant"
                  ? "pointer-events-none absolute right-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover/tcopy:opacity-100"
                  : "pointer-events-none absolute right-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink opacity-0 shadow-md transition-opacity duration-150 group-hover/tcopy:opacity-100"
              }
            >
              复制
            </span>
          </span>
        </div>
        <div className={tableBodyWrapClass(variant)}>
          <table {...rest} className={`${tableClass(variant)} ${className ?? ""}`.trim()}>
            {children}
          </table>
        </div>
      </div>
    );
  };

  return { pre: Pre, table: Table };
}
