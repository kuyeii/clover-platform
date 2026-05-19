import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

/** 将 React 节点树展平为纯文本（用于剪贴板），`br` 对应换行。 */
export function reactNodeToPlainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToPlainText).join("");
  if (!isValidElement(node)) return "";

  const tag = typeof node.type === "string" ? node.type : "";
  if (tag === "br") return "\n";

  const props = node.props as { children?: ReactNode };
  return reactNodeToPlainText(props.children);
}

/** Markdown 表格子树 → TSV（制表符分列）。 */
export function tableReactNodeToTsv(node: ReactNode): string {
  const rows: string[][] = [];

  const collectRow = (tr: ReactElement<{ children?: ReactNode }>) => {
    const cells: string[] = [];
    Children.forEach(tr.props.children, (cell) => {
      if (!isValidElement(cell)) return;
      const ct = typeof cell.type === "string" ? cell.type : "";
      if (ct !== "th" && ct !== "td") return;
      const cellProps = cell.props as { children?: ReactNode };
      const raw = reactNodeToPlainText(cellProps.children)
        .replace(/\r\n/g, "\n")
        .replace(/\n/g, " ")
        .replace(/\t/g, " ")
        .trim();
      cells.push(raw);
    });
    if (cells.length > 0) rows.push(cells);
  };

  const walk = (n: ReactNode) => {
    if (n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (!isValidElement(n)) return;
    const tag = typeof n.type === "string" ? n.type : "";
    if (tag === "tr") {
      collectRow(n as ReactElement<{ children?: ReactNode }>);
      return;
    }
    const props = n.props as { children?: ReactNode };
    walk(props.children);
  };

  walk(node);
  return rows.map((r) => r.join("\t")).join("\n");
}
