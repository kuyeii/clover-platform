import type { Components, Options } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { buildMarkdownCopyChromeComponents } from "@/components/MarkdownCopyChrome";
import {
  buildMarkdownHighlightComponents,
  highlightTextInNode,
} from "@/lib/markdownHighlight";
import { normalizeLlmMarkdown } from "@/lib/normalizeMarkdown";

const assistantClass =
  "prose prose-sm max-w-none min-w-0 overflow-hidden break-words text-[15px] leading-relaxed text-ink " +
  "prose-headings:font-semibold prose-headings:text-ink prose-headings:mb-2 prose-headings:mt-3 first:prose-headings:mt-0 " +
  "prose-p:my-3 prose-p:leading-relaxed " +
  "prose-strong:font-semibold prose-strong:text-ink " +
  "prose-em:text-slate-700 " +
  "prose-ul:my-3 prose-ul:pl-5 prose-ol:my-3 prose-ol:pl-5 prose-ol:list-decimal " +
  "prose-li:my-2 prose-li:pl-1 prose-li:marker:text-slate-400 " +
  "prose-blockquote:border-l-brand-500 prose-blockquote:text-slate-700 " +
  "prose-code:rounded-md prose-code:bg-brand-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none " +
  /* 围栏块为 <pre><code>；勿对内部 code 再用行内 code 的 padding/背景，否则会与 prose-pre 的 padding 叠成「行首多一截空白」 */
  "[&_pre_code]:m-0 [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:shadow-none " +
  "prose-pre:bg-slate-100 prose-pre:text-slate-800 prose-pre:rounded-xl prose-pre:px-3 prose-pre:py-2 " +
  "prose-hr:border-slate-200 " +
  "prose-a:text-brand-600 prose-a:underline prose-a:decoration-brand-500/50 " +
  "prose-table:text-sm prose-table:border-collapse " +
  "prose-th:border prose-th:border-slate-200 prose-th:px-3 prose-th:py-2.5 prose-th:align-top " +
  "prose-td:border prose-td:border-slate-200 prose-td:px-3 prose-td:py-2.5 prose-td:align-top " +
  "[&_.katex-display]:my-4 [&_.katex-display]:block [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto " +
  "[&_.katex]:max-w-full [&_.katex]:text-ink";

const userClass =
  "prose prose-sm max-w-none min-w-0 overflow-hidden break-words text-[15px] leading-relaxed prose-invert " +
  "prose-headings:text-white prose-p:text-white prose-strong:text-white prose-em:text-slate-100 " +
  "prose-ul:my-3 prose-ul:pl-5 prose-ol:my-3 prose-ol:pl-5 prose-ol:list-decimal prose-li:my-2 " +
  "prose-li:marker:text-slate-400 prose-li:text-white " +
  "prose-blockquote:border-white/40 prose-blockquote:text-slate-200 " +
  "prose-code:rounded-md prose-code:bg-white/15 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:before:content-none prose-code:after:content-none " +
  "[&_pre_code]:m-0 [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:shadow-none " +
  "prose-pre:bg-black/25 prose-pre:text-slate-100 prose-pre:rounded-xl prose-pre:px-3 prose-pre:py-2 " +
  "prose-a:text-sky-300 prose-a:underline prose-a:decoration-sky-300/50 " +
  "prose-table:text-sm prose-table:border-collapse " +
  "prose-th:border prose-th:border-white/25 prose-th:px-3 prose-th:py-2.5 prose-th:align-top " +
  "prose-td:border prose-td:border-white/25 prose-td:px-3 prose-td:py-2.5 prose-td:align-top " +
  "[&_.katex-display]:my-4 [&_.katex-display]:block [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto " +
  "[&_.katex]:max-w-full";

type Props = {
  content: string;
  variant: "assistant" | "user";
  /** 非空时对正文做不区分大小写的子串高亮（与侧栏搜索一致） */
  highlightQuery?: string;
  /** 点击代码块/表格「复制」时回调（如 Toast） */
  onCopied?: () => void;
};

export function MarkdownBubble({
  content,
  variant,
  highlightQuery,
  onCopied,
}: Props) {
  if (!content.trim()) {
    return null;
  }

  const markdown = normalizeLlmMarkdown(content);
  const hl = buildMarkdownHighlightComponents(variant, highlightQuery);
  const copyChrome = buildMarkdownCopyChromeComponents({ variant, onCopied });
  const q = highlightQuery?.trim();

  const components: Components = {
    ...hl,
    ...copyChrome,
    a: ({ href, children, ...props }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {q ? highlightTextInNode(children, q, variant) : children}
      </a>
    ),
  };

  const remarkPlugins = [remarkGfm, remarkMath];
  const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [
    [
      rehypeKatex,
      {
        throwOnError: false,
        strict: false,
        trust: true,
      },
    ],
  ];

  return (
    <div className={variant === "user" ? userClass : assistantClass}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
