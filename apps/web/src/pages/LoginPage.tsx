import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  DatabaseZap,
  FileSearch,
  LockKeyhole,
  PanelTop,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { BrandMark } from "../shared/components/BrandMark";

function getLoginRedirect() {
  if (typeof window === "undefined") {
    return "/workspace";
  }
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from");
  return from && from.startsWith("/") && !from.startsWith("//") ? from : "/workspace";
}

export function LoginPage({ navigate }: { navigate: NavigateFn }) {
  const { login, isAuthenticated, isLoading, error } = useAuth();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const redirectTo = useMemo(() => getLoginRedirect(), []);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectTo);
    }
  }, [isAuthenticated, navigate, redirectTo]);

  if (isAuthenticated) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!account.trim() || !password) {
      setFormError("请输入账号和密码。");
      return;
    }
    const ok = await login(account.trim(), password);
    if (ok) {
      navigate(redirectTo);
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-mist px-4 py-8 text-ink sm:px-6 lg:px-8">
      <section
        className="mx-auto grid min-h-[calc(100vh-64px)] w-full max-w-6xl overflow-hidden rounded-xl border border-border bg-surface shadow-panel lg:grid-cols-[1.06fr_0.94fr]"
        aria-label="账号登录"
      >
        <div className="relative hidden overflow-hidden bg-brand-500 p-8 text-white lg:block">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--color-brand-active)_0%,var(--color-brand)_58%,var(--color-success-text)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_16%,rgba(255,255,255,0.24),transparent_30%),linear-gradient(90deg,rgba(36,52,71,0.34),rgba(36,52,71,0.08)_56%,rgba(36,52,71,0.28))]" />
          <div
            className="absolute inset-0 opacity-[0.14]"
            aria-hidden="true"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.52) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.52) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />

          <div className="relative z-10 flex h-full min-h-[600px] flex-col justify-between gap-8">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white/90">
                <Building2 className="h-4 w-4" aria-hidden="true" />
                企业智能门户
              </div>

              <div className="max-w-xl space-y-5">
                <h1 className="text-4xl font-black leading-tight tracking-normal text-white xl:text-5xl">
                  招投标、审合同、查知识库，统一进入
                </h1>
                <p className="max-w-md text-base font-medium leading-7 text-white/86">
                  面向投标、合同风控、知识检索和竞对分析的工作入口，权限、会话和应用占用由平台统一管理。
                </p>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[520px]" aria-hidden="true">
              <div className="rounded-xl border border-white/18 bg-white/12 p-4 shadow-2xl shadow-slate-900/20">
                <div className="flex items-center justify-between border-b border-white/15 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success-bg)]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-info-bg)]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-warning-bg)]" />
                  </div>
                  <div className="flex items-center gap-2 text-white/72">
                    <PanelTop className="h-4 w-4" />
                    <span className="h-2 w-20 rounded-full bg-white/28" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-4">
                  {[
                    { icon: ShieldCheck, label: "合同风险", tone: "bg-white text-brand-600" },
                    { icon: FileSearch, label: "标书生成", tone: "bg-[var(--color-info-bg)] text-brand-700" },
                    { icon: DatabaseZap, label: "知识检索", tone: "bg-[var(--color-success-bg)] text-success" },
                    { icon: ArrowRight, label: "统一入口", tone: "bg-[var(--color-warning-bg)] text-warning" },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="min-h-24 rounded-lg border border-white/14 bg-white/10 p-3">
                        <span className={`grid h-10 w-10 place-items-center rounded-lg shadow-sm ${item.tone}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="mt-4 space-y-2">
                          <span className="block text-sm font-semibold text-white/90">{item.label}</span>
                          <span className="block h-2 w-4/5 rounded-full bg-white/34" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center px-6 py-10 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-md space-y-10">
            <div className="space-y-6">
              <BrandMark />
              <div className="space-y-3">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Portal Access</p>
                <h2 className="text-3xl font-black leading-tight tracking-normal text-ink sm:text-4xl">账号登录</h2>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-5">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-muted">账号</span>
                <span className="flex h-12 items-center gap-3 rounded-lg border border-border bg-surface-soft px-4 transition focus-within:border-brand-500 focus-within:bg-surface focus-within:ring-4 focus-within:ring-brand-200">
                  <UserRound className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    autoComplete="username"
                    spellCheck={false}
                    placeholder="请输入账号"
                  />
                </span>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-muted">密码</span>
                <span className="flex h-12 items-center gap-3 rounded-lg border border-border bg-surface-soft px-4 transition focus-within:border-brand-500 focus-within:bg-surface focus-within:ring-4 focus-within:ring-brand-200">
                  <LockKeyhole className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    placeholder="请输入密码"
                  />
                </span>
              </label>

              {formError || error ? (
                <p className="rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm font-medium text-danger" aria-live="polite">
                  {formError || error}
                </p>
              ) : null}

              <button
                type="submit"
                className="inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 text-base font-bold text-white transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={isLoading}
              >
                <span className="truncate">{isLoading ? "正在登录..." : "进入工作台"}</span>
                <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
              </button>
            </form>

            <div className="flex items-center justify-between border-t border-border pt-5 text-xs font-medium text-muted">
              <span>安全连接已启用</span>
              <span>后端校验</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
