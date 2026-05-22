import { FormEvent, useEffect, useMemo, useState } from "react";

import { useAuth } from "../shared/auth/AuthProvider";
import { Icon } from "../shared/components/Icon";
import { moduleEntries } from "../shared/config/modules";
import type { ModuleCode, PortalUser, UserRole } from "../shared/types/portal";

const roleLabelMap: Record<UserRole, string> = {
  admin: "管理员",
  operator: "业务用户",
  viewer: "只读用户",
};

const roleOptions: UserRole[] = ["operator", "viewer", "admin"];
const allAppIds = moduleEntries.map((module) => module.code);

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
    return "全部模块";
  }
  const names = moduleEntries.filter((module) => user.appPermissions.includes(module.code)).map((module) => module.shortName);
  return names.length ? names.join("、") : "暂无权限";
}

function PermissionGrid({
  selectedAppIds,
  disabled,
  onToggle,
}: {
  selectedAppIds: ModuleCode[];
  disabled?: boolean;
  onToggle: (appId: ModuleCode) => void;
}) {
  return (
    <div className="permission-grid">
      {moduleEntries.map((module) => {
        const checked = selectedAppIds.includes(module.code);
        return (
          <button
            key={module.code}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(module.code)}
            className={checked ? "permission-chip active" : "permission-chip"}
          >
            <span>{module.name}</span>
            <Icon name={checked ? "check" : "plus"} />
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setProfileName(currentUser.name);
    setProfileAccount(currentUser.account);
  }, [currentUser.account, currentUser.name]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError("");
    setProfileMessage("");
    const name = profileName.trim();
    const account = profileAccount.trim().toLowerCase();
    if (!name || !account) {
      setLocalError("姓名和账号不能为空。");
      return;
    }
    const updated = await updateUser(currentUser.id, { name, account });
    if (updated) {
      setProfileMessage("账号信息已更新。");
    } else {
      setLocalError(error || "账号信息更新失败。");
    }
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError("");
    setPasswordMessage("");
    if (!currentPassword.trim() || !newPassword.trim()) {
      setLocalError("当前密码和新密码不能为空。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError("两次输入的新密码不一致。");
      return;
    }
    const result = await changePassword({ currentPassword, newPassword });
    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码已修改，下次登录请使用新密码。");
    } else {
      setLocalError(result.message);
    }
  };

  return (
    <section className="two-column">
      <form className="panel-card" onSubmit={saveProfile}>
        <div className="panel-title">
          <Icon name="user" />
          <div>
            <h2>我的账号</h2>
            <p>{roleLabelMap[currentUser.role]} · {getPermissionText(currentUser)}</p>
          </div>
        </div>
        <label className="form-field">
          <span>姓名</span>
          <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
        </label>
        <label className="form-field">
          <span>账号</span>
          <input value={profileAccount} onChange={(event) => setProfileAccount(event.target.value)} />
        </label>
        <p className="muted-text">最近登录：{formatTime(currentUser.lastLoginAt)}</p>
        {profileMessage ? <p className="success-message">{profileMessage}</p> : null}
        <button type="submit" className="primary-button">
          <Icon name="save" />
          保存账号信息
        </button>
      </form>

      <form className="panel-card" onSubmit={savePassword}>
        <div className="panel-title">
          <Icon name="key" />
          <div>
            <h2>修改密码</h2>
            <p>需要先验证当前密码。</p>
          </div>
        </div>
        <label className="form-field">
          <span>当前密码</span>
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="form-field">
          <span>新密码</span>
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="form-field">
          <span>确认新密码</span>
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        {passwordMessage ? <p className="success-message">{passwordMessage}</p> : null}
        <button type="submit" className="primary-button">
          <Icon name="lock" />
          修改密码
        </button>
      </form>
      {localError ? <p className="form-error wide">{localError}</p> : null}
    </section>
  );
}

function AdminUserRow({
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
  const [localMessage, setLocalMessage] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setName(user.name);
    setAccount(user.account);
    setPassword("");
    setLocalMessage("");
    setLocalError("");
  }, [user.account, user.id, user.name]);

  const saveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalMessage("");
    setLocalError("");
    const nextName = name.trim();
    const nextAccount = account.trim().toLowerCase();
    const nextPassword = password.trim();
    if (!nextName || !nextAccount) {
      setLocalError("姓名和账号不能为空。");
      return;
    }
    const updated = await updateUser(user.id, {
      name: nextName,
      account: nextAccount,
      ...(nextPassword ? { password: nextPassword } : {}),
    });
    if (updated) {
      setPassword("");
      setLocalMessage(nextPassword ? "账号信息和密码已更新。" : "账号信息已更新。");
    } else {
      setLocalError("保存失败，请检查账号是否重复。");
    }
  };

  const togglePermission = async (appId: ModuleCode) => {
    if (user.role === "admin") {
      return;
    }
    const nextPermissions = user.appPermissions.includes(appId)
      ? user.appPermissions.filter((item) => item !== appId)
      : [...user.appPermissions, appId];
    await updateUser(user.id, { appPermissions: nextPermissions });
  };

  return (
    <article className="user-row">
      <div className="user-row-head">
        <div>
          <h3>{user.name}</h3>
          <p>{user.account} · 最近登录：{formatTime(user.lastLoginAt)}</p>
        </div>
        <div className="row-actions">
          <select
            value={user.role}
            disabled={user.id === currentUserId}
            onChange={(event) =>
              updateUser(user.id, {
                role: event.target.value as UserRole,
                appPermissions: event.target.value === "admin" ? allAppIds : user.appPermissions,
              })
            }
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>{roleLabelMap[role]}</option>
            ))}
          </select>
          <button
            type="button"
            className="ghost-button"
            disabled={user.id === currentUserId}
            onClick={() => updateUser(user.id, { enabled: !user.enabled })}
          >
            {user.enabled ? "停用" : "启用"}
          </button>
        </div>
      </div>

      <form className="user-edit-grid" onSubmit={saveAccount}>
        <label className="form-field compact">
          <span>姓名</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="form-field compact">
          <span>账号</span>
          <input value={account} onChange={(event) => setAccount(event.target.value)} />
        </label>
        <label className="form-field compact">
          <span>重置密码</span>
          <input type="password" placeholder="留空不修改" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button type="submit" className="primary-button small">
          <Icon name="save" />
          保存
        </button>
      </form>

      <PermissionGrid selectedAppIds={user.role === "admin" ? allAppIds : user.appPermissions} disabled={user.role === "admin"} onToggle={togglePermission} />
      {localError ? <p className="form-error">{localError}</p> : null}
      {localMessage ? <p className="success-message">{localMessage}</p> : null}
    </article>
  );
}

