import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";

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

type FeatureApp = {
  key: string;
  title: string;
  icon: FeatureIconType;
  description: string;
  tags: string[];
};

type FeatureIconType = "document" | "shield" | "chart" | "chat" | "badge";

const featureApps: FeatureApp[] = [
  {
    key: "bid",
    title: "标书生成",
    icon: "document",
    description: "整合团队资源和前沿技术调研，AI辅助输出高质量投标文件。",
    tags: ["模板复用", "智能生成"],
  },
  {
    key: "contract",
    title: "合同审查",
    icon: "shield",
    description: "识别关键条款与潜在风险，辅助合规审阅和修订。",
    tags: ["风险提示", "条款比对", "修订建议"],
  },
  {
    key: "competitor",
    title: "竞品分析",
    icon: "chart",
    description: "整合公开信息与行业数据，快速形成结构化洞察。",
    tags: ["行业对比", "趋势摘要", "报告输出"],
  },
  {
    key: "rag",
    title: "RAG问答",
    icon: "chat",
    description: "连接企业知识库与项目资料，针对业务问题精准检索作答。",
    tags: ["知识检索", "语义问答", "多源引用"],
  },
  {
    key: "patent",
    title: "专利生成",
    icon: "badge",
    description: "梳理技术方案与创新点，辅助生成规范专利文本。",
    tags: ["创新提炼", "结构生成", "规范输出"],
  },
];

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);
    const handleChange = () => setReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return reducedMotion;
}

