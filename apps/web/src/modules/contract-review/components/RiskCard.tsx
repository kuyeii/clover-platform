import { useEffect, useState } from "react";

import { Icon } from "../../../shared/components/Icon";
import type { RiskItem } from "../types";

export function RiskCard(props: {
  risk: RiskItem;
  busy: boolean;
  onStatusChange: (status: "pending" | "accepted" | "rejected") => void;
  onAiApply: () => void;
  onAiAccept: (revisedText?: string, targetText?: string) => void;
  onAiEdit: (revisedText: string) => void;
  onAiReject: () => void;
}) {
  const risk = props.risk;
  const ai = risk.ai_rewrite || risk.ai_apply;
  const aiState = String(ai?.state || (ai?.revised_text ? "succeeded" : "")).toLowerCase();
  const decision = String(risk.ai_rewrite_decision || "").toLowerCase();
  const status = String(risk.status || "pending").toLowerCase();
  const revisedText = String(ai?.revised_text || "").trim();
  const targetText = String(ai?.target_text || "").trim();
  const canAcceptAi = aiState === "succeeded" && decision !== "rejected";
  const [draftText, setDraftText] = useState(revisedText);

  useEffect(() => {
    setDraftText(revisedText);
  }, [revisedText]);

  return (
    <article className={`contract-risk-card ${statusClass(status)}`}>
      <div className="contract-risk-head">
        <div>
          <span className={`contract-risk-level ${String(risk.risk_level || "low").toLowerCase()}`}>
            {levelLabel(String(risk.risk_level || ""))}
          </span>
          <h3>{cleanText(risk.risk_label || risk.dimension || "风险项")}</h3>
        </div>
        <span className={`contract-status-pill ${statusClass(status)}`}>{statusLabel(status)}</span>
      </div>

      <dl className="contract-risk-fields">
        <div>
          <dt>位置</dt>
          <dd>{formatClauseRefs(risk)}</dd>
        </div>
        <div>
          <dt>问题</dt>
          <dd>{cleanText(risk.issue) || "—"}</dd>
        </div>
        <div>
          <dt>依据</dt>
          <dd>{cleanText(risk.basis_minimal || risk.basis_summary || risk.basis) || "—"}</dd>
        </div>
        <div>
          <dt>建议</dt>
          <dd>{cleanText(risk.suggestion_optimized || risk.suggestion_minimal || risk.suggestion) || "—"}</dd>
        </div>
      </dl>

      <section className={`contract-ai-box ${aiState === "failed" ? "failed" : ""}`}>
        <div className="contract-ai-title">
          <Icon name="spark" />
          <strong>AI 改写</strong>
          <span>{aiStatusLabel(aiState, decision, Boolean(ai))}</span>
        </div>
        {aiState === "succeeded" ? (
          <div className="contract-ai-diff">
            {targetText ? (
              <div>
                <span>原文</span>
                <p>{targetText}</p>
              </div>
            ) : null}
            <div>
              <span>改写后</span>
              <textarea
                value={draftText}
                rows={Math.min(8, Math.max(3, Math.ceil((revisedText.length || 36) / 34)))}
                disabled={props.busy}
                onChange={(event) => setDraftText(event.target.value)}
                onBlur={(event) => {
                  const next = event.target.value;
                  if (next !== revisedText) {
                    props.onAiEdit(next);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <p>{aiState === "failed" ? cleanText(ai?.comment_text) || "AI 建议生成失败。" : "可对单条风险生成 AI 改写建议。"}</p>
        )}
      </section>

      <div className="contract-risk-actions">
        <button type="button" className="ghost-button small" disabled={props.busy} onClick={() => props.onStatusChange("pending")}>
          重置
        </button>
        <button type="button" className="ghost-button small" disabled={props.busy} onClick={() => props.onStatusChange("rejected")}>
          拒绝风险
        </button>
        <button type="button" className="secondary-button small" disabled={props.busy} onClick={props.onAiApply}>
          <Icon name="spark" />
          生成 AI
        </button>
        <button type="button" className="secondary-button small" disabled={props.busy || !ai} onClick={props.onAiReject}>
          拒绝 AI
        </button>
        <button
          type="button"
          className="primary-button small"
          disabled={props.busy}
          onClick={() => {
            if (canAcceptAi) {
              props.onAiAccept(draftText, targetText);
              return;
            }
            props.onStatusChange("accepted");
          }}
        >
          接受
        </button>
      </div>
    </article>
  );
}

function levelLabel(level: string) {
  if (level === "high") {
    return "高";
  }
  if (level === "medium") {
    return "中";
  }
  if (level === "low") {
    return "低";
  }
  return level || "—";
}

function statusLabel(status: string) {
  if (status === "accepted" || status === "ai_applied") {
    return "已接受";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  return "待处理";
}

function statusClass(status: string) {
  if (status === "accepted" || status === "ai_applied") {
    return "completed";
  }
  if (status === "rejected") {
    return "failed";
  }
  return "pending";
}

function aiStatusLabel(aiState: string, decision: string, hasAi: boolean) {
  if (decision === "accepted") {
    return "已接受";
  }
  if (decision === "rejected") {
    return "已拒绝";
  }
  if (aiState === "succeeded") {
    return "已生成";
  }
  if (aiState === "failed") {
    return "生成失败";
  }
  return hasAi ? "生成中" : "未生成";
}

function formatClauseRefs(risk: RiskItem) {
  const refs = [
    ...(risk.display_clause_ids || []),
    ...(risk.related_clause_ids || []),
    risk.clause_id,
    ...(risk.clause_uids || []),
    ...(risk.related_clause_uids || []),
    risk.clause_uid,
  ].filter(Boolean);
  return refs.length ? Array.from(new Set(refs.map(String))).slice(0, 4).join("、") : "未定位";
}

function cleanText(value?: unknown) {
  return String(value || "")
    .replace(/\[[A-Z0-9_-]{2,}\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
