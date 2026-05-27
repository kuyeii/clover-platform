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
const ATTACHMENT_HELP_TEXT =
  "支持 .png .jpg .jpeg .txt .rar .doc .xls .xlsx .pdf .zip .7z .mp4 等格式，单个附件不超过 10MB，最多上传 5 个附件。";
const sidebarItems: { id: FeedbackMode; label: string; description: string }[] = [
  { id: "ticket", label: "工单", description: "问题上报与技术支持" },
  { id: "feature_request", label: "新功能愿望单", description: "产品建议与需求" },
];

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
  const [contactEmailTouched, setContactEmailTouched] = useState(false);
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
  const captchaHint = context?.captchaHint || captchaDisplay?.hint || "建议将问题汇总后发送";
  const resolvedDefaultContactEmail = resolveDefaultContactEmail(context, currentUser?.account);
  const hasDefaultContactEmail = Boolean(resolvedDefaultContactEmail);

  const loadContext = useCallback(async (nextMode: FeedbackMode) => {
    setLoadingContext(true);
    setPageError("");
    try {
      const nextContext = await loadContextForMode(nextMode);
      setContext(nextContext);
      if (!contactEmailTouched) {
        setContactEmail(resolveDefaultContactEmail(nextContext, currentUser?.account));
      }
    } catch (error) {
      setContext(null);
      setPageError(getErrorMessage(error));
    } finally {
      setLoadingContext(false);
    }
  }, [contactEmailTouched, currentUser?.account]);

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
    setFileError("");
    setContactEmailTouched(false);
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
      if (next.reduce((total, item) => total + item.size, 0) + file.size > MAX_FILES * MAX_FILE_BYTES) {
        setFileError("附件总大小超出限制。");
        return;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
    setFileError("");
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
    <>
      <div className="mx-auto min-h-full w-full max-w-7xl space-y-5 px-4 py-5 pb-10 md:px-8 md:py-6 md:pb-12">
        <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-lg md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                <Icon name="shield" />
                邮件工单与愿望单
              </div>
              <h1 className="text-3xl font-semibold text-slate-950">用户反馈</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-600">
                提交后将通过邮件发送至后台配置的邮箱。请尽量在一条反馈中汇总相关信息，便于处理。
              </p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Icon name="message" className="h-7 w-7" />
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <aside className="w-full shrink-0 rounded-3xl border border-white/80 bg-white p-4 shadow-lg lg:w-56 xl:w-64">
            <p className="mb-3 px-1 text-xs font-semibold uppercase text-slate-400">反馈类型</p>
            <nav className="flex flex-col gap-2">
              {sidebarItems.map((item) => {
                const active = mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMode(item.id)}
                    className={[
                      "relative rounded-2xl border px-4 py-3 text-left transition-colors",
                      active
                        ? "border-sky-200 bg-sky-50 text-sky-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    {active ? <span className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-blue-600" /> : null}
                    <span className="block pl-2 text-sm font-semibold">{item.label}</span>
                    <span className="mt-1 block pl-2 text-xs text-slate-500">{item.description}</span>
                  </button>
                );
              })}
            </nav>
        </aside>

          <section className="min-w-0 flex-1 rounded-3xl border border-white/80 bg-white p-5 shadow-lg md:p-7">
            <div className="mb-6 border-b border-slate-100 pb-5">
              <h2 className="text-xl font-semibold text-slate-950">{pageTitle}</h2>
              <p className="mt-1 text-sm text-slate-500">标有 * 的字段为必填。</p>
            </div>

            {loadingContext ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
                <div className="loading-spinner" />
                加载中...
              </div>
            ) : (
              <form className="space-y-6" onSubmit={onSubmit}>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">{overviewLabel}<span className="text-rose-500"> *</span></span>
                  <input
                    value={overview}
                    maxLength={OVERVIEW_MAX}
                    placeholder={mode === "ticket" ? "简要概括问题" : "简要概括期望的新功能"}
                    onChange={(event) => setOverview(event.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  />
                  <p className="mt-1 text-right text-xs text-slate-400">{overview.length}/{OVERVIEW_MAX}</p>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">{descriptionLabel}<span className="text-rose-500"> *</span></span>
                  <textarea
                    rows={8}
                    value={description}
                    maxLength={DESCRIPTION_MAX}
                    placeholder={mode === "ticket" ? "请描述您的问题，可粘贴图片或说明复现步骤" : "请描述您希望新增的功能、使用场景与预期效果"}
                    onChange={(event) => setDescription(event.target.value)}
                    className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  />
                  <p className="mt-1 text-right text-xs text-slate-400">{description.length}/{DESCRIPTION_MAX}</p>
                </label>
                <div>
                  <span className="text-sm font-semibold text-slate-700">附件</span>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800">
                      <Icon name="upload" />
                      添加附件
                      <input
                        type="file"
                        className="sr-only"
                        multiple
                        accept={Array.from(ALLOWED_EXTENSIONS).join(",")}
                        onChange={(event) => validateFiles(event.target.files)}
                      />
                    </label>
                    <span className="text-xs text-slate-500">{ATTACHMENT_HELP_TEXT}</span>
                  </div>
                  {files.length ? (
                    <ul className="mt-3 space-y-2">
                      {files.map((file, index) => (
                        <li key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                          <span className="flex min-w-0 items-center gap-2">
                            <Icon name="file" className="shrink-0 text-slate-400" />
                            <span className="truncate">{file.name}</span>
                            <span className="shrink-0 text-slate-400">({(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB)</span>
                          </span>
                          <button type="button" className="shrink-0 text-xs font-semibold text-rose-600 hover:text-rose-700" onClick={() => removeFile(index)}>
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {fileError ? <p className="mt-2 text-sm text-rose-600">{fileError}</p> : null}
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">联系方式（邮箱）<span className="text-rose-500"> *</span></span>
                  <input
                    type="email"
                    value={contactEmail}
                    placeholder={hasDefaultContactEmail ? resolvedDefaultContactEmail : "请输入您的联系邮箱"}
                    autoComplete="email"
                    onChange={(event) => {
                      setContactEmailTouched(true);
                      setContactEmail(event.target.value);
                    }}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  />
                  {!hasDefaultContactEmail ? <p className="mt-1 text-xs text-slate-500">请输入您的联系邮箱</p> : null}
                </label>
                {pageError ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{pageError}</p> : null}
                {successMessage ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successMessage}</p> : null}
                <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto sm:min-w-[200px]">
                  {submitting ? <div className="loading-spinner" /> : <Icon name="send" />}
                  {submitting ? "提交中..." : "提交"}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>

      {captchaModalOpen ? (
        <div className="modal-backdrop">
          <section className="dialog" role="dialog" aria-modal="true">
            <button className="icon-button dialog-close" type="button" disabled={submitting} onClick={() => setCaptchaModalOpen(false)}>
              <Icon name="close" />
            </button>
            <span className="dialog-icon warning"><Icon name="shield" /></span>
            <h3>验证码</h3>
            <p>{captchaHint}</p>
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
    </>
  );
}
