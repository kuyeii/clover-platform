import type { PatentArtifact } from "../types";

type Props = {
  artifacts: PatentArtifact[];
  isDownloadingId: string | null;
  onDownload: (artifact: PatentArtifact) => Promise<void>;
};

export function ArtifactDownloadList({ artifacts, isDownloadingId, onDownload }: Props) {
  return (
    <section className="pd-panel" aria-labelledby="pd-artifact-title">
      <div className="pd-panel-header">
        <div>
          <p className="pd-eyebrow">交付物</p>
          <h2 id="pd-artifact-title">文件下载</h2>
        </div>
        <span className="pd-count">{artifacts.length}</span>
      </div>
      <div className="pd-artifact-list">
        {artifacts.length === 0 ? (
          <div className="pd-empty">生成完成后会展示最终 Markdown 和 Word 文件。</div>
        ) : (
          artifacts.map((artifact) => (
            <div className="pd-artifact-row" key={artifact.id}>
              <span>
                <strong>{artifact.name}</strong>
                <small>{formatKind(artifact.kind)} · {formatFileSize(artifact.size || 0)}</small>
              </span>
              <button
                className="pd-secondary-button"
                type="button"
                onClick={() => onDownload(artifact)}
                disabled={isDownloadingId === artifact.id}
              >
                {isDownloadingId === artifact.id ? "下载中" : "下载"}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatKind(kind?: string) {
  if (kind === "markdown") return "Markdown";
  if (kind === "docx") return "Word";
  if (kind === "prior_art") return "查新记录";
  if (kind === "revision_log") return "修订记录";
  return kind || "文件";
}

function formatFileSize(size: number) {
  if (!size) return "大小未知";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
