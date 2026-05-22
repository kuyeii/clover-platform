import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../../shared/auth/AuthProvider";
import { Icon } from "../../shared/components/Icon";
import { MarkdownReport } from "./components/MarkdownReport";
import {
  CompetitorAnalysisInput,
  CompetitorItem,
  HistoryRecord,
  deleteHistoryRecord,
  getHistoryRecord,
  healthCheck,
  listHistory,
  runAnalysisStream,
  runCompanyNameValidationWorkflow,
} from "./services/competitorApi";
import {
  DEFAULT_PROVINCE,
  DEFAULT_RESULT_TAB,
  PROVINCES,
  RESULT_TABS,
  compactText,
  createEmptyForm,
  createPendingResultId,
  extractCompanyValidationResult,
  formatDateTime,
  getRecordTitle,
  getScoreItem,
  getThreatScore,
  getSnapshot,
  isSameCompanyName,
  splitCompetitorNames,
} from "./utils";

type DetailEntry = { status: "idle" | "loading" | "success" | "error"; data: Record<string, unknown> | null; error: string };
type ReportEntry = { status: "idle" | "loading" | "success" | "error"; text: string; error: string };

function normalizeRecordSnapshot(record: HistoryRecord | null) {
  const form = { ...createEmptyForm(), ...(getSnapshot(record, "form", record?.input || {}) as CompetitorAnalysisInput) };
  const competitors = getSnapshot<CompetitorItem[]>(record, "competitors", []);
  return {
    form,
    targetCompanyInfo: getSnapshot<Record<string, unknown> | null>(record, "targetCompanyInfo", null),
    targetDetail: getSnapshot<Record<string, unknown> | null>(record, "targetDetail", null),
    competitors: Array.isArray(competitors) ? competitors : [],
    competitorDetails: getSnapshot<Record<string, DetailEntry>>(record, "competitorDetails", {}),
    compareReports: getSnapshot<Record<string, ReportEntry>>(record, "compareReports", {}),
    scoreResult: getSnapshot<unknown>(record, "scoreResult", null),
    queryTime: getSnapshot<string>(record, "queryTime", record?.queryTime || ""),
    selectedCompetitorId: getSnapshot<string | null>(record, "selectedCompetitorId", null),
    activeTab: getSnapshot<string>(record, "activeTab", DEFAULT_RESULT_TAB),
    targetDetailStatus: getSnapshot<DetailEntry["status"]>(record, "targetDetailStatus", "idle"),
    targetDetailError: getSnapshot<string>(record, "targetDetailError", ""),
    scoreStatus: getSnapshot<DetailEntry["status"]>(record, "scoreStatus", "idle"),
    scoreError: getSnapshot<string>(record, "scoreError", ""),
  };
}

