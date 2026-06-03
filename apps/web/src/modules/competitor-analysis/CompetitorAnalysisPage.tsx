import type { CSSProperties } from "react";

import LegacyCompetitorAnalysisApp from "./legacy/App";

export function CompetitorAnalysisPage() {
  return (
    <div
      className="competitor-analysis-legacy-viewport"
      data-module="competitor-analysis"
      style={{ "--competitor-portal-offset-top": "var(--portal-topbar-height)" } as CSSProperties}
    >
      <LegacyCompetitorAnalysisApp />
    </div>
  );
}
