import { FormEvent, useCallback, useEffect, useState } from "react";

import { ApiRequestError } from "../shared/api/client";
import {
  FeedbackSubmissionContext,
  fetchFeatureRequestCaptcha,
  fetchFeatureRequestSubmissionContext,
  fetchTicketCaptcha,
  fetchTicketSubmissionContext,
  submitFeatureRequest,
  submitTicket,
} from "../shared/api/portal";
import { useAuth } from "../shared/auth/AuthProvider";
import { Icon } from "../shared/components/Icon";

type FeedbackMode = "ticket" | "feature_request";

const OVERVIEW_MAX = 500;
const DESCRIPTION_MAX = 2000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".rar",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".pdf",
  ".zip",
  ".7z",
  ".mp4",
]);

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

function loadContextForMode(mode: FeedbackMode) {
  return mode === "ticket" ? fetchTicketSubmissionContext() : fetchFeatureRequestSubmissionContext();
}

function fetchCaptchaForMode(mode: FeedbackMode) {
  return mode === "ticket" ? fetchTicketCaptcha() : fetchFeatureRequestCaptcha();
}

function submitForMode(mode: FeedbackMode, formData: FormData) {
  return mode === "ticket" ? submitTicket(formData) : submitFeatureRequest(formData);
}

function resolveDefaultContactEmail(context: FeedbackSubmissionContext | null, account?: string) {
  const fromApi = (context?.defaultContactEmail || "").trim();
  if (fromApi && EMAIL_PATTERN.test(fromApi)) {
    return fromApi;
  }
  const normalizedAccount = (account || "").trim();
  return EMAIL_PATTERN.test(normalizedAccount) ? normalizedAccount : fromApi;
}

