import { ReactElement } from "react";

import { BidGeneratorPage } from "../modules/bid-generator/BidGeneratorPage";
import { CompetitorAnalysisPage } from "../modules/competitor-analysis/CompetitorAnalysisPage";
import { ContractReviewPage } from "../modules/contract-review/ContractReviewPage";
import { RagPage } from "../modules/rag/RagPage";
import { FeedbackPage } from "../pages/FeedbackPage";
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
    path: "/users",
    label: "用户管理",
    render: (context) => protectedPage(context, <UserManagementPage />),
  },
  {
    path: "/feedback",
    label: "用户反馈",
    render: (context) => protectedPage(context, <FeedbackPage />),
  },
  {
    path: "/modules/competitor-analysis",
    label: "竞对分析",
    render: (context) => protectedPage(context, <CompetitorAnalysisPage />),
  },
  {
    path: "/modules/rag",
    label: "RAG 问答",
    render: (context) => protectedPage(context, <RagPage />),
  },
  {
    path: "/modules/contract-review",
    label: "合同审查",
    render: (context) => protectedPage(context, <ContractReviewPage />),
  },
  {
    path: "/modules/bid-generator",
    label: "标书生成",
    render: (context) => protectedPage(context, <BidGeneratorPage />),
  },
];

export function resolveRoute(pathname: string): AppRoute {
  return appRoutes.find((route) => route.path === pathname) ?? {
    path: "*",
    label: "404",
    render: ({ navigate }) => <NotFoundPage navigate={navigate} />,
  };
}