function Sidebar({
  historyItems,
  activeHistoryId,
  runningItem,
  onNew,
  onOpen,
  onDelete,
}: {
  historyItems: HistoryRecord[];
  activeHistoryId: string;
  runningItem: HistoryRecord | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const renderedHistoryItems = runningItem ? historyItems.filter((item) => item.id !== runningItem.id) : historyItems;
  return (
    <aside className="competitor-sidebar">
      <button type="button" className="primary-button full" onClick={onNew}>
        <Icon name="plus" />
        新建对比
      </button>
      <section className="history-box">
        <div className="history-title-row">
          <h3>历史记录</h3>
          <span>{renderedHistoryItems.length + (runningItem ? 1 : 0)}</span>
        </div>
        {runningItem ? (
          <button
            type="button"
            className={activeHistoryId === runningItem.id ? "history-entry active running" : "history-entry running"}
            onClick={() => onOpen(runningItem.id)}
          >
            <strong>{getRecordTitle(runningItem)}</strong>
            <span>分析中</span>
          </button>
        ) : null}
        {renderedHistoryItems.length ? renderedHistoryItems.map((item) => (
          <div key={item.id} className="history-entry-row">
            <button
              type="button"
              className={activeHistoryId === item.id ? "history-entry active" : "history-entry"}
              onClick={() => onOpen(item.id)}
            >
              <strong>{getRecordTitle(item)}</strong>
              <span>{item.queryTime || item.createdAt?.slice(0, 10) || "-"}</span>
            </button>
            <button type="button" className="icon-button small" onClick={() => onDelete(item.id)} aria-label="删除历史记录">
              <Icon name="close" />
            </button>
          </div>
        )) : !runningItem ? <p className="empty-mini">暂无历史记录</p> : null}
      </section>
    </aside>
  );
}

function HomeForm({
  form,
  setForm,
  onAnalyze,
  isLoading,
  apiError,
}: {
  form: CompetitorAnalysisInput;
  setForm: (updater: (current: CompetitorAnalysisInput) => CompetitorAnalysisInput) => void;
  onAnalyze: (event: FormEvent) => void;
  isLoading: boolean;
  apiError: string;
}) {
  const [validationMessage, setValidationMessage] = useState("");
  const [modeError, setModeError] = useState("");
  const manualNames = splitCompetitorNames(form.competitorCompanyName);
  const hasSameCompany = form.matchMode === "exact" && manualNames.some((name) => isSameCompanyName(name, form.targetCompanyName));

  const validateTargetCompany = async () => {
    const name = String(form.targetCompanyName || "").trim();
    if (!name) {
      setValidationMessage("请先输入我方企业名称。");
      return;
    }
    setValidationMessage("正在校验企业信息...");
    try {
      const payload = await runCompanyNameValidationWorkflow({ companyName: name });
      const result = extractCompanyValidationResult(payload);
      if (result.company) {
        setForm((current) => ({
          ...current,
          targetCompanyName: result.company?.name || current.targetCompanyName,
          targetCompanyIntro: result.company?.intro || "",
          targetCompanyBusiness: result.company?.business || "",
          targetCompanyConfirmed: true,
        }));
        setValidationMessage("企业信息已确认。");
        return;
      }
      setValidationMessage(result.candidates.length ? `可选企业：${result.candidates.slice(0, 4).join("、")}` : "未返回企业详情，请确认名称后继续。");
    } catch (error) {
      setValidationMessage(error instanceof Error ? error.message : "企业校验失败。");
    }
  };

  const submit = (event: FormEvent) => {
    setModeError("");
    if (form.matchMode === "exact" && manualNames.length === 0) {
      event.preventDefault();
      setModeError("精确匹配至少需要输入一家竞争对手。");
      return;
    }
    if (hasSameCompany) {
      event.preventDefault();
      setModeError("竞争对手名称不能与我方企业名称相同。");
      return;
    }
    onAnalyze(event);
  };

  return (
    <section className="competitor-home">
      <header className="competitor-home-head">
        <span className="eyebrow">Competitor Analysis</span>
        <h1>企业竞争力深度分析</h1>
        <p>直接对接 apps/api 的竞对分析 direct API，支持企业校验、流式分析、报告与历史记录。</p>
      </header>

      <form className="analysis-form" onSubmit={submit}>
        <div className="match-switch">
          <button
            type="button"
            className={form.matchMode !== "exact" ? "active" : ""}
            onClick={() => setForm((current) => ({ ...current, matchMode: "auto", competitorCompanyName: "", province: current.province || DEFAULT_PROVINCE }))}
          >
            自动匹配
          </button>
          <button
            type="button"
            className={form.matchMode === "exact" ? "active" : ""}
            onClick={() => setForm((current) => ({ ...current, matchMode: "exact", province: "" }))}
          >
            精确匹配
          </button>
        </div>

        <div className="analysis-form-grid">
          <label className="form-field">
            <span>我方企业名称 *</span>
            <input
              value={form.targetCompanyName}
              onChange={(event) => setForm((current) => ({
                ...current,
                targetCompanyName: event.target.value,
                targetCompanyConfirmed: false,
                targetCompanyIntro: "",
                targetCompanyBusiness: "",
              }))}
              placeholder="请输入我方企业名称"
            />
          </label>
          <button type="button" className="ghost-button validate-button" onClick={() => void validateTargetCompany()}>
            <Icon name="search" />
            校验企业
          </button>

          {form.matchMode === "auto" ? (
            <label className="form-field">
              <span>选择省份</span>
              <select value={form.province || DEFAULT_PROVINCE} onChange={(event) => setForm((current) => ({ ...current, province: event.target.value }))}>
                {PROVINCES.map((province) => <option value={province} key={province}>{province}</option>)}
              </select>
            </label>
          ) : (
            <label className="form-field wide">
              <span>竞争对手名称 *</span>
              <textarea
                rows={4}
                value={form.competitorCompanyName || ""}
                onChange={(event) => setForm((current) => ({ ...current, competitorCompanyName: event.target.value }))}
                placeholder="可输入 1-5 家，使用顿号、逗号或换行分隔"
              />
            </label>
          )}
        </div>

        {validationMessage ? <p className="success-message">{validationMessage}</p> : null}
        {apiError || modeError ? <p className="form-error">{modeError || apiError}</p> : null}

        <button type="submit" className="primary-button large" disabled={isLoading || hasSameCompany}>
          <Icon name="spark" />
          {isLoading ? "分析中..." : "开始分析"}
        </button>
      </form>
    </section>
  );
}

function CompanyOverview({
  form,
  targetCompanyInfo,
  targetDetail,
  targetDetailStatus,
  targetDetailError,
}: {
  form: CompetitorAnalysisInput;
  targetCompanyInfo: Record<string, unknown> | null;
  targetDetail: Record<string, unknown> | null;
  targetDetailStatus: string;
  targetDetailError: string;
}) {
  const latelyItems = Array.isArray(targetDetail?.latelyItems) ? targetDetail.latelyItems as Array<Record<string, unknown>> : [];
  return (
    <section className="company-overview">
      <div>
        <span className="eyebrow">我方企业</span>
        <h1>{form.targetCompanyName || "待输入企业"}</h1>
        <p>{String(targetCompanyInfo?.intro || form.targetCompanyIntro || (targetDetailStatus === "loading" ? "正在补全企业简介..." : targetDetailError || "暂无企业简介。"))}</p>
      </div>
      <div className="overview-block">
        <h3>主营业务</h3>
        <p>{String(targetCompanyInfo?.business || form.targetCompanyBusiness || targetDetail?.product || "暂无主营业务。")}</p>
      </div>
      <div className="overview-block">
        <h3>近期动态</h3>
        {latelyItems.length ? (
          <ul>
            {latelyItems.slice(0, 4).map((item, index) => <li key={index}>{String(item.title || item.content || "近期动态")}</li>)}
          </ul>
        ) : (
          <p>{targetDetailStatus === "loading" ? "正在获取近期动态..." : "暂无近期动态。"}</p>
        )}
      </div>
    </section>
  );
}

function CompetitorCard({
  item,
  active,
  scoreResult,
  detail,
  report,
  scoreStatus,
  onClick,
}: {
  item: CompetitorItem;
  active: boolean;
  scoreResult: unknown;
  detail?: DetailEntry;
  report?: ReportEntry;
  scoreStatus: string;
  onClick: () => void;
}) {
  const score = getThreatScore(item, scoreResult);
  const scoreItem = getScoreItem(scoreResult, item.name);
  const summary = compactText(scoreItem?.竞争分析小结) || compactText(detail?.data?.product) || item.intro || "暂无简介。";
  const statusLabel =
    detail?.status === "loading"
      ? "企业信息获取中"
      : report?.status === "loading"
        ? "对比报告生成中"
        : scoreStatus === "loading"
          ? "评分生成中"
          : "";

  return (
    <button type="button" className={active ? "competitor-card active" : "competitor-card"} onClick={onClick}>
      <div className="score-ring"><span>{score ?? "--"}</span></div>
      <h3>{item.name}</h3>
      {statusLabel ? <span className="status-chip">{statusLabel}</span> : null}
      <p>{summary}</p>
    </button>
  );
}

function ResultsPage(props: {
  form: CompetitorAnalysisInput;
  targetCompanyInfo: Record<string, unknown> | null;
  targetDetail: Record<string, unknown> | null;
  competitors: CompetitorItem[];
  competitorDetails: Record<string, DetailEntry>;
  compareReports: Record<string, ReportEntry>;
  scoreResult: unknown;
  selectedCompetitorId: string | null;
  setSelectedCompetitorId: (id: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  targetDetailStatus: string;
  targetDetailError: string;
  scoreStatus: string;
  scoreError: string;
  isLoading: boolean;
  apiError: string;
}) {
  const selected = props.competitors.find((item) => item.id === props.selectedCompetitorId) || null;
  const selectedDetail = selected ? props.competitorDetails[selected.id] : undefined;
  const selectedReport = selected ? props.compareReports[selected.id] : undefined;
  const selectedScoreItem = selected ? getScoreItem(props.scoreResult, selected.name) : null;

  return (
    <main className="competitor-results">
      <CompanyOverview
        form={props.form}
        targetCompanyInfo={props.targetCompanyInfo}
        targetDetail={props.targetDetail}
        targetDetailStatus={props.targetDetailStatus}
        targetDetailError={props.targetDetailError}
      />

      <section className="competitor-section">
        <div className="section-title-row">
          <h2>竞争对手列表 <span>（{props.competitors.length}家）</span></h2>
          {props.isLoading ? <span className="status-chip">流式分析中</span> : null}
          {props.scoreError ? <span className="status-chip error">评分失败</span> : null}
        </div>
        {props.apiError ? <p className="form-error">{props.apiError}</p> : null}
        {props.competitors.length === 0 && props.isLoading ? <div className="analysis-loading">正在生成竞争对手列表...</div> : null}
        <div className="competitor-grid-native">
          {props.competitors.map((item) => (
            <CompetitorCard
              key={item.id}
              item={item}
              active={props.selectedCompetitorId === item.id}
              scoreResult={props.scoreResult}
              detail={props.competitorDetails[item.id]}
              report={props.compareReports[item.id]}
              scoreStatus={props.scoreStatus}
              onClick={() => {
                props.setSelectedCompetitorId(item.id);
                props.setActiveTab(DEFAULT_RESULT_TAB);
              }}
            />
          ))}
        </div>
      </section>

      <section className="details-panel">
        {selected ? (
          <>
            <div className="tabbar">
              {RESULT_TABS.map((tab) => (
                <button key={tab} type="button" className={props.activeTab === tab ? "active" : ""} onClick={() => props.setActiveTab(tab)}>
                  {tab}
                </button>
              ))}
            </div>
            {props.activeTab === "总体信息" ? (
              <div className="detail-grid">
                <div>
                  <h3>公司名称</h3>
                  <p>{selected.name}</p>
                </div>
                <div>
                  <h3>公司简介</h3>
                  <p>{selected.intro || "暂无企业简介。"}</p>
                </div>
                <div>
                  <h3>竞争分析小结</h3>
                  <p>{compactText(selectedScoreItem?.竞争分析小结) || "暂无竞争分析小结。"}</p>
                </div>
              </div>
            ) : null}
            {props.activeTab === "公司近况" ? (
              <div className="timeline-list">
                {selectedDetail?.status === "loading" ? <p>正在获取公司近况...</p> : null}
                {selectedDetail?.status === "error" ? <p className="form-error">{selectedDetail.error}</p> : null}
                {Array.isArray(selectedDetail?.data?.latelyItems) && selectedDetail.data.latelyItems.length ? (
                  (selectedDetail.data.latelyItems as Array<Record<string, unknown>>).slice(0, 8).map((item, index) => (
                    <article key={index} className="timeline-item">
                      <time>{String(item.time || "近期")}</time>
                      <h4>{String(item.title || "近期动态")}</h4>
                      <p>{String(item.content || item.impact || "")}</p>
                    </article>
                  ))
                ) : selectedDetail?.status === "success" ? <p>{String(selectedDetail.data?.lately || "暂无近期动态。")}</p> : null}
              </div>
            ) : null}
            {props.activeTab === "对比分析报告" ? (
              <div className="report-wrap">
                {selectedReport?.status === "loading" ? <div className="analysis-loading">对比分析报告生成中...</div> : null}
                {selectedReport?.status === "error" ? <p className="form-error">{selectedReport.error}</p> : null}
                {selectedReport?.status === "success" ? <MarkdownReport text={selectedReport.text} /> : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="select-tip">点击任意卡片查看详细分析。</div>
        )}
      </section>
    </main>
  );
}

export function CompetitorAnalysisPage() {
  const { canAccessApp } = useAuth();
  const [form, setFormState] = useState<CompetitorAnalysisInput>(() => createEmptyForm());
  const [phase, setPhase] = useState<"home" | "results">("home");
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [historyItems, setHistoryItems] = useState<HistoryRecord[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState("");
  const [runningResultId, setRunningResultId] = useState("");
  const [targetCompanyInfo, setTargetCompanyInfo] = useState<Record<string, unknown> | null>(null);
  const [targetDetail, setTargetDetail] = useState<Record<string, unknown> | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorItem[]>([]);
  const [competitorDetails, setCompetitorDetails] = useState<Record<string, DetailEntry>>({});
  const [compareReports, setCompareReports] = useState<Record<string, ReportEntry>>({});
  const [scoreResult, setScoreResult] = useState<unknown>(null);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(DEFAULT_RESULT_TAB);
  const [targetDetailStatus, setTargetDetailStatus] = useState<DetailEntry["status"]>("idle");
  const [targetDetailError, setTargetDetailError] = useState("");
  const [scoreStatus, setScoreStatus] = useState<DetailEntry["status"]>("idle");
  const [scoreError, setScoreError] = useState("");
  const [queryTime, setQueryTime] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const setForm = (updater: (current: CompetitorAnalysisInput) => CompetitorAnalysisInput) => {
    setFormState((current) => updater(current));
  };

  const loadHistory = useCallback(async () => {
    try {
      const [items] = await Promise.all([listHistory(), healthCheck().catch(() => null)]);
      setHistoryItems(items);
    } catch (error) {
      setHistoryItems([]);
      setApiError(error instanceof Error ? `历史记录服务不可用：${error.message}` : "历史记录服务不可用。");
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => abortRef.current?.abort();
  }, [loadHistory]);

  const restoreRecord = useCallback((record: HistoryRecord) => {
    const snap = normalizeRecordSnapshot(record);
    setFormState(snap.form);
    setTargetCompanyInfo(snap.targetCompanyInfo);
    setTargetDetail(snap.targetDetail);
    setCompetitors(snap.competitors);
    setCompetitorDetails(snap.competitorDetails);
    setCompareReports(snap.compareReports);
    setScoreResult(snap.scoreResult);
    setSelectedCompetitorId(snap.selectedCompetitorId || snap.competitors[0]?.id || null);
    setActiveTab(snap.activeTab || DEFAULT_RESULT_TAB);
    setTargetDetailStatus(snap.targetDetailStatus);
    setTargetDetailError(snap.targetDetailError);
    setScoreStatus(snap.scoreStatus);
    setScoreError(snap.scoreError);
    setQueryTime(snap.queryTime || record.queryTime || "");
    setActiveHistoryId(record.id);
    setRunningResultId("");
    setIsLoading(false);
    setPhase("results");
    setApiError(Array.isArray(record.warnings) && record.warnings.length ? record.warnings.join("；") : "");
  }, []);

  const openRecord = useCallback(async (id: string) => {
    if (id === runningResultId) {
      setPhase("results");
      setActiveHistoryId(id);
      return;
    }
    try {
      const record = await getHistoryRecord(id);
      if (!record) {
        setApiError("未找到历史记录。");
        return;
      }
      restoreRecord(record);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "历史记录加载失败。");
    }
  }, [restoreRecord, runningResultId]);

  const deleteRecord = async (id: string) => {
    await deleteHistoryRecord(id);
    await loadHistory();
    if (activeHistoryId === id) {
      setActiveHistoryId("");
      setPhase("home");
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setFormState(createEmptyForm());
    setPhase("home");
    setIsLoading(false);
    setApiError("");
    setTargetCompanyInfo(null);
    setTargetDetail(null);
    setCompetitors([]);
    setCompetitorDetails({});
    setCompareReports({});
    setScoreResult(null);
    setSelectedCompetitorId(null);
    setActiveTab(DEFAULT_RESULT_TAB);
    setActiveHistoryId("");
    setRunningResultId("");
    setTargetDetailStatus("idle");
    setTargetDetailError("");
    setScoreStatus("idle");
    setScoreError("");
  };

  const handleAnalyze = async (event: FormEvent) => {
    event.preventDefault();
    if (isLoading) {
      return;
    }
    const targetName = String(form.targetCompanyName || "").trim();
    if (!targetName) {
      setApiError("请先输入我方企业名称。");
      return;
    }

    const manualNames = splitCompetitorNames(form.competitorCompanyName);
    const pendingResultId = createPendingResultId();
    const currentForm: CompetitorAnalysisInput = {
      ...form,
      targetCompanyName: targetName,
      province: form.matchMode === "exact" ? "" : form.province || DEFAULT_PROVINCE,
      competitorCompanyName: form.matchMode === "exact" ? manualNames.join("、") : "",
      resultId: pendingResultId,
    };
    const optimisticCompetitors = manualNames.map((name, index) => ({
      id: `manual-${index + 1}`,
      name,
      intro: "正在补全企业详情。",
      threatScore: null,
      sourceTag: "指定竞争对手",
    }));

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setFormState(currentForm);
    setTargetCompanyInfo({ name: targetName, intro: currentForm.targetCompanyIntro || "", business: currentForm.targetCompanyBusiness || "" });
    setTargetDetail(null);
    setTargetDetailStatus("loading");
    setTargetDetailError("");
    setCompetitors(optimisticCompetitors);
    setCompetitorDetails(Object.fromEntries(optimisticCompetitors.map((item) => [item.id, { status: "loading", data: null, error: "" }])));
    setCompareReports(Object.fromEntries(optimisticCompetitors.map((item) => [item.id, { status: "loading", text: "", error: "" }])));
    setScoreResult(null);
    setScoreStatus(optimisticCompetitors.length ? "loading" : "idle");
    setScoreError("");
    setSelectedCompetitorId(optimisticCompetitors[0]?.id || null);
    setActiveTab(DEFAULT_RESULT_TAB);
    setActiveHistoryId(pendingResultId);
    setRunningResultId(pendingResultId);
    setQueryTime(formatDateTime());
    setPhase("results");
    setIsLoading(true);
    setApiError("");

    let finishedRecord: HistoryRecord | null = null;
    let streamError = "";

    const initializeCompetitors = (items: unknown) => {
      const nextCompetitors = Array.isArray(items) ? (items as CompetitorItem[]) : [];
      setCompetitors(nextCompetitors);
      setCompetitorDetails(Object.fromEntries(nextCompetitors.map((item) => [item.id, { status: "loading", data: null, error: "" }])));
      setCompareReports(Object.fromEntries(nextCompetitors.map((item) => [item.id, { status: "loading", text: "", error: "" }])));
      setSelectedCompetitorId((current) => nextCompetitors.some((item) => item.id === current) ? current : nextCompetitors[0]?.id || null);
      setScoreStatus(nextCompetitors.length ? "loading" : "idle");
    };

    const markPendingAsError = (message: string) => {
      setTargetDetailStatus((current) => current === "loading" ? "error" : current);
      setTargetDetailError((current) => current || message);
      setCompetitorDetails((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [
        id,
        value.status === "loading" ? { ...value, status: "error", error: message } : value,
      ])));
      setCompareReports((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [
        id,
        value.status === "loading" ? { ...value, status: "error", error: message } : value,
      ])));
      setScoreStatus((current) => current === "loading" ? "error" : current);
      setScoreError((current) => current || message);
    };

    try {
      await runAnalysisStream(currentForm, (eventMessage) => {
        const data = eventMessage.data as Record<string, unknown>;
        if (eventMessage.type === "analysis_started") {
          setApiError("");
          setIsLoading(true);
          return;
        }
        if (eventMessage.type === "competitors_ready") {
          initializeCompetitors(eventMessage.data);
          return;
        }
        if (eventMessage.type === "target_detail_ready") {
          if (data.status === "success") {
            setTargetDetail((data.data as Record<string, unknown>) || null);
            setTargetDetailStatus("success");
            setTargetDetailError("");
          } else {
            setTargetDetailStatus("error");
            setTargetDetailError(String(data.error || "我方企业详情加载失败"));
          }
          return;
        }
        if (eventMessage.type === "competitor_detail_ready") {
          const competitorId = String(data.competitorId || "");
          if (!competitorId) return;
          setCompetitorDetails((current) => ({
            ...current,
            [competitorId]: {
              status: data.status === "success" ? "success" : "error",
              data: data.status === "success" ? (data.data as Record<string, unknown>) || null : null,
              error: data.status === "success" ? "" : String(data.error || "企业详情加载失败"),
            },
          }));
          return;
        }
        if (eventMessage.type === "compare_report_ready") {
          const competitorId = String(data.competitorId || "");
          if (!competitorId) return;
          setCompareReports((current) => ({
            ...current,
            [competitorId]: {
              status: data.status === "success" ? "success" : "error",
              text: data.status === "success" ? String(data.text || "") : "",
              error: data.status === "success" ? "" : String(data.error || "对比报告生成失败"),
            },
          }));
          return;
        }
        if (eventMessage.type === "score_ready") {
          if (data.status === "success") {
            setScoreResult(data.data || null);
            setScoreStatus("success");
            setScoreError("");
          } else {
            setScoreStatus("error");
            setScoreError(String(data.error || "评分生成失败"));
          }
          return;
        }
        if (eventMessage.type === "analysis_finished") {
          const record = data.record as HistoryRecord | undefined;
          if (!record) {
            streamError = "后端未返回完整分析结果。";
            setApiError(streamError);
            return;
          }
          finishedRecord = record;
          setRunningResultId("");
          restoreRecord(record);
          setHistoryItems((current) => [record, ...current.filter((item) => item.id !== record.id)].slice(0, 200));
          return;
        }
        if (eventMessage.type === "analysis_error") {
          streamError = String(data.message || "分析失败");
          markPendingAsError(streamError);
          setApiError(streamError);
        }
      }, abortController.signal);
      if (finishedRecord) {
        await loadHistory();
      } else if (streamError) {
        setApiError(streamError);
      } else {
        throw new Error("分析流未返回完成事件。");
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : "分析失败。";
      markPendingAsError(message);
      setApiError(message);
    } finally {
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  };

  const runningRecord = useMemo<HistoryRecord | null>(() => (
    runningResultId ? { id: runningResultId, input: form, queryTime, mode: "running" } : null
  ), [form, queryTime, runningResultId]);

  if (!canAccessApp("competitor-analysis")) {
    return (
      <section className="page-stack">
        <div className="notice warning"><Icon name="lock" />当前账号没有访问竞对分析的权限。</div>
      </section>
    );
  }

  return (
    <section className="competitor-shell">
      <Sidebar
        historyItems={historyItems}
        runningItem={runningRecord}
        activeHistoryId={activeHistoryId}
        onNew={reset}
        onOpen={(id) => void openRecord(id)}
        onDelete={(id) => void deleteRecord(id)}
      />
      {phase === "home" ? (
        <HomeForm form={form} setForm={setForm} onAnalyze={handleAnalyze} isLoading={isLoading} apiError={apiError} />
      ) : (
        <ResultsPage
          form={form}
          targetCompanyInfo={targetCompanyInfo}
          targetDetail={targetDetail}
          competitors={competitors}
          competitorDetails={competitorDetails}
          compareReports={compareReports}
          scoreResult={scoreResult}
          selectedCompetitorId={selectedCompetitorId}
          setSelectedCompetitorId={setSelectedCompetitorId}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          targetDetailStatus={targetDetailStatus}
          targetDetailError={targetDetailError}
          scoreStatus={scoreStatus}
          scoreError={scoreError}
          isLoading={isLoading}
          apiError={apiError}
        />
      )}
    </section>
  );
}
