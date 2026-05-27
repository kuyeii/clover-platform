import { FormEvent, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import type { PortalUser } from "../types/portal";
import { Icon } from "./Icon";

type AccountTab = "profile" | "password";

export function AccountSettingsPanel({ currentUser, onDone }: { currentUser: PortalUser; onDone?: () => void }) {
  const { updateUser, changePassword, error } = useAuth();
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");
  const [profileName, setProfileName] = useState(currentUser.name);
  const [profileAccount, setProfileAccount] = useState(currentUser.account);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    setProfileName(currentUser.name);
    setProfileAccount(currentUser.account);
  }, [currentUser.account, currentUser.name]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileError("");
    setProfileMessage("");
    const name = profileName.trim();
    if (!name) {
      setProfileError("姓名不能为空。");
      return;
    }
    setIsSavingProfile(true);
    const updated = await updateUser(currentUser.id, { name });
    setIsSavingProfile(false);
    if (updated) {
      setProfileMessage("账号信息已更新。");
      onDone?.();
    } else {
      setProfileError(error || "账号信息更新失败，请稍后重试。");
    }
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");
    if (!currentPassword.trim() || !newPassword.trim()) {
      setPasswordError("当前密码和新密码不能为空。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError("新密码不能和当前密码相同。");
      return;
    }
    setIsChangingPassword(true);
    const result = await changePassword({ currentPassword, newPassword });
    setIsChangingPassword(false);
    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码已修改，下次登录请使用新密码。");
    } else {
      setPasswordError(result.message);
    }
  };

  return (
    <section className="min-w-0">
      <div className="mb-4 grid w-full grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          className={[
            "h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition-colors",
            activeTab === "profile" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800",
          ].join(" ")}
          onClick={() => setActiveTab("profile")}
        >
          我的信息
        </button>
        <button
          type="button"
          className={[
            "h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition-colors",
            activeTab === "password" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800",
          ].join(" ")}
          onClick={() => setActiveTab("password")}
        >
          修改密码
        </button>
      </div>

      {activeTab === "profile" ? (
        <form className="space-y-3" onSubmit={saveProfile}>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">姓名</span>
            <input
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">账号</span>
            <input
              className="mt-1 h-10 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 outline-none"
              value={profileAccount}
              disabled
            />
          </label>
          {profileError ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{profileError}</p> : null}
          {profileMessage ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{profileMessage}</p> : null}
          <button
            type="submit"
            disabled={isSavingProfile}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Icon name="save" strokeWidth={1.7} />
            {isSavingProfile ? "保存中..." : "保存账号信息"}
          </button>
        </form>
      ) : (
        <form className="space-y-3" onSubmit={savePassword}>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">当前密码</span>
            <input
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">新密码</span>
            <input
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">确认新密码</span>
            <input
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {passwordError ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{passwordError}</p> : null}
          {passwordMessage ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{passwordMessage}</p> : null}
          <button
            type="submit"
            disabled={isChangingPassword}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Icon name="lock" strokeWidth={1.7} />
            {isChangingPassword ? "修改中..." : "修改密码"}
          </button>
        </form>
      )}
    </section>
  );
}
