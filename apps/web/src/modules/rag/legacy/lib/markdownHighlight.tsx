import {
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import { splitTextBySearchQuery } from "@/lib/searchText";

function markClassForVariant(variant: "assistant" | "user"): string {
  return variant === "user"
    ? "rounded-sm bg-[var(--color-warning-bg)] px-0.5 font-medium text-neutral-900"
    : "rounded-sm bg-[var(--color-warning-bg)] px-0.5 font-medium text-neutral-900";
}

function splitToMarks(text: string, query: string, variant: "assistant" | "user"): ReactNode {
  const parts = splitTextBySearchQuery(text, query);
  return parts.map((p, i) =>
    p.match ? (
      <mark key={i} className={markClassForVariant(variant)}>
        {p.segment}
      </mark>
    ) : (
      <Fragment key={i}>{p.segment}</Fragment>
    ),
  );
}

/** KaTeX 根节点 class 含 `katex` / `katex-*`；搜索高亮不得改写其子树。 */
function isKatexRootElement(node: ReactElement<{ className?: string }>): boolean {
  const cn = node.props.className;
  if (typeof cn !== "string") return false;
  return cn.split(/\s+/).some((c) => c === "katex" || c.startsWith("katex-"));
}

/**
 * 在 React 节点树中递归为纯文本叶子加上与 query 匹配的高亮（不区分大小写）。
 * `pre` 整块不处理，避免破坏代码块展示。
 */
export function highlightTextInNode(
  node: ReactNode,
  query: string,
  variant: "assistant" | "user",
  insidePre = false,
): ReactNode {
  const q = query.trim();
  if (!q) return node;

  if (insidePre) {
    return node;
  }

  if (typeof node === "string") {
    return splitToMarks(node, q, variant);
  }
  if (typeof node === "number") {
    return splitToMarks(String(node), q, variant);
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <Fragment key={i}>{highlightTextInNode(child, q, variant, insidePre)}</Fragment>
    ));
  }
  if (!isValidElement(node)) {
    return node;
  }

  const el = node as ReactElement<{ children?: ReactNode; className?: string }>;
  const tag = typeof el.type === "string" ? el.type : "";

  if (isKatexRootElement(el)) {
    return el;
  }

  if (tag === "br" || tag === "pre") {
    return el;
  }

  const child = el.props.children;
  if (child === undefined || child === null) {
    return el;
  }
  return cloneElement(el, {
    ...el.props,
    children: highlightTextInNode(child, q, variant, insidePre),
  });
}

/**
 * 对「会承载文本」的块/行内标签加一层遍历；列表/表格结构本身不包，避免重复处理，
 * 由 li、td、th、p 等接住文本。
 */
const HIGHLIGHT_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "td",
  "th",
  "blockquote",
  "strong",
  "em",
  "del",
  "span",
  "sub",
  "sup",
] as const;

export function buildMarkdownHighlightComponents(
  variant: "assistant" | "user",
  query: string | undefined,
): Components {
  const q = query?.trim();
  if (!q) {
    return {};
  }

  const wrap = (Tag: (typeof HIGHLIGHT_TAGS)[number]) => {
    const Comp = (props: { children?: ReactNode; node?: unknown }) => {
      const { children, node: _node, ...rest } = props;
      return (
        <Tag {...(rest as object)}>
          {highlightTextInNode(children, q, variant)}
        </Tag>
      );
    };
    return Comp;
  };

  const components: Components = {};

  for (const tag of HIGHLIGHT_TAGS) {
    (components as Record<string, Components[keyof Components]>)[tag] = wrap(
      tag,
    ) as Components[keyof Components];
  }

  /** 围栏 `pre` 由 MarkdownBubble 的复制条组件提供，此处不覆盖。 */

  /** 围栏代码块内保持字面量；行内 code 才做文本高亮 */
  (components as Record<string, Components[keyof Components]>)["code"] = (props: {
    className?: string;
    children?: ReactNode;
    node?: unknown;
  }) => {
    const isFencedBlock =
      typeof props.className === "string" &&
      props.className.split(/\s+/).some((c) => c.startsWith("language-"));
    const { children, node: _node, ...rest } = props;
    if (isFencedBlock) {
      return <code {...rest}>{children}</code>;
    }
    return (
      <code {...rest}>
        {highlightTextInNode(children, q, variant)}
      </code>
    );
  };

  return components;
}
