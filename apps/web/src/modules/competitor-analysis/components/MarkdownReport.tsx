import { renderInlineMarkdown } from "../utils";

type Block =
  | { type: "h1" | "h2" | "h3" | "p"; text: string }
  | { type: "hr" }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

function normalizeMarkdownText(value: string) {
  const withoutFences = String(value || "")
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  return withoutFences.includes("\n") ? withoutFences : withoutFences.replace(/\\n/g, "\n");
}

function parseMarkdownTableRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return false;
  }
  const normalized = trimmed.replace(/\|/g, "").replace(/:/g, "").replace(/-/g, "").trim();
  return normalized.length === 0 && trimmed.includes("-");
}

function parseBlocks(text: string): Block[] {
  const lines = normalizeMarkdownText(text).replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (/^-{3,}$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push({ type: "h1", text: trimmed.slice(2) });
      index += 1;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", text: trimmed.slice(3) });
      index += 1;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "h3", text: trimmed.slice(4) });
      index += 1;
      continue;
    }
    if (trimmed.includes("|") && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      const header = parseMarkdownTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(parseMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (/^[-*]\s+/.test(trimmed) || /^\d+[.)、]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)、]\s+/.test(trimmed);
      const pattern = ordered ? /^\d+[.)、]\s+/ : /^[-*]\s+/;
      const items: string[] = [];
      while (index < lines.length && pattern.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(pattern, ""));
        index += 1;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    const paragraph = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || next.startsWith("#") || /^[-*]\s+/.test(next) || /^\d+[.)、]\s+/.test(next)) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  return blocks;
}

export function MarkdownReport({ text }: { text?: string }) {
  const blocks = parseBlocks(text || "");
  if (!blocks.length) {
    return <p className="muted-text">暂无报告内容。</p>;
  }

  return (
    <div className="markdown-report">
      {blocks.map((block, index) => {
        if (block.type === "h1") return <h2 key={index}>{renderInlineMarkdown(block.text)}</h2>;
        if (block.type === "h2") return <h3 key={index}>{renderInlineMarkdown(block.text)}</h3>;
        if (block.type === "h3") return <h4 key={index}>{renderInlineMarkdown(block.text)}</h4>;
        if (block.type === "hr") return <hr key={index} />;
        if (block.type === "ul" || block.type === "ol") {
          const List = block.type;
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}
            </List>
          );
        }
        if (block.type === "table") {
          return (
            <div key={index} className="table-wrap">
              <table>
                <thead>
                  <tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{renderInlineMarkdown(cell)}</th>)}</tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInlineMarkdown(cell)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === "p") {
          return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
        }
        return null;
      })}
    </div>
  );
}
