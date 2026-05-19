/**
 * 缓解 LLM 输出与 CommonMark 不兼容的常见写法（例如「**标题 **」导致无法识别加粗），
 * 不改变 ``` fenced code ``` 围栏内的字面量。
 */

const FENCED_CODE_BLOCK = /```[\t ]*[^\r\n]*(?:\r?\n)([\s\S]*?)```/g;

export function mapOutsideFencedCodeBlocks(
  source: string,
  transform: (chunk: string) => string,
): string {
  let out = "";
  let last = 0;
  FENCED_CODE_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCED_CODE_BLOCK.exec(source)) !== null) {
    out += transform(source.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }
  out += transform(source.slice(last));
  return out;
}

/** 配对分隔符内部 trim，修复 ** foo ** → **foo**（CommonMark 对闭合前有空白时不认 strong） */
export function normalizePairedDelimiter(text: string, delimiter: string): string {
  const len = delimiter.length;
  let result = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(delimiter, i);
    if (start === -1) {
      result += text.slice(i);
      break;
    }
    result += text.slice(i, start);
    const end = text.indexOf(delimiter, start + len);
    if (end === -1) {
      result += text.slice(start);
      break;
    }
    const inner = text.slice(start + len, end).trim();
    result += `${delimiter}${inner}${delimiter}`;
    i = end + len;
  }
  return result;
}

/** 标题行行末多余空格：### 标题··· */
export function trimHeadingLineEnds(text: string): string {
  return text.replace(/^([#]{1,6}\s+)(.+)$/gm, (_, hashes: string, title: string) => `${hashes}${title.trimEnd()}`);
}

/**
 * 行首全角序号「1、」「2、」「1．」等无法被 CommonMark 识别为有序列表，
 * 与 Dify / 常见中文 LLM 输出对齐为「1. 」。
 */
export function normalizeOrderedListMarkers(text: string): string {
  return text.replace(/^(\s*)(\d{1,3})[、．](?=\s)/gm, "$1$2. ");
}

/**
 * 少数接口把换行以字面量「\\n」塞进字符串（非 JSON 转义后的真实换行），
 * 在围栏外替换为真实换行。
 */
export function unescapeLiteralNewlines(text: string): string {
  if (!text.includes("\\n") && !text.includes("\\r")) {
    return text;
  }
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
}

/** LLM / 部分接口使用 Unicode 行/段分隔符，统一成 \\n 便于后续处理 */
export function normalizeUnicodeLineSeparators(text: string): string {
  return text
    .replace(/\u2028/g, "\n")
    .replace(/\u2029/g, "\n")
    .replace(/\u0085/g, "\n");
}

/** CommonMark 有序列表行：1. / 2. 后至少一个空白 */
function isMarkdownOrderedItemLine(line: string): boolean {
  return /^\s{0,3}\d{1,3}\.\s+/.test(line);
}

function isMarkdownUnorderedItemLine(line: string): boolean {
  return /^\s{0,3}[-*+]\s+/.test(line);
}

/** 相邻两行均为同级有序/无序列表项时，中间保持普通换行（供解析器识别为新条目） */
function areSiblingListItems(curr: string, next: string): boolean {
  if (isMarkdownOrderedItemLine(curr) && isMarkdownOrderedItemLine(next)) {
    return true;
  }
  if (
    isMarkdownUnorderedItemLine(curr) &&
    isMarkdownUnorderedItemLine(next)
  ) {
    return true;
  }
  return false;
}

/**
 * 统一规则：在「由空行划分的段落块」内部，将单行换行全部变成 Markdown 硬换行（行末两空格），
 * 从而在 react-markdown 中稳定渲染为换行；不针对「参考知识库」等片段特殊判断。
 * 相邻的 `1. …` / `2. …`（及 `- …`）之间不插入硬换行，以免破坏有序/无序列表。
 */
export function newlinesToMarkdownHardBreaks(text: string): string {
  const normalized = normalizeUnicodeLineSeparators(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\n+/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.length <= 1) {
        return lines[0] ?? "";
      }
      const pieces: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === lines.length - 1) {
          pieces.push(line);
          break;
        }
        const next = lines[i + 1];
        if (areSiblingListItems(line, next)) {
          pieces.push(line);
        } else {
          /**
           * CommonMark 硬换行只认行末 **ASCII 空格**；不能用 /\\s{2,}$/ 跳过追加，
           * 否则行尾「全角空格」等会被 \\s 匹配却不被解析器当作硬换行，导致正文单换行全部丢失。
           */
          pieces.push(`${line.trimEnd()}  `);
        }
      }
      return pieces.join("\n");
    })
    .join("\n\n");
}

/** 单行内 **…** … **…**：若模型在行末混用但未换行配对，尽量不破坏段落 */
export function normalizeLlmMarkdown(source: string): string {
  return mapOutsideFencedCodeBlocks(source, (chunk) => {
    let t = normalizeUnicodeLineSeparators(unescapeLiteralNewlines(chunk));
    t = normalizeOrderedListMarkers(t);
    t = normalizePairedDelimiter(t, "**");
    t = normalizePairedDelimiter(t, "__");
    t = trimHeadingLineEnds(t);
    t = newlinesToMarkdownHardBreaks(t);
    return t;
  });
}
