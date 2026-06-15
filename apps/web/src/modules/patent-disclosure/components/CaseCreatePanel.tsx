import { ChangeEvent, FormEvent, useState } from "react";
import { Icon } from "../../../shared/components/Icon";
import type { CreatePatentCaseInput, GenerateSettings } from "../types";

type Props = {
  disabledReason?: string | null;
  isCreating: boolean;
  isGenerating: boolean;
  settings: GenerateSettings;
  onCreate: (input: CreatePatentCaseInput, files: File[]) => Promise<string | undefined>;
  onGenerate: (caseId?: string) => Promise<void>;
  onSettingsChange: (settings: GenerateSettings) => void;
};

const RESET_SETTINGS: GenerateSettings = {
  patentType: "invention",
  includePriorArtSearch: true,
  enableDesensitization: false,
  outputFormat: "docx",
  technicalField: "",
  claimFocus: "",
  additionalInstructions: "",
};

export function CaseCreatePanel({
  disabledReason,
  isCreating,
  isGenerating,
  settings,
  onCreate,
  onGenerate,
  onSettingsChange,
}: Props) {
  const [title, setTitle] = useState("");
  const [technicalField, setTechnicalField] = useState("");
  const [owner, setOwner] = useState("");
  const [summary, setSummary] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(Array.from(event.target.files || []));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }
    const createdCaseId = await onCreate({
      title: normalizedTitle,
      technicalField: technicalField.trim() || undefined,
      owner: owner.trim() || undefined,
      summary: summary.trim() || undefined,
      inventionType: settings.patentType,
    }, selectedFiles);
    if (createdCaseId && selectedFiles.length) {
      await onGenerate(createdCaseId);
      onSettingsChange(RESET_SETTINGS);
      setTitle("");
      setTechnicalField("");
      setOwner("");
      setSummary("");
      setSelectedFiles([]);
      setShowAdvancedSettings(false);
    }
  }

  function patchSettings(patchValue: Partial<GenerateSettings>) {
    onSettingsChange({ ...settings, ...patchValue });
  }

  const isBusy = isCreating || isGenerating;
  const canSubmit = Boolean(title.trim()) && selectedFiles.length > 0 && !disabledReason && !isBusy;

  return (
    <section className="pd-create-panel" aria-labelledby="pd-create-title">
      <form className="pd-form" onSubmit={handleSubmit}>
        <div className="pd-create-stage">
          <div className="pd-create-heading">
            <h2 id="pd-create-title">新建专利交底书</h2>
          </div>

          <section className="pd-create-upload" aria-label="上传技术材料">
            <input
              id="pd-create-material-input"
              type="file"
              multiple
              disabled={isBusy}
              onChange={handleFileChange}
            />
            <label className="pd-create-dropzone" htmlFor="pd-create-material-input">
              {selectedFiles.length ? (
                <>
                  <span className="pd-upload-glyph is-selected" aria-hidden>
                    <Icon name="file" />
                  </span>
                  <strong className="pd-selected-file-name">{formatSelectedFileLabel(selectedFiles)}</strong>
                  <small>{formatSelectedFileMeta(selectedFiles)} · 点击可重新选择</small>
                </>
              ) : (
                <>
                  <span className="pd-upload-glyph" aria-hidden>
                    <Icon name="upload" />
                  </span>
                  <strong>拖拽文件至此或点击导入</strong>
                  <small>支持 .docx · .pdf · .pptx · .md · .txt · .zip 代码仓库，单文件不超过 100MB</small>
                </>
              )}
            </label>
          </section>

          <section className="pd-create-config" aria-labelledby="pd-create-config-title">
            <div className="pd-create-config-title">
              <h3 id="pd-create-config-title">项目配置参数</h3>
              <button
                type="button"
                className="pd-detail-toggle"
                aria-expanded={showAdvancedSettings}
                onClick={() => setShowAdvancedSettings((current) => !current)}
              >
                {showAdvancedSettings ? "收起详细参数" : "详细参数配置"}
              </button>
            </div>
            <label className="pd-field">
              <span>交底书项目名称</span>
              <span className="pd-control-shell">
                <input
                  className="pd-control-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="例如：多业务智能应用接入方法"
                  disabled={isBusy}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </span>
            </label>
            <label className="pd-field">
              <span>申请主体（可选）</span>
              <span className="pd-control-shell">
                <input
                  className="pd-control-input"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder="例如：北京某某科技有限公司"
                  disabled={isBusy}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </span>
            </label>
            {showAdvancedSettings ? (
              <div className="pd-advanced-settings" aria-label="详细参数配置">
                <label className="pd-field">
                  <span>技术领域</span>
                  <span className="pd-control-shell">
                    <input
                      className="pd-control-input"
                      value={technicalField}
                      onChange={(event) => {
                        setTechnicalField(event.target.value);
                        patchSettings({ technicalField: event.target.value });
                      }}
                      placeholder="例如：软件工程 / 智能调度"
                      disabled={isBusy}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </span>
                </label>
                <label className="pd-field">
                  <span>权利要求侧重点</span>
                  <span className="pd-control-shell">
                    <input
                      className="pd-control-input"
                      value={settings.claimFocus}
                      onChange={(event) => patchSettings({ claimFocus: event.target.value })}
                      placeholder="例如：方法流程、系统模块、数据处理链路"
                      disabled={isBusy}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </span>
                </label>
                <label className="pd-field">
                  <span>技术摘要</span>
                  <span className="pd-control-shell is-textarea">
                    <textarea
                      className="pd-control-input"
                      value={summary}
                      onChange={(event) => setSummary(event.target.value)}
                      placeholder="描述核心技术问题、方案和效果"
                      disabled={isBusy}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      rows={4}
                    />
                  </span>
                </label>
                <label className="pd-field">
                  <span>补充说明</span>
                  <span className="pd-control-shell is-textarea">
                    <textarea
                      className="pd-control-input"
                      value={settings.additionalInstructions}
                      onChange={(event) => patchSettings({ additionalInstructions: event.target.value })}
                      placeholder="写入对交底书结构、术语或保护范围的额外要求"
                      disabled={isBusy}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      rows={3}
                    />
                  </span>
                </label>
              </div>
            ) : null}
            <button className="pd-primary-button pd-create-submit" type="submit" disabled={!canSubmit}>
              {isBusy ? "处理中" : "开始生成专利交底书"}
            </button>
          </section>
        </div>
      </form>
    </section>
  );
}

function formatFileSize(size: number) {
  if (!size) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatSelectedFileLabel(files: File[]) {
  if (files.length === 1) {
    return files[0].name;
  }
  return `${files[0].name} 等 ${files.length} 个文件`;
}

function formatSelectedFileMeta(files: File[]) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  return formatFileSize(totalSize);
}
