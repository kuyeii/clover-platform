import type { ModuleCode, PortalModule } from "../types/portal";

export const moduleEntries: PortalModule[] = [
  {
    slug: "bid-generator",
    code: "bid-generator",
    name: "标书生成",
    shortName: "标书",
    route: "/modules/bid-generator",
    apiPrefix: "/api/v1/bid-generator",
    description: "智能生成高质量标书，提升投标效率。",
    bannerText: "智能生成 · 高质规范 · 有效响应",
    ctaLabel: "进入应用",
    backgroundImage: "/app-backgrounds/bid-generator.png",
    status: "running",
  },
  {
    slug: "contract-review",
    code: "contract-review",
    name: "合同审查",
    shortName: "合同",
    route: "/modules/contract-review",
    apiPrefix: "/api/v1/contract-review",
    description: "智能审查合同条款，识别风险隐患。",
    bannerText: "风险识别 · 条款审查 · 合规保障",
    ctaLabel: "进入应用",
    backgroundImage: "/app-backgrounds/contract-review.png",
    status: "running",
  },
  {
    slug: "competitor-analysis",
    code: "competitor-analysis",
    name: "企业竞品分析",
    shortName: "竞品",
    route: "/modules/competitor-analysis",
    apiPrefix: "/api/v1/competitor-analysis",
    description: "多维分析竞品动态，洞察市场机会。",
    bannerText: "多维洞察 · 竞品监测 · 机会发现",
    ctaLabel: "进入应用",
    backgroundImage: "/app-backgrounds/competitor-analysis.png",
    status: "running",
  },
  {
    slug: "rag",
    code: "rag-web-search",
    name: "RAG 问答",
    shortName: "问答",
    route: "/modules/rag",
    apiPrefix: "/api/v1/rag",
    description: "基于知识库的智能问答，精准高效。",
    bannerText: "知识驱动 · 精准回答 · 高效协同",
    ctaLabel: "进入应用",
    backgroundImage: "/app-backgrounds/rag-web-search.png",
    status: "running",
  },
];

export function getModuleEntry(slug: PortalModule["slug"]): PortalModule {
  const entry = moduleEntries.find((item) => item.slug === slug);
  if (!entry) {
    throw new Error(`Unknown module slug: ${slug}`);
  }
  return entry;
}

export function getModuleByCode(code: ModuleCode): PortalModule | undefined {
  return moduleEntries.find((item) => item.code === code);
}

export function getModuleByRoute(pathname: string): PortalModule | undefined {
  return moduleEntries.find((item) => item.route === pathname);
}
