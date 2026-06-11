import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const LegacyBidGeneratorRuntime = lazy(() => import("./legacy/LegacyBidGeneratorRuntime"));

function LegacyLoading() {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-mist text-muted">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-3 text-sm shadow-panel">
        <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />
        正在加载工作台
      </div>
    </div>
  );
}

export function BidGeneratorPage() {
  return (
    <div className="legacy-app-viewport bid-generator-legacy-viewport">
      <Suspense fallback={<LegacyLoading />}>
        <LegacyBidGeneratorRuntime />
      </Suspense>
    </div>
  );
}
