export type ModuleEntry = {
  slug: "competitor-analysis" | "rag" | "contract-review" | "bid-generator";
  code: string;
  name: string;
  route: string;
  apiPrefix: string;
  legacyFrontend: string;
  description: string;
};

export const moduleEntries: ModuleEntry[] = [
  {
    slug: "competitor-analysis",
    code: "competitor-analysis",
    name: "竞对分析",
    route: "/modules/competitor-analysis",
    apiPrefix: "/api/v1/competitor-analysis",
    legacyFrontend: "legacy/company-competitors-analysis",
    description: "公司竞对分析、报告生成和 workflow 调用能力。",
  },
  {
    slug: "rag",
    code: "rag-web-search",
    name: "RAG 问答",
    route: "/modules/rag",
    apiPrefix: "/api/v1/rag",
    legacyFrontend: "legacy/chat_with_rag_and_websearch/frontend",
    description: "知识库问答、Web Search、SSE 聊天和 Dataset 管理能力。",
  },
  {
    slug: "contract-review",
    code: "contract-review",
    name: "合同审查",
    route: "/modules/contract-review",
    apiPrefix: "/api/v1/contract-review",
    legacyFrontend: "legacy/contract_review/frontend",
    description: "合同风险审查、DOCX 批注、AI 改写和审查历史能力。",
  },
  {
    slug: "bid-generator",
    code: "bid-generator",
    name: "标书生成",
    route: "/modules/bid-generator",
    apiPrefix: "/api/v1/bid-generator",
    legacyFrontend: "legacy/bid-generator/frontend-web",
    description: "标书项目、需求提取、内容生成、文档组装和导出能力。",
  },
];

export function getModuleEntry(slug: ModuleEntry["slug"]): ModuleEntry {
  const entry = moduleEntries.find((item) => item.slug === slug);
  if (!entry) {
    throw new Error(`Unknown module slug: ${slug}`);
  }
  return entry;
}
