import { ReactElement } from "react";

import { BidGeneratorPage } from "../modules/bid-generator/BidGeneratorPage";
import { CompetitorAnalysisPage } from "../modules/competitor-analysis/CompetitorAnalysisPage";
import { ContractReviewPage } from "../modules/contract-review/ContractReviewPage";
import { PatentDisclosurePage } from "../modules/patent-disclosure/PatentDisclosurePage";
import { RagPage } from "../modules/rag/RagPage";
import { BidReferenceSitesPage } from "../pages/BidReferenceSitesPage";
import { FeedbackPage } from "../pages/FeedbackPage";
import { KnowledgePage } from "../pages/KnowledgePage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { UserManagementPage } from "../pages/UserManagementPage";
import { WorkspacePage } from "../pages/WorkspacePage";
import { RequireAuth } from "../shared/components/RequireAuth";

export type NavigateFn = (href: string) => void;

export type RouteRenderContext = {
  navigate: NavigateFn;
  currentPath: string;
};

export type AppRoute = {
  path: string;
  label: string;
  public?: boolean;
  keepAliveKey?: string;
  render: (context: RouteRenderContext) => ReactElement;
};

function protectedPage(context: RouteRenderContext, page: ReactElement) {
  return (
    <RequireAuth currentPath={context.currentPath} navigate={context.navigate}>
      {page}
    </RequireAuth>
  );
}

export const appRoutes: AppRoute[] = [
  {
    path: "/",
    label: "工作台",
    render: (context) => protectedPage(context, <WorkspacePage navigate={context.navigate} />),
  },
  {
    path: "/login",
    label: "登录",
    public: true,
    render: ({ navigate }) => <LoginPage navigate={navigate} />,
  },
  {
    path: "/workspace",
    label: "工作台",
    render: (context) => protectedPage(context, <WorkspacePage navigate={context.navigate} />),
  },
  {
    path: "/dashboard",
    label: "工作台",
    render: (context) => protectedPage(context, <WorkspacePage navigate={context.navigate} />),
  },
  {
    path: "/knowledge",
    label: "知识库",
    render: (context) => protectedPage(context, <KnowledgePage />),
  },
  {
    path: "/users",
    label: "用户管理",
    render: (context) => protectedPage(context, <UserManagementPage />),
  },
  {
    path: "/settings",
    label: "用户管理",
    render: (context) => protectedPage(context, <UserManagementPage />),
  },
  {
    path: "/admin/users",
    label: "用户管理",
    render: (context) => protectedPage(context, <UserManagementPage />),
  },
  {
    path: "/bid-reference-sites",
    label: "招投标网址",
    render: (context) => protectedPage(context, <BidReferenceSitesPage />),
  },
  {
    path: "/feedback",
    label: "用户反馈",
    render: (context) => protectedPage(context, <FeedbackPage />),
  },
  {
    path: "/apps/competitor-analysis",
    label: "企业竞品分析",
    keepAliveKey: "competitor-analysis",
    render: (context) => protectedPage(context, <CompetitorAnalysisPage />),
  },
  {
    path: "/modules/competitor-analysis",
    label: "竞对分析",
    keepAliveKey: "competitor-analysis",
    render: (context) => protectedPage(context, <CompetitorAnalysisPage />),
  },
  {
    path: "/apps/rag-web-search",
    label: "RAG 问答",
    keepAliveKey: "rag-web-search",
    render: (context) => protectedPage(context, <RagPage />),
  },
  {
    path: "/apps/rag",
    label: "RAG 问答",
    keepAliveKey: "rag-web-search",
    render: (context) => protectedPage(context, <RagPage />),
  },
  {
    path: "/modules/rag",
    label: "RAG 问答",
    keepAliveKey: "rag-web-search",
    render: (context) => protectedPage(context, <RagPage />),
  },
  {
    path: "/apps/contract-review",
    label: "合同审查",
    keepAliveKey: "contract-review",
    render: (context) => protectedPage(context, <ContractReviewPage />),
  },
  {
    path: "/modules/contract-review",
    label: "合同审查",
    keepAliveKey: "contract-review",
    render: (context) => protectedPage(context, <ContractReviewPage />),
  },
  {
    path: "/apps/bid-generator",
    label: "标书生成",
    keepAliveKey: "bid-generator",
    render: (context) => protectedPage(context, <BidGeneratorPage />),
  },
  {
    path: "/modules/bid-generator",
    label: "标书生成",
    keepAliveKey: "bid-generator",
    render: (context) => protectedPage(context, <BidGeneratorPage />),
  },
  {
    path: "/apps/patent-disclosure",
    label: "专利交底书",
    keepAliveKey: "patent-disclosure",
    render: (context) => protectedPage(context, <PatentDisclosurePage />),
  },
  {
    path: "/modules/patent-disclosure",
    label: "专利交底书",
    keepAliveKey: "patent-disclosure",
    render: (context) => protectedPage(context, <PatentDisclosurePage />),
  },
];

export function resolveRoute(pathname: string): AppRoute {
  if (pathname.startsWith("/apps/competitor-analysis/")) {
    return {
      path: "/apps/competitor-analysis/*",
      label: "企业竞品分析",
      keepAliveKey: "competitor-analysis",
      render: (context) => protectedPage(context, <CompetitorAnalysisPage />),
    };
  }

  return appRoutes.find((route) => route.path === pathname) ?? {
    path: "*",
    label: "404",
    render: ({ navigate }) => <NotFoundPage navigate={navigate} />,
  };
}
