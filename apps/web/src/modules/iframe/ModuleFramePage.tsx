import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../shared/auth/AuthProvider";
import { Icon } from "../../shared/components/Icon";
import { getModuleEntry } from "../../shared/config/modules";
import { useRuntimeApps } from "../../shared/runtime/RuntimeAppsProvider";
import type { PortalModule } from "../../shared/types/portal";
import {
  buildAuthContextMessage,
  buildAuthErrorMessage,
  getCurrentAuthTokenForIframe,
  getIframeOrigin,
  isCloverAuthRequestMessage,
  resolveIframeUrl,
} from "./iframeBridge";

interface ModuleFramePageProps {
  slug: PortalModule["slug"];
}

export function ModuleFramePage({ slug }: ModuleFramePageProps) {
  const module = getModuleEntry(slug);
  const { getRuntimeAppByCode, error: runtimeError } = useRuntimeApps();
  const { canAccessApp, isAuthenticated } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [frameError, setFrameError] = useState("");
  const runtimeApp = getRuntimeAppByCode(module.code);
  const iframeUrl = resolveIframeUrl(module, runtimeApp?.iframeUrl || runtimeApp?.url);
  const iframeOrigin = iframeUrl ? getIframeOrigin(iframeUrl) : "";
  const allowed = canAccessApp(module.code);

  useEffect(() => {
    setIsLoaded(false);
    setFrameError("");
  }, [iframeUrl]);

  useEffect(() => {
    if (!iframeOrigin) {
      return undefined;
    }

    const handleMessage = (event: MessageEvent) => {
      if (!isCloverAuthRequestMessage(event.data)) {
        return;
      }
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow || event.origin !== iframeOrigin) {
        return;
      }

      const requestId = String(event.data.requestId || "");
      const requestedAppCode = String(event.data.appCode || "");
      if (!requestId || requestedAppCode !== module.code) {
        iframeWindow.postMessage(
          buildAuthErrorMessage({
            requestId,
            appCode: requestedAppCode || module.code,
            message: "鉴权请求的应用编码不匹配。",
          }),
          iframeOrigin,
        );
        return;
      }

      if (!isAuthenticated || !allowed) {
        iframeWindow.postMessage(
          buildAuthErrorMessage({
            requestId,
            appCode: module.code,
            message: `当前账号没有访问 ${module.name} 的权限。`,
          }),
          iframeOrigin,
        );
        return;
      }

      const token = getCurrentAuthTokenForIframe();
      if (!token) {
        iframeWindow.postMessage(
          buildAuthErrorMessage({
            requestId,
            appCode: module.code,
            message: "请先登录后再访问该应用。",
          }),
          iframeOrigin,
        );
        return;
      }

      const authContext = buildAuthContextMessage({ requestId, appCode: module.code, token });
      if (!authContext) {
        iframeWindow.postMessage(
          buildAuthErrorMessage({
            requestId,
            appCode: module.code,
            message: "当前应用尚未配置鉴权桥接。",
          }),
          iframeOrigin,
        );
        return;
      }

      iframeWindow.postMessage(authContext, iframeOrigin);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [allowed, iframeOrigin, isAuthenticated, module.code, module.name]);

  if (!allowed) {
    return (
      <section className="page-stack">
        <div className="notice warning">
          <Icon name="lock" />
          当前账号没有访问 {module.name} 的权限。
        </div>
      </section>
    );
  }

  if (!iframeUrl || !iframeOrigin) {
    return (
      <section className="page-stack">
        <header className="page-hero compact">
          <div>
            <span className="eyebrow">Iframe</span>
            <h1>{module.name}</h1>
            <p>当前模块仍通过 iframe 接入，iframe 地址来自 runtime apps。</p>
          </div>
        </header>
        <div className="notice warning">
          {runtimeError || `${module.name} iframe 地址不可用，请先启动对应 legacy 前端或生成 runtime/ports.json。`}
        </div>
      </section>
    );
  }

  return (
    <section className="module-frame-page">
      <header className="frame-header">
        <div>
          <span className="eyebrow">Iframe bridge</span>
          <h1>{module.name}</h1>
        </div>
        <span className="runtime-url">{iframeOrigin}</span>
      </header>

      <div className="module-frame-wrap">
        <iframe
          ref={iframeRef}
          key={module.code}
          title={`${module.name} 内嵌应用`}
          src={iframeUrl}
          onLoad={() => setIsLoaded(true)}
          onError={() => setFrameError("iframe 加载失败，请确认对应前端已启动。")}
          allow="clipboard-read; clipboard-write; fullscreen"
        />
        {!isLoaded ? (
          <div className="frame-loading">
            <div className="loading-spinner" />
            正在进入 {module.name}...
          </div>
        ) : null}
        {frameError ? <div className="frame-error">{frameError}</div> : null}
      </div>
    </section>
  );
}
