import { Icon } from "../../../shared/components/Icon";

export function DownloadActions(props: {
  disabled: boolean;
  documentReady: boolean;
  downloadingDocument: boolean;
  downloadingReviewed: boolean;
  onDownloadDocument: () => void;
  onDownloadReviewed: () => void;
}) {
  return (
    <div className="contract-download-actions">
      <button
        type="button"
        className="secondary-button"
        disabled={props.disabled || !props.documentReady || props.downloadingDocument}
        onClick={props.onDownloadDocument}
      >
        <Icon name="file" />
        {props.downloadingDocument ? "准备中..." : "下载原始 DOCX"}
      </button>
      <button
        type="button"
        className="primary-button"
        disabled={props.disabled || !props.documentReady || props.downloadingReviewed}
        onClick={props.onDownloadReviewed}
      >
        <Icon name="download" />
        {props.downloadingReviewed ? "导出中..." : "下载法务修订文档"}
      </button>
    </div>
  );
}