export function FeedbackPage() {
  const { currentUser } = useAuth();
  const [mode, setMode] = useState<FeedbackMode>("ticket");
  const [context, setContext] = useState<FeedbackSubmissionContext | null>(null);
  const [overview, setOverview] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaDisplay, setCaptchaDisplay] = useState<{ code: string; hint: string } | null>(null);
  const [captchaModalOpen, setCaptchaModalOpen] = useState(false);
  const [loadingContext, setLoadingContext] = useState(true);
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [fileError, setFileError] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const pageTitle = mode === "ticket" ? "提交工单" : "提交新功能愿望单";
  const overviewLabel = mode === "ticket" ? "问题概述" : "新功能概述";
  const descriptionLabel = mode === "ticket" ? "问题描述" : "新功能具体描述";

  const loadContext = useCallback(async (nextMode: FeedbackMode) => {
    setLoadingContext(true);
    setPageError("");
    try {
      const nextContext = await loadContextForMode(nextMode);
      setContext(nextContext);
      setContactEmail(resolveDefaultContactEmail(nextContext, currentUser?.account));
    } catch (error) {
      setContext(null);
      setPageError(getErrorMessage(error));
    } finally {
      setLoadingContext(false);
    }
  }, [currentUser?.account]);

  const loadCaptcha = useCallback(async (nextMode: FeedbackMode) => {
    setLoadingCaptcha(true);
    setCaptchaError("");
    try {
      const data = await fetchCaptchaForMode(nextMode);
      setCaptchaDisplay({ code: data.code, hint: data.hint });
      setCaptchaInput("");
    } catch (error) {
      setCaptchaDisplay(null);
      setCaptchaError(getErrorMessage(error));
    } finally {
      setLoadingCaptcha(false);
    }
  }, []);

  useEffect(() => {
    setOverview("");
    setDescription("");
    setFiles([]);
    setCaptchaInput("");
    setCaptchaDisplay(null);
    setCaptchaModalOpen(false);
    setSuccessMessage("");
    void loadContext(mode);
  }, [loadContext, mode]);

  const validateFiles = (selected: FileList | null) => {
    setFileError("");
    if (!selected?.length) {
      return;
    }
    const next = [...files];
    for (const file of Array.from(selected)) {
      if (next.length >= MAX_FILES) {
        setFileError(`最多只能选择 ${MAX_FILES} 个附件。`);
        break;
      }
      if (!ALLOWED_EXTENSIONS.has(extensionOf(file.name))) {
        setFileError(`不支持的文件类型：${file.name}`);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setFileError(`单个文件不能超过 10MB：${file.name}`);
        return;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const validateForm = () => {
    if (!overview.trim()) {
      return `请填写${overviewLabel}。`;
    }
    if (overview.trim().length > OVERVIEW_MAX) {
      return `${overviewLabel}过长。`;
    }
    if (!description.trim()) {
      return `请填写${descriptionLabel}。`;
    }
    if (description.trim().length > DESCRIPTION_MAX) {
      return `${descriptionLabel}过长。`;
    }
    if (!EMAIL_PATTERN.test(contactEmail.trim())) {
      return "联系方式（邮箱）格式不正确。";
    }
    return "";
  };

  const performSubmit = async (captchaValue?: string) => {
    const formData = new FormData();
    formData.append("overview", overview.trim());
    formData.append("description", description.trim());
    formData.append("contactEmail", contactEmail.trim());
    if (context?.captchaRequired && captchaValue) {
      formData.append("captcha", captchaValue);
    }
    files.forEach((file) => formData.append("attachments", file));

    setSubmitting(true);
    setPageError("");
    setCaptchaError("");
    try {
      const result = await submitForMode(mode, formData);
      setSuccessMessage(`提交成功，已于 ${new Date(result.submittedAt).toLocaleString("zh-CN")} 发送邮件。`);
      setOverview("");
      setDescription("");
      setFiles([]);
      setCaptchaInput("");
      setCaptchaDisplay(null);
      setCaptchaModalOpen(false);
      await loadContext(mode);
    } catch (error) {
      const message = getErrorMessage(error);
      if (captchaModalOpen) {
        setCaptchaError(message);
        if (error instanceof ApiRequestError && error.code === "INVALID_CAPTCHA") {
          await loadCaptcha(mode);
        }
      } else {
        setPageError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPageError("");
    setSuccessMessage("");
    const validationError = validateForm();
    if (validationError) {
      setPageError(validationError);
      return;
    }
    if (context?.captchaRequired) {
      setCaptchaModalOpen(true);
      await loadCaptcha(mode);
      return;
    }
    await performSubmit();
  };

  return (
    <section className="page-stack">
      <header className="page-hero compact">
        <div>
          <span className="eyebrow">Feedback</span>
          <h1>用户反馈</h1>
          <p>支持工单和功能建议，保持验证码 cookie、multipart 附件和后台邮件提交兼容。</p>
        </div>
      </header>

      <div className="feedback-layout">
        <aside className="feedback-tabs">
          <button type="button" className={mode === "ticket" ? "active" : ""} onClick={() => setMode("ticket")}>
            工单
            <span>问题上报与技术支持</span>
          </button>
          <button type="button" className={mode === "feature_request" ? "active" : ""} onClick={() => setMode("feature_request")}>
            新功能愿望单
            <span>产品建议与需求</span>
          </button>
        </aside>

        <section className="panel-card">
          <div className="panel-title">
            <Icon name="message" />
            <div>
              <h2>{pageTitle}</h2>
              <p>标有 * 的字段为必填。</p>
            </div>
          </div>

          {loadingContext ? (
            <div className="page-center-state small"><div className="loading-spinner" />加载中...</div>
          ) : (
            <form className="form-stack" onSubmit={onSubmit}>
              <label className="form-field">
                <span>{overviewLabel} *</span>
                <input value={overview} maxLength={OVERVIEW_MAX} onChange={(event) => setOverview(event.target.value)} />
                <small>{overview.length}/{OVERVIEW_MAX}</small>
              </label>
              <label className="form-field">
                <span>{descriptionLabel} *</span>
                <textarea rows={8} value={description} maxLength={DESCRIPTION_MAX} onChange={(event) => setDescription(event.target.value)} />
                <small>{description.length}/{DESCRIPTION_MAX}</small>
              </label>
              <label className="form-field">
                <span>附件</span>
                <input type="file" multiple accept={Array.from(ALLOWED_EXTENSIONS).join(",")} onChange={(event) => validateFiles(event.target.files)} />
                <small>最多 5 个附件，单个不超过 10MB。</small>
              </label>
              {files.length ? (
                <div className="attachment-list">
                  {files.map((file, index) => (
                    <span key={`${file.name}-${file.size}-${index}`}>
                      {file.name}
                      <button type="button" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>移除</button>
                    </span>
                  ))}
                </div>
              ) : null}
              {fileError ? <p className="form-error">{fileError}</p> : null}
              <label className="form-field">
                <span>联系方式（邮箱） *</span>
                <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
              </label>
              {pageError ? <p className="form-error">{pageError}</p> : null}
              {successMessage ? <p className="success-message">{successMessage}</p> : null}
              <button type="submit" className="primary-button" disabled={submitting}>
                <Icon name="send" />
                {submitting ? "提交中..." : "提交"}
              </button>
            </form>
          )}
        </section>
      </div>

      {captchaModalOpen ? (
        <div className="modal-backdrop">
          <section className="dialog" role="dialog" aria-modal="true">
            <button className="icon-button dialog-close" type="button" disabled={submitting} onClick={() => setCaptchaModalOpen(false)}>
              <Icon name="close" />
            </button>
            <span className="dialog-icon warning"><Icon name="shield" /></span>
            <h3>验证码</h3>
            <p>{context?.captchaHint || captchaDisplay?.hint || "请输入验证码后提交。"}</p>
            {captchaDisplay?.code ? <strong className="captcha-code">{captchaDisplay.code}</strong> : <div className="page-center-state small"><div className="loading-spinner" />正在获取验证码...</div>}
            <label className="form-field">
              <span>输入验证码 *</span>
              <input
                value={captchaInput}
                onChange={(event) => setCaptchaInput(event.target.value.replace(/\D/g, "").slice(0, 5))}
                inputMode="numeric"
                maxLength={5}
              />
            </label>
            {captchaError ? <p className="form-error">{captchaError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="ghost-button" disabled={loadingCaptcha || submitting} onClick={() => void loadCaptcha(mode)}>
                <Icon name="refresh" />
                刷新
              </button>
              <button type="button" className="primary-button" disabled={submitting || captchaInput.length !== 5} onClick={() => void performSubmit(captchaInput)}>
                确认提交
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
