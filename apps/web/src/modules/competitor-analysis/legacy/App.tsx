// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./index.css";
import "./App.css";
import { getHistoryRecord, listHistory, runAnalysisStream, runCompanyNameValidationWorkflow } from "../services/competitorApi";
import { downloadDocxFromMarkdown } from "./docxExport";
import { buildResultRoute, parseAppRoute, pushHomeRoute, pushResultRoute, replaceResultRoute } from "./routes";
import {
  getValidationPendingLabel,
  getValidationStatusIconType,
  shouldShowValidationDropdown,
  shouldShowValidationPendingStatus
} from "./validationState";

const lookupCompanyNameValidationCache = runCompanyNameValidationWorkflow;

const DEFAULT_COMPETITOR_ROWS = 1;
const MAX_COMPETITOR_COUNT = 5;
const COMPANY_VALIDATION_LOCAL_DEBOUNCE_MS = 300;
const COMPANY_VALIDATION_WEB_DELAY_MS = 1200;
const COMPANY_VALIDATION_MIN_KEYWORD_LENGTH = 2;
const DEFAULT_PROVINCE = "全国";
const SAME_COMPANY_NAME_ERROR = "竞争对手名称不能与我方企业名称相同。";
const DUPLICATE_COMPETITOR_NAME_ERROR = "竞争对手名称不能重复。";

const createEmptyForm = () => ({
  targetCompanyName: "",
  targetCompanyIntro: "",
  targetCompanyBusiness: "",
  targetCompanyConfirmed: false,
  province: DEFAULT_PROVINCE,
  competitorCompanyName: ""
});

const RESULT_TABS = [
  { label: "总体信息", routeKey: "overview" },
  { label: "公司近况", routeKey: "dynamics" },
  { label: "对比分析报告", routeKey: "report" }
];
const DEFAULT_RESULT_TAB = RESULT_TABS[0].label;
const RESULT_TAB_BY_KEY = new Map(RESULT_TABS.map((tab) => [tab.routeKey, tab.label]));
const RESULT_TAB_KEY_BY_LABEL = new Map(RESULT_TABS.map((tab) => [tab.label, tab.routeKey]));
const DOCX_PAGE_BREAK_MARKER = "<!-- page-break -->";

const PROVINCES = [
  "全国",
  "北京市",
  "天津市",
  "上海市",
  "重庆市",
  "河北省",
  "山西省",
  "辽宁省",
  "吉林省",
  "黑龙江省",
  "浙江省",
  "江苏省",
  "安徽省",
  "福建省",
  "江西省",
  "广东省",
  "山东省",
  "河南省",
  "湖北省",
  "湖南省",
  "海南省",
  "四川省",
  "贵州省",
  "云南省",
  "陕西省",
  "甘肃省",
  "青海省",
  "台湾省",
  "内蒙古自治区",
  "广西壮族自治区",
  "西藏自治区",
  "宁夏回族自治区",
  "新疆维吾尔自治区",
  "香港特别行政区",
  "澳门特别行政区"
];

const COMPANY_ALIAS_PATTERN = /（([^（）]+)）|\(([^()]+)\)|【([^【】]+)】|\[([^\[\]]+)\]|「([^「」]+)」|『([^『』]+)』/g;
const COMPANY_PUNCTUATION_PATTERN = /[\s（）()【】\[\]「」『』·•.。,:：;；,，、\-＿_\/\\]/g;

function extractCompanyAliasParts(name) {
  return Array.from(String(name || "").matchAll(COMPANY_ALIAS_PATTERN))
    .map((match) => match.slice(1).find(Boolean)?.trim())
    .filter(Boolean);
}

function removeCompanyAliasParts(name) {
  return String(name || "").replace(COMPANY_ALIAS_PATTERN, "").trim();
}

function normalizeCompanyName(name) {
  return removeCompanyAliasParts(name)
    .replace(COMPANY_PUNCTUATION_PATTERN, "")
    .replace(/(有限责任公司|股份有限公司|有限公司|公司|实验室|研究院)$/g, "")
    .toLowerCase();
}

function getCompanyNameMatchKeys(name) {
  const rawName = String(name || "").trim();
  if (!rawName) return [];

  const candidates = [
    rawName,
    rawName.replace(/[（）()【】\[\]「」『』]/g, ""),
    removeCompanyAliasParts(rawName),
    ...extractCompanyAliasParts(rawName)
  ];

  const keys = new Set();
  candidates.forEach((candidate) => {
    const direct = String(candidate || "").trim();
    const normalized = normalizeCompanyName(candidate);
    if (direct) keys.add(direct);
    if (normalized) keys.add(normalized);
  });
  return Array.from(keys);
}

function buildScoreItemNameMap(scoreItems) {
  const map = new Map();
  scoreItems.forEach((item) => {
    getCompanyNameMatchKeys(item?.竞争对手企业).forEach((key) => {
      if (!map.has(key)) {
        map.set(key, item);
      }
    });
  });
  return map;
}

function getScoreItemByCompanyName(scoreByName, companyName) {
  for (const key of getCompanyNameMatchKeys(companyName)) {
    const item = scoreByName.get(key);
    if (item) return item;
  }
  return null;
}

