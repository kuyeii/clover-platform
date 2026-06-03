import type { GenerateSettings } from "../types";

type Props = {
  disabled: boolean;
  disabledReason?: string | null;
  isGenerating: boolean;
  settings: GenerateSettings;
  onChange: (settings: GenerateSettings) => void;
  onGenerate: () => Promise<void>;
};

export function GenerateSettingsPanel({ disabled, disabledReason, isGenerating, settings, onChange, onGenerate }: Props) {
  function patch(patchValue: Partial<GenerateSettings>) {
    onChange({ ...settings, ...patchValue });
  }

  return (
    <section className="pd-panel" aria-labelledby="pd-generate-title">
      <div className="pd-panel-header">
        <div>
          <p className="pd-eyebrow">生成</p>
          <h2 id="pd-generate-title">交底书参数</h2>
        </div>
      </div>
      <div className="pd-settings-grid">
        <label className="pd-field">
          <span>专利类型</span>
          <select
            value={settings.patentType}
            onChange={(event) => patch({ patentType: event.target.value as GenerateSettings["patentType"] })}
            disabled={disabled || isGenerating}
          >
            <option value="invention">发明</option>
            <option value="utility_model">实用新型</option>
            <option value="design">外观设计</option>
          </select>
        </label>
        <label className="pd-field">
          <span>输出格式</span>
          <select
            value={settings.outputFormat}
            onChange={(event) => patch({ outputFormat: event.target.value as GenerateSettings["outputFormat"] })}
            disabled={disabled || isGenerating}
          >
            <option value="markdown_docx">Markdown + Word</option>
            <option value="docx">Word</option>
          </select>
        </label>
      </div>
      <label className="pd-field">
        <span>技术领域补充</span>
        <input
          value={settings.technicalField}
          onChange={(event) => patch({ technicalField: event.target.value })}
          placeholder="可覆盖案件中的技术领域"
          disabled={disabled || isGenerating}
        />
      </label>
      <label className="pd-field">
        <span>权利要求侧重点</span>
        <input
          value={settings.claimFocus}
          onChange={(event) => patch({ claimFocus: event.target.value })}
          placeholder="例如：方法流程、系统模块、数据处理链路"
          disabled={disabled || isGenerating}
        />
      </label>
      <label className="pd-field">
        <span>补充说明</span>
        <textarea
          value={settings.additionalInstructions}
          onChange={(event) => patch({ additionalInstructions: event.target.value })}
          placeholder="写入对交底书结构、术语或保护范围的额外要求"
          rows={4}
          disabled={disabled || isGenerating}
        />
      </label>
      <button className="pd-primary-button" type="button" onClick={onGenerate} disabled={disabled || isGenerating}>
        {isGenerating ? "生成中" : "开始生成交底书"}
      </button>
      {disabledReason ? <div className="pd-inline-warning">{disabledReason}</div> : null}
    </section>
  );
}