export function UserManagementPage() {
  const { users, currentUser, isAdmin, createUser, updateUser, error } = useAuth();
  const [form, setForm] = useState({ name: "", account: "", password: "", appPermissions: allAppIds });
  const [formError, setFormError] = useState("");
  const activeUsers = useMemo(() => users.filter((user) => user.enabled).length, [users]);
  const adminUsers = useMemo(() => users.filter((user) => user.enabled && user.role === "admin").length, [users]);

  const toggleFormPermission = (appId: ModuleCode) => {
    setForm((current) => ({
      ...current,
      appPermissions: current.appPermissions.includes(appId)
        ? current.appPermissions.filter((item) => item !== appId)
        : [...current.appPermissions, appId],
    }));
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    const name = form.name.trim();
    const account = form.account.trim().toLowerCase();
    const password = form.password.trim();
    if (!name || !account || !password) {
      setFormError("请填写用户姓名、账号和初始密码。");
      return;
    }
    const created = await createUser({ name, account, password, appPermissions: form.appPermissions });
    if (created) {
      setForm({ name: "", account: "", password: "", appPermissions: allAppIds });
    }
  };

  return (
    <section className="page-stack">
      <header className="page-hero compact">
        <div>
          <span className="eyebrow">Users</span>
          <h1>用户管理</h1>
          <p>管理员可新增用户、启停账号、配置模块权限和重置密码；普通用户可维护自己的账号和密码。</p>
        </div>
        <div className="hero-metrics">
          <div><span>用户数</span><strong>{users.length}</strong></div>
          <div><span>启用</span><strong>{activeUsers}</strong></div>
          <div><span>管理员</span><strong>{adminUsers}</strong></div>
        </div>
      </header>

      {currentUser ? <CurrentAccountCard currentUser={currentUser} /> : null}

      {isAdmin ? (
        <section className="admin-grid">
          <form className="panel-card" onSubmit={handleCreate}>
            <div className="panel-title">
              <Icon name="plus" />
              <div>
                <h2>新增用户</h2>
                <p>角色默认业务用户。</p>
              </div>
            </div>
            <label className="form-field"><span>姓名</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="form-field"><span>账号</span><input value={form.account} onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))} /></label>
            <label className="form-field"><span>初始密码</span><input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></label>
            <PermissionGrid selectedAppIds={form.appPermissions} onToggle={toggleFormPermission} />
            {formError || error ? <p className="form-error">{formError || error}</p> : null}
            <button type="submit" className="primary-button"><Icon name="plus" />创建用户</button>
          </form>

          <section className="panel-card user-list-card">
            <div className="panel-title">
              <Icon name="users" />
              <div>
                <h2>用户列表</h2>
                <p>编辑用户资料、启停状态、角色和应用权限。</p>
              </div>
            </div>
            <div className="user-list">
              {users.map((user) => (
                <AdminUserRow key={user.id} user={user} currentUserId={currentUser?.id} updateUser={updateUser} />
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </section>
  );
}
