import { Loader2, MessageSquarePlus, Paperclip, Send, ShieldCheck, Upload } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { FeedbackCaptchaDialog } from "../components/FeedbackCaptchaDialog";
import { ApiRequestError as ApiError } from "../shared/api/client";
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

type FeedbackMode = "ticket" | "feature_request";

const OVERVIEW_MAX = 500;
const DESCRIPTION_MAX = 2000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function resolveDefaultContactEmail(apiDefault?: string, account?: string): string {
  const fromApi = (apiDefault || "").trim();
  if (fromApi && EMAIL_PATTERN.test(fromApi)) {
    return fromApi;
  }
  const normalizedAccount = (account || "").trim();
  if (EMAIL_PATTERN.test(normalizedAccount)) {
    return normalizedAccount;
  }
  return fromApi;
}

function loadContextForMode(mode: FeedbackMode) {
  return mode === "ticket"
    ? fetchTicketSubmissionContext()
    : fetchFeatureRequestSubmissionContext();
}

function fetchCaptchaForMode(mode: FeedbackMode) {
  return mode === "ticket" ? fetchTicketCaptcha() : fetchFeatureRequestCaptcha();
}

function submitForMode(mode: FeedbackMode, formData: FormData) {
  return mode === "ticket" ? submitTicket(formData) : submitFeatureRequest(formData);
}

const sidebarItems: { id: FeedbackMode; label: string; description: string }[] = [
  { id: "ticket", label: "工单", description: "问题上报与技术支持" },
  { id: "feature_request", label: "新功能愿望单", description: "产品建议与需求" },
];

