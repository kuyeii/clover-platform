import { AnimatePresence, motion } from "framer-motion";
import { LockKeyhole, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFormError("");
      setSuccessMessage("");
      setIsSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setSuccessMessage("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setFormError("请填写当前密码、新密码和确认密码。");
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError("两次输入的新密码不一致。");
      return;
    }

    if (currentPassword === newPassword) {
      setFormError("新密码不能和当前密码相同。");
      return;
    }

    setIsSubmitting(true);
    const result = await changePassword({
      currentPassword,
      newPassword,
    });
    setIsSubmitting(false);

    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccessMessage("密码已更新，下次登录请使用新密码。");
      return;
    }

    setFormError(result.message);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="修改密码"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.form
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-3xl border border-white/80 bg-white p-5 shadow-2xl shadow-slate-950/20 md:p-6"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">修改密码</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    输入当前密码验证身份，修改后当前登录状态会继续保留。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                aria-label="关闭修改密码弹窗"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">当前密码</span>
                <input
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">新密码</span>
                <input
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">确认新密码</span>
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              {formError ? (
                <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {formError}
                </p>
              ) : null}

              {successMessage ? (
                <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {successMessage}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSubmitting ? "正在保存..." : "保存新密码"}
                </button>
              </div>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
