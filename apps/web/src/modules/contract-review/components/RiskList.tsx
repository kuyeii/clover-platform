import { Icon } from "../../../shared/components/Icon";
import type { ReviewResultPayload, RiskItem } from "../types";
import { RiskCard } from "./RiskCard";

export function RiskList(props: {
  result: ReviewResultPayload | null;
  busyRiskId: string;
  applyAllBusy: boolean;
  acceptAllBusy: boolean;
  onRefresh: () => void;
  onApplyAll: () => void;
  onAcceptAll: () => void;
  onRiskStatusChange: (riskId: string | number, status: "pending" | "accepted" | "rejected") => void;
  onAiApply: (riskId: string | number) => void;
  onAiAccept: (riskId: string | number, revisedText?: string, targetText?: string) => void;
  onAiEdit: (riskId: string | number, revisedText: string) => void;
  onAiReject: (riskId: string | number) => void;
}) {
  const risks = props.result?.risk_result_validated?.risk_result?.risk_items || [];
  const stats = getRiskStats(risks);

  if (!props.result) {
    return (
      <section className="contract-risk-panel">
        <div className="contract-empty-state">审查完成后会在这里展示风险卡片。</div>
      </section>
    );
  }

  return (
    <section className="contract-risk-panel">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">Risk Review</span>
          <h2>风险卡片</h2>
        </div>
        <div className="row-actions">
          <button type="button" className="ghost-button small" onClick={props.onRefresh}>
            <Icon name="refresh" />
            刷新结果
          </button>
          <button type="button" className="secondary-button small" disabled={props.applyAllBusy || risks.length === 0} onClick={props.onApplyAll}>
            <Icon name="spark" />
            {props.applyAllBusy ? "生成中..." : "AI 批量改写"}
          </button>
          <button type="button" className="primary-button small" disabled={props.acceptAllBusy || stats.pending === 0} onClick={props.onAcceptAll}>
            <Icon name="check" />
            {props.acceptAllBusy ? "处理中..." : "全部接受"}
          </button>
        </div>
      </div>

      <div className="contract-risk-stats">
        <span>总计 <strong>{stats.total}</strong></span>
        <span className="high">高 <strong>{stats.high}</strong></span>
        <span className="medium">中 <strong>{stats.medium}</strong></span>
        <span className="low">低 <strong>{stats.low}</strong></span>
        <span>待处理 <strong>{stats.pending}</strong></span>
      </div>

      {props.result.risk_result_validated?.is_valid === false ? (
        <div className="notice warning">{props.result.risk_result_validated.error_message || "风险结果校验未通过。"}</div>
      ) : null}

      {risks.length === 0 ? (
        <div className="contract-empty-state">本次审查未发现风险项。</div>
      ) : (
        <div className="contract-risk-groups">
          {groupRisks(risks).map(([dimension, items]) => (
            <details key={dimension} className="contract-risk-group" open>
              <summary>
                <span>{dimension}</span>
                <strong>{items.length}</strong>
              </summary>
              <div className="contract-risk-list">
                {items.map((risk) => (
                  <RiskCard
                    key={String(risk.risk_id)}
                    risk={risk}
                    busy={props.busyRiskId === String(risk.risk_id)}
                    onStatusChange={(status) => props.onRiskStatusChange(risk.risk_id, status)}
                    onAiApply={() => props.onAiApply(risk.risk_id)}
                    onAiAccept={(revisedText, targetText) => props.onAiAccept(risk.risk_id, revisedText, targetText)}
                    onAiEdit={(revisedText) => props.onAiEdit(risk.risk_id, revisedText)}
                    onAiReject={() => props.onAiReject(risk.risk_id)}
                  />
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function groupRisks(risks: RiskItem[]) {
  const groups = new Map<string, RiskItem[]>();
  for (const risk of risks) {
    const key = String(risk.dimension || "未分类");
    groups.set(key, [...(groups.get(key) || []), risk]);
  }
  return Array.from(groups.entries());
}

function getRiskStats(risks: RiskItem[]) {
  return risks.reduce(
    (stats, risk) => {
      stats.total += 1;
      const level = String(risk.risk_level || "").trim().toLowerCase();
      if (level === "high") {
        stats.high += 1;
      } else if (level === "medium") {
        stats.medium += 1;
      } else if (level === "low") {
        stats.low += 1;
      }
      const status = String(risk.status || "pending").toLowerCase();
      if (!status || status === "pending") {
        stats.pending += 1;
      }
      return stats;
    },
    { total: 0, high: 0, medium: 0, low: 0, pending: 0 },
  );
}
