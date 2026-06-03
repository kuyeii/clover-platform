import { ChangeEvent, useMemo, useState } from "react";
import type { PatentMaterial } from "../types";

type Props = {
  disabled: boolean;
  materials: PatentMaterial[];
  isUploading: boolean;
  onUpload: (files: File[]) => Promise<void>;
};

export function MaterialUploader({ disabled, materials, isUploading, onUpload }: Props) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const totalSize = useMemo(() => materials.reduce((sum, item) => sum + (item.fileSize || 0), 0), [materials]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(Array.from(event.target.files || []));
  }

  async function handleUpload() {
    if (!selectedFiles.length) return;
    await onUpload(selectedFiles);
    setSelectedFiles([]);
  }

  return (
    <section className="pd-panel" aria-labelledby="pd-material-title">
      <div className="pd-panel-header">
        <div>
          <p className="pd-eyebrow">材料</p>
          <h2 id="pd-material-title">技术材料上传</h2>
        </div>
        <span className="pd-count">{formatFileSize(totalSize)}</span>
      </div>
      <div className="pd-upload-box">
        <input
          id="pd-material-input"
          type="file"
          multiple
          disabled={disabled || isUploading}
          onChange={handleFileChange}
        />
        <label htmlFor="pd-material-input">
          <strong>{selectedFiles.length ? `${selectedFiles.length} 个文件已选择` : "选择材料文件"}</strong>
          <span>支持上传需求文档、设计说明、会议纪要、既有交底材料。</span>
        </label>
        <button
          className="pd-secondary-button"
          type="button"
          onClick={handleUpload}
          disabled={disabled || isUploading || selectedFiles.length === 0}
        >
          {isUploading ? "上传中" : "上传材料"}
        </button>
      </div>
      <div className="pd-material-list">
        {materials.length === 0 ? (
          <div className="pd-empty">尚未上传材料。</div>
        ) : (
          materials.map((material) => (
            <div className="pd-material-row" key={material.id}>
              <span>
                <strong>{material.fileName}</strong>
                <small>{material.materialType || material.category || material.mimeType || "材料文件"}</small>
              </span>
              <em>{formatFileSize(material.fileSize || 0)}</em>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatFileSize(size: number) {
  if (!size) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
