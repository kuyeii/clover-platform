import "katex/dist/katex.min.css";
import LegacyRagApp from "./legacy/App";
import "./legacy/index.css";

export function RagPage() {
  return (
    <div className="rag-legacy-viewport">
      <div className="rag-legacy-scope">
        <LegacyRagApp />
      </div>
    </div>
  );
}
