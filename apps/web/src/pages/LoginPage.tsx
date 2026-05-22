import { FormEvent, useMemo, useState } from "react";

import type { NavigateFn } from "../routes";
import { useAuth } from "../shared/auth/AuthProvider";
import { Icon } from "../shared/components/Icon";

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

  if (isAuthenticated) {
    navigate(redirectTo);
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
    <main className="login-screen">
      <section className="login-visual" aria-hidden>
        <div className="login-visual-grid">
          <div className="visual-tile primary">
            <Icon name="shield" />
            <strong>Portal</strong>
            <span>权限与会话</span>
          </div>
          <div className="visual-tile">
            <Icon name="chart" />
            <strong>竞对分析</strong>
            <span>原生迁入</span>
          </div>
          <div className="visual-tile">
            <Icon name="message" />
            <strong>RAG</strong>
            <span>iframe 保留</span>
          </div>
          <div className="visual-tile">
            <Icon name="file" />
            <strong>文档工具</strong>
            <span>回滚链路保留</span>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-label="账号登录">
        <div className="login-card">
          <div className="login-heading">
            <span className="eyebrow">Portal Access</span>
            <h1>账号登录</h1>
            <p>统一前端入口已接入平台会话、权限和模块工作台。</p>
          </div>

          <form onSubmit={handleSubmit} className="form-stack">
            <label className="form-field">
              <span>账号</span>
              <div className="input-with-icon">
                <Icon name="user" />
                <input
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  autoComplete="username"
                  spellCheck={false}
                  placeholder="请输入账号"
                />
              </div>
            </label>

            <label className="form-field">
              <span>密码</span>
              <div className="input-with-icon">
                <Icon name="lock" />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder="请输入密码"
                />
              </div>
            </label>

            {formError || error ? <p className="form-error">{formError || error}</p> : null}

            <button type="submit" className="primary-button full" disabled={isLoading}>
              {isLoading ? "正在登录..." : "进入工作台"}
              <Icon name="arrow" />
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
