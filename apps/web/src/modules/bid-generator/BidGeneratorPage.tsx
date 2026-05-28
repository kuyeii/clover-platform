import { HashRouter } from "react-router-dom";

import LegacyBidGeneratorApp from "./legacy/App";
import "./legacy/index.css";

export function BidGeneratorPage() {
  return (
    <div className="legacy-app-viewport bid-generator-legacy-viewport">
      <HashRouter>
        <LegacyBidGeneratorApp />
      </HashRouter>
    </div>
  );
}
