import {
  ArrowRight,
  Building2,
  LockKeyhole,
  PanelTop,
  Shield,
  UserRound,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { login, isAuthenticated, isLoading, error } = useAuth();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const fromPath =
    typeof location.state === "object" && location.state && "from" in location.state
      ? String(location.state.from)
      : "/dashboard";

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");

    if (!account.trim() || !password) {
      setFormError("请输入账号和密码。");
      return;
    }

    const success = await login(account.trim(), password);
    if (success) {
      navigate(fromPath, { replace: true });
    }
  };

  return (
    <main className="flex min-h-screen items-center overflow-x-hidden bg-gradient-to-br from-white via-slate-50 to-sky-50 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid min-h-[640px] w-full overflow-hidden rounded-3xl border border-white/90 bg-white shadow-2xl shadow-slate-200/70 md:grid-cols-[1.08fr_0.92fr]">
          <section className="relative hidden overflow-hidden bg-blue-700 p-7 text-white md:block lg:p-8">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,#123a84_0%,#1267a5_58%,#0f766e_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(125,211,252,0.3),transparent_32%),linear-gradient(90deg,rgba(15,23,42,0.36),rgba(15,23,42,0.14)_58%,rgba(15,23,42,0.32))]" />
            <div
              className="absolute inset-0 opacity-[0.16]"
              aria-hidden="true"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.55) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />
            <div className="relative z-10 flex h-full flex-col justify-between gap-6">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 py-1.5 text-sm font-semibold text-white/90 backdrop-blur-sm">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                  企业智能门户
                </div>

                <div className="space-y-5">
                  <h1 className="max-w-none text-4xl font-black leading-[1.12] lg:text-[2.25rem]">
                    招投标、审文件、查风险、看竞对
                    <span className="mt-2 block">一步到位</span>
                  </h1>
                  <p className="max-w-md text-base leading-7 text-sky-50/90">
                    聚合标书、合同、知识库与外部查询能力，辅助完成投标合规、风险识别和竞争分析。
                  </p>
                </div>
              </div>

              <div className="relative min-h-[210px]" aria-hidden="true">
                <div className="relative mx-auto w-[88%] max-w-[500px] rounded-[1.75rem] border border-white/20 bg-slate-950/18 p-3 shadow-2xl shadow-blue-950/30 backdrop-blur-md">
                  <div className="flex items-center justify-between border-b border-white/15 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                      <span className="h-2.5 w-2.5 rounded-full bg-sky-200" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
                    </div>
                    <div className="flex items-center gap-2 text-white/75">
                      <PanelTop className="h-4 w-4" />
                      <span className="h-2 w-20 rounded-full bg-white/28" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 px-1 py-3">
                    <div className="min-h-[74px] rounded-2xl border border-white/14 bg-white/12 p-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-blue-700 shadow-lg shadow-blue-950/15">
                        <Shield className="h-5 w-5" />
                      </span>
                      <div className="mt-3 space-y-2">
                        <span className="block h-2.5 w-4/5 rounded-full bg-white/55" />
                        <span className="block h-2 w-3/5 rounded-full bg-white/24" />
                      </div>
                    </div>

                    <div className="min-h-[74px] rounded-2xl border border-white/14 bg-white/10 p-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-200/85 text-blue-800 shadow-lg shadow-blue-950/10">
                        <PanelTop className="h-5 w-5" />
                      </span>
                      <div className="mt-3 space-y-2">
                        <span className="block h-2.5 w-3/4 rounded-full bg-white/45" />
                        <span className="block h-2 w-2/3 rounded-full bg-white/22" />
                      </div>
                    </div>

                    <div className="min-h-[74px] rounded-2xl border border-white/14 bg-white/10 p-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-200/90 text-emerald-900 shadow-lg shadow-blue-950/10">
                        <Building2 className="h-5 w-5" />
                      </span>
                      <div className="mt-3 space-y-2">
                        <span className="block h-2.5 w-4/5 rounded-full bg-white/45" />
                        <span className="block h-2 w-1/2 rounded-full bg-white/22" />
                      </div>
                    </div>

                    <div className="min-h-[74px] rounded-2xl border border-white/14 bg-sky-300/18 p-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-300/85 text-emerald-950 shadow-lg shadow-blue-950/10">
                        <ArrowRight className="h-5 w-5" />
                      </span>
                      <div className="mt-3 space-y-2">
                        <span className="block h-2.5 w-4/5 rounded-full bg-emerald-100/55" />
                        <span className="block h-2 w-2/5 rounded-full bg-white/22" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="flex items-center px-6 py-10 md:px-10 lg:px-14">
            <div className="mx-auto w-full max-w-md space-y-10">
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20 md:hidden">
                    <Shield className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-600">
                      Portal Access
                    </p>
                    <h2 className="mt-2 text-3xl font-bold text-slate-950 text-balance md:text-4xl">
                      账号登录
                    </h2>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">账号</span>
                  <div className="mt-2 flex h-[3.25rem] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 transition-colors focus-within:border-sky-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-100">
                    <UserRound className="h-5 w-5 text-slate-400" aria-hidden="true" />
                    <input
                      name="username"
                      value={account}
                      onChange={(event) => setAccount(event.target.value)}
                      autoComplete="username"
                      spellCheck={false}
                      type="text"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                      placeholder="请输入账号…"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">密码</span>
                  <div className="mt-2 flex h-[3.25rem] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 transition-colors focus-within:border-sky-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-100">
                    <LockKeyhole className="h-5 w-5 text-slate-400" aria-hidden="true" />
                    <input
                      name="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      autoComplete="current-password"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                      placeholder="请输入密码…"
                    />
                  </div>
                </label>

                {formError || error ? (
                  <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700" aria-live="polite">
                    {formError || error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex min-h-[3.25rem] w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  {isLoading ? "正在登录…" : "进入工作台"}
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </form>

              <div className="flex items-center justify-between border-t border-slate-100 pt-5 text-xs text-slate-500">
                <span>安全连接已启用</span>
                <span>后端校验</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
