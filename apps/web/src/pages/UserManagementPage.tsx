import { Check, KeyRound, LockKeyhole, Plus, Save, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../shared/auth/AuthProvider";
import { appsConfig } from "../shared/config/apps.config";
import type { ModuleCode, PortalUser, UserRole } from "../shared/types/portal";

const roleLabelMap: Record<UserRole, string> = {
  admin: "管理员",
  operator: "业务用户",
  viewer: "只读用户",
};

const roleOptions: UserRole[] = ["operator", "viewer", "admin"];
const allAppIds = appsConfig.map((app) => app.id);

const emptyCreateForm = {
  name: "",
  account: "",
  password: "",
  appPermissions: allAppIds,
};

function formatTime(value?: string) {
  if (!value) {
    return "未登录";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPermissionText(user: PortalUser) {
  if (user.role === "admin") {
    return "全部应用";
  }

  const names = appsConfig
    .filter((app) => user.appPermissions.includes(app.id))
    .map((app) => app.shortName);

  return names.length > 0 ? names.join("、") : "暂无权限";
}

function AppPermissionCheckboxes({
  selectedAppIds,
  disabled,
  onToggle,
}: {
  selectedAppIds: ModuleCode[];
  disabled?: boolean;
  onToggle: (appId: ModuleCode) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {appsConfig.map((app) => {
        const checked = selectedAppIds.includes(app.id);

        return (
          <button
            key={app.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(app.id)}
            className={[
              "flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors",
              checked
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              disabled ? "cursor-not-allowed opacity-60" : "",
            ].join(" ")}
          >
            <span>{app.name}</span>
            <span
              className={[
                "flex h-5 w-5 items-center justify-center rounded-md border",
                checked
                  ? "border-sky-200 bg-sky-100 text-sky-700"
                  : "border-slate-200 bg-white text-transparent",
              ].join(" ")}
            >
              <Check className="h-3.5 w-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CurrentAccountCard({ currentUser }: { currentUser: PortalUser }) {
  const { updateUser, changePassword, error } = useAuth();
  const [profileName, setProfileName] = useState(currentUser.name);
  const [profileAccount, setProfileAccount] = useState(currentUser.account);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    setProfileName(currentUser.name);
    setProfileAccount(currentUser.account);
  }, [currentUser.account, currentUser.name]);

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileError("");
    setProfileMessage("");

    const name = profileName.trim();
    const account = profileAccount.trim().toLowerCase();

    if (!name || !account) {
      setProfileError("姓名和账号不能为空。");
      return;
    }

    setIsSavingProfile(true);
    const updated = await updateUser(currentUser.id, { name, account });
    setIsSavingProfile(false);

    if (updated) {
      setProfileMessage("账号信息已更新。");
    } else {
      setProfileError(error || "账号信息更新失败，请稍后重试。");
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
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
    const result = await changePassword({
      currentPassword,
      newPassword,
    });
    setIsChangingPassword(false);

    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码已修改，下次登录请使用新密码。");
    } else {
      setPasswordError(result.message || "密码修改失败，请稍后重试。");
    }
  };

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={handleSaveProfile} className="rounded-3xl border border-white/80 bg-white p-5 shadow-lg md:p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <UserRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-950">我的账号</h2>
            <p className="mt-1 text-sm text-slate-500">
              {roleLabelMap[currentUser.role]} · {getPermissionText(currentUser)}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">姓名</span>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">账号</span>
            <input
              value={profileAccount}
              onChange={(event) => setProfileAccount(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              required
            />
          </label>

          <p className="text-sm text-slate-500">最近登录：{formatTime(currentUser.lastLoginAt)}</p>

          {profileError ? (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{profileError}</p>
          ) : null}
          {profileMessage ? (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{profileMessage}</p>
          ) : null}

          <button
            type="submit"
            disabled={isSavingProfile}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save className="h-4 w-4" />
            {isSavingProfile ? "正在保存..." : "保存账号信息"}
          </button>
        </div>
      </form>

      <form onSubmit={handleChangePassword} className="rounded-3xl border border-white/80 bg-white p-5 shadow-lg md:p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-950">修改密码</h2>
            <p className="mt-1 text-sm text-slate-500">需要先验证当前密码，普通用户和管理员都可使用。</p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">当前密码</span>
            <input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">新密码</span>
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">确认新密码</span>
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              required
            />
          </label>

          {passwordError ? (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{passwordError}</p>
          ) : null}
          {passwordMessage ? (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{passwordMessage}</p>
          ) : null}

          <button
            type="submit"
            disabled={isChangingPassword}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <LockKeyhole className="h-4 w-4" />
            {isChangingPassword ? "正在修改..." : "修改密码"}
          </button>
        </div>
      </form>
    </section>
  );
}

function AdminUserCard({
  user,
  currentUserId,
  updateUser,
}: {
  user: PortalUser;
  currentUserId?: string;
  updateUser: ReturnType<typeof useAuth>["updateUser"];
}) {
  const [name, setName] = useState(user.name);
  const [account, setAccount] = useState(user.account);
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(user.name);
    setAccount(user.account);
    setPassword("");
    setLocalError("");
    setLocalMessage("");
  }, [user.account, user.id, user.name]);

  const handleSaveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError("");
    setLocalMessage("");

    const nextName = name.trim();
    const nextAccount = account.trim().toLowerCase();
    const nextPassword = password.trim();

    if (!nextName || !nextAccount) {
      setLocalError("姓名和账号不能为空。");
      return;
    }

    setIsSaving(true);
    const updated = await updateUser(user.id, {
      name: nextName,
      account: nextAccount,
      ...(nextPassword ? { password: nextPassword } : {}),
    });
    setIsSaving(false);

    if (updated) {
      setPassword("");
      setLocalMessage(nextPassword ? "账号信息和密码已更新。" : "账号信息已更新。");
    } else {
      setLocalError("保存失败，请检查账号是否重复或稍后重试。");
    }
  };

  const toggleUserEnabled = async () => {
    if (user.id === currentUserId) {
      return;
    }

    await updateUser(user.id, { enabled: !user.enabled });
  };

  const toggleUserPermission = async (appId: ModuleCode) => {
    if (user.role === "admin") {
      return;
    }

    const nextPermissions = user.appPermissions.includes(appId)
      ? user.appPermissions.filter((item) => item !== appId)
      : [...user.appPermissions, appId];

    await updateUser(user.id, { appPermissions: nextPermissions });
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-950">{user.name}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {roleLabelMap[user.role]}
              </span>
              <span
                className={[
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  user.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
                ].join(" ")}
              >
                {user.enabled ? "已启用" : "已停用"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              账号：{user.account} · 最近登录：{formatTime(user.lastLoginAt)}
            </p>
            <p className="mt-2 text-sm text-slate-600">权限：{getPermissionText(user)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={user.role}
            onChange={(event) =>
              updateUser(user.id, {
                role: event.target.value as UserRole,
                appPermissions: event.target.value === "admin" ? allAppIds : user.appPermissions,
              })
            }
            disabled={user.id === currentUserId}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {roleLabelMap[role]}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={toggleUserEnabled}
            disabled={user.id === currentUserId}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              user.enabled ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
              user.id === currentUserId ? "cursor-not-allowed opacity-50" : "",
            ].join(" ")}
          >
            {user.enabled ? "停用" : "启用"}
          </button>
        </div>
      </div>

      <form onSubmit={handleSaveAccount} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">姓名</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            required
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-500">账号</span>
          <input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            required
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-500">重置密码</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="留空则不修改"
            className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
          />
        </label>

        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "保存中" : "保存"}
        </button>
      </form>

      {localError ? <p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{localError}</p> : null}
      {localMessage ? <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{localMessage}</p> : null}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <AppPermissionCheckboxes
          selectedAppIds={user.role === "admin" ? allAppIds : user.appPermissions}
          disabled={user.role === "admin"}
          onToggle={toggleUserPermission}
        />
      </div>
    </article>
  );
}

export function SettingsPage() {
  const { users, currentUser, isAdmin, createUser, updateUser, error } = useAuth();
  const [form, setForm] = useState(emptyCreateForm);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeUsers = useMemo(() => users.filter((user) => user.enabled).length, [users]);
  const adminUsers = useMemo(
    () => users.filter((user) => user.role === "admin" && user.enabled).length,
    [users],
  );

  const handleToggleFormPermission = (appId: ModuleCode) => {
    setForm((current) => {
      const nextPermissions = current.appPermissions.includes(appId)
        ? current.appPermissions.filter((item) => item !== appId)
        : [...current.appPermissions, appId];

      return { ...current, appPermissions: nextPermissions };
    });
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");

    const name = form.name.trim();
    const account = form.account.trim().toLowerCase();
    const password = form.password.trim();

    if (!name || !account || !password) {
      setFormError("请填写用户姓名、账号和初始密码。");
      return;
    }

    setIsSubmitting(true);
    const created = await createUser({
      name,
      account,
      password,
      appPermissions: form.appPermissions,
    });
    setIsSubmitting(false);

    if (created) {
      setForm(emptyCreateForm);
    }
  };

  return (
    <div className="mx-auto min-h-full w-full max-w-7xl space-y-5 px-4 py-5 pb-10 md:px-8 md:py-6 md:pb-12">
      <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-lg md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
              <ShieldCheck className="h-4 w-4" />
              后端用户与权限
            </div>
            <h1 className="text-3xl font-semibold text-slate-950">用户管理</h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              所有用户都可以在这里维护自己的账号信息和密码；管理员还可以新增用户、启停账号并调整应用权限。
            </p>
          </div>

          <div className="grid w-full grid-cols-3 gap-3 sm:w-auto sm:min-w-[280px]">
            <div className="rounded-2xl bg-slate-50 p-3 md:p-4">
              <p className="text-xs text-slate-500">用户数</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{users.length}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 md:p-4">
              <p className="text-xs text-slate-500">启用</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-700">{activeUsers}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 md:p-4">
              <p className="text-xs text-slate-500">管理员</p>
              <p className="mt-2 text-2xl font-semibold text-blue-700">{adminUsers}</p>
            </div>
          </div>
        </div>
      </section>

      {currentUser ? <CurrentAccountCard currentUser={currentUser} /> : null}

      {isAdmin ? (
        <section className="grid items-start gap-5 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
          <form onSubmit={handleCreateUser} className="rounded-3xl border border-white/80 bg-white p-5 shadow-lg md:p-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Plus className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950">新增用户</h2>
                <p className="mt-1 text-sm text-slate-500">姓名、账号和初始密码均为必填，角色默认业务用户。</p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">姓名</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：赵六"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">账号</span>
                <input
                  value={form.account}
                  onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
                  placeholder="例如：zhaoliu"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">初始密码</span>
                <input
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  type="password"
                  placeholder="请输入初始密码"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  required
                />
              </label>

              <div className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">应用权限</span>
                <AppPermissionCheckboxes selectedAppIds={form.appPermissions} onToggle={handleToggleFormPermission} />
              </div>

              {formError || error ? (
                <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError || error}</p>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Plus className="h-4 w-4" />
                {isSubmitting ? "正在创建..." : "创建用户"}
              </button>
            </div>
          </form>

          <section className="min-w-0 rounded-3xl border border-white/80 bg-white p-4 shadow-lg md:p-5">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">用户列表</h2>
                <p className="mt-1 text-sm text-slate-500">可以编辑姓名、账号和密码；停用用户后，该用户的登录和应用进入都会被拒绝。</p>
              </div>
            </div>

            <div className="space-y-4">
              {users.map((user) => (
                <AdminUserCard
                  key={user.id}
                  user={user}
                  currentUserId={currentUser?.id}
                  updateUser={updateUser}
                />
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </div>
  );
}

export const UserManagementPage = SettingsPage;
