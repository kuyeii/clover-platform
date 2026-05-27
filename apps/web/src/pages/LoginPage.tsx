import { FormEvent, useEffect, useMemo, useState } from "react";

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
    <main className="grid min-h-screen place-items-center overflow-hidden bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/40" aria-label="账号登录">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>

        <form onSubmit={handleSubmit} className="grid gap-5">
          <label className="grid gap-2">
            <span className="text-base font-semibold text-slate-700 dark:text-slate-200">账号</span>
            <input
              className="h-12 rounded-lg border border-slate-200 bg-white px-3 text-base text-slate-950 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-500/20"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              autoComplete="username"
              spellCheck={false}
              placeholder="请输入账号"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-base font-semibold text-slate-700 dark:text-slate-200">密码</span>
            <input
              className="h-12 rounded-lg border border-slate-200 bg-white px-3 text-base text-slate-950 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-500/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="请输入密码"
            />
          </label>

          {formError || error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-base font-medium text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">
              {formError || error}
            </p>
          ) : null}

          <button
            type="submit"
            className="inline-flex h-12 min-w-0 items-center justify-center rounded-lg bg-blue-600 px-4 text-base font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={isLoading}
          >
            <span className="truncate">{isLoading ? "正在登录..." : "进入工作台"}</span>
          </button>
        </form>
      </section>
    </main>
  );
}