function splitCompetitorNames(value) {
  return String(value || "")
    .split(/[,，;；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPETITOR_COUNT);
}

function shouldUseDemo(error) {
  const message = String(error?.message || error || "");
  return message.includes("未配置") || message.includes("API_KEY") || message.includes("API Key");
}

function formatDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function createPendingResultId() {
  return `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getResultTabLabel(routeKey) {
  return RESULT_TAB_BY_KEY.get(routeKey) || DEFAULT_RESULT_TAB;
}

function getResultTabRouteKey(tabLabel) {
  return RESULT_TAB_KEY_BY_LABEL.get(tabLabel) || RESULT_TAB_KEY_BY_LABEL.get(DEFAULT_RESULT_TAB);
}

function getDisplayDate(value) {
  return String(value || "").trim();
}

function NewsDate({ value }) {
  const displayDate = getDisplayDate(value);
  return (
    <time className={`news-date ${displayDate ? "" : "news-date--empty"}`.trim()}>
      {displayDate || "暂无日期"}
    </time>
  );
}

function getRecordRouteOptions(record, overrides = {}) {
  const snap = record?.stateSnapshot || {};
  const hasOverrideSelected = Object.prototype.hasOwnProperty.call(overrides, "selectedCompetitorId");
  const selectedCompetitorId = hasOverrideSelected ? overrides.selectedCompetitorId : snap.selectedCompetitorId;
  const activeTab = overrides.activeTab || snap.activeTab || DEFAULT_RESULT_TAB;

  return {
    competitorId: selectedCompetitorId || "",
    tab: getResultTabRouteKey(activeTab)
  };
}

function isRunningHistoryRecord(record) {
  const snap = record?.stateSnapshot || {};
  return record?.mode === "running" && snap.isLoading !== false;
}

function isSettledHistoryRecord(record) {
  return Boolean(record?.id) && record?.mode !== "running" && record?.mode !== "demo";
}

const RUNNING_ANALYSIS_STORAGE_KEY = "company-competitors-analysis:running-analysis";
const RUNNING_ANALYSIS_STORAGE_TTL = 24 * 60 * 60 * 1000;

function readStoredRunningAnalysis() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RUNNING_ANALYSIS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.snapshot) return null;
    if (Date.now() - Number(parsed.updatedAt || 0) > RUNNING_ANALYSIS_STORAGE_TTL) {
      window.sessionStorage.removeItem(RUNNING_ANALYSIS_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredRunningAnalysis(payload) {
  if (typeof window === "undefined" || !payload?.id) return;
  try {
    window.sessionStorage.setItem(
      RUNNING_ANALYSIS_STORAGE_KEY,
      JSON.stringify({ ...payload, updatedAt: Date.now() })
    );
  } catch {
    // Storage may be unavailable in private browsing; route state still works in memory.
  }
}

function clearStoredRunningAnalysis() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RUNNING_ANALYSIS_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function getNewsHref(item) {
  const link = String(item?.link || "").trim();
  if (/^https?:\/\//i.test(link)) return link;
  const source = String(item?.source || "").trim();
  if (/^https?:\/\//i.test(source)) return source;
  return "";
}

function stripThinkContent(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

function renderInlineMarkdown(text) {
  const raw = stripThinkContent(text).replace(/\\\*/g, "*");
  if (!raw) return "";

  const segments = [];
  const tokenPattern = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(`([^`]+)`)|(<br\s*\/?>)/gi;
  let cursor = 0;
  let key = 0;
  let match = tokenPattern.exec(raw);

  while (match) {
    if (match.index > cursor) {
      segments.push(raw.slice(cursor, match.index));
    }

    if (match[2]) {
      segments.push(<strong key={`bold-${key}`}>{match[2]}</strong>);
    } else if (match[5]) {
      segments.push(
        <a key={`link-${key}`} href={match[5]} target="_blank" rel="noreferrer">
          {match[4]}
        </a>
      );
    } else if (match[7]) {
      segments.push(<code key={`code-${key}`}>{match[7]}</code>);
    } else {
      segments.push(<br key={`br-${key}`} />);
    }

    key += 1;
    cursor = tokenPattern.lastIndex;
    match = tokenPattern.exec(raw);
  }

  if (cursor < raw.length) {
    segments.push(raw.slice(cursor));
  }

  return segments.length ? segments : raw;
}

function MarkdownReport({ text }) {
  const normalizeMarkdownText = (value) => {
    let raw = stripThinkContent(value);
    if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = raw.slice(1, -1);
      }
    }

    try {
      const parsed = JSON.parse(raw);
      raw = parsed?.markdown || parsed?.report || parsed?.text || parsed?.content || raw;
    } catch {
      const jsonMatch = raw.match(/^\s*\{[\s\S]*\}\s*$/);
      if (jsonMatch) {
        raw = raw
          .replace(/^\s*\{\s*"?(markdown|report|text|content)"?\s*:\s*"?/i, "")
          .replace(/"?\s*\}\s*$/, "");
      }
    }

    const withoutFences = String(raw || "")
      .replace(/```[a-z]*\s*/gi, "")
      .replace(/```/g, "")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, "\"")
      .replace(/\\\*/g, "*")
      .replace(/\\#/g, "#")
      .replace(/\\\|/g, "|")
      .trim();
    return withoutFences;
  };

  const parseMarkdownTableRow = (line) => {
    const cleaned = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return cleaned.split("|").map((cell) => cell.trim());
  };

  const isMarkdownTableSeparator = (line) => {
    const trimmed = line.trim();
    if (!trimmed.includes("|")) return false;
    const normalized = trimmed.replace(/\|/g, "").replace(/:/g, "").replace(/-/g, "").trim();
    return normalized.length === 0 && trimmed.includes("-");
  };

  const lines = normalizeMarkdownText(text).replace(/\r\n/g, "\n").split("\n");
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
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(parseMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
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
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  if (!blocks.length) {
    return <p className="muted-text">暂无报告内容。</p>;
  }

  return (
    <div className="markdown-report pretty-report">
      {blocks.map((block, blockIndex) => {
        if (block.type === "h1") return <h2 key={`h1-${blockIndex}`}>{renderInlineMarkdown(block.text)}</h2>;
        if (block.type === "h2") return <h3 key={`h2-${blockIndex}`}>{renderInlineMarkdown(block.text)}</h3>;
        if (block.type === "h3") return <h4 key={`h3-${blockIndex}`}>{renderInlineMarkdown(block.text)}</h4>;
        if (block.type === "hr") return <hr key={`hr-${blockIndex}`} />;
        if (block.type === "ul" || block.type === "ol") {
          const ListTag = block.type;
          return (
            <ListTag key={`list-${blockIndex}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "table") {
          return (
            <div key={`table-${blockIndex}`} className="pretty-table-wrap">
              <table className="pretty-table">
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={`th-${cellIndex}`}>{renderInlineMarkdown(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`tr-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`td-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={`p-${blockIndex}`}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

function Icon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  };

  const paths = {
    home: (
      <>
        <path d="M3.5 11.2 12 4l8.5 7.2" />
        <path d="M5.5 10.4V20h5v-5.4h3V20h5v-9.6" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 8 4.4-8 4.4-8-4.4L12 3Z" />
        <path d="m4 12 8 4.4 8-4.4" />
        <path d="m4 16.5 8 4.4 8-4.4" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="7" ry="3" />
        <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
        <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      </>
    ),
    building: (
      <>
        <path d="M5 20V5.8C5 4.8 5.8 4 6.8 4h10.4c1 0 1.8.8 1.8 1.8V20" />
        <path d="M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2M8.5 16h2M13.5 16h2" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </>
    ),
    settings: (
      <>
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1A1.7 1.7 0 0 0 4.3 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1A1.7 1.7 0 0 0 20.9 10h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20c1.4-4 4-6 7.5-6s6.1 2 7.5 6" />
      </>
    ),
    sparkle: (
      <>
        <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3Z" />
        <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
      </>
    ),
    back: <path d="M15 18 9 12l6-6" />,
    download: (
      <>
        <path d="M12 4v10" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 20h14" />
      </>
    )
  };

  return <svg className="icon" {...common}>{paths[name] || paths.sparkle}</svg>;
}

function Sidebar({ historyItems, runningItem, onNewCompare, onRestoreHistory, onOpenRunning, activeHistoryId }) {
  const renderedHistoryItems = runningItem
    ? historyItems.filter((item) => item.id !== runningItem.id)
    : historyItems;
  const historyCount = renderedHistoryItems.length + (runningItem ? 1 : 0);
  const runningMeta = runningItem?.isLoading ? "分析中" : "未完成";

  return (
    <aside className="sidebar">
      <button type="button" className="new-compare-btn" onClick={() => onNewCompare()}>
        <span className="new-compare-icon" aria-hidden />
        <span className="new-compare-label">新建对比</span>
      </button>

      <section className="history-box">
        <div className="history-title-row">
          <h3>历史记录</h3>
          <span>{historyCount}</span>
        </div>
        <div className="history-list">
          {runningItem && (
            <a
              className={`history-entry history-entry--running ${activeHistoryId === runningItem.id ? "history-entry--active" : ""}`}
              href={buildResultRoute(runningItem.id, { tab: getResultTabRouteKey(DEFAULT_RESULT_TAB) })}
              onClick={(event) => {
                event.preventDefault();
                onOpenRunning();
              }}
            >
              <strong>{runningItem.input?.targetCompanyName || "正在生成的报告"}</strong>
              <span>{runningItem.queryTime ? `${runningItem.queryTime} · ${runningMeta}` : runningMeta}</span>
            </a>
          )}
          {renderedHistoryItems.map((item) => {
            const isRunningRecord = isRunningHistoryRecord(item);
            return (
            <a
              key={item.id}
              className={`history-entry ${isRunningRecord ? "history-entry--running" : ""} ${activeHistoryId === item.id ? "history-entry--active" : ""}`}
              href={buildResultRoute(item.id, { tab: getResultTabRouteKey(DEFAULT_RESULT_TAB) })}
              onClick={(event) => {
                event.preventDefault();
                onRestoreHistory(item.id);
              }}
            >
              <strong>{item.input?.targetCompanyName || item.title || "竞争分析记录"}</strong>
              <span>{isRunningRecord ? `${item.queryTime || item.createdAt?.slice(0, 10) || "-"} · 分析中` : item.queryTime || item.createdAt?.slice(0, 10) || "-"}</span>
            </a>
            );
          })}
          {historyItems.length === 0 && !runningItem && <p className="empty-mini">暂无历史记录</p>}
        </div>
      </section>

      <div className="sidebar-user">
        <span className="sidebar-avatar" aria-hidden />
        <span>管理员</span>
      </div>
    </aside>
  );
}

function Illustration() {
  return (
    <div className="hero-illustration" aria-hidden>
      <img src="/hero-analysis-icon.png" alt="" />
    </div>
  );
}

function FieldGroup({ icon, label, hint, children, className = "" }) {
  return (
    <label className={`field-group home-field ${className}`.trim()}>
      <span className="field-title"><Icon name={icon} />{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}


function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const clean = value.replace(/```json|```/gi, "").trim();
  if (!clean) return null;
  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try {
      const parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

const COMPANY_NAME_KEYS = [
  "企业名称",
  "公司名称",
  "名称",
  "name",
  "companyName",
  "company_name",
  "targetCompanyName",
  "target_company_name"
];

const COMPANY_INTRO_KEYS = [
  "企业介绍",
  "企业简介",
  "公司介绍",
  "公司简介",
  "简介",
  "企业概况",
  "公司概况",
  "介绍",
  "intro",
  "introduction",
  "description",
  "companyIntro",
  "company_intro",
  "targetCompanyIntro",
  "target_company_intro"
];

const COMPANY_BUSINESS_KEYS = [
  "企业主营业务",
  "公司主营业务",
  "主营业务",
  "企业主要业务",
  "公司主要业务",
  "主要业务",
  "业务介绍",
  "业务范围",
  "经营范围",
  "核心业务",
  "主营产品",
  "产品服务",
  "产品与服务",
  "business",
  "mainBusiness",
  "main_business",
  "businessScope",
  "business_scope",
  "primaryBusiness",
  "companyBusiness",
  "company_business",
  "companyMainBusiness",
  "company_main_business",
  "targetCompanyBusiness",
  "target_company_business",
  "targetCompanyMainBusiness",
  "target_company_main_business"
];

function normalizeCandidateCompanyItems(value) {
  const companiesByName = new Map();
  const addCompany = (company) => {
    const normalizedCompany = typeof company === "string"
      ? { name: company.trim(), intro: "", business: "" }
      : normalizeValidationCompany(company) || {
        name: pickCompanyText(company, COMPANY_NAME_KEYS),
        intro: pickCompanyText(company, COMPANY_INTRO_KEYS),
        business: pickCompanyText(company, COMPANY_BUSINESS_KEYS)
      };
    const name = String(normalizedCompany?.name || "").trim();
    if (!name) return;
    const existing = companiesByName.get(name) || { name, intro: "", business: "" };
    companiesByName.set(name, {
      name,
      intro: existing.intro || normalizedCompany.intro || "",
      business: existing.business || normalizedCompany.business || ""
    });
  };

  if (Array.isArray(value)) {
    value.forEach(addCompany);
    return Array.from(companiesByName.values());
  }

  if (typeof value === "string") {
    const parsed = parseJsonObject(`{"items":${value}}`);
    if (parsed?.items) return normalizeCandidateCompanyItems(parsed.items);
    value
      .split(/[,，;；、\n]/)
      .filter(Boolean)
      .forEach(addCompany);
    return Array.from(companiesByName.values());
  }

  return [];
}

function normalizeCandidateCompanies(value) {
  return normalizeCandidateCompanyItems(value).map((item) => item.name);
}

function getParsedFieldValue(fields, key) {
  if (!Array.isArray(fields)) return "";
  const matched = fields.find((item) => item?.key === key);
  return matched?.value || "";
}

function stringifyCompanyField(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyCompanyField(item))
      .filter(Boolean)
      .join("、");
  }
  if (value && typeof value === "object") {
    return Object.values(value)
      .map((item) => stringifyCompanyField(item))
      .filter(Boolean)
      .join("、");
  }
  return "";
}

function pickCompanyText(source, keys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  for (const key of keys) {
    const value = stringifyCompanyField(source[key]);
    if (value) return value;
  }
  return "";
}

function normalizeValidationCompany(value, fallbackName = "") {
  const source = parseJsonObject(value) || (value && typeof value === "object" && !Array.isArray(value) ? value : null);
  if (!source) return null;
  const name = pickCompanyText(source, COMPANY_NAME_KEYS) || fallbackName;
  const intro = pickCompanyText(source, COMPANY_INTRO_KEYS);
  const business = pickCompanyText(source, COMPANY_BUSINESS_KEYS);
  if (!name && !intro && !business) return null;
  return { name, intro, business };
}

function mergeValidationCompany(...companies) {
  return companies.reduce((merged, company) => {
    if (!company) return merged;
    return {
      name: merged.name || company.name || "",
      intro: merged.intro || company.intro || "",
      business: merged.business || company.business || ""
    };
  }, { name: "", intro: "", business: "" });
}

function hasCompanyDetails(company) {
  return Boolean(company?.intro?.trim() && company?.business?.trim());
}

function extractCompanyValidationResult(payload) {
  const rawOutputs = payload?.raw?.data?.outputs;
  const parsedFromText =
    parseJsonObject(payload?.outputText) ||
    parseJsonObject(rawOutputs?.text) ||
    parseJsonObject(rawOutputs?.result) ||
    parseJsonObject(rawOutputs?.output) ||
    parseJsonObject(rawOutputs?.answer);
  const source = parsedFromText || {};
  const outputSource = rawOutputs || {};
  const company = mergeValidationCompany(
    normalizeValidationCompany(payload?.company),
    normalizeValidationCompany(source.company),
    normalizeValidationCompany(source),
    normalizeValidationCompany(outputSource.company),
    normalizeValidationCompany(outputSource)
  );
  const candidateSource =
    (Array.isArray(payload?.candidateItems) && payload.candidateItems.length ? payload.candidateItems : null) ||
    source["候选企业"] ||
    source.candidateCompanies ||
    source.candidates ||
    payload?.candidates ||
    outputSource["候选企业"] ||
    outputSource.candidateCompanies ||
    outputSource.candidates ||
    source["企业名称"] ||
    source.companyName ||
    payload?.companyName ||
    outputSource["企业名称"] ||
    outputSource.companyName;

  const candidateItems = normalizeCandidateCompanyItems(candidateSource);

  return {
    searchResult:
      source["搜索结果"] ||
      source.searchResult ||
      payload?.searchResult ||
      outputSource["搜索结果"] ||
      outputSource.searchResult ||
      getParsedFieldValue(payload?.parsedFields, "搜索结果") ||
      "",
    candidateItems,
    candidates: candidateItems.map((item) => item.name),
    company: company.name || company.intro || company.business ? company : null,
    cacheHit: Boolean(payload?.cacheHit),
    cacheMiss: Boolean(payload?.cacheMiss),
    cacheSource: payload?.cacheSource || ""
  };
}

function getCompanySuggestionItems(result, fallbackName = "") {
  const companyName = result?.company?.name || (result?.company?.intro || result?.company?.business ? fallbackName : "");
  return normalizeCandidateCompanyItems([...(result?.candidateItems || []), result?.company, companyName]);
}

function decorateCompanySuggestionItems(items, { source = "local", keyword = "", stale = false } = {}) {
  return normalizeCandidateCompanyItems(items).map((item) => ({
    ...item,
    source,
    keyword,
    stale,
    disabled: stale
  }));
}

function markCompanySuggestionsStale(items) {
  return (items || []).map((item) => ({
    ...item,
    stale: true,
    disabled: true
  }));
}

function isSameCompanyName(left, right) {
  const leftName = String(left || "").trim();
  const rightName = String(right || "").trim();
  if (!leftName || !rightName) return false;
  const normalizedLeft = normalizeCompanyName(leftName);
  const normalizedRight = normalizeCompanyName(rightName);
  return leftName === rightName || Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function ValidationStatusIcon({ type }) {
  if (type === "valid") {
    return (
      <svg className="validation-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  if (type === "loading") {
    return <span className="validation-status-spinner" aria-hidden />;
  }

  return (
    <svg className="validation-warning-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-8a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V6a1 1 0 0 0-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function ResultLoadingDots() {
  return (
    <span className="result-loading-dots" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

function ResultPendingText({ children }) {
  return (
    <span className="result-pending-text">
      <span>{children}</span>
      <ResultLoadingDots />
    </span>
  );
}

function AnalysisLoadingCard({ title = "分析任务队列", steps = [] }) {
  const normalizedSteps = steps.length ? steps : [
    { label: "整理企业基础信息", state: "done" },
    { label: "抽取公开竞争信号", state: "active", detail: "正在校验候选数据与报告结构" },
    { label: "生成分析结论", state: "pending" }
  ];

  return (
    <div className="analysis-loading-card" role="status" aria-live="polite">
      <div className="analysis-loading-head">
        <span className="analysis-loading-kicker">ANALYSIS QUEUE</span>
        <strong>{title}</strong>
      </div>
      <ol className="analysis-loading-list">
        {normalizedSteps.map((step, index) => (
          <li className={`analysis-loading-step analysis-loading-step--${step.state || "pending"}`} key={`${step.label}-${index}`}>
            <span className="analysis-loading-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="analysis-loading-copy">
              <span>{step.label}</span>
              {step.detail && <small>{step.detail}</small>}
            </span>
            <em>{step.state === "done" ? "已完成" : step.state === "active" ? "进行中" : "待处理"}</em>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CompanyValidationInput({ value, onChange, placeholder, inputProps = {}, className = "", requireCompanyDetails = false, suspendValidation = false }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [validationState, setValidationState] = useState("idle");
  const [suggestions, setSuggestions] = useState([]);
  const [validationMeta, setValidationMeta] = useState({ searchResult: "", note: "", error: "" });
  const wrapperRef = useRef(null);
  const confirmedValueRef = useRef("");
  const selectingValueRef = useRef("");
  const requestSeqRef = useRef(0);
  const localTimerRef = useRef(null);
  const webTimerRef = useRef(null);
  const webSearchingKeywordRef = useRef("");
  const keyword = String(value || "").trim();
  const isValidated = validationState === "validated";
  const showPendingStatus = shouldShowValidationPendingStatus(validationState, keyword);

  const clearSearchTimers = () => {
    if (localTimerRef.current) {
      window.clearTimeout(localTimerRef.current);
      localTimerRef.current = null;
    }
    if (webTimerRef.current) {
      window.clearTimeout(webTimerRef.current);
      webTimerRef.current = null;
    }
  };

  const confirmCompany = (company, fallbackName = "") => {
    const normalizedCompany = {
      name: company?.name || fallbackName,
      intro: company?.intro || "",
      business: company?.business || ""
    };
    const confirmedName = normalizedCompany.name || fallbackName;
    clearSearchTimers();
    selectingValueRef.current = "";
    confirmedValueRef.current = confirmedName;
    onChange(confirmedName, true, normalizedCompany);
    setValidationState("validated");
    setSuggestions([]);
    setValidationMeta({ searchResult: "已确认企业", note: "", error: "" });
    setShowDropdown(false);
  };

  const applyImmediateLookupPayload = (payload, { currentKeyword, requestId, source = "web", fromCacheOnly = false } = {}) => {
    if (requestSeqRef.current !== requestId || currentKeyword !== String(value || "").trim()) return true;
    const result = extractCompanyValidationResult(payload);
    const candidateItems = decorateCompanySuggestionItems(getCompanySuggestionItems(result, currentKeyword), {
      source,
      keyword: currentKeyword,
      stale: false
    });
    const hasAnyCompanyInfo = Boolean(result.company?.name || result.company?.intro || result.company?.business);
    const isExactCompanyCache = Boolean(
      result.cacheHit &&
      hasCompanyDetails(result.company) &&
      isSameCompanyName(result.company?.name, currentKeyword)
    );

    if (isExactCompanyCache) {
      confirmCompany(result.company, currentKeyword);
      return true;
    }

    if (fromCacheOnly && result.cacheMiss) {
      return false;
    }

    if (hasAnyCompanyInfo) {
      if (requireCompanyDetails && !hasCompanyDetails(result.company)) {
        setSuggestions(candidateItems);
        setValidationMeta({
          searchResult: "企业信息确认失败",
          note: "",
          error: "未获取到企业介绍和主营业务，请补充更准确的企业名称。"
        });
        setValidationState(candidateItems.length ? "ready" : "error");
        setShowDropdown(true);
        return true;
      }
      setSuggestions(candidateItems);
      setValidationMeta({ searchResult: result.searchResult || "检索完成", note: "", error: "" });
      setValidationState(source === "local" ? "localMatched" : "webMatched");
      setShowDropdown(true);
      return true;
    }

    if (result.candidateItems.length) {
      setSuggestions(decorateCompanySuggestionItems(result.candidateItems, {
        source,
        keyword: currentKeyword,
        stale: false
      }));
      setValidationMeta({ searchResult: result.searchResult || "检索完成", note: "", error: "" });
      setValidationState(source === "local" ? "localMatched" : "webMatched");
      setShowDropdown(true);
      return true;
    }

    return false;
  };

  const runImmediateLookup = async ({ skipLocal = false } = {}) => {
    const currentKeyword = String(value || "").trim();
    if (suspendValidation || currentKeyword.length < COMPANY_VALIDATION_MIN_KEYWORD_LENGTH) return;

    clearSearchTimers();
    requestSeqRef.current += 1;
    const requestId = requestSeqRef.current;
    setSuggestions((prev) => markCompanySuggestionsStale(prev));
    setValidationMeta({
      searchResult: skipLocal ? "本地未找到，正在联网查找..." : "正在匹配本地企业...",
      note: "",
      error: ""
    });
    setValidationState(skipLocal ? "webSearching" : "localSearching");
    setShowDropdown(true);

    try {
      if (!skipLocal) {
        const cachedPayload = await lookupCompanyNameValidationCache({ companyName: currentKeyword, cacheOnly: true });
        if (requestSeqRef.current !== requestId || currentKeyword !== String(value || "").trim()) return;
        const handledFromCache = applyImmediateLookupPayload(cachedPayload, {
          currentKeyword,
          requestId,
          source: "local",
          fromCacheOnly: true
        });
        if (handledFromCache) return;
      }

      setSuggestions([]);
      setValidationMeta({ searchResult: "本地未找到，正在联网查找...", note: "", error: "" });
      setValidationState("webSearching");
      const payload = await runCompanyNameValidationWorkflow({
        companyName: currentKeyword,
        ...(skipLocal ? { forceRefresh: true } : {})
      });
      if (requestSeqRef.current !== requestId || currentKeyword !== String(value || "").trim()) return;
      const handled = applyImmediateLookupPayload(payload, { currentKeyword, requestId, source: "web" });
      if (!handled) {
        setSuggestions([]);
        setValidationMeta({ searchResult: "未找到匹配企业，可继续修改企业名称", note: "", error: "" });
        setValidationState("empty");
        setShowDropdown(true);
      }
    } catch (error) {
      if (requestSeqRef.current !== requestId || currentKeyword !== String(value || "").trim()) return;
      setSuggestions([]);
      setValidationMeta({
        searchResult: "搜索失败，请稍后重试，或继续手动输入企业名称",
        note: "",
        error: error.message || String(error)
      });
      setValidationState("error");
      setShowDropdown(true);
    }
  };

  useEffect(() => {
    return () => clearSearchTimers();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const currentKeyword = String(value || "").trim();

    clearSearchTimers();

    if (!currentKeyword) {
      requestSeqRef.current += 1;
      confirmedValueRef.current = "";
      selectingValueRef.current = "";
      webSearchingKeywordRef.current = "";
      setValidationState("idle");
      setSuggestions([]);
      setValidationMeta({ searchResult: "", note: "", error: "" });
      setShowDropdown(false);
      return undefined;
    }

    if (suspendValidation) {
      requestSeqRef.current += 1;
      selectingValueRef.current = "";
      webSearchingKeywordRef.current = "";
      setValidationState("idle");
      setSuggestions([]);
      setValidationMeta({ searchResult: "", note: "", error: "" });
      setShowDropdown(false);
      return undefined;
    }

    if (confirmedValueRef.current === currentKeyword) {
      selectingValueRef.current = "";
      webSearchingKeywordRef.current = "";
      setValidationState("validated");
      setSuggestions([]);
      setValidationMeta({ searchResult: "已确认企业", note: "", error: "" });
      setShowDropdown(false);
      return undefined;
    }

    if (selectingValueRef.current === currentKeyword) {
      setValidationState("fetching");
      setSuggestions([]);
      setValidationMeta({ searchResult: "正在获取企业信息", note: "", error: "" });
      setShowDropdown(false);
      return undefined;
    }

    requestSeqRef.current += 1;
    const requestId = requestSeqRef.current;
    let cancelled = false;

    const isLatestSearch = () => !cancelled && requestSeqRef.current === requestId && currentKeyword === String(value || "").trim();

    const applyValidationPayload = (payload, { source = "web", fromCacheOnly = false } = {}) => {
      if (cancelled || requestSeqRef.current !== requestId) return true;
      const result = extractCompanyValidationResult(payload);
      const candidateItems = decorateCompanySuggestionItems(getCompanySuggestionItems(result, currentKeyword), {
        source,
        keyword: currentKeyword,
        stale: false
      });
      const hasAnyCompanyInfo = Boolean(result.company?.name || result.company?.intro || result.company?.business);
      const isExactCompanyCache = Boolean(
        result.cacheHit &&
        hasCompanyDetails(result.company) &&
        isSameCompanyName(result.company?.name, currentKeyword)
      );

      if (isExactCompanyCache) {
        confirmCompany(result.company, currentKeyword);
        return true;
      }

      if (fromCacheOnly && result.cacheMiss) {
        return false;
      }

      if (hasAnyCompanyInfo) {
        if (requireCompanyDetails && !hasCompanyDetails(result.company)) {
          setSuggestions(candidateItems);
          setValidationMeta({
            searchResult: "企业信息确认失败",
            note: "",
            error: "未获取到企业介绍和主营业务，请补充更准确的企业名称。"
          });
          setValidationState(candidateItems.length ? "ready" : "error");
          setShowDropdown(true);
          return true;
        }
        setSuggestions(candidateItems);
        setValidationMeta({ searchResult: result.searchResult || "检索完成", note: "", error: "" });
        setValidationState(source === "local" ? "localMatched" : "webMatched");
        setShowDropdown(true);
        return true;
      }

      if (result.candidateItems.length) {
        setSuggestions(decorateCompanySuggestionItems(result.candidateItems, {
          source,
          keyword: currentKeyword,
          stale: false
        }));
        setValidationMeta({ searchResult: result.searchResult || "检索完成", note: "", error: "" });
        setValidationState(source === "local" ? "localMatched" : "webMatched");
        setShowDropdown(true);
        return true;
      }

      if (!fromCacheOnly) {
        setSuggestions([]);
        setValidationMeta({ searchResult: result.searchResult || "检索完成", note: "", error: "" });
        setValidationState("ready");
        setShowDropdown(true);
      }
      return false;
    };

    const runWebLookup = async () => {
      if (!isLatestSearch()) return;
      if (webSearchingKeywordRef.current === currentKeyword) return;
      webSearchingKeywordRef.current = currentKeyword;
      setValidationState("webSearching");
      setValidationMeta({ searchResult: "本地未找到，正在联网查找...", note: "", error: "" });
      setShowDropdown(true);

      try {
        const payload = await runCompanyNameValidationWorkflow({ companyName: currentKeyword });
        if (!isLatestSearch()) return;
        const handled = applyValidationPayload(payload, { source: "web" });
        if (!handled) {
          setSuggestions([]);
          setValidationMeta({ searchResult: "未找到匹配企业，可继续修改企业名称", note: "", error: "" });
          setValidationState("empty");
          setShowDropdown(true);
        }
      } catch (error) {
        if (!isLatestSearch()) return;
        setSuggestions([]);
        setValidationMeta({
          searchResult: "搜索失败，请稍后重试，或继续手动输入企业名称",
          note: "",
          error: error.message || String(error)
        });
        setValidationState("error");
        setShowDropdown(true);
      } finally {
        if (webSearchingKeywordRef.current === currentKeyword) {
          webSearchingKeywordRef.current = "";
        }
      }
    };

    if (currentKeyword.length < COMPANY_VALIDATION_MIN_KEYWORD_LENGTH) {
      setValidationState("idle");
      setSuggestions([]);
      setValidationMeta({ searchResult: "", note: "", error: "" });
      setShowDropdown(false);
      return () => {
        cancelled = true;
      };
    }

    setSuggestions((prev) => markCompanySuggestionsStale(prev));
    setValidationState(suggestions.length ? "refreshing" : "waiting");
    setValidationMeta({ searchResult: "正在重新匹配...", note: "", error: "" });
    setShowDropdown(suggestions.length > 0);

    localTimerRef.current = window.setTimeout(async () => {
      if (!isLatestSearch()) return;
      setValidationState("localSearching");
      setValidationMeta({ searchResult: "正在匹配本地企业...", note: "", error: "" });
      setShowDropdown(true);

      try {
        const cachedPayload = await lookupCompanyNameValidationCache({ companyName: currentKeyword, cacheOnly: true });
        if (!isLatestSearch()) return;
        const handledFromCache = applyValidationPayload(cachedPayload, { source: "local", fromCacheOnly: true });
        if (handledFromCache || !isLatestSearch()) return;

        setSuggestions([]);
        setValidationMeta({ searchResult: "本地未找到，准备联网查找...", note: "", error: "" });
        setValidationState("localEmpty");
        setShowDropdown(true);

        webTimerRef.current = window.setTimeout(runWebLookup, COMPANY_VALIDATION_WEB_DELAY_MS);
      } catch (error) {
        if (!isLatestSearch()) return;
        setSuggestions([]);
        setValidationMeta({
          searchResult: "搜索失败，请稍后重试，或继续手动输入企业名称",
          note: "",
          error: error.message || String(error)
        });
        setValidationState("error");
        setShowDropdown(true);
      }
    }, COMPANY_VALIDATION_LOCAL_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearSearchTimers();
    };
  }, [requireCompanyDetails, suspendValidation, value]);

  const handleInputChange = (event) => {
    const nextValue = event.target.value;
    onChange(nextValue, false, null);
    confirmedValueRef.current = "";
    selectingValueRef.current = "";
    webSearchingKeywordRef.current = "";
    clearSearchTimers();
    requestSeqRef.current += 1;

    if (nextValue.trim()) {
      const nextMeta = suspendValidation
        ? { searchResult: "", note: "", error: "" }
        : { searchResult: "正在重新匹配...", note: "", error: "" };
      setSuggestions((prev) => markCompanySuggestionsStale(prev));
      setValidationState(suspendValidation ? "idle" : "refreshing");
      setValidationMeta(nextMeta);
      setShowDropdown((prev) => Boolean(prev || suggestions.length));
    } else {
      setValidationState("idle");
      setValidationMeta({ searchResult: "", note: "", error: "" });
      setSuggestions([]);
      setShowDropdown(false);
    }
  };

  const handleSelect = async (selectedItem) => {
    const selectedCompany = typeof selectedItem === "string"
      ? { name: selectedItem, intro: "", business: "" }
      : selectedItem || {};
    const name = String(selectedCompany.name || "").trim();
    if (!name) return;
    if (selectedCompany.disabled || selectedCompany.stale || (selectedCompany.keyword && selectedCompany.keyword !== keyword)) return;
    clearSearchTimers();
    if (hasCompanyDetails(selectedCompany)) {
      confirmCompany(selectedCompany, name);
      return;
    }

    const sourceQuery = keyword;
    requestSeqRef.current += 1;
    const requestId = requestSeqRef.current;

    try {
      const cachedPayload = await lookupCompanyNameValidationCache({ companyName: name });
      if (requestSeqRef.current !== requestId) return;
      const cachedResult = extractCompanyValidationResult(cachedPayload);
      const cachedCompany = mergeValidationCompany(selectedCompany, cachedResult.company, { name });
      if (cachedPayload?.cacheHit && hasCompanyDetails(cachedCompany)) {
        confirmCompany(cachedCompany, name);
        return;
      }
    } catch {
      // 缓存未命中或读取失败时继续使用原有完整校验流程。
    }

    selectingValueRef.current = name;
    requestSeqRef.current += 1;
    const fetchRequestId = requestSeqRef.current;
    onChange(name, false, null);
    setValidationState("fetching");
    setSuggestions([]);
    setValidationMeta({ searchResult: "正在获取企业信息", note: "", error: "" });
    setShowDropdown(false);

    try {
      const payload = await runCompanyNameValidationWorkflow({ companyName: name, sourceQuery });
      if (requestSeqRef.current !== fetchRequestId) return;
      const result = extractCompanyValidationResult(payload);
      const confirmedCompany = mergeValidationCompany(selectedCompany, result.company, { name });
      if (confirmedCompany.name || confirmedCompany.intro || confirmedCompany.business) {
        confirmCompany(confirmedCompany, name);
        return;
      }
      confirmCompany({ name }, name);
    } catch (error) {
      if (requestSeqRef.current !== fetchRequestId) return;
      confirmCompany(selectedCompany, name);
    }
  };

  return (
    <div className={`company-validation-input company-validation-input--${validationState} ${className}`.trim()} ref={wrapperRef}>
      <input
        {...inputProps}
        value={value}
        onChange={handleInputChange}
        onFocus={() => {
          if (keyword && !suspendValidation && !isValidated && validationState !== "fetching" && validationState !== "idle") setShowDropdown(true);
        }}
        onKeyDown={(event) => {
          inputProps.onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Enter" && keyword.length >= COMPANY_VALIDATION_MIN_KEYWORD_LENGTH && !isValidated && !suspendValidation) {
            event.preventDefault();
            runImmediateLookup();
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
      />

      {showPendingStatus && (
        <div className={`validation-status validation-status--pending ${validationState === "fetching" ? "validation-status--fetching" : ""}`.trim()} aria-hidden>
          <ValidationStatusIcon type={getValidationStatusIconType(validationState)} />
          <span>{getValidationPendingLabel(validationState)}</span>
        </div>
      )}

      {isValidated && (
        <div className="validation-status validation-status--success" aria-hidden>
          <ValidationStatusIcon type="valid" />
        </div>
      )}

      {shouldShowValidationDropdown({ showDropdown, keyword, isValidated, validationState }) && (
        <div className="validation-dropdown">
          {suggestions.length > 0 ? (
            <>
              {["refreshing", "waiting", "localSearching", "localEmpty", "webSearching"].includes(validationState) && (
                <div className="validation-refreshing-row">
                  <span className="validation-spinner" aria-hidden />
                  <span>{validationMeta.searchResult || "正在重新匹配..."}</span>
                </div>
              )}
              <div className="validation-option-list">
                {suggestions.map((item, index) => {
                  const isStale = Boolean(item.stale || item.disabled);
                  return (
                    <button
                      type="button"
                      className={`validation-option ${isStale ? "validation-option--stale" : ""}`.trim()}
                      key={`${item.name}-${index}`}
                      onClick={() => handleSelect(item)}
                      disabled={isStale}
                      aria-disabled={isStale ? "true" : undefined}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <em>{isStale ? "旧候选，正在重新匹配" : item.source === "web" ? "联网搜索" : "本地企业库"}</em>
                      </span>
                    </button>
                  );
                })}
                {["localMatched", "webMatched"].includes(validationState) && (
                  <button
                    type="button"
                    className="validation-more-option"
                    onClick={() => runImmediateLookup({ skipLocal: true })}
                  >
                    联网搜索更多
                  </button>
                )}
              </div>
            </>
          ) : ["loading", "localSearching", "localEmpty", "webSearching"].includes(validationState) ? (
            <div className="validation-loading-row">
              <span className="validation-spinner" aria-hidden />
              <span>{validationMeta.searchResult || "正在匹配企业，请稍候"}</span>
            </div>
          ) : (
            <div className={`validation-empty ${validationState === "error" ? "validation-empty--error" : ""}`.trim()}>
              {validationMeta.error || validationMeta.searchResult || validationMeta.note || "未找到匹配企业，可继续修改企业名称"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getScoreLevel(score) {
  if (!Number.isFinite(score)) return "pending";
  if (score >= 85) return "high";
  if (score >= 70) return "medium";
  return "low";
}

function compactCardSummary(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[#*_`>~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompetitorDetailSummary(detailData) {
  if (!detailData || typeof detailData !== "object") return "";
  return compactCardSummary(detailData.product || detailData.lately || detailData.tech || "");
}

function isPendingCompetitorIntro(value) {
  return typeof value === "string" && value.includes("正在");
}

function CompetitorCard({ item, scoreItem, detailData, detailStatus = "idle", reportStatus = "idle", scoreStatus = "idle", detailError = "", reportError = "", isActive, onClick }) {
  const rawScore = scoreItem?.威胁分数 ?? item.threatScore;
  const score = rawScore === null || rawScore === undefined || rawScore === "" ? NaN : Number(rawScore);
  const displayScore = Number.isFinite(score) ? Math.round(score) : "--";
  const scoreLevel = getScoreLevel(score);
  const scorePercent = Number.isFinite(score) ? `${Math.max(0, Math.min(100, score))}%` : "0%";
  const hasPendingIntro = isPendingCompetitorIntro(item.intro);
  const scoreSummary = compactCardSummary(scoreItem?.竞争分析小结);
  const detailSummary = getCompetitorDetailSummary(detailData);
  const statusLabel = detailStatus === "loading"
    ? "企业信息获取中"
    : detailStatus === "error"
      ? "详情失败"
      : reportStatus === "loading"
        ? "对比报告生成中"
        : reportStatus === "error"
          ? "报告失败"
          : scoreStatus === "loading"
            ? "打分中"
            : "";
  const statusError = detailStatus === "error" ? detailError : reportStatus === "error" ? reportError : "";
  const summaryText = statusError || (!hasPendingIntro ? item.intro : "") || scoreSummary || detailSummary || item.intro || "暂无简介。";
  const isSummaryPending = !statusError && typeof summaryText === "string" && summaryText.includes("正在");
  return (
    <button
      type="button"
      className={`competitor-card ${isActive ? "competitor-card--active" : ""}`}
      onClick={onClick}
    >
      <div className="competitor-card-head">
        <div
          className={`score-ring score-ring--${scoreLevel}`}
          style={{ "--score-percent": scorePercent }}
          aria-label={Number.isFinite(score) ? `威胁分数 ${displayScore}` : "威胁分数生成中"}
        >
          <span>{displayScore}</span>
        </div>
        <h3>{item.name}</h3>
      </div>
      {statusLabel && (
        <span className={`status-dot ${statusError ? "status-dot--error" : ""}`.trim()}>
          {statusError ? statusLabel : <ResultPendingText>{statusLabel}</ResultPendingText>}
        </span>
      )}
      <p>{isSummaryPending ? <ResultPendingText>{summaryText}</ResultPendingText> : summaryText}</p>
    </button>
  );
}

function CompanyOverview({ targetName, targetCompanyInfo, targetDetail, detailStatus = "idle", detailError = "", isLoading = false }) {
  const detailLoading = detailStatus === "loading" || isLoading;
  const detailFailed = detailStatus === "error";
  const latelyItems = Array.isArray(targetDetail?.latelyItems) ? targetDetail.latelyItems : [];
  const businessText = targetCompanyInfo?.business || (detailLoading ? "正在补全主营业务" : detailFailed ? "企业详情加载失败" : "人工智能 / 量子计算 / 数据智能平台建设");
  const businessItems = businessText
    .split(/[、/，,；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  const isBusinessPending = detailLoading && businessText.includes("正在");
  const introText = targetCompanyInfo?.intro ||
    (detailLoading
      ? "正在补全企业简介与基础信息。"
      : detailFailed
        ? (detailError || "企业详情加载失败。")
        : "由浙江省政府发起设立的新型研发机构，聚焦人工智能、量子计算、空天信息、先进芯片等国家战略科技方向。");
  const isIntroPending = detailLoading && introText.includes("正在");
  return (
    <section className="company-overview card-panel">
      <div className="overview-main">
        <div className="overview-identity">
          <p className="section-eyebrow">我方企业信息</p>
          <h1>{targetName || "待输入企业"}</h1>
        </div>
        <div className="overview-detail-row">
          <div className="overview-info-block overview-business">
            <h3>主营业务</h3>
            <div className="business-lines">
              {businessItems.map((item) => (
                <span key={item}>{isBusinessPending ? <ResultPendingText>{item}</ResultPendingText> : item}</span>
              ))}
            </div>
          </div>
          <div className="overview-info-block overview-intro-block">
            <h3>公司简介</h3>
            <p className="overview-intro">
              {isIntroPending ? <ResultPendingText>{introText}</ResultPendingText> : introText}
            </p>
          </div>
        </div>
      </div>
      <div className="overview-news">
        <h3>近期动态</h3>
        <ul>
          {latelyItems.map((item) => (
            <li key={item.id || item.title}>
              <NewsDate value={item.time} />
              {getNewsHref(item) ? (
                <a className="overview-news-link" href={getNewsHref(item)} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
              ) : (
                <span>{item.title}</span>
              )}
            </li>
          ))}
          {detailLoading && latelyItems.length === 0 && <li className="overview-news-placeholder"><ResultPendingText>正在补全近期动态</ResultPendingText></li>}
          {detailFailed && latelyItems.length === 0 && <li className="overview-news-placeholder overview-news-placeholder--error">{detailError || "企业详情加载失败"}</li>}
          {!detailLoading && !detailFailed && latelyItems.length === 0 && <li className="overview-news-placeholder">暂无近期动态。</li>}
        </ul>
      </div>
    </section>
  );
}

function InfoGrid({ companyName, companyIntro, analysisSummary, onOpenDrawer }) {
  return (
    <div className="detail-overview">
      <div className="detail-overview-head">
        <div>
          <p className="section-eyebrow">竞争对手总体信息</p>
          <h3>{companyName || "暂无公司名称。"}</h3>
        </div>
        <div className="detail-overview-actions">
          <button type="button" className="secondary-action secondary-action--brand" onClick={() => onOpenDrawer("公司近况")}>
            查看近况与报告
          </button>
        </div>
      </div>

      <div className="detail-overview-copy">
        <div>
          <h4>公司简介</h4>
          <p>{companyIntro || "暂无企业简介。"}</p>
        </div>
        <div>
          <h4>竞争分析小结</h4>
          <p>{analysisSummary || "暂无竞争分析小结。"}</p>
        </div>
      </div>
    </div>
  );
}

function DynamicsPanel({ competitorDetail, status = "idle", error = "" }) {
  if (status === "loading") {
    return (
      <AnalysisLoadingCard
        title="公司近况分析中"
        steps={[
          { label: "确认竞争对手主体", state: "done" },
          { label: "检索近期公开动态", state: "active", detail: "正在整理新闻、公告与公开事件" },
          { label: "归纳动态影响", state: "pending" }
        ]}
      />
    );
  }

  if (status === "error") {
    return <p className="api-error">{error || "企业详情加载失败"}</p>;
  }

  const normalizeItems = (detail) => {
    const items = Array.isArray(detail?.latelyItems) ? detail.latelyItems : [];
    if (items.length > 0) {
      return items;
    }

    const summary = typeof detail?.lately === "string" ? stripThinkContent(detail.lately) : "";
    if (!summary || summary === "暂无近期动态" || summary === "未检索到企业近期信息") {
      return [];
    }

    return [{
      id: "lately-summary",
      title: "近期动态",
      content: summary,
      time: "近期"
    }];
  };

  const mergedItems = normalizeItems(competitorDetail);

  return (
    <div className="dynamics-timeline">
      {mergedItems.length > 0 ? (
        mergedItems.slice(0, 8).map((item, index) => (
          <article key={`${item.id || item.title}-${index}`} className="timeline-item">
            <div className="timeline-dot" />
            <div className="timeline-content-grid">
              <NewsDate value={item.time} />
              <div className="timeline-copy">
                <div className="timeline-title-row">
                  <h4>
                    {getNewsHref(item) ? (
                      <a className="timeline-link" href={getNewsHref(item)} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </h4>
                  {item.type && <span className="timeline-type">{item.type}</span>}
                </div>
                <p>{stripThinkContent(item.content || item.impact || "暂无详情。")}</p>
                {item.source && <small>来源：{stripThinkContent(item.source)}</small>}
              </div>
            </div>
          </article>
        ))
      ) : (
        <p className="muted-text">暂无近期动态。</p>
      )}
    </div>
  );
}

function DetailPanel({
  selectedCompetitor,
  selectedScoreItem,
  onOpenDrawer
}) {
  if (!selectedCompetitor) {
    return (
      <div className="select-tip">
        <span className="cursor-icon">☝</span>
        <p>点击任意卡片查看更详细的分析</p>
      </div>
    );
  }

  return (
    <section className="details-panel card-panel">
      <InfoGrid
        companyName={selectedCompetitor.name}
        companyIntro={selectedCompetitor.intro}
        analysisSummary={selectedScoreItem?.竞争分析小结}
        onOpenDrawer={onOpenDrawer}
      />
    </section>
  );
}

function ResultDetailDrawer({
  open,
  targetName,
  selectedCompetitor,
  selectedDetail,
  selectedDetailStatus,
  selectedDetailError,
  selectedReport,
  selectedScoreItem,
  activeTab,
  onTabChange,
  onClose
}) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    const timer = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted || !selectedCompetitor || typeof document === "undefined") {
    return null;
  }

  const drawerTab = activeTab === "对比分析报告" ? "对比分析报告" : "公司近况";

  return createPortal(
    <div className={`competitor-analysis-legacy-viewport competitor-drawer-layer result-detail-drawer-layer ${open ? "result-detail-drawer-layer--open" : "result-detail-drawer-layer--closing"}`} role="presentation">
      <button
        type="button"
        className="competitor-drawer-backdrop"
        aria-label="关闭竞争对手分析详情"
        onClick={onClose}
      />
      <aside className="competitor-drawer result-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="result-detail-drawer-title">
        <div className="competitor-drawer-head result-detail-drawer-head">
          <div>
            <h2 id="result-detail-drawer-title">{selectedCompetitor.name}</h2>
            <p>{targetName} 的竞争对手延展信息</p>
          </div>
          <button type="button" className="competitor-drawer-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="result-detail-drawer-tabs" role="tablist" aria-label="竞争对手详情类型">
          {["公司近况", "对比分析报告"].map((tab) => (
            <button
              type="button"
              key={tab}
              className={drawerTab === tab ? "result-detail-drawer-tab result-detail-drawer-tab--active" : "result-detail-drawer-tab"}
              onClick={() => onTabChange(tab)}
              role="tab"
              aria-selected={drawerTab === tab}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="competitor-drawer-body result-detail-drawer-body">
          {drawerTab === "公司近况" ? (
            <DynamicsPanel competitorDetail={selectedDetail} status={selectedDetailStatus} error={selectedDetailError} />
          ) : (
            <div className="report-wrap">
              <div className="report-title-row">
                <div>
                  <h3>{targetName} vs {selectedCompetitor.name}</h3>
                  <p>围绕产品服务、技术力、近期动态与战略威胁展开对比。</p>
                </div>
                {selectedReport?.status === "loading" && <span className="status-dot"><ResultPendingText>报告生成中</ResultPendingText></span>}
                {selectedReport?.status === "error" && <span className="status-dot status-dot--error">生成失败</span>}
              </div>
              {selectedReport?.status === "loading" ? (
                <AnalysisLoadingCard
                  title="对比分析报告生成中"
                  steps={[
                    { label: "企业信息与动态已接入", state: "done" },
                    { label: "生成产品、技术与近期动态对比", state: "active", detail: "正在组织报告段落与关键判断" },
                    { label: "汇总战略威胁结论", state: "pending" }
                  ]}
                />
              ) : selectedReport?.status === "error" ? (
                <p className="api-error">{selectedReport.error}</p>
              ) : (
                <MarkdownReport text={selectedReport?.text || selectedScoreItem?.竞争分析小结 || "暂无报告。"} />
              )}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

function HomePage({ form, setForm, matchMode, onMatchModeChange, onAnalyze, isLoading, apiError, resetSeed }) {
  const [modeError, setModeError] = useState("");
  const [competitorDrawerOpen, setCompetitorDrawerOpen] = useState(false);
  const getRowsFromForm = useCallback((value) => {
    const names = splitCompetitorNames(value);
    const rows = names.length ? names.slice(0, MAX_COMPETITOR_COUNT) : [];
    while (rows.length < DEFAULT_COMPETITOR_ROWS) rows.push("");
    return rows;
  }, []);
  const [competitorRows, setCompetitorRows] = useState(() => getRowsFromForm(form.competitorCompanyName));
  const lastSyncedCompetitorValue = useRef(form.competitorCompanyName || "");
  const previousMatchMode = useRef(matchMode);
  const sameAsTargetCompetitorIndexes = useMemo(() => {
    const targetName = String(form.targetCompanyName || "").trim();
    const indexes = new Set();
    if (matchMode !== "exact" || !targetName) return indexes;
    competitorRows.forEach((name, index) => {
      if (isSameCompanyName(name, targetName)) indexes.add(index);
    });
    return indexes;
  }, [competitorRows, form.targetCompanyName, matchMode]);
  const duplicateCompetitorIndexes = useMemo(() => {
    const indexes = new Set();
    if (matchMode !== "exact") return indexes;
    competitorRows.forEach((name, index) => {
      const currentName = String(name || "").trim();
      if (!currentName) return;
      const duplicateIndex = competitorRows.findIndex((otherName, otherIndex) => (
        otherIndex !== index && isSameCompanyName(currentName, otherName)
      ));
      if (duplicateIndex >= 0) indexes.add(index);
    });
    return indexes;
  }, [competitorRows, matchMode]);
  const hasSameAsTargetCompetitor = sameAsTargetCompetitorIndexes.size > 0;
  const hasDuplicateCompetitor = duplicateCompetitorIndexes.size > 0;
  const hasBlockingCompetitorError = matchMode === "exact" && (hasSameAsTargetCompetitor || hasDuplicateCompetitor);
  const competitorNames = useMemo(
    () => competitorRows.map((item) => item.trim()).filter(Boolean).slice(0, MAX_COMPETITOR_COUNT),
    [competitorRows]
  );

  useEffect(() => {
    const rows = getRowsFromForm("");
    setModeError("");
    setCompetitorRows(rows);
    lastSyncedCompetitorValue.current = "";
    setForm({
      ...createEmptyForm(),
      province: matchMode === "auto" ? DEFAULT_PROVINCE : "",
      matchMode
    });
  }, [getRowsFromForm, matchMode, resetSeed, setForm]);

  useEffect(() => {
    if (previousMatchMode.current === matchMode) return;
    setModeError("");

    if (matchMode === "auto") {
      const rows = getRowsFromForm("");
      setCompetitorRows(rows);
      lastSyncedCompetitorValue.current = "";
      setForm((prev) => ({ ...prev, province: prev.province || DEFAULT_PROVINCE, competitorCompanyName: "" }));
    } else {
      setForm((prev) => ({ ...prev, province: "" }));
    }

    previousMatchMode.current = matchMode;
  }, [getRowsFromForm, matchMode, setForm]);

  useEffect(() => {
    if ((form.competitorCompanyName || "") !== lastSyncedCompetitorValue.current) {
      setCompetitorRows(getRowsFromForm(form.competitorCompanyName));
      lastSyncedCompetitorValue.current = form.competitorCompanyName || "";
    }
  }, [form.competitorCompanyName, getRowsFromForm]);

  const syncCompetitorRowsToForm = (rows) => {
    const value = rows.map((item) => item.trim()).filter(Boolean).slice(0, MAX_COMPETITOR_COUNT).join("、");
    lastSyncedCompetitorValue.current = value;
    setForm((prev) => ({ ...prev, competitorCompanyName: value }));
  };

  const switchMatchMode = (mode) => {
    setModeError("");
    if (mode === matchMode) return;
    onMatchModeChange(mode);

    if (mode === "auto") {
      const rows = getRowsFromForm("");
      setCompetitorRows(rows);
      lastSyncedCompetitorValue.current = "";
      setForm((prev) => ({ ...prev, province: prev.province || DEFAULT_PROVINCE, competitorCompanyName: "" }));
      return;
    }

    setForm((prev) => ({ ...prev, province: "" }));
  };

  const updateCompetitorAt = (index, value) => {
    setModeError("");
    const next = competitorRows.map((item, itemIndex) => (itemIndex === index ? value : item));
    setCompetitorRows(next);
    syncCompetitorRowsToForm(next);
  };

  const removeCompetitorAt = (index) => {
    const next = competitorRows.length > DEFAULT_COMPETITOR_ROWS
      ? competitorRows.filter((_, itemIndex) => itemIndex !== index)
      : competitorRows.map((item, itemIndex) => (itemIndex === index ? "" : item));
    setCompetitorRows(next);
    syncCompetitorRowsToForm(next);
  };

  const addCompetitor = () => {
    if (competitorRows.length >= MAX_COMPETITOR_COUNT) return;
    const next = [...competitorRows, ""];
    const nextIndex = next.length - 1;
    setCompetitorRows(next);
    syncCompetitorRowsToForm(next);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-competitor-input="${nextIndex}"]`)?.focus();
    });
  };

  const submitAnalysis = (event) => {
    event.preventDefault();
    if (isLoading) return;

    if (matchMode === "exact" && splitCompetitorNames(form.competitorCompanyName).length === 0) {
      setModeError("请至少输入一家竞争对手企业名称。");
      setCompetitorDrawerOpen(true);
      return;
    }
    if (matchMode === "exact" && hasSameAsTargetCompetitor) {
      setModeError(SAME_COMPANY_NAME_ERROR);
      setCompetitorDrawerOpen(true);
      return;
    }
    if (matchMode === "exact" && hasDuplicateCompetitor) {
      setModeError(DUPLICATE_COMPETITOR_NAME_ERROR);
      setCompetitorDrawerOpen(true);
      return;
    }

    setModeError("");
    onAnalyze(event);
  };

  return (
    <main className="main-canvas main-canvas--home">
      <div className="home-page-shell">
        <section className="home-center-panel" aria-label="竞争分析首页">
          <div className="home-content-wrap">
            <header className="hero-head">
              <div className="hero-copy">
                <h1>企业竞争力深度分析</h1>
              </div>
            </header>

            <div className={`match-switch match-switch--${matchMode}`} role="tablist" aria-label="竞争对手匹配模式">
              <button
                type="button"
                className={`match-switch-btn ${matchMode === "auto" ? "match-switch-btn--active" : ""}`}
                onClick={() => switchMatchMode("auto")}
                role="tab"
                aria-selected={matchMode === "auto"}
              >
                自动匹配
              </button>
              <button
                type="button"
                className={`match-switch-btn ${matchMode === "exact" ? "match-switch-btn--active" : ""}`}
                onClick={() => switchMatchMode("exact")}
                role="tab"
                aria-selected={matchMode === "exact"}
              >
                精确匹配
              </button>
            </div>

            <form className="analysis-form home-compare-form" onSubmit={submitAnalysis}>
              <div className="home-form-grid">
                <div className="home-form-column">
                  <FieldGroup icon="search" label="您的企业名称" className="home-company-field">
                    <CompanyValidationInput
                      value={form.targetCompanyName}
                      onChange={(value, confirmed, company) => {
                        setModeError("");
                        setForm((prev) => ({
                          ...prev,
                          targetCompanyName: value,
                          targetCompanyIntro: confirmed ? company?.intro || "" : "",
                          targetCompanyBusiness: confirmed ? company?.business || "" : "",
                          targetCompanyConfirmed: Boolean(confirmed)
                        }));
                      }}
                      placeholder="请输入我方企业名称"
                      inputProps={{ name: "targetCompanyName" }}
                      requireCompanyDetails
                    />
                  </FieldGroup>
                </div>

                <div className="home-vs-divider" aria-hidden>
                  <span>VS</span>
                </div>

                <div className="home-form-column home-form-column--right">
                  {matchMode === "auto" ? (
                    <div className="match-mode-content match-mode-content--auto home-mode-panel" key="auto">
                      <FieldGroup
                        icon="search"
                        label="选择省份"
                        hint="系统会基于所选省份自动匹配最合适的 5 家企业"
                        className="home-province-field"
                      >
                        <select
                          name="province"
                          value={form.province || DEFAULT_PROVINCE}
                          onChange={(event) => setForm((prev) => ({ ...prev, province: event.target.value }))}
                        >
                          {PROVINCES.map((province) => <option value={province} key={province}>{province}</option>)}
                        </select>
                      </FieldGroup>
                      <p className="home-mode-note">自动匹配会根据省份筛选 5 家对手，适合快速生成第一版竞争分析。</p>
                    </div>
                  ) : (
                    <div className="match-mode-content match-mode-content--exact home-mode-panel competitor-summary-panel" key="exact">
                      <div className="field-title">竞争对手</div>
                      <button
                        type="button"
                        className="competitor-summary-card"
                        onClick={() => setCompetitorDrawerOpen(true)}
                        aria-haspopup="dialog"
                      >
                        <span className="competitor-summary-main">
                          <strong>{competitorNames.length > 0 ? `${competitorNames.length} 家已配置` : "尚未配置对手"}</strong>
                          <small>{competitorNames.length > 0 ? competitorNames.join("、") : "打开侧栏录入 1-5 家企业"}</small>
                        </span>
                        <span className="competitor-summary-action">配置</span>
                      </button>
                      <p className="home-mode-note">精确匹配适合已有明确对手名单的场景，主页仅保留配置摘要。</p>
                    </div>
                  )}
                </div>
              </div>

              {(apiError || modeError) && <p className="api-error">{modeError || apiError}</p>}

              <div className="home-action-row">
                <button type="submit" className="primary-action" disabled={isLoading || hasBlockingCompetitorError}>
                  <span>{isLoading ? "分析中..." : "开始分析"}</span>
                  <span aria-hidden>→</span>
                </button>
              </div>
            </form>
          </div>
        </section>

        {competitorDrawerOpen ? (
          <div className="competitor-drawer-layer" role="presentation">
            <button
              type="button"
              className="competitor-drawer-backdrop"
              aria-label="关闭竞争对手配置"
              onClick={() => setCompetitorDrawerOpen(false)}
            />
            <aside className="competitor-drawer" role="dialog" aria-modal="true" aria-labelledby="competitor-drawer-title">
              <div className="competitor-drawer-head">
                <div>
                  <h2 id="competitor-drawer-title">配置竞争对手</h2>
                  <p>最多录入 5 家企业，校验通过后即可开始分析。</p>
                </div>
                <button type="button" className="competitor-drawer-close" onClick={() => setCompetitorDrawerOpen(false)} aria-label="关闭">
                  ×
                </button>
              </div>

              <div className="competitor-drawer-body">
                <div className="manual-list-head">
                  <span className="field-title">竞争对手名称</span>
                  <button
                    type="button"
                    className="mini-add"
                    onClick={addCompetitor}
                    disabled={competitorRows.length >= MAX_COMPETITOR_COUNT}
                    aria-label="新增竞争对手输入行"
                  >
                    + 添加
                  </button>
                </div>
                <div className="competitor-input-list">
                  {competitorRows.map((name, index) => {
                    const isSameAsTarget = sameAsTargetCompetitorIndexes.has(index);
                    const isDuplicateCompetitor = duplicateCompetitorIndexes.has(index);
                    const rowError = isSameAsTarget
                      ? SAME_COMPANY_NAME_ERROR
                      : isDuplicateCompetitor
                        ? DUPLICATE_COMPETITOR_NAME_ERROR
                        : "";
                    const errorId = `competitor-name-error-${index}`;
                    return (
                      <div className={`competitor-input-row ${rowError ? "competitor-input-row--error" : ""}`.trim()} key={`competitor-row-${index}`}>
                        <CompanyValidationInput
                          value={name}
                          onChange={(value) => updateCompetitorAt(index, value)}
                          placeholder="请输入竞争对手名称"
                          className={rowError ? "company-validation-input--error" : ""}
                          suspendValidation={Boolean(rowError)}
                          inputProps={{
                            "data-competitor-input": index,
                            "aria-invalid": rowError ? "true" : undefined,
                            "aria-describedby": rowError ? errorId : undefined
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => removeCompetitorAt(index)}
                          disabled={!name.trim() && competitorRows.length <= DEFAULT_COMPETITOR_ROWS}
                          aria-label={competitorRows.length > DEFAULT_COMPETITOR_ROWS ? "删除竞争对手输入行" : "清空竞争对手输入行"}
                          title={competitorRows.length > DEFAULT_COMPETITOR_ROWS ? "删除竞争对手输入行" : "清空竞争对手输入行"}
                        >
                          ×
                        </button>
                        {rowError && <p className="competitor-row-error" id={errorId}>{rowError}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="competitor-drawer-footer">
                {(modeError || hasBlockingCompetitorError) ? <p className="drawer-error">{modeError || "请先处理竞争对手名称错误。"}</p> : null}
                <button type="button" className="secondary-action" onClick={() => setCompetitorDrawerOpen(false)}>
                  完成配置
                </button>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function ResultsPage({
  form,
  targetCompanyInfo,
  targetDetail,
  competitors,
  competitorDetails,
  compareReports,
  scoreResult,
  selectedCompetitorId,
  onSelectCompetitor,
  activeTab,
  setActiveTab,
  onExport,
  isLoading,
  apiError,
  singleMode,
  targetDetailStatus,
  targetDetailError,
  scoreStatus,
  scoreError,
  finalizing,
  analysisMessage
}) {
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(activeTab !== DEFAULT_RESULT_TAB);
  const scoreItems = Array.isArray(scoreResult?.竞争对手分析与打分) ? scoreResult.竞争对手分析与打分 : [];
  const scoreByName = useMemo(() => {
    return buildScoreItemNameMap(scoreItems);
  }, [scoreItems]);
  const displayCompetitors = useMemo(() => {
    return competitors.map((item) => {
      if (!isPendingCompetitorIntro(item.intro)) return item;
      const scoreItem = getScoreItemByCompanyName(scoreByName, item.name);
      const scoreSummary = compactCardSummary(scoreItem?.竞争分析小结);
      const detailSummary = getCompetitorDetailSummary(competitorDetails[item.id]?.data || null);
      const intro = scoreSummary || detailSummary;
      return intro ? { ...item, intro } : item;
    });
  }, [competitors, competitorDetails, scoreByName]);

  const selectedCompetitor = displayCompetitors.find((item) => item.id === selectedCompetitorId) || displayCompetitors[0] || null;
  const selectedDetailEntry = selectedCompetitor ? competitorDetails[selectedCompetitor.id] || {} : {};
  const selectedDetail = selectedDetailEntry?.data || null;
  const selectedReport = selectedCompetitor ? compareReports[selectedCompetitor.id] : null;
  const selectedScoreItem = selectedCompetitor
    ? getScoreItemByCompanyName(scoreByName, selectedCompetitor.name)
    : null;
  const openDetailDrawer = useCallback((tab = "公司近况") => {
    const nextTab = tab === "对比分析报告" ? "对比分析报告" : "公司近况";
    setActiveTab(nextTab);
    setDetailDrawerOpen(true);
  }, [setActiveTab]);
  const closeDetailDrawer = useCallback(() => {
    setDetailDrawerOpen(false);
    setActiveTab(DEFAULT_RESULT_TAB);
  }, [setActiveTab]);

  useEffect(() => {
    if (activeTab !== DEFAULT_RESULT_TAB && selectedCompetitor) {
      setDetailDrawerOpen(true);
    }
  }, [activeTab, selectedCompetitor]);

  return (
    <main className="main-canvas main-canvas--results">
      <CompanyOverview
        targetName={form.targetCompanyName}
        targetCompanyInfo={targetCompanyInfo}
        targetDetail={targetDetail}
        detailStatus={targetDetailStatus}
        detailError={targetDetailError}
        isLoading={targetDetailStatus === "loading"}
      />

      <section className="competitor-section">
        <div className="section-title-row">
          <h2>竞争对手列表 <span>（{competitors.length}家）</span></h2>
          <div className="section-title-actions">
            {isLoading && finalizing && <span className="loading-chip"><ResultPendingText>正在保存完整结果</ResultPendingText></span>}
            {scoreStatus === "loading" && <span className="loading-chip"><ResultPendingText>评分生成中</ResultPendingText></span>}
            {scoreStatus === "error" && <span className="status-dot status-dot--error">评分失败</span>}
            <button type="button" className="export-btn section-export-btn" onClick={onExport} disabled={competitors.length === 0}>
              <Icon name="download" />导出报告
            </button>
          </div>
        </div>
        {apiError && <p className="api-error api-error--inline">{apiError}</p>}
        {scoreStatus === "error" && scoreError && <p className="api-error api-error--inline">评分失败：{scoreError}</p>}
        {competitors.length === 0 && isLoading && (
          <AnalysisLoadingCard
            title="竞争对手列表生成中"
            steps={[
              { label: "读取我方企业信息", state: "done" },
              { label: "筛选候选竞争对手", state: "active", detail: "正在根据地区、业务与公开信号匹配" },
              { label: "生成竞争对手卡片", state: "pending" }
            ]}
          />
        )}
        <div className="competitor-grid">
          {displayCompetitors.map((item) => {
            const scoreItem = getScoreItemByCompanyName(scoreByName, item.name);
            return (
              <CompetitorCard
                item={item}
                key={item.id}
                scoreItem={scoreItem}
                detailData={competitorDetails[item.id]?.data || null}
                detailStatus={competitorDetails[item.id]?.status || "idle"}
                reportStatus={compareReports[item.id]?.status || "idle"}
                scoreStatus={scoreStatus}
                detailError={competitorDetails[item.id]?.error || ""}
                reportError={compareReports[item.id]?.error || ""}
                isActive={selectedCompetitor?.id === item.id}
                onClick={() => onSelectCompetitor(item.id)}
              />
            );
          })}
        </div>
      </section>

      <DetailPanel
        selectedCompetitor={selectedCompetitor}
        selectedScoreItem={selectedScoreItem}
        onOpenDrawer={openDetailDrawer}
      />

      <ResultDetailDrawer
        open={detailDrawerOpen}
        targetName={form.targetCompanyName}
        selectedCompetitor={selectedCompetitor}
        selectedDetail={selectedDetail}
        selectedDetailStatus={selectedDetailEntry?.status || "idle"}
        selectedDetailError={selectedDetailEntry?.error || ""}
        selectedReport={selectedReport}
        selectedScoreItem={selectedScoreItem}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onClose={closeDetailDrawer}
      />
    </main>
  );
}


export default function LegacyCompetitorAnalysisApp() {
  const initialRoute = useMemo(() => parseAppRoute(), []);
  const storedRunningAnalysis = useMemo(() => readStoredRunningAnalysis(), []);
  const initialRunningSnapshot = useMemo(() => {
    if (initialRoute.page !== "results") return null;
    if (!storedRunningAnalysis?.id || storedRunningAnalysis.id !== initialRoute.resultId) return null;
    return storedRunningAnalysis.snapshot || null;
  }, [initialRoute, storedRunningAnalysis]);

  const [form, setForm] = useState(() => ({ ...createEmptyForm(), ...(initialRunningSnapshot?.form || {}) }));
  const [phase, setPhase] = useState(initialRunningSnapshot ? "results" : "home");
  const [isLoading, setIsLoading] = useState(Boolean(initialRunningSnapshot?.isLoading));
  const [apiError, setApiError] = useState("");
  const [targetCompanyInfo, setTargetCompanyInfo] = useState(initialRunningSnapshot?.targetCompanyInfo || null);
  const [targetDetail, setTargetDetail] = useState(initialRunningSnapshot?.targetDetail || null);
  const [competitors, setCompetitors] = useState(() => (Array.isArray(initialRunningSnapshot?.competitors) ? initialRunningSnapshot.competitors : []));
  const [competitorDetails, setCompetitorDetails] = useState(initialRunningSnapshot?.competitorDetails || {});
  const [compareReports, setCompareReports] = useState(initialRunningSnapshot?.compareReports || {});
  const [scoreResult, setScoreResult] = useState(initialRunningSnapshot?.scoreResult || null);
  const [historyItems, setHistoryItems] = useState([]);
  const [activeHistoryId, setActiveHistoryId] = useState(initialRunningSnapshot ? storedRunningAnalysis.id : "");
  const [homeResetSeed, setHomeResetSeed] = useState(0);
  const [queryTime, setQueryTime] = useState(initialRunningSnapshot?.queryTime || "");
  const [selectedCompetitorId, setSelectedCompetitorId] = useState(initialRunningSnapshot?.selectedCompetitorId || null);
  const [activeTab, setActiveTab] = useState(initialRunningSnapshot?.activeTab || DEFAULT_RESULT_TAB);
  const [homeMatchMode, setHomeMatchMode] = useState(initialRoute.mode === "exact" ? "exact" : "auto");
  const [singleMode, setSingleMode] = useState(Boolean(initialRunningSnapshot?.singleMode));
  const [targetDetailStatus, setTargetDetailStatus] = useState(initialRunningSnapshot?.targetDetailStatus || "idle");
  const [targetDetailError, setTargetDetailError] = useState(initialRunningSnapshot?.targetDetailError || "");
  const [scoreStatus, setScoreStatus] = useState(initialRunningSnapshot?.scoreStatus || "idle");
  const [scoreError, setScoreError] = useState(initialRunningSnapshot?.scoreError || "");
  const [finalizing, setFinalizing] = useState(Boolean(initialRunningSnapshot?.finalizing));
  const [analysisMessage, setAnalysisMessage] = useState(initialRunningSnapshot?.analysisMessage || "");
  const [runningResultId, setRunningResultId] = useState(initialRunningSnapshot ? storedRunningAnalysis.id : "");
  const latestRouteRuntimeRef = useRef({ runningResultId, competitors });
  const lastRestoredRouteKeyRef = useRef("");
  const settledHistoryRecordsRef = useRef(new Map());

  useEffect(() => {
    latestRouteRuntimeRef.current = { runningResultId, competitors };
  }, [runningResultId, competitors]);

  const rememberSettledHistoryRecord = useCallback((record) => {
    if (isSettledHistoryRecord(record)) {
      settledHistoryRecordsRef.current.set(record.id, record);
    }
  }, []);

  const normalizeHistoryRecord = useCallback((record) => {
    if (!record?.id) return record;
    const settledRecord = settledHistoryRecordsRef.current.get(record.id);
    const normalized = settledRecord && isRunningHistoryRecord(record) ? settledRecord : record;
    rememberSettledHistoryRecord(normalized);
    return normalized;
  }, [rememberSettledHistoryRecord]);

  const normalizeHistoryItems = useCallback(
    (items) => (Array.isArray(items) ? items.map((item) => normalizeHistoryRecord(item)) : []),
    [normalizeHistoryRecord]
  );

  const applyRecordSnapshot = useCallback((record, routeState = {}) => {
    const snap = record?.stateSnapshot || {};
    const restoredForm = { ...createEmptyForm(), ...(snap.form || record.input || {}) };
    const restoredCompetitors = Array.isArray(snap.competitors) ? snap.competitors : [];
    const requestedCompetitorId = routeState.selectedCompetitorId || snap.selectedCompetitorId || null;
    const restoredSelectedCompetitorId = restoredCompetitors.some((item) => item.id === requestedCompetitorId)
      ? requestedCompetitorId
      : null;

    setForm(restoredForm);
    setTargetCompanyInfo(snap.targetCompanyInfo || null);
    setTargetDetail(snap.targetDetail || null);
    setCompetitors(restoredCompetitors);
    setCompetitorDetails(snap.competitorDetails || {});
    setCompareReports(snap.compareReports || {});
    setScoreResult(snap.scoreResult || null);
    setQueryTime(snap.queryTime || record.queryTime || "");
    setSingleMode(Boolean(snap.singleMode || splitCompetitorNames(restoredForm.competitorCompanyName).length === 1));
    setSelectedCompetitorId(restoredSelectedCompetitorId);
    setActiveTab(routeState.activeTab || snap.activeTab || DEFAULT_RESULT_TAB);
    setPhase((snap.phase || snap.workPhase) === "input" ? "home" : "results");
    setActiveHistoryId(record.id || "");
    setTargetDetailStatus(snap.targetDetailStatus || (snap.targetDetail ? "success" : "idle"));
    setTargetDetailError(snap.targetDetailError || "");
    setScoreStatus(snap.scoreStatus || (snap.scoreResult ? "success" : "idle"));
    setScoreError(snap.scoreError || "");
    setFinalizing(Boolean(snap.finalizing));
    setAnalysisMessage(snap.analysisMessage || "");
    setRunningResultId("");
    setIsLoading(false);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const items = await listHistory();
      const normalizedItems = normalizeHistoryItems(items);
      setHistoryItems(normalizedItems);
      return normalizedItems;
    } catch (error) {
      setHistoryItems([]);
      setApiError((prev) => prev || `后端历史记录服务不可用：${error.message || error}`);
      return [];
    }
  }, [normalizeHistoryItems]);

  const restoreHistory = useCallback(
    (record, options = {}) => {
      const { syncUrl = true, routeState = {} } = options;
      const normalizedRecord = normalizeHistoryRecord(record);
      applyRecordSnapshot(normalizedRecord, routeState);
      setApiError(Array.isArray(normalizedRecord?.warnings) && normalizedRecord.warnings.length ? normalizedRecord.warnings.join("；") : "");
      if (syncUrl && normalizedRecord?.id) {
        pushResultRoute(normalizedRecord.id, getRecordRouteOptions(normalizedRecord, routeState));
      }
    },
    [applyRecordSnapshot, normalizeHistoryRecord]
  );

  const openHistoryRecord = useCallback(
    async (recordOrId) => {
      const resultId = typeof recordOrId === "string" ? recordOrId : recordOrId?.id;
      if (!resultId) return;

      // 先同步地址栏，再拉完整快照。这样侧边栏历史点击一定能形成 /results/{result_id} 的真实路由，
      // 同时避免把列表摘要当成完整结果渲染。
      setActiveHistoryId(resultId);
      pushResultRoute(resultId, { tab: getResultTabRouteKey(DEFAULT_RESULT_TAB) });

      try {
        const record = recordOrId?.stateSnapshot ? recordOrId : await getHistoryRecord(resultId);
        if (record) {
          restoreHistory(record, { syncUrl: false });
          replaceResultRoute(resultId, getRecordRouteOptions(record));
        }
      } catch (error) {
        setApiError(`未找到历史结果 ${resultId}：${error.message || error}`);
      }
    },
    [restoreHistory]
  );

  const startNewCompare = useCallback((options = {}) => {
    const { syncUrl = true } = options;
    const nextMode = options.mode === "exact" ? "exact" : "auto";

    if (isLoading && runningResultId) {
      setHomeMatchMode(nextMode);
      setPhase("home");
      setHomeResetSeed((value) => value + 1);
      if (syncUrl) {
        pushHomeRoute({ mode: nextMode });
      }
      return;
    }

    setForm(createEmptyForm());
    setHomeMatchMode(nextMode);
    setPhase("home");
    setApiError("");
    setTargetCompanyInfo(null);
    setTargetDetail(null);
    setCompetitors([]);
    setCompetitorDetails({});
    setCompareReports({});
    setScoreResult(null);
    setQueryTime("");
    setSingleMode(false);
    setActiveTab(DEFAULT_RESULT_TAB);
    setActiveHistoryId("");
    setSelectedCompetitorId(null);
    setTargetDetailStatus("idle");
    setTargetDetailError("");
    setScoreStatus("idle");
    setScoreError("");
    setFinalizing(false);
    setAnalysisMessage("");
    setRunningResultId("");
    setHomeResetSeed((value) => value + 1);
    if (syncUrl) {
      pushHomeRoute({ mode: nextMode });
    }
  }, [isLoading, runningResultId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!runningResultId) {
      clearStoredRunningAnalysis();
      return;
    }

    writeStoredRunningAnalysis({
      id: runningResultId,
      snapshot: {
        form,
        targetCompanyInfo,
        targetDetail,
        competitors,
        competitorDetails,
        compareReports,
        scoreResult,
        queryTime,
        selectedCompetitorId,
        activeTab,
        singleMode,
        targetDetailStatus,
        targetDetailError,
        scoreStatus,
        scoreError,
        finalizing,
        analysisMessage,
        isLoading
      }
    });
  }, [
    activeTab,
    analysisMessage,
    compareReports,
    competitorDetails,
    competitors,
    finalizing,
    form,
    isLoading,
    queryTime,
    runningResultId,
    scoreError,
    scoreResult,
    scoreStatus,
    selectedCompetitorId,
    singleMode,
    targetCompanyInfo,
    targetDetail,
    targetDetailError,
    targetDetailStatus
  ]);

  useEffect(() => {
    let cancelled = false;

    const buildRouteRestoreKey = (route) => [
      route.resultId || "",
      route.competitorId || "",
      route.tab || ""
    ].join("|");

    const restoreFromRoute = async (route = parseAppRoute(), options = {}) => {
      if (route.page !== "results" || !route.resultId) return;

      const routeKey = buildRouteRestoreKey(route);
      if (!options.force && lastRestoredRouteKeyRef.current === routeKey) return;
      lastRestoredRouteKeyRef.current = routeKey;

      const routeState = {};
      if (route.competitorId) routeState.selectedCompetitorId = route.competitorId;
      if (route.tab) routeState.activeTab = getResultTabLabel(route.tab);

      const { runningResultId: currentRunningResultId, competitors: currentCompetitors } = latestRouteRuntimeRef.current;
      if (route.resultId === currentRunningResultId) {
        setPhase("results");
        setActiveHistoryId(currentRunningResultId);
        if (routeState.activeTab) setActiveTab(routeState.activeTab);
        if (routeState.selectedCompetitorId && currentCompetitors.some((item) => item.id === routeState.selectedCompetitorId)) {
          setSelectedCompetitorId(routeState.selectedCompetitorId);
        }
        return;
      }

      try {
        const record = await getHistoryRecord(route.resultId);
        if (!cancelled && record) {
          restoreHistory(record, { syncUrl: false, routeState });
        }
      } catch (error) {
        if (!cancelled) {
          lastRestoredRouteKeyRef.current = "";
          setApiError(`未找到历史结果 ${route.resultId}：${error.message || error}`);
        }
      }
    };

    const currentRoute = parseAppRoute();
    if (currentRoute.page === "results") {
      restoreFromRoute(currentRoute);
    } else {
      lastRestoredRouteKeyRef.current = "";
      setHomeMatchMode(currentRoute.mode);
    }

    const onPopState = () => {
      const route = parseAppRoute();
      if (route.page === "results" && route.resultId) {
        restoreFromRoute(route, { force: true });
      } else {
        lastRestoredRouteKeyRef.current = "";
        startNewCompare({ syncUrl: false, mode: route.mode });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", onPopState);
    };
  }, [restoreHistory, startNewCompare]);

  const handleHomeMatchModeChange = useCallback((mode) => {
    const nextMode = mode === "exact" ? "exact" : "auto";
    setHomeMatchMode(nextMode);
    pushHomeRoute({ mode: nextMode });
  }, []);

  const handleSelectCompetitor = useCallback(
    (competitorId) => {
      setSelectedCompetitorId(competitorId);
      setActiveTab(DEFAULT_RESULT_TAB);
      if (activeHistoryId) {
        pushResultRoute(activeHistoryId, {
          competitorId,
          tab: getResultTabRouteKey(DEFAULT_RESULT_TAB)
        });
      }
    },
    [activeHistoryId]
  );

  const handleActiveTabChange = useCallback(
    (tab) => {
      setActiveTab(tab);
      if (activeHistoryId) {
        pushResultRoute(activeHistoryId, {
          competitorId: selectedCompetitorId,
          tab: getResultTabRouteKey(tab)
        });
      }
    },
    [activeHistoryId, selectedCompetitorId]
  );

  const openRunningAnalysis = useCallback(() => {
    if (!runningResultId) return;
    setPhase("results");
    setActiveHistoryId(runningResultId);
    pushResultRoute(runningResultId, {
      competitorId: selectedCompetitorId,
      tab: getResultTabRouteKey(activeTab)
    });
  }, [activeTab, runningResultId, selectedCompetitorId]);

  const handleAnalyze = async (event) => {
    event?.preventDefault();
    if (isLoading) return;

    let targetName = form.targetCompanyName.trim();
    let targetCompanyIntro = String(form.targetCompanyIntro || "").trim();
    let targetCompanyBusiness = String(form.targetCompanyBusiness || "").trim();
    let targetCompanyConfirmed = Boolean(form.targetCompanyConfirmed);
    const province = (form.province || DEFAULT_PROVINCE).trim();
    const manualNames = splitCompetitorNames(form.competitorCompanyName);

    if (!targetName) {
      setApiError("请先输入我方企业名称。");
      return;
    }
    if (homeMatchMode === "exact" && manualNames.some((name) => isSameCompanyName(name, targetName))) {
      setApiError(SAME_COMPANY_NAME_ERROR);
      return;
    }

    if (homeMatchMode === "auto" && !hasCompanyDetails({ intro: targetCompanyIntro, business: targetCompanyBusiness })) {
      try {
        setApiError("正在确认我方企业信息，请稍候。");
        const payload = await runCompanyNameValidationWorkflow({ companyName: targetName });
        const result = extractCompanyValidationResult(payload);
        if (!hasCompanyDetails(result.company)) {
          const selectedFromCandidates = result.candidates.some((name) => isSameCompanyName(name, targetName));
          const selectedByWorkflowName = result.company?.name && isSameCompanyName(result.company.name, targetName);
          if (!targetCompanyConfirmed && !selectedFromCandidates && !selectedByWorkflowName) {
            setApiError(
              result.candidates.length
                ? "请先从企业名称候选中选择准确企业，再开始分析。"
                : "企业名称校验未返回企业介绍和主营业务，请补充准确企业名称后重试。"
            );
            return;
          }
        }
        targetName = result.company?.name || targetName;
        targetCompanyIntro = result.company?.intro || "";
        targetCompanyBusiness = result.company?.business || "";
        targetCompanyConfirmed = true;
        setForm((prev) => ({
          ...prev,
          targetCompanyName: targetName,
          targetCompanyIntro,
          targetCompanyBusiness,
          targetCompanyConfirmed
        }));
      } catch (error) {
        setApiError(`企业名称校验失败：${error.message || error}`);
        return;
      }
    }

    const currentForm = {
      targetCompanyName: targetName,
      targetCompanyIntro,
      targetCompanyBusiness,
      targetCompanyConfirmed,
      province,
      competitorCompanyName: manualNames.join("、"),
      matchMode: homeMatchMode
    };
    const currentTargetCompanyInfo = {
      name: targetName,
      intro: targetCompanyIntro,
      business: targetCompanyBusiness
    };

    const optimisticCompetitors = manualNames.map((name, index) => ({
      id: `manual-${index + 1}`,
      name,
      intro: "正在补全企业详情。",
      threatScore: null,
      sourceTag: "指定竞争对手"
    }));
    const optimisticStatusMap = Object.fromEntries(
      optimisticCompetitors.map((item) => [item.id, { status: "loading", data: null, error: "" }])
    );

    const pendingResultId = createPendingResultId();

    setForm(currentForm);
    setIsLoading(true);
    setFinalizing(false);
    setAnalysisMessage("分析已开始");
    setApiError("");
    setTargetCompanyInfo(currentTargetCompanyInfo);
    setTargetDetail(null);
    setTargetDetailStatus("loading");
    setTargetDetailError("");
    setCompetitors(optimisticCompetitors);
    setCompetitorDetails(optimisticStatusMap);
    setCompareReports(Object.fromEntries(optimisticCompetitors.map((item) => [item.id, { status: "loading", text: "", error: "" }])));
    setScoreResult(null);
    setScoreStatus("idle");
    setScoreError("");
    setSingleMode(manualNames.length === 1);
    setSelectedCompetitorId(optimisticCompetitors.length === 1 ? optimisticCompetitors[0].id : null);
    setActiveTab(DEFAULT_RESULT_TAB);
    setActiveHistoryId(pendingResultId);
    setRunningResultId(pendingResultId);
    setQueryTime(formatDateTime());
    setPhase("results");
    pushResultRoute(pendingResultId);

    let finishedRecord = null;
    let streamError = "";

    const initializeCompetitorStage = (items) => {
      const nextCompetitors = Array.isArray(items) ? items : [];
      setCompetitors(nextCompetitors);
      setCompetitorDetails(Object.fromEntries(
        nextCompetitors.map((item) => [item.id, { status: "loading", data: null, error: "" }])
      ));
      setCompareReports(Object.fromEntries(
        nextCompetitors.map((item) => [item.id, { status: "loading", text: "", error: "" }])
      ));
      setSingleMode(nextCompetitors.length === 1 || manualNames.length === 1);
      setSelectedCompetitorId((prev) => {
        if (nextCompetitors.some((item) => item.id === prev)) return prev;
        return nextCompetitors.length === 1 ? nextCompetitors[0].id : null;
      });
      setScoreStatus(nextCompetitors.length ? "loading" : "idle");
    };

    const markPendingStagesAsError = (message) => {
      setTargetDetailStatus((prev) => (prev === "loading" ? "error" : prev));
      setTargetDetailError((prev) => prev || message);
      setCompetitorDetails((prev) => Object.fromEntries(
        Object.entries(prev).map(([id, value]) => [
          id,
          value?.status === "loading" ? { ...value, status: "error", error: message } : value
        ])
      ));
      setCompareReports((prev) => Object.fromEntries(
        Object.entries(prev).map(([id, value]) => [
          id,
          value?.status === "loading" ? { ...value, status: "error", error: message } : value
        ])
      ));
      setScoreStatus((prev) => (prev === "loading" ? "error" : prev));
      setScoreError((prev) => prev || message);
    };

    const handleStreamEvent = (eventMessage) => {
      const eventType = eventMessage?.type;
      const data = eventMessage?.data || {};

      if (eventType === "analysis_started") {
        setAnalysisMessage(data.message || "分析已开始");
        setApiError("");
        setIsLoading(true);
        return;
      }

      if (eventType === "competitors_ready") {
        initializeCompetitorStage(Array.isArray(data) ? data : []);
        setAnalysisMessage("");
        return;
      }

      if (eventType === "target_detail_ready") {
        if (data.status === "success") {
          setTargetDetail(data.data || null);
          setTargetDetailStatus("success");
          setTargetDetailError("");
        } else {
          setTargetDetail(null);
          setTargetDetailStatus("error");
          setTargetDetailError(data.error || "我方企业详情加载失败");
        }
        return;
      }

      if (eventType === "competitor_detail_ready") {
        const competitorId = data.competitorId;
        if (!competitorId) return;
        setCompetitorDetails((prev) => ({
          ...prev,
          [competitorId]: {
            status: data.status === "success" ? "success" : "error",
            data: data.status === "success" ? data.data || null : null,
            error: data.status === "success" ? "" : data.error || "企业详情加载失败"
          }
        }));
        return;
      }

      if (eventType === "compare_report_ready") {
        const competitorId = data.competitorId;
        if (!competitorId) return;
        setCompareReports((prev) => ({
          ...prev,
          [competitorId]: {
            status: data.status === "success" ? "success" : "error",
            text: data.status === "success" ? data.text || "" : "",
            error: data.status === "success" ? "" : data.error || "对比报告生成失败"
          }
        }));
        return;
      }

      if (eventType === "score_ready") {
        if (data.status === "success") {
          setScoreResult(data.data || null);
          setScoreStatus("success");
          setScoreError("");
        } else {
          setScoreResult(null);
          setScoreStatus("error");
          setScoreError(data.error || "评分生成失败");
        }
        setFinalizing(true);
        return;
      }

      if (eventType === "analysis_finished") {
        const record = data.record;
        if (!record) {
          streamError = "后端未返回完整分析结果。";
          setApiError(streamError);
          setIsLoading(false);
          setFinalizing(false);
          return;
        }
        finishedRecord = record;
        rememberSettledHistoryRecord(record);
        clearStoredRunningAnalysis();
        setRunningResultId((current) => (current === record.id ? "" : current));
        restoreHistory(record, { syncUrl: true });
        setHistoryItems((prev) => normalizeHistoryItems([record, ...prev.filter((item) => item.id !== record.id)]).slice(0, 200));
        setApiError(Array.isArray(record.warnings) && record.warnings.length ? record.warnings.join("；") : "");
        setAnalysisMessage("分析完成");
        setFinalizing(false);
        setIsLoading(false);
        return;
      }

      if (eventType === "analysis_error") {
        streamError = data.message || "分析失败";
        markPendingStagesAsError(streamError);
        setApiError(streamError);
        setAnalysisMessage("");
        setFinalizing(false);
        setIsLoading(false);
      }
    };

    try {
      await runAnalysisStream({ ...currentForm, resultId: pendingResultId }, handleStreamEvent);
      if (finishedRecord) {
        await loadHistory();
      } else if (streamError) {
        setApiError(streamError);
      } else {
        throw new Error("分析流未返回完成事件。");
      }
    } catch (error) {
      const message = error.message || String(error);
      markPendingStagesAsError(message);
      setApiError(message);
    } finally {
      setIsLoading(false);
      setFinalizing(false);
    }
  };

  const exportReport = () => {
    const scoreItems = Array.isArray(scoreResult?.竞争对手分析与打分) ? scoreResult.竞争对手分析与打分 : [];
    const scoreByName = buildScoreItemNameMap(scoreItems);
    const lines = [
      `# ${form.targetCompanyName || "我方企业"} 竞争分析报告`,
      "",
      `生成时间：${queryTime || formatDateTime()}`,
      `省份：${form.province || "-"}`,
      "",
      "## 我方企业信息",
      targetCompanyInfo?.intro || "-",
      "",
      "## 竞争对手",
      ...competitors.map((item) => {
        const score = getScoreItemByCompanyName(scoreByName, item.name)?.威胁分数 || item.threatScore || "-";
        return `- ${item.name}：威胁分数 ${score}`;
      }),
      "",
      "## 对比分析报告",
      ...competitors.flatMap((item, index) => [
        ...(index > 0 ? [DOCX_PAGE_BREAK_MARKER] : []),
        `### ${item.name}`,
        compareReports[item.id]?.text || compareReports[item.id]?.error || "暂无报告",
        ""
      ]),
      "## 整体结论",
      scoreResult?.整体结论?.整体小结 || "-"
    ];
    const markdownText = lines.join("\n");
    downloadDocxFromMarkdown(markdownText, `${form.targetCompanyName || "竞争分析"}-报告.docx`, {
      title: `${form.targetCompanyName || "我方企业"} 竞争分析报告`
    });
  };

  return (
    <div className={`app-shell ${phase === "home" ? "app-shell--home" : "app-shell--results"}`}>
      <Sidebar
        historyItems={historyItems}
        runningItem={runningResultId ? { id: runningResultId, input: form, queryTime, isLoading } : null}
        onNewCompare={startNewCompare}
        onRestoreHistory={openHistoryRecord}
        onOpenRunning={openRunningAnalysis}
        activeHistoryId={activeHistoryId}
      />
      {phase === "home" ? (
        <HomePage
          form={form}
          setForm={setForm}
          matchMode={homeMatchMode}
          onMatchModeChange={handleHomeMatchModeChange}
          onAnalyze={handleAnalyze}
          isLoading={isLoading}
          apiError={apiError}
          resetSeed={homeResetSeed}
        />
      ) : (
        <ResultsPage
          form={form}
          targetCompanyInfo={targetCompanyInfo}
          targetDetail={targetDetail}
          competitors={competitors}
          competitorDetails={competitorDetails}
          compareReports={compareReports}
          scoreResult={scoreResult}
          selectedCompetitorId={selectedCompetitorId}
          onSelectCompetitor={handleSelectCompetitor}
          activeTab={activeTab}
          setActiveTab={handleActiveTabChange}
          onExport={exportReport}
          isLoading={isLoading}
          apiError={apiError}
          singleMode={singleMode}
          targetDetailStatus={targetDetailStatus}
          targetDetailError={targetDetailError}
          scoreStatus={scoreStatus}
          scoreError={scoreError}
          finalizing={finalizing}
          analysisMessage={analysisMessage}
        />
      )}
    </div>
  );
}
