import type { ModuleCode, PortalModule } from "../types/portal";

export const moduleEntries: PortalModule[] = [
  {
    slug: "competitor-analysis",
    code: "competitor-analysis",
    name: "竞对分析",
    shortName: "竞对",
    route: "/modules/competitor-analysis",
    apiPrefix: "/api/v1/competitor-analysis",
    legacyFrontend: "legacy/company-competitors-analysis",
    description: "公司竞对分析、报告生成和 workflow 调用能力。",
    status: "running",
  },
  {
    slug: "rag",
    code: "rag-web-search",
    name: "RAG 问答",
    shortName: "问答",
    route: "/modules/rag",
    iframeRoute: "/modules/rag",
    apiPrefix: "/api/v1/rag",
    legacyFrontend: "legacy/chat_with_rag_and_websearch/frontend",
    description: "知识库问答、Web Search、SSE 聊天和 Dataset 管理能力。",
    status: "running",
  },
  {
    slug: "contract-review",
    code: "contract-review",
    name: "合同审查",
    shortName: "合同",
    route: "/modules/contract-review",
    iframeRoute: "/modules/contract-review",
    apiPrefix: "/api/v1/contract-review",
    legacyFrontend: "",
    description: "合同风险审查、DOCX 批注、AI 改写和审查历史能力。",
    status: "running",
  },
  {
    slug: "bid-generator",
    code: "bid-generator",
    name: "标书生成",
    shortName: "标书",
    route: "/modules/bid-generator",
    apiPrefix: "/api/v1/bid-generator",
    legacyFrontend: "legacy/bid-generator/frontend-web",
    description: "标书项目、需求提取、内容生成、文档组装和导出能力。",
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