function AppIcon({ type }: { type: FeatureIconType }) {
  const commonProps = {
    className: "h-10 w-10",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.85,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (type === "document") {
    return (
      <svg {...commonProps}>
        <path d="M7 3.8h6.2L18 8.6v11.6H7z" />
        <path d="M13 4v5h5" />
        <path d="M9.5 13h5" />
        <path d="M9.5 16.5H14" />
      </svg>
    );
  }

  if (type === "shield") {
    return (
      <svg {...commonProps}>
        <path d="M12 3.8 18.4 6v5.3c0 4.1-2.5 7.4-6.4 8.9-3.9-1.5-6.4-4.8-6.4-8.9V6z" />
        <path d="m9.4 12 1.8 1.8 3.6-4" />
      </svg>
    );
  }

  if (type === "chart") {
    return (
      <svg {...commonProps}>
        <path d="M4.8 19.2h14.4" />
        <path d="M6.8 15.8V9.4" />
        <path d="M12 15.8V5.8" />
        <path d="M17.2 15.8v-3.9" />
        <path d="m6.8 10 4-3.9 3.4 3 3-3.6" />
      </svg>
    );
  }

  if (type === "chat") {
    return (
      <svg {...commonProps}>
        <path d="M5.2 6.4h13.6v8.8H10l-4.8 3.2z" />
        <path d="M8.6 10h6.8" />
        <path d="M8.6 13h4.4" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M12 3.8 14.3 8l4.7.8-3.3 3.3.8 4.7L12 14.6l-4.5 2.2.8-4.7L5 8.8 9.7 8z" />
      <path d="M9.8 20.2h4.4" />
    </svg>
  );
}

function FeatureSwitcher() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const activeApp = featureApps[activeIndex];

  useEffect(() => {
    if (isPaused || reducedMotion) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % featureApps.length);
    }, 7500);

    return () => window.clearInterval(timer);
  }, [isPaused, reducedMotion]);

  return (
    <section
      className="group relative w-full max-w-[620px] overflow-hidden rounded-2xl border border-white/35 bg-[linear-gradient(135deg,rgba(255,255,255,0.28),rgba(255,255,255,0.12))] px-4 pb-5 pt-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_24px_60px_rgba(0,39,105,0.26)] backdrop-blur-[18px] sm:px-5"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      aria-label="应用能力切换"
    >
      <span
        className="pointer-events-none absolute -inset-px bg-[radial-gradient(circle_at_78%_100%,rgba(40,226,255,0.22),transparent_42%)]"
        aria-hidden="true"
      />
      <div className="relative z-10">
        <div
          className="grid grid-cols-5 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] max-sm:flex max-sm:gap-2 [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="应用能力"
        >
          {featureApps.map((item, index) => {
            const selected = activeIndex === index;
            return (
              <div
                key={item.key}
                className={[
                  "relative min-w-0 shrink-0 sm:w-full",
                  index > 0 ? "before:absolute before:-left-[3px] before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:bg-white/22" : "",
                ].join(" ")}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={[
                    "inline-flex h-9 min-w-0 shrink-0 items-center justify-center rounded-full px-2.5 text-[13px] font-bold transition-[background-color,color,box-shadow,transform] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:w-full",
                    selected
                      ? "-translate-y-px bg-white/95 text-[#096dd9] shadow-[0_8px_22px_rgba(0,84,180,0.18)]"
                      : "bg-transparent text-white/85 hover:bg-white/12 hover:text-white",
                  ].join(" ")}
                  onClick={() => setActiveIndex(index)}
                >
                  <span className="truncate">{item.title}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div
          key={activeApp.key}
          className="feature-switcher-body mt-5 min-h-[112px] pl-8"
          role="tabpanel"
        >
          <div className="flex items-stretch gap-4">
            <div className="grid min-h-[64px] w-16 shrink-0 place-items-center rounded-xl bg-slate-100/20 text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_24px_rgba(0,103,184,0.14)]">
              <AppIcon type={activeApp.icon} />
            </div>
            <div className="min-w-0 self-center">
              <h3 className="text-[23px] font-extrabold leading-tight text-white">{activeApp.title}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {activeApp.tags.map((tag) => (
                  <span key={tag} className="rounded-md border border-white/22 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/86">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-4 text-[15px] font-medium leading-7 text-white/82">{activeApp.description}</p>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2.5" aria-label="应用切换分页">
          {featureApps.map((item, index) => {
            const selected = activeIndex === index;
            return (
              <button
                key={item.key}
                type="button"
                aria-label={`切换到${item.title}`}
                className={[
                  "h-[7px] rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                  selected ? "w-[22px] bg-[linear-gradient(90deg,#fff,#6eefff)]" : "w-[7px] bg-white/45 hover:bg-white/70",
                ].join(" ")}
                onClick={() => setActiveIndex(index)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
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
    <main className="grid min-h-screen place-items-center overflow-x-hidden bg-[radial-gradient(circle_at_18%_12%,rgba(42,157,255,0.14),transparent_32%),linear-gradient(135deg,#f7fbff_0%,#eef6ff_100%)] px-3 py-4 text-ink sm:px-6 lg:overflow-hidden lg:px-8">
      <section
        className="grid min-h-[600px] w-full max-w-[min(86vw,1280px)] overflow-hidden rounded-[18px] bg-white shadow-[0_28px_80px_rgba(19,59,105,0.18)] lg:max-h-[min(76vh,680px)] lg:grid-cols-[54%_46%]"
        aria-label="账号登录"
      >
        <div className="relative flex min-h-[420px] flex-col justify-between overflow-hidden bg-[#0266a8] px-7 py-10 text-white sm:min-h-[460px] sm:px-10 sm:py-12 lg:min-h-0 lg:px-14 lg:py-16">
          <div className="pointer-events-none absolute inset-0 bg-[url('/login/arkmind-left-bg-rendered.png')] bg-cover bg-center opacity-75" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 bg-white,linear-gradient(180deg,rgba(0,22,78,0.88),rgba(0,20,60,0.35))]" />
          <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-between gap-10">
            <div className="max-w-[620px]">
              <p className="text-[13px] font-bold uppercase tracking-[4px] text-white/90">AI WORK PLATFORM</p>
              <h1 className="mt-16 text-[clamp(38px,4.2vw,60px)] font-black leading-[1.12] tracking-normal text-white sm:tracking-[-1px] lg:mt-20">
                企业级{" "}
                <span className="bg-[linear-gradient(90deg,#8ef7ff_0%,#d7ffff_48%,#1ce4ff_100%)] bg-clip-text text-transparent">
                  AI
                </span>{" "}
                智能工作台
              </h1>
              <span className="mt-6 block h-1 w-[42px] rounded-full bg-[linear-gradient(90deg,#18f0ff,#31ffc7)]" aria-hidden="true" />
              <p className="mt-6 max-w-[620px] text-base font-medium leading-[1.9] text-white/85">
                统一承载标书生成、合同审查、竞品分析、RAG问答与专利生成，
                帮助团队高效完成资料复用、知识检索、风险审阅与内容生成。
              </p>
            </div>

            <FeatureSwitcher />
          </div>
        </div>

        <div className="flex items-center justify-center bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] px-7 py-12 sm:px-9 lg:px-[72px] lg:py-16">
          <div className="mx-auto w-full max-w-[460px]">
            <div className="mb-11">
              <BrandMark />
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-bold uppercase tracking-[4px] text-[#096dd9]">PORTAL ACCESS</p>
              <h2 className="text-4xl font-black leading-tight tracking-normal text-[#10233f]">账号登录</h2>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 grid gap-5">
              <label className="grid gap-2">
                <span className="text-sm font-bold text-[#10233f]">账号</span>
                <span className="flex h-[50px] items-center gap-3 rounded-[9px] border border-[#d8e4f2] bg-white px-4 text-[#10233f] transition focus-within:border-[#1677ff] focus-within:ring-[3px] focus-within:ring-[rgba(22,119,255,0.12)]">
                  <UserRound className="h-5 w-5 shrink-0 text-[#71839b]" aria-hidden="true" />
                  <input
                    className="min-h-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-[#10233f] shadow-none outline-none placeholder:text-[#7c8da3] focus:border-0 focus:shadow-none"
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    autoComplete="username"
                    spellCheck={false}
                    placeholder="请输入账号"
                  />
                </span>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-bold text-[#10233f]">密码</span>
                <span className="flex h-[50px] items-center gap-3 rounded-[9px] border border-[#d8e4f2] bg-white px-4 text-[#10233f] transition focus-within:border-[#1677ff] focus-within:ring-[3px] focus-within:ring-[rgba(22,119,255,0.12)]">
                  <LockKeyhole className="h-5 w-5 shrink-0 text-[#71839b]" aria-hidden="true" />
                  <input
                    className="min-h-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-[#10233f] shadow-none outline-none placeholder:text-[#7c8da3] focus:border-0 focus:shadow-none"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    placeholder="请输入密码"
                  />
                </span>
              </label>

              <div className="flex items-center justify-between gap-4 text-sm font-semibold">
                {/* <label className="inline-flex min-w-0 items-center gap-2 text-[#53657d]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded border-[#d8e4f2] p-0 accent-[#096dd9] focus:shadow-none"
                    defaultChecked
                  />
                  <span className="truncate">记住账号</span>
                </label>
                <button
                  type="button"
                  className="shrink-0 text-[#096dd9] transition hover:text-[#075bb8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(22,119,255,0.18)]"
                >
                  忘记密码？
                </button> */}
              </div>

              {formError || error ? (
                <p className="rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm font-medium text-danger" aria-live="polite">
                  {formError || error}
                </p>
              ) : null}

              <button
                type="submit"
                className="mt-2 inline-flex h-[54px] min-w-0 items-center justify-center gap-3 rounded-[9px] bg-[linear-gradient(90deg,#0565f2_0%,#0a8df5_100%)] px-5 text-base font-bold text-white shadow-[0_14px_28px_rgba(0,101,242,0.22)] transition hover:-translate-y-px hover:shadow-[0_16px_34px_rgba(0,101,242,0.28)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(22,119,255,0.16)] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
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
