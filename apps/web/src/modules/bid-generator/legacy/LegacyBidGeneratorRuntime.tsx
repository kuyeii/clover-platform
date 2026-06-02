import { HashRouter } from "react-router-dom";

import LegacyBidGeneratorApp from "./App";
import "./index.css";

export default function LegacyBidGeneratorRuntime() {
  return (
    <HashRouter>
      <LegacyBidGeneratorApp />
    </HashRouter>
  );
}
