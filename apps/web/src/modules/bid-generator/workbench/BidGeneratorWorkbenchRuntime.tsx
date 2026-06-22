import { HashRouter } from "react-router-dom";

import BidGeneratorWorkbenchApp from "./App";
import "./index.css";

export default function BidGeneratorWorkbenchRuntime() {
  return (
    <HashRouter>
      <BidGeneratorWorkbenchApp />
    </HashRouter>
  );
}
