import { FormEvent, useState } from "react";
import type { CreatePatentCaseInput } from "../types";

type Props = {
  isCreating: boolean;
  onCreate: (input: CreatePatentCaseInput) => Promise<void>;
};

export function CaseCreatePanel({ isCreating, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [technicalField, setTechnicalField] = useState("");
  const [owner, setOwner] = useState("");
  const [summary, setSummary] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }
    await onCreate({
      title: normalizedTitle,
      technicalField: technicalField.trim() || undefined,
      owner: owner.trim() || undefined,
      summary: summary.trim() || undefined,
      inventionType: "invention",
    });
    setTitle("");
    setTechnicalField("");
    setOwner("");
    setSummary("");
  }

  return (
    <section className="pd-panel pd-create-panel" aria-labelledby="pd-create-title">
      <div className="pd-panel-header">
        <div>
          <p className="pd-eyebrow">新建案件</p>
          <h2 id="pd-create-title">交底书工作单</h2>
        </div>
      </div>
      <form className="pd-form" onSubmit={handleSubmit}>
        <label className="pd-field">
          <span>案件名称</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：一种多业务智能应用接入方法"
            disabled={isCreating}
          />
        </label>
        <label className="pd-field">
          <span>技术领域</span>
          <input
            value={technicalField}
            onChange={(event) => setTechnicalField(event.target.value)}
            placeholder="例如：软件工程 / 智能调度 / 数据处理"
            disabled={isCreating}
          />
        </label>
        <label className="pd-field">
          <span>申请主体</span>
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="可选"
            disabled={isCreating}
          />
        </label>
        <label className="pd-field">
          <span>技术摘要</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="用 2-3 句话描述核心技术问题、方案和效果"
            disabled={isCreating}
            rows={4}
          />
        </label>
        <button className="pd-primary-button" type="submit" disabled={isCreating || !title.trim()}>
          {isCreating ? "创建中" : "创建案件"}
        </button>
      </form>
    </section>
  );
}
