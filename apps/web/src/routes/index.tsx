import { ReactElement } from "react";

import { BidGeneratorPage } from "../modules/bid-generator/BidGeneratorPage";
import { CompetitorAnalysisPage } from "../modules/competitor-analysis/CompetitorAnalysisPage";
import { ContractReviewPage } from "../modules/contract-review/ContractReviewPage";
import { RagPage } from "../modules/rag/RagPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { WorkspacePage } from "../pages/WorkspacePage";

export type NavigateFn = (href: string) => void;

export type RouteRenderContext = {
  navigate: NavigateFn;
};

export type AppRoute = {
  path: string;
  label: string;
  render: (context: RouteRenderContext) => ReactElement;
};

export const appRoutes: AppRoute[] = [
  {
    path: "/",
    label: "工作台",
    render: ({ navigate }) => <WorkspacePage navigate={navigate} />,
  },
  {
    path: "/login",
    label: "登录",
    render: () => <LoginPage />,
  },
  {
    path: "/workspace",
    label: "工作台",
    render: ({ navigate }) => <WorkspacePage navigate={navigate} />,
  },
  {
    path: "/modules/competitor-analysis",
    label: "竞对分析",
    render: () => <CompetitorAnalysisPage />,
  },
  {
    path: "/modules/rag",
    label: "RAG 问答",
    render: () => <RagPage />,
  },
  {
    path: "/modules/contract-review",
    label: "合同审查",
    render: () => <ContractReviewPage />,
  },
  {
    path: "/modules/bid-generator",
    label: "标书生成",
    render: () => <BidGeneratorPage />,
  },
];

export function resolveRoute(pathname: string): AppRoute {
  return appRoutes.find((route) => route.path === pathname) ?? {
    path: "*",
    label: "404",
    render: ({ navigate }) => <NotFoundPage navigate={navigate} />,
  };
}
