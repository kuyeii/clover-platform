import type { ReactNode } from "react";
import type { CompetitorAnalysisInput, CompetitorItem, HistoryRecord } from "./services/competitorApi";

export const DEFAULT_PROVINCE = "全国";
export const DEFAULT_RESULT_TAB = "总体信息";
export const RESULT_TABS = ["总体信息", "公司近况", "对比分析报告"];
export const MAX_COMPETITOR_COUNT = 5;

export const PROVINCES = [
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
  "内蒙古自治区",
  "广西壮族自治区",
  "西藏自治区",
  "宁夏回族自治区",
  "新疆维吾尔自治区",
  "香港特别行政区",
  "澳门特别行政区",
];

export function createEmptyForm(): CompetitorAnalysisInput {
  return {
    targetCompanyName: "",
    targetCompanyIntro: "",
    targetCompanyBusiness: "",
    targetCompanyConfirmed: false,
    province: DEFAULT_PROVINCE,
    competitorCompanyName: "",
    matchMode: "auto",
  };
}

export function splitCompetitorNames(value?: string) {
  return String(value || "")
    .split(/[,，;；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPETITOR_COUNT);
}

export function normalizeCompanyName(name?: string) {
  return String(name || "")
    .replace(/（[^（）]+）|\([^()]+\)|【[^【】]+】|\[[^\[\]]+\]/g, "")
    .replace(/[\s（）()【】\[\]·•.。,:：;；,，、\-＿_\/\\]/g, "")
    .replace(/(有限责任公司|股份有限公司|有限公司|公司|实验室|研究院)$/g, "")
    .toLowerCase();
}

export function isSameCompanyName(left?: string, right?: string) {
  const leftName = String(left || "").trim();
  const rightName = String(right || "").trim();
  if (!leftName || !rightName) {
    return false;
  }
  const normalizedLeft = normalizeCompanyName(leftName);
  const normalizedRight = normalizeCompanyName(rightName);
  return leftName === rightName || Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function formatDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function createPendingResultId() {
  return `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getRecordTitle(record: HistoryRecord) {
  return record.input?.targetCompanyName || record.title || "竞争分析记录";
}

export function getSnapshot<T>(record: HistoryRecord | null, key: string, fallback: T): T {
  const snap = record?.stateSnapshot;
  if (!snap || typeof snap !== "object") {
    return fallback;
  }
  return (snap as Record<string, unknown>)[key] as T ?? fallback;
}

export function compactText(value: unknown) {
  return typeof value === "string"
    ? value.replace(/[#*_`>~-]/g, "").replace(/\s+/g, " ").trim()
    : "";
}

export function getScoreItems(scoreResult: unknown) {
  const source = scoreResult as { 竞争对手分析与打分?: Array<Record<string, unknown>> } | null;
  return Array.isArray(source?.竞争对手分析与打分) ? source.竞争对手分析与打分 : [];
}

function getCompanyNameKeys(name?: string) {
  const raw = String(name || "").trim();
  const normalized = normalizeCompanyName(raw);
  return [raw, normalized].filter(Boolean);
}

export function getScoreItem(scoreResult: unknown, companyName?: string) {
  const keys = getCompanyNameKeys(companyName);
  return getScoreItems(scoreResult).find((item) =>
    keys.some((key) => getCompanyNameKeys(String(item.竞争对手企业 || "")).includes(key)),
  );
}

export function getThreatScore(item: CompetitorItem, scoreResult: unknown) {
  const scoreItem = getScoreItem(scoreResult, item.name);
  const raw = scoreItem?.威胁分数 ?? item.threatScore;
  const score = Number(raw);
  return Number.isFinite(score) ? Math.round(score) : null;
}

export function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stringifyValue).filter(Boolean).join("、");
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(stringifyValue).filter(Boolean).join("、");
  }
  return "";
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return null;
  }
  const clean = value.replace(/```json|```/gi, "").trim();
  if (!clean) {
    return null;
  }
  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      const parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function extractCompanyValidationResult(payload: Record<string, unknown>) {
  const rawOutputs = (payload.raw as { data?: { outputs?: Record<string, unknown> } } | undefined)?.data?.outputs || {};
  const parsed =
    parseJsonObject(payload.outputText) ||
    parseJsonObject(rawOutputs.text) ||
    parseJsonObject(rawOutputs.result) ||
    parseJsonObject(rawOutputs.output) ||
    {};
  const source = parsed as Record<string, unknown>;
  const companySource =
    parseJsonObject(payload.company) ||
    parseJsonObject(source.company) ||
    source ||
    rawOutputs;
  const company = {
    name: pickCompanyText(companySource, ["企业名称", "公司名称", "名称", "name", "companyName"]) || "",
    intro: pickCompanyText(companySource, ["企业介绍", "企业简介", "公司介绍", "公司简介", "intro", "description"]) || "",
    business: pickCompanyText(companySource, ["主营业务", "企业主营业务", "公司主营业务", "business", "mainBusiness"]) || "",
  };
  const candidates = normalizeCandidateCompanies(
    payload.candidateItems ||
      source["候选企业"] ||
      source.candidateCompanies ||
      source.candidates ||
      rawOutputs["候选企业"] ||
      rawOutputs.candidateCompanies,
  );
  return {
    company: company.name || company.intro || company.business ? company : null,
    candidates,
    cacheHit: Boolean(payload.cacheHit),
    cacheMiss: Boolean(payload.cacheMiss),
  };
}

function pickCompanyText(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return "";
  }
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = stringifyValue(record[key]).trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeCandidateCompanies(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : stringifyValue((item as Record<string, unknown>)?.name || item)))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[,，;；、\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function renderInlineMarkdown(text: string): ReactNode[] | string {
  const raw = String(text ?? "").replace(/\\\*/g, "*");
  if (!raw) {
    return "";
  }
  const segments: ReactNode[] = [];
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
      segments.push(<a key={`link-${key}`} href={match[5]} target="_blank" rel="noreferrer">{match[4]}</a>);
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
