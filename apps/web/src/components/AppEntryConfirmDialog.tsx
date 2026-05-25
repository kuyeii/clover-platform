import { AlertTriangle, X } from "lucide-react";
import type { ToolkitApp } from "../shared/types/app";

interface AppEntryConfirmDialogProps {
  app: ToolkitApp;
  userNames: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function AppEntryConfirmDialog({
  app,
  userNames,
  onConfirm,
  onCancel,
}: AppEntryConfirmDialogProps) {
  const userLabel = userNames.join("、") || "其他";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-entry-confirm-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 id="app-entry-confirm-title" className="text-lg font-semibold text-slate-950">
                应用正在被使用
              </h2>
              <p className="mt-1 text-sm text-slate-500">{app.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-6">
          <p className="text-base leading-7 text-slate-700">
            当前应用正在被 <span className="font-semibold text-slate-950">{userLabel}</span> 用户使用，请确认是否要进入。
          </p>
          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
            进入不会强制踢出对方，只会在启动台上同时显示你的使用状态。
          </p>
        </div>

        <div className="flex justify-end gap-3 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            进入
          </button>
        </div>
      </section>
    </div>
  );
}
