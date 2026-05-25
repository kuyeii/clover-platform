import { useRef, useState } from "react";

import { Icon } from "../../../shared/components/Icon";
import type { AnalysisScopeOption, ReviewSideOption } from "../types";

const reviewSideOptions: Array<{ value: ReviewSideOption; title: string; description: string }> = [
  { value: "甲方", title: "甲方视角", description: "关注委托方权益、验收与履约控制。" },
  { value: "乙方", title: "乙方视角", description: "关注交付边界、回款与责任限制。" },
];

const analysisScopeOptions: Array<{ value: AnalysisScopeOption; title: string; description: string }> = [
  { value: "full_detail", title: "深度审查", description: "全面识别合同结构、风险依据与修改建议。" },
  { value: "high_risk_only", title: "仅高风险", description: "聚焦高风险条款，适合快速预审。" },
];

export function ReviewUploader(props: {
  file: File | null;
  reviewSide: ReviewSideOption | null;
  analysisScope: AnalysisScopeOption;
  locked: boolean;
  submitting: boolean;
  onFileChange: (file: File | null) => void;
  onReviewSideChange: (side: ReviewSideOption) => void;
  onAnalysisScopeChange: (scope: AnalysisScopeOption) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const openPicker = () => {
    if (props.locked) {
      return;
    }
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const pickFile = (file: File | null) => {
    if (!file || props.locked) {
      return;
    }
    props.onFileChange(file);
  };

  return (
    <section className="contract-upload-panel">
      <div
        className={`contract-dropzone ${dragActive ? "active" : ""} ${props.file ? "has-file" : ""}`}
        role="button"
        tabIndex={props.locked ? -1 : 0}
        aria-disabled={props.locked}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          openPicker();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!props.locked) {
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          pickFile(event.dataTransfer.files?.[0] || null);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => pickFile(event.target.files?.[0] || null)}
        />
        <span className="contract-dropzone-icon">
          <Icon name={props.file ? "file" : "upload"} />
        </span>
        {props.file ? (
          <div className="contract-file-summary">
            <strong title={props.file.name}>{props.file.name}</strong>
            <span>{formatFileSize(props.file.size)} · {formatFileType(props.file.name)}</span>
            <button
              type="button"
              className="icon-button small"
              aria-label="移除文件"
              disabled={props.locked}
              onClick={(event) => {
                event.stopPropagation();
                props.onFileChange(null);
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        ) : (
          <div>
            <strong>选择或拖入合同文件</strong>
            <span>支持 PDF、Word（.doc/.docx），上传字段保持 legacy 的 file。</span>
          </div>
        )}
      </div>

      <div className="contract-option-grid">
        <div className="contract-option-group">
          <span className="contract-option-title">审查视角</span>
          {reviewSideOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={props.reviewSide === option.value ? "contract-option active" : "contract-option"}
              disabled={props.locked}
              onClick={() => props.onReviewSideChange(option.value)}
            >
              <span className="contract-radio" />
              <span>
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="contract-option-group">
          <span className="contract-option-title">审查范围</span>
          {analysisScopeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={props.analysisScope === option.value ? "contract-option active" : "contract-option"}
              disabled={props.locked}
              onClick={() => props.onAnalysisScopeChange(option.value)}
            >
              <span className="contract-radio" />
              <span>
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="primary-button large"
        disabled={!props.file || !props.reviewSide || props.locked}
        onClick={props.onSubmit}
      >
        {props.submitting ? "提交中..." : props.locked ? "审查中..." : "开始审查"}
        <Icon name="arrow" />
      </button>
    </section>
  );
}

function formatFileType(name: string) {
  const suffix = name.split(".").pop()?.toLowerCase();
  if (suffix === "pdf") {
    return "PDF";
  }
  if (suffix === "doc") {
    return "DOC";
  }
  if (suffix === "docx") {
    return "DOCX";
  }
  return "文件";
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
