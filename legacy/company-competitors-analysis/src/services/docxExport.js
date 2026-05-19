const WORD_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const CORE_REL_TYPE = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const APP_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties";
const HYPERLINK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

const PAGE_CONTENT_WIDTH_DXA = 9072;
const DEFAULT_FONT = "Microsoft YaHei";
const ASCII_FONT = "Arial";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeMarkdownText(value) {
  const withoutFences = String(value || "")
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  return withoutFences.includes("\n") ? withoutFences : withoutFences.replace(/\\n/g, "\n");
}

function hasUnescapedTrailingPipe(value) {
  let slashCount = 0;
  for (let index = value.length - 2; index >= 0 && value[index] === "\\"; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 0;
}

function parseMarkdownTableRow(line) {
  let cleaned = String(line || "").trim();
  if (cleaned.startsWith("|")) cleaned = cleaned.slice(1);
  if (cleaned.endsWith("|") && hasUnescapedTrailingPipe(cleaned)) cleaned = cleaned.slice(0, -1);

  const cells = [];
  let current = "";
  let escaped = false;

  for (const char of cleaned) {
    if (escaped) {
      current += char === "|" ? "|" : `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

function isMarkdownTableSeparator(line) {
  const cells = parseMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseMarkdownTableAlignments(separatorLine, columnCount) {
  const cells = parseMarkdownTableRow(separatorLine);
  return Array.from({ length: columnCount }, (_, index) => {
    const cell = String(cells[index] || "").trim();
    if (cell.startsWith(":" ) && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });
}

function normalizeTableRows(header, rows) {
  const columnCount = Math.max(
    1,
    header.length,
    ...rows.map((row) => row.length)
  );
  const pad = (row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
  return {
    columnCount,
    header: pad(header),
    rows: rows.map(pad)
  };
}

export function parseMarkdownBlocks(markdownText) {
  const lines = normalizeMarkdownText(markdownText).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
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
      const separatorLine = lines[index + 1];
      index += 2;
      const rows = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (!current || !current.includes("|") || isMarkdownTableSeparator(current)) break;
        rows.push(parseMarkdownTableRow(current));
        index += 1;
      }
      const normalized = normalizeTableRows(header, rows);
      blocks.push({
        type: "table",
        header: normalized.header,
        rows: normalized.rows,
        aligns: parseMarkdownTableAlignments(separatorLine, normalized.columnCount),
        columnCount: normalized.columnCount
      });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+[.)、]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)、]\s+/.test(trimmed);
      const itemPattern = ordered ? /^\d+[.)、]\s+/ : /^[-*]\s+/;
      const items = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (itemPattern.test(current)) {
          items.push(current.replace(itemPattern, ""));
          index += 1;
          continue;
        }
        if (!current) {
          const nextListLineIndex = lines.findIndex((candidate, candidateIndex) => (
            candidateIndex > index && candidate.trim()
          ));
          if (nextListLineIndex !== -1 && itemPattern.test(lines[nextListLineIndex].trim())) {
            index = nextListLineIndex;
            continue;
          }
        }
        break;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }

    const paragraph = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (
        !next ||
        next.startsWith("#") ||
        /^-{3,}$/.test(next) ||
        /^[-*]\s+/.test(next) ||
        /^\d+[.)、]\s+/.test(next) ||
        (next.includes("|") && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1]))
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: "p", text: paragraph.join("\n") });
  }

  return blocks;
}

function buildRunProperties(options = {}) {
  const props = [
    `<w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${DEFAULT_FONT}"/>`
  ];
  if (options.bold) props.push("<w:b/>");
  if (options.italic) props.push("<w:i/>");
  if (options.code) {
    props.push('<w:color w:val="1F3A72"/>');
    props.push('<w:shd w:fill="EDF4FF"/>');
  } else if (options.color) {
    props.push(`<w:color w:val="${options.color}"/>`);
  }
  if (options.underline) props.push('<w:u w:val="single"/>');
  props.push(`<w:sz w:val="${options.size || 22}"/>`);
  props.push(`<w:szCs w:val="${options.size || 22}"/>`);
  return `<w:rPr>${props.join("")}</w:rPr>`;
}

function textRun(text, options = {}) {
  if (text === "") return "";
  return `<w:r>${buildRunProperties(options)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function breakRun() {
  return `<w:r>${buildRunProperties()}<w:br/></w:r>`;
}

function tokenizeInlineMarkdown(value) {
  const source = String(value ?? "").replace(/<br\s*\/?\s*>/gi, "\n");
  const tokens = [];
  const tokenPattern = /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|\n/g;
  let cursor = 0;
  let match = tokenPattern.exec(source);

  while (match) {
    if (match.index > cursor) {
      tokens.push({ type: "text", text: source.slice(cursor, match.index) });
    }
    if (match[2]) {
      tokens.push({ type: "text", text: match[2], bold: true });
    } else if (match[4]) {
      tokens.push({ type: "text", text: match[4], bold: true });
    } else if (match[6]) {
      tokens.push({ type: "text", text: match[6], code: true });
    } else if (match[8] && match[9]) {
      tokens.push({ type: "link", text: match[8], href: match[9] });
    } else {
      tokens.push({ type: "break" });
    }
    cursor = tokenPattern.lastIndex;
    match = tokenPattern.exec(source);
  }

  if (cursor < source.length) {
    tokens.push({ type: "text", text: source.slice(cursor) });
  }

  return tokens.length ? tokens : [{ type: "text", text: source }];
}

function inlineMarkdownToRuns(value, context, options = {}) {
  return tokenizeInlineMarkdown(value).map((token) => {
    if (token.type === "break") return breakRun();
    if (token.type === "link") {
      const relationshipId = context.addHyperlink(token.href);
      return `<w:hyperlink r:id="${relationshipId}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${DEFAULT_FONT}"/><w:sz w:val="${options.size || 22}"/><w:szCs w:val="${options.size || 22}"/></w:rPr><w:t xml:space="preserve">${escapeXml(token.text)}</w:t></w:r></w:hyperlink>`;
    }
    return textRun(token.text, {
      ...options,
      bold: options.bold || token.bold,
      code: token.code
    });
  }).join("");
}

function paragraphXml(text, context, options = {}) {
  const pPr = [];
  if (options.style) pPr.push(`<w:pStyle w:val="${options.style}"/>`);
  if (options.align) pPr.push(`<w:jc w:val="${options.align}"/>`);
  if (options.spacing !== false) {
    pPr.push(`<w:spacing w:before="${options.before ?? 80}" w:after="${options.after ?? 80}" w:line="${options.line ?? 360}" w:lineRule="auto"/>`);
  }
  if (options.indent) pPr.push(`<w:ind w:left="${options.indent}" w:hanging="${options.hanging || 0}"/>`);

  const runs = inlineMarkdownToRuns(text, context, options);
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : ""}${runs || textRun(" ", options)}</w:p>`;
}

function horizontalRuleXml() {
  return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="E5EDF9"/></w:pBdr><w:spacing w:before="80" w:after="80"/></w:pPr></w:p>';
}

function tableCellXml(cellText, context, options = {}) {
  const width = Math.max(900, Math.floor(PAGE_CONTENT_WIDTH_DXA / Math.max(1, options.columnCount || 1)));
  const shading = options.header ? '<w:shd w:fill="EDF4FF"/>' : "";
  const paragraphs = String(cellText || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .split(/\n+/)
    .map((part) => paragraphXml(part || " ", context, {
      align: options.align === "right" ? "right" : options.align === "center" ? "center" : "left",
      bold: options.header,
      size: 19,
      before: 0,
      after: 0,
      line: 300,
      spacing: true
    }))
    .join("");

  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcMar><w:top w:w="120" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar><w:vAlign w:val="top"/>${shading}</w:tcPr>${paragraphs}</w:tc>`;
}

function tableRowXml(cells, context, options = {}) {
  const headerProps = options.header ? '<w:trPr><w:tblHeader/></w:trPr>' : "";
  return `<w:tr>${headerProps}${cells.map((cell, index) => tableCellXml(cell, context, {
    header: options.header,
    align: options.aligns?.[index] || "left",
    columnCount: options.columnCount
  })).join("")}</w:tr>`;
}

function tableXml(block, context) {
  const columnCount = Math.max(1, block.columnCount || block.header.length || 1);
  const columnWidth = Math.floor(PAGE_CONTENT_WIDTH_DXA / columnCount);
  const grid = Array.from({ length: columnCount }, () => `<w:gridCol w:w="${columnWidth}"/>`).join("");
  const rows = [
    tableRowXml(block.header, context, { header: true, aligns: block.aligns, columnCount }),
    ...block.rows.map((row) => tableRowXml(row, context, { aligns: block.aligns, columnCount }))
  ].join("");

  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="D6E2F3"/><w:left w:val="single" w:sz="6" w:space="0" w:color="D6E2F3"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="D6E2F3"/><w:right w:val="single" w:sz="6" w:space="0" w:color="D6E2F3"/><w:insideH w:val="single" w:sz="6" w:space="0" w:color="E5EDF9"/><w:insideV w:val="single" w:sz="6" w:space="0" w:color="E5EDF9"/></w:tblBorders><w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

function blocksToDocumentBody(blocks, context) {
  return blocks.map((block) => {
    if (block.type === "h1") return paragraphXml(block.text, context, { style: "Heading1", size: 32, bold: true, before: 240, after: 120, line: 360 });
    if (block.type === "h2") return paragraphXml(block.text, context, { style: "Heading2", size: 28, bold: true, before: 220, after: 100, line: 360 });
    if (block.type === "h3") return paragraphXml(block.text, context, { style: "Heading3", size: 24, bold: true, before: 180, after: 80, line: 340 });
    if (block.type === "hr") return horizontalRuleXml();
    if (block.type === "table") return tableXml(block, context);
    if (block.type === "ul") {
      return block.items.map((item) => paragraphXml(`• ${item}`, context, { indent: 420, hanging: 260, before: 40, after: 40, line: 330 })).join("");
    }
    if (block.type === "ol") {
      return block.items.map((item, index) => paragraphXml(`${index + 1}. ${item}`, context, { indent: 500, hanging: 320, before: 40, after: 40, line: 330 })).join("");
    }
    return paragraphXml(block.text, context, { before: 60, after: 60, line: 350 });
  }).join("");
}

function createBuildContext() {
  const hyperlinkRelationships = [];
  return {
    addHyperlink(href) {
      const id = `rId${hyperlinkRelationships.length + 1}`;
      hyperlinkRelationships.push({ id, href: String(href || "") });
      return id;
    },
    getHyperlinkRelationships() {
      return hyperlinkRelationships;
    }
  };
}

function buildDocumentXml(blocks, context) {
  const body = blocksToDocumentBody(blocks, context);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="${REL_NS}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="${WORD_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1417" w:bottom="1440" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="312"/></w:sectPr></w:body></w:document>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="${REL_NS}" xmlns:w="${WORD_NS}" mc:Ignorable="w14"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${DEFAULT_FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${DEFAULT_FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:uiPriority w:val="9"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${DEFAULT_FONT}"/><w:b/><w:color w:val="1F3A72"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:uiPriority w:val="9"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${DEFAULT_FONT}"/><w:b/><w:color w:val="1F3A72"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:uiPriority w:val="9"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${DEFAULT_FONT}"/><w:b/><w:color w:val="1F3A72"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="1762D7"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D6E2F3"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D6E2F3"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D6E2F3"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D6E2F3"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E5EDF9"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="E5EDF9"/></w:tblBorders></w:tblPr></w:style></w:styles>`;
}

function buildRelationshipsXml(relationships) {
  const linkRelationships = relationships.map((relationship) => (
    `<Relationship Id="${escapeXml(relationship.id)}" Type="${HYPERLINK_REL_TYPE}" Target="${escapeXml(relationship.href)}" TargetMode="External"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rFontTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>${linkRelationships}</Relationships>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function buildRootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${DOC_REL_TYPE}" Target="word/document.xml"/><Relationship Id="rId2" Type="${CORE_REL_TYPE}" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${APP_REL_TYPE}" Target="docProps/app.xml"/></Relationships>`;
}

function buildSettingsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${WORD_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="doNotCompress"/></w:settings>`;
}

function buildFontTableXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="${WORD_NS}"><w:font w:name="${DEFAULT_FONT}"><w:charset w:val="86"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="${ASCII_FONT}"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font></w:fonts>`;
}

function buildCoreXml(title) {
  const created = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title || "竞争分析报告")}</dc:title><dc:creator>竞争分析系统</dc:creator><cp:lastModifiedBy>竞争分析系统</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
}

function buildAppXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>竞争分析系统</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    c = crcTable[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function encodeText(value) {
  return new TextEncoder().encode(String(value));
}

function writeUint16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function getDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = getDosDateTime();

  files.forEach((file) => {
    const nameBytes = encodeText(file.path);
    const dataBytes = file.data instanceof Uint8Array ? file.data : encodeText(file.data);
    const fileCrc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, 0);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, dosTime);
    writeUint16(localHeader, 12, dosDate);
    writeUint32(localHeader, 14, fileCrc);
    writeUint32(localHeader, 18, dataBytes.length);
    writeUint32(localHeader, 22, dataBytes.length);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, dosTime);
    writeUint16(centralHeader, 14, dosDate);
    writeUint32(centralHeader, 16, fileCrc);
    writeUint32(centralHeader, 20, dataBytes.length);
    writeUint32(centralHeader, 24, dataBytes.length);
    writeUint16(centralHeader, 28, nameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  });

  const centralDirectory = concatUint8Arrays(centralParts);
  const endHeader = new Uint8Array(22);
  writeUint32(endHeader, 0, 0x06054b50);
  writeUint16(endHeader, 4, 0);
  writeUint16(endHeader, 6, 0);
  writeUint16(endHeader, 8, files.length);
  writeUint16(endHeader, 10, files.length);
  writeUint32(endHeader, 12, centralDirectory.length);
  writeUint32(endHeader, 16, offset);
  writeUint16(endHeader, 20, 0);

  return concatUint8Arrays([...localParts, centralDirectory, endHeader]);
}

export function createDocxFromMarkdown(markdownText, options = {}) {
  const blocks = parseMarkdownBlocks(markdownText);
  const context = createBuildContext();
  const documentXml = buildDocumentXml(blocks, context);
  const relationshipsXml = buildRelationshipsXml(context.getHyperlinkRelationships());

  return createZip([
    { path: "[Content_Types].xml", data: buildContentTypesXml() },
    { path: "_rels/.rels", data: buildRootRelationshipsXml() },
    { path: "docProps/core.xml", data: buildCoreXml(options.title) },
    { path: "docProps/app.xml", data: buildAppXml() },
    { path: "word/document.xml", data: documentXml },
    { path: "word/_rels/document.xml.rels", data: relationshipsXml },
    { path: "word/styles.xml", data: buildStylesXml() },
    { path: "word/settings.xml", data: buildSettingsXml() },
    { path: "word/fontTable.xml", data: buildFontTableXml() }
  ]);
}

export function downloadDocxFromMarkdown(markdownText, filename, options = {}) {
  const bytes = createDocxFromMarkdown(markdownText, options);
  const blob = new Blob([bytes], { type: WORD_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
