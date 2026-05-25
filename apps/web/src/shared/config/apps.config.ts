import { ToolkitApp } from "../types/app";

function buildRuntimeUrl(port: number, path = "") {
  if (typeof window === "undefined") {
    return `http://localhost:${port}${path}`;
  }

  const protocol = window.location.protocol || "http:";
  return `${protocol}//${window.location.hostname}:${port}${path}`;
}

export const appsConfig: ToolkitApp[] = [
  {
    id: "bid-generator",
    name: "标书生成",
    shortName: "标书",
    description: "智能生成高质量标书，提升投标效率。",
    bannerText: "智能生成 · 高质规范 · 有效响应",
    ctaLabel: "进入应用",
    backgroundImage: "/app-backgrounds/bid-generator.png",
    url: buildRuntimeUrl(18110),
    backendUrl: buildRuntimeUrl(18115),
    healthUrl: buildRuntimeUrl(18115, "/health"),
    status: "running",
    healthStatus: "unknown",
    theme: "blue",
    icon: "file-text",
    moduleRepo: "app-bid-generator",
    group: "app-modules",
  },
  {
    id: "contract-review",
    name: "合同审查",
    shortName: "合同",
    description: "智能审查合同条款，识别风险隐患。",
    bannerText: "风险识别 · 条款审查 · 合规保障",
    ctaLabel: "进入应用",
    backgroundImage: "/app-backgrounds/contract-review.png",
    url: buildRuntimeUrl(18120),
    backendUrl: buildRuntimeUrl(18125),
    healthUrl: buildRuntimeUrl(18125, "/api/health"),
    status: "running",
    healthStatus: "unknown",
    theme: "emerald",
    icon: "shield-check",
    moduleRepo: "app-contract-review",
    group: "app-modules",
  },
  {
    id: "competitor-analysis",
    name: "企业竞品分析",
    shortName: "竞品",
    description: "多维分析竞品动态，洞察市场机会。",
    bannerText: "多维洞察 · 竞品监测 · 机会发现",
    ctaLabel: "进入应用",
    backgroundImage: "/app-backgrounds/competitor-analysis.png",
    url: buildRuntimeUrl(18130),
    backendUrl: buildRuntimeUrl(18135),
    healthUrl: buildRuntimeUrl(18135, "/api/health"),
    status: "running",
    healthStatus: "unknown",
    theme: "orange",
    icon: "chart-line",
    moduleRepo: "app-competitor-analysis",
    group: "app-modules",
  },
  {
    id: "rag-web-search",
    name: "RAG 问答",
    shortName: "问答",
    description: "基于知识库的智能问答，精准高效。",
    bannerText: "知识驱动 · 精准回答 · 高效协同",
    ctaLabel: "开始使用",
    backgroundImage: "/app-backgrounds/rag-web-search.png",
    url: buildRuntimeUrl(18140),
    backendUrl: buildRuntimeUrl(18145),
    healthUrl: buildRuntimeUrl(18145, "/api/v1/health"),
    status: "running",
    healthStatus: "unknown",
    theme: "amber",
    icon: "message-circle",
    moduleRepo: "app-rag-web-search",
    group: "app-modules",
  },
];

export function getAppById(appId: string) {
  return appsConfig.find((app) => app.id === appId);
}
