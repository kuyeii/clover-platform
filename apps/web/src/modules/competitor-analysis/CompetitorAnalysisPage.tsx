import type { CSSProperties } from "react";

import LegacyCompetitorAnalysisApp from "./legacy/App";

export function CompetitorAnalysisPage() {
  return (
    <div
      className="competitor-analysis-legacy-viewport"
      data-module="competitor-analysis"
      style={{ "--competitor-portal-offset-top": "56px" } as CSSProperties}
    >
      <LegacyCompetitorAnalysisApp />
    </div>
  );
}