export function FeedbackPage() {
  const { currentUser } = useAuth();
  const [mode, setMode] = useState<FeedbackMode>("ticket");
  const [context, setContext] = useState<FeedbackSubmissionContext | null>(null);
  const [overview, setOverview] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactEmailTouched, setContactEmailTouched] = useState(false);
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaDisplay, setCaptchaDisplay] = useState<{ code: string; hint: string } | null>(null);
  const [captchaModalOpen, setCaptchaModalOpen] = useState(false);
  const [captchaModalError, setCaptchaModalError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pageError, setPageError] = useState("");
  const [fileError, setFileError] = useState("");
  const [loadingContext, setLoadingContext] = useState(true);
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const pageTitle = mode === "ticket" ? "提交工单" : "提交新功能愿望单";
  const overviewLabel = mode === "ticket" ? "问题概述" : "新功能概述";
  const descriptionLabel = mode === "ticket" ? "问题描述" : "新功能具体描述";
  const captchaHint = context?.captchaHint || "建议将问题汇总后发送";
  const resolvedDefaultContactEmail = resolveDefaultContactEmail(
    context?.defaultContactEmail,
    currentUser?.account,
  );
  const hasDefaultContactEmail = Boolean(resolvedDefaultContactEmail);

  const applyDefaultContactEmail = useCallback(
    (ctx: FeedbackSubmissionContext | null, force = false) => {
      if (!force && contactEmailTouched) {
        return;
      }
      const next = resolveDefaultContactEmail(ctx?.defaultContactEmail, currentUser?.account);
      if (next) {
        setContactEmail(next);
      }
    },
    [contactEmailTouched, currentUser?.account],
  );

  const loadCaptcha = useCallback(async (nextMode: FeedbackMode) => {
    setLoadingCaptcha(true);
    setCaptchaModalError("");
    try {
      const data = await fetchCaptchaForMode(nextMode);
      setCaptchaDisplay({ code: data.code, hint: data.hint });
      setCaptchaInput("");
    } catch (e) {
      setCaptchaDisplay(null);
      setCaptchaModalError(e instanceof ApiError ? e.message : "获取验证码失败。");
    } finally {
      setLoadingCaptcha(false);
    }
  }, []);

  const openCaptchaModal = useCallback(async () => {
    setCaptchaModalOpen(true);
    setCaptchaModalError("");
    setCaptchaInput("");
    setCaptchaDisplay(null);
    await loadCaptcha(mode);
  }, [loadCaptcha, mode]);

  const closeCaptchaModal = useCallback(() => {
    if (submitting) {
      return;
    }
    setCaptchaModalOpen(false);
    setCaptchaModalError("");
    setCaptchaInput("");
  }, [submitting]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setOverview("");
      setDescription("");
      setCaptchaInput("");
      setFiles([]);
      setFileError("");
      setSuccessMessage("");
      setPageError("");
      setCaptchaModalOpen(false);
      setCaptchaDisplay(null);
      setContactEmailTouched(false);
      setLoadingContext(true);
      try {
        const ctx = await loadContextForMode(mode);
        if (cancelled) {
          return;
        }
        setContext(ctx);
        const nextEmail = resolveDefaultContactEmail(ctx.defaultContactEmail, currentUser?.account);
        setContactEmail(nextEmail);
      } catch (e) {
        if (!cancelled) {
          setContext(null);
          setPageError(e instanceof ApiError ? e.message : "加载失败，请刷新重试。");
        }
      } finally {
        if (!cancelled) {
          setLoadingContext(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.account, mode]);

  useEffect(() => {
    if (loadingContext || contactEmailTouched) {
      return;
    }
    applyDefaultContactEmail(context);
  }, [applyDefaultContactEmail, contactEmailTouched, context, loadingContext]);

  const validateFormFields = (): string | null => {
    const ov = overview.trim();
    const desc = description.trim();
    const email = contactEmail.trim();

    if (!ov) {
      return `请填写${overviewLabel}。`;
    }
    if (ov.length > OVERVIEW_MAX) {
      return `${overviewLabel}过长（最多 ${OVERVIEW_MAX} 字）。`;
    }
    if (!desc) {
      return `请填写${descriptionLabel}。`;
    }
    if (desc.length > DESCRIPTION_MAX) {
      return `${descriptionLabel}过长（最多 ${DESCRIPTION_MAX} 字）。`;
    }
    if (!email) {
      return "请填写联系方式（邮箱）。";
    }
    if (!EMAIL_PATTERN.test(email)) {
      return "联系方式（邮箱）格式不正确。";
    }
    return null;
  };

  const performSubmit = async (captchaValue?: string) => {
    const ov = overview.trim();
    const desc = description.trim();
    const email = contactEmail.trim();

    const formData = new FormData();
    formData.append("overview", ov);
    formData.append("description", desc);
    formData.append("contactEmail", email);
    if (context?.captchaRequired && captchaValue) {
      formData.append("captcha", captchaValue);
    }
    for (const file of files) {
      formData.append("attachments", file);
    }

    setSubmitting(true);
    setPageError("");
    setCaptchaModalError("");
    try {
      const result = await submitForMode(mode, formData);
      setSuccessMessage(`提交成功，已于 ${new Date(result.submittedAt).toLocaleString("zh-CN")} 发送邮件。`);
      setOverview("");
      setDescription("");
      setCaptchaInput("");
      setFiles([]);
      setFileError("");
      setCaptchaModalOpen(false);
      setCaptchaDisplay(null);

      const ctx = await loadContextForMode(mode);
      setContext(ctx);
      setContactEmailTouched(false);
      const nextEmail = resolveDefaultContactEmail(ctx.defaultContactEmail, currentUser?.account);
      setContactEmail(nextEmail);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "提交失败，请稍后重试。";
      if (captchaModalOpen) {
        setCaptchaModalError(message);
        if (e instanceof ApiError && e.code === "INVALID_CAPTCHA") {
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

    const validationError = validateFormFields();
    if (validationError) {
      setPageError(validationError);
      return;
    }

    if (context?.captchaRequired) {
      await openCaptchaModal();
      return;
    }

    await performSubmit();
  };

  const onCaptchaConfirm = async () => {
    const digits = captchaInput.trim();
    if (digits.length !== 5 || !/^\d{5}$/.test(digits)) {
      setCaptchaModalError("请输入 5 位数字验证码。");
      return;
    }
    await performSubmit(digits);
  };

  const validateAndSetFiles = (selected: FileList | File[] | null) => {
    setFileError("");
    if (!selected || selected.length === 0) {
      return;
    }
    const list = Array.from(selected);
    const next: File[] = [...files];
    for (const file of list) {
      if (next.length >= MAX_FILES) {
        setFileError(`最多只能选择 ${MAX_FILES} 个附件。`);
        break;
      }
      const ext = extensionOf(file.name);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        setFileError(`不支持的文件类型：${file.name}`);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setFileError(`单个文件不能超过 10MB：${file.name}`);
        return;
      }
      if (next.reduce((s, f) => s + f.size, 0) + file.size > MAX_FILES * MAX_FILE_BYTES) {
        setFileError("附件总大小超出限制。");
        return;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
    setFileError("");
  };

  const descriptionCount = description.length;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 pb-10 md:px-8 md:py-6 md:pb-12">
          <section className="px-1">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-600">
                  <ShieldCheck className="h-4 w-4" />
                  邮件工单与愿望单
                </div>
                <h1 className="text-3xl font-semibold text-slate-950">用户反馈</h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-600">
                  提交后将通过邮件发送至后台配置的邮箱。请尽量在一条反馈中汇总相关信息，便于我们处理。
                </p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <MessageSquarePlus className="h-7 w-7" />
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <aside className="w-full shrink-0 rounded-xl border border-border bg-white p-4 shadow-none lg:w-56 xl:w-64">
              <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">反馈类型</p>
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
                          ? "border-brand-200 bg-brand-50 text-brand-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {active ? (
                        <span className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-brand-500" />
                      ) : null}
                      <span className="block pl-2 text-sm font-semibold">{item.label}</span>
                      <span className="mt-1 block pl-2 text-xs text-slate-500">{item.description}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <section className="min-w-0 flex-1 rounded-xl border border-border bg-white p-5 shadow-none md:p-7">
            <div className="mb-6 border-b border-slate-100 pb-5">
              <h2 className="text-xl font-semibold text-slate-950">{pageTitle}</h2>
              <p className="mt-1 text-sm text-slate-500">标有 * 的字段为必填。</p>
            </div>

            {loadingContext ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                加载中…
              </div>
            ) : (
              <form className="space-y-6" onSubmit={onSubmit}>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">
                    {overviewLabel}
                    <span className="text-danger"> *</span>
                  </span>
                  <input
                    value={overview}
                    onChange={(e) => setOverview(e.target.value)}
                    maxLength={OVERVIEW_MAX}
                    placeholder={mode === "ticket" ? "简要概括问题" : "简要概括期望的新功能"}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  />
                  <p className="mt-1 text-right text-xs text-slate-400">
                    {overview.length}/{OVERVIEW_MAX}
                  </p>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">
                    {descriptionLabel}
                    <span className="text-danger"> *</span>
                  </span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={DESCRIPTION_MAX}
                    rows={8}
                    placeholder={
                      mode === "ticket"
                        ? "请描述您的问题，可粘贴图片或说明复现步骤"
                        : "请描述您希望新增的功能、使用场景与预期效果"
                    }
                    className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  />
                  <p className="mt-1 text-right text-xs text-slate-400">
                    {descriptionCount}/{DESCRIPTION_MAX}
                  </p>
                </label>

                <div>
                  <span className="text-sm font-semibold text-slate-700">附件</span>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700">
                      <Upload className="h-4 w-4" />
                      添加附件
                      <input
                        type="file"
                        className="sr-only"
                        multiple
                        accept={Array.from(ALLOWED_EXTENSIONS).join(",")}
                        onChange={(e) => validateAndSetFiles(e.target.files)}
                      />
                    </label>
                    <span className="text-xs text-slate-500">{ATTACHMENT_HELP_TEXT}</span>
                  </div>
                  {files.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {files.map((file, index) => (
                        <li
                          key={`${file.name}-${file.size}-${index}`}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="truncate">{file.name}</span>
                            <span className="shrink-0 text-slate-400">
                              ({(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB)
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            className="shrink-0 text-xs font-semibold text-danger hover:text-danger"
                          >
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {fileError ? <p className="mt-2 text-sm text-danger">{fileError}</p> : null}
                </div>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">
                    联系方式（邮箱）
                    <span className="text-danger"> *</span>
                  </span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => {
                      setContactEmailTouched(true);
                      setContactEmail(e.target.value);
                    }}
                    placeholder={
                      hasDefaultContactEmail ? resolvedDefaultContactEmail : "请输入您的联系邮箱"
                    }
                    autoComplete="email"
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  />
                  {!hasDefaultContactEmail ? (
                    <p className="mt-1 text-xs text-slate-500">请输入您的联系邮箱</p>
                  ) : null}
                </label>

                {pageError ? (
                  <p className="rounded-xl bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-danger">{pageError}</p>
                ) : null}
                {successMessage ? (
                  <p className="rounded-xl bg-[var(--color-success-bg)] px-4 py-3 text-sm text-success">{successMessage}</p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 px-5 py-3.5 text-sm font-semibold text-white shadow-none  transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto sm:min-w-[200px]"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting ? "提交中…" : "提交"}
                </button>
              </form>
            )}
          </section>
          </div>
        </div>
      </div>

      {captchaModalOpen ? (
        <FeedbackCaptchaDialog
          hint={captchaHint}
          code={captchaDisplay?.code ?? null}
          captchaInput={captchaInput}
          loadingCaptcha={loadingCaptcha}
          submitting={submitting}
          error={captchaModalError}
          onCaptchaInputChange={setCaptchaInput}
          onRefresh={() => void loadCaptcha(mode)}
          onConfirm={() => void onCaptchaConfirm()}
          onCancel={closeCaptchaModal}
        />
      ) : null}
    </>
  );
}
