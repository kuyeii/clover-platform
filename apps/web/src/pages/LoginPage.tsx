import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  DatabaseZap,
  FileSearch,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { motion } from "framer-motion";

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

const brandSlides = [
  {
    icon: ShieldCheck,
    label: "合同审查",
    summary: "帮助业务、法务和项目团队快速识别合同风险，沉淀可复用的审查意见。",
    capabilities: ["条款定位", "风险分级", "改写建议"],
    tone: "bg-white text-brand-600",
  },
  {
    icon: FileSearch,
    label: "标书生成",
    summary: "让投标团队复用企业资料、项目经验和模板规范，更快完成投标文件。",
    capabilities: ["资料复用", "模板生成", "格式整理"],
    tone: "bg-[var(--color-info-bg)] text-brand-700",
  },
  {
    icon: DatabaseZap,
    label: "知识检索",
    summary: "把制度、案例、项目资料和历史成果统一检索，减少反复找资料的时间。",
    capabilities: ["语义检索", "来源追溯", "材料归档"],
    tone: "bg-[var(--color-success-bg)] text-success",
  },
  {
    icon: ArrowRight,
    label: "竞对分析",
    summary: "面向市场、售前和管理者汇总竞品动态，辅助判断机会和差异。",
    capabilities: ["信息汇总", "差异对比", "趋势洞察"],
    tone: "bg-[var(--color-warning-bg)] text-warning",
  },
];

export function LoginPage({ navigate }: { navigate: NavigateFn }) {
  const { login, isAuthenticated, isLoading, error } = useAuth();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [activeSlide, setActiveSlide] = useState(0);
  const redirectTo = useMemo(() => getLoginRedirect(), []);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectTo);
    }
  }, [isAuthenticated, navigate, redirectTo]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % brandSlides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

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

  const ActiveSlideIcon = brandSlides[activeSlide].icon;

  return (
    <main className="grid min-h-screen place-items-center overflow-hidden bg-mist px-4 py-4 text-ink sm:px-6 lg:px-8">
      <section
        className="relative grid max-h-[calc(100vh-32px)] min-h-[min(600px,calc(100vh-32px))] w-full max-w-6xl overflow-hidden rounded-xl border border-border bg-surface shadow-panel lg:grid-cols-[1.06fr_0.94fr]"
        aria-label="账号登录"
      >
        <div className="absolute right-5 top-5 z-30 sm:right-6">
          <BrandMark compact />
        </div>

        <div className="relative hidden overflow-hidden bg-brand-500 p-6 text-white lg:block">
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

          <div className="relative z-10 flex h-full min-h-[440px] flex-col justify-between gap-7 px-4 pt-10">
            <div className="max-w-[520px] space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-white/64">AI Work Platform</p>
              <h1 className="text-5xl font-black leading-none tracking-normal text-white xl:text-6xl">
                企智方
              </h1>
              <p className="max-w-[500px] text-base font-medium leading-7 text-white/82">
                为企业客户提供合同审查、标书生成、知识检索和竞对分析能力，让业务团队在同一入口完成高频文档与信息工作。
              </p>
            </div>

            <div className="w-full px-4 pb-4">
              <div className="relative mx-auto h-36 w-full max-w-[580px] overflow-hidden rounded-lg border border-white/16 bg-white/10 shadow-none">
                <motion.div
                  key={brandSlides[activeSlide].label}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 px-5 py-5 pr-24"
                >
                  <div className="flex h-full min-w-0 flex-col justify-center">
                    <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                      <h2 className="shrink-0 text-xl font-black leading-tight text-white">{brandSlides[activeSlide].label}</h2>
                      <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden">
                        {brandSlides[activeSlide].capabilities.map((capability) => (
                          <span key={capability} className="shrink-0 rounded-md border border-white/14 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/82">
                            {capability}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="mt-3 max-w-[420px] text-sm font-medium leading-6 text-white/78">{brandSlides[activeSlide].summary}</p>
                  </div>
                </motion.div>

                <span className={`absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-lg shadow-sm ${brandSlides[activeSlide].tone}`}>
                  <ActiveSlideIcon className="h-5 w-5" aria-hidden="true" />
                </span>

                <div className="absolute bottom-4 right-5 flex items-center gap-2">
                  {brandSlides.map((item, index) => {
                    const selected = index === activeSlide;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        className={[
                          "grid h-4 w-4 place-items-center rounded-full transition-colors",
                          selected ? "bg-white/20" : "bg-transparent hover:bg-white/12",
                        ].join(" ")}
                        onClick={() => setActiveSlide(index)}
                        aria-label={`查看${item.label}`}
                        aria-current={selected ? "true" : undefined}
                      >
                        <span className={["h-2 w-2 rounded-full transition-colors", selected ? "bg-white" : "bg-white/42"].join(" ")} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center px-6 py-16 sm:px-8 lg:px-12 lg:py-10">
          <div className="mx-auto w-full max-w-md space-y-7">
            <div className="space-y-3 pt-8 lg:pt-0">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Portal Access</p>
              <h2 className="text-3xl font-black leading-tight tracking-normal text-ink sm:text-4xl">账号登录</h2>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4">
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
          </div>
        </div>
      </section>
    </main>
  );
}
