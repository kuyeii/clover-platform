import { HashRouter } from "react-router-dom";

import LegacyContractReviewApp from "./legacy/App";
import "./legacy/index.css";
import "./legacy/legacy-review.css";

export function ContractReviewPage() {
  return (
    <div className="legacy-app-viewport contract-review-legacy-viewport">
      <HashRouter>
        <LegacyContractReviewApp />
      </HashRouter>
    </div>
  );
}
