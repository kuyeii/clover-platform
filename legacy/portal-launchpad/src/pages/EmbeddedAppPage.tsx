import { LockKeyhole, TriangleAlert } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { getAppById } from "../config/apps.config";
import { useAuth } from "../contexts/AuthContext";

export function EmbeddedAppPage() {
  const { appId = "" } = useParams();
  const app = getAppById(appId);
  const { canAccessApp } = useAuth();

  if (!app) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 md:px-8">
        <section className="w-full max-w-2xl rounded-3xl border border-white/80 bg-white p-8 shadow-panel">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <TriangleAlert className="h-6 w-6" />
            </div>
            <div className="space-y-3">
              <h1 className="text-2xl font-semibold text-slate-950">未找到应用入口</h1>
              <p className="text-base leading-7 text-slate-600">
                当前路由没有匹配到有效模块配置。请返回总览后重新进入目标应用。
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!canAccessApp(app.id)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 md:px-8">
        <section className="w-full max-w-2xl rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow-panel">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-amber-600">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <div className="space-y-3">
              <h1 className="text-2xl font-semibold text-amber-950">没有访问权限</h1>
              <p className="text-base leading-7 text-amber-800">
                当前账号没有访问 {app.name} 的权限。请联系管理员在用户管理中开启该应用权限。
              </p>
              <Link
                to="/dashboard"
                className="inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-amber-700 shadow-sm transition-colors hover:bg-amber-100"
              >
                返回工作台
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return <div className="flex h-full min-h-0 flex-1" />;
}
