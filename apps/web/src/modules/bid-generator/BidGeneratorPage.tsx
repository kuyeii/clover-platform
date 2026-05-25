import { HashRouter } from "react-router-dom";

import LegacyBidGeneratorApp from "./legacy/App";
import "./legacy/index.css";

export function BidGeneratorPage() {
  return (
    <div className="bid-generator-legacy-viewport">
      <HashRouter>
        <LegacyBidGeneratorApp />
      </HashRouter>
    </div>
  );
}
