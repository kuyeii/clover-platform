import { HashRouter } from "react-router-dom";

import ContractReviewRuntime from "./runtime/App";
import "./runtime/index.css";
import "./runtime/runtime-review.css";

export function ContractReviewPage() {
  return (
    <div className="legacy-app-viewport contract-review-legacy-viewport">
      <HashRouter>
        <ContractReviewRuntime />
      </HashRouter>
    </div>
  );
}
