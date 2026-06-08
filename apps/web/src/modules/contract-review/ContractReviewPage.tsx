import { HashRouter } from "react-router-dom";

import ContractReviewRuntime from "./runtime/App";
import "./runtime/runtime-review.css";

export function ContractReviewPage() {
  return (
    <HashRouter>
      <ContractReviewRuntime />
    </HashRouter>
  );
}
