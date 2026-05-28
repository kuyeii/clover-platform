import { FormEvent, useEffect, useMemo, useState } from "react";

import { useAuth } from "../shared/auth/AuthProvider";
import { Icon } from "../shared/components/Icon";
import type { ModuleCode, PortalUser, UserRole } from "../shared/types/portal";

const roleLabelMap: Record<UserRole, string> = {
  admin: "管理员",
  operator: "业务用户",
  viewer: "只读用户",
};

const roleOptions: UserRole[] = ["operator", "viewer", "admin"];
const permissionModules: Array<{ code: ModuleCode; name: string; shortName: string }> = [
  { code: "bid-generator", name: "标书生成", shortName: "标书" },
  { code: "contract-review", name: "合同审查", shortName: "合同" },
  { code: "competitor-analysis", name: "企业竞品分析", shortName: "竞品" },
  { code: "rag-web-search", name: "RAG 问答", shortName: "问答" },
];
const allAppIds = permissionModules.map((module) => module.code);
const emptyCreateForm = { name: "", account: "", password: "", appPermissions: allAppIds };
const userPageSize = 6;

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

  const names = permissionModules
    .filter((module) => user.appPermissions.includes(module.code))
    .map((module) => module.shortName);

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
    <div className="grid gap-2 sm:grid-cols-2">
      {permissionModules.map((module) => {
        const checked = selectedAppIds.includes(module.code);

        return (
          <button
            key={module.code}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(module.code)}
            className={[
              "flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors",
              checked
                ? "border-brand-200 bg-brand-50 text-brand-600"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              disabled ? "cursor-not-allowed opacity-60" : "",
            ].join(" ")}
          >
            <span>{module.name}</span>
            <span
              className={[
                "flex h-5 w-5 items-center justify-center rounded-md border",
                checked ? "border-brand-200 bg-brand-50 text-brand-600" : "border-slate-200 bg-white text-transparent",
              ].join(" ")}
            >
              <Icon name="check" className="h-3.5 w-3.5" />
            </span>
          </button>
        );
      })}
    </div>
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
  const [isSaving, setIsSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setName(user.name);
    setAccount(user.account);
    setPassword("");
    setPasswordOpen(false);
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

    setIsSaving(true);
    const updated = await updateUser(user.id, {
      name: nextName,
      account: nextAccount,
      ...(nextPassword ? { password: nextPassword } : {}),
    });
    setIsSaving(false);

    if (updated) {
      setPassword("");
      setPasswordOpen(false);
      setLocalMessage(nextPassword ? "账号信息和密码已更新。" : "账号信息已更新。");
    } else {
      setLocalError("保存失败，请检查账号是否重复或稍后重试。");
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
    <article className="overflow-hidden rounded-2xl bg-white">
      <div className="flex min-w-0 items-center gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3 className="flex h-7 min-w-0 items-center truncate text-base font-normal leading-none text-slate-950">
            {user.name}
          </h3>
          <span className="inline-flex h-7 items-center rounded-full bg-slate-100 px-2.5 text-xs font-semibold leading-none text-slate-600">
            {roleLabelMap[user.role]}
          </span>
          <span
            className={[
              "inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold leading-none",
              user.enabled ? "bg-[var(--color-success-bg)] text-success" : "bg-slate-100 text-slate-500",
            ].join(" ")}
          >
            {user.enabled ? "已启用" : "已停用"}
          </span>
        </div>
        <button
          type="button"
          className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          onClick={() => setIsExpanded((open) => !open)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "收起用户详情" : "展开用户详情"}
        >
          <Icon
            name="arrow"
            className={["h-4 w-4 transition-transform", isExpanded ? "-rotate-90" : "rotate-90"].join(" ")}
            strokeWidth={1.7}
          />
        </button>
      </div>

      <div
        className={[
          "grid transition-[grid-template-rows] duration-200 ease-out",
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        ].join(" ")}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={[
              "border-t border-slate-100 p-4 pt-3 transition-opacity duration-150",
              isExpanded ? "visible opacity-100 delay-75" : "invisible opacity-0",
            ].join(" ")}
            aria-hidden={!isExpanded}
          >
            <div className="mb-4 flex flex-col gap-3 rounded-xl bg-slate-50 p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm text-slate-500">
                  账号：{user.account} · 最近登录：{formatTime(user.lastLoginAt)}
                </p>
                <p className="mt-1 text-sm text-slate-600">权限：{getPermissionText(user)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={user.role}
                  disabled={user.id === currentUserId}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  onChange={(event) =>
                    updateUser(user.id, {
                      role: event.target.value as UserRole,
                      appPermissions: event.target.value === "admin" ? allAppIds : user.appPermissions,
                    })
                  }
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {roleLabelMap[role]}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className={[
                    "inline-flex h-9 w-24 shrink-0 items-center rounded-full border p-1 transition-colors",
                    user.enabled ? "border-[var(--color-success-border)] bg-[var(--color-success-bg)]" : "border-slate-200 bg-slate-100",
                    user.id === currentUserId ? "cursor-not-allowed opacity-50" : "",
                  ].join(" ")}
                  disabled={user.id === currentUserId}
                  onClick={() => updateUser(user.id, { enabled: !user.enabled })}
                  role="switch"
                  aria-checked={user.enabled}
                  aria-label={user.enabled ? "停用用户" : "启用用户"}
                >
                  <span
                    className={[
                      "grid h-7 w-12 place-items-center rounded-full bg-white text-xs font-semibold shadow-none transition-transform",
                      user.enabled ? "translate-x-10 text-success" : "translate-x-0 text-slate-500",
                    ].join(" ")}
                  >
                    {user.enabled ? "启用" : "停用"}
                  </span>
                </button>
              </div>
            </div>

            <form className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end" onSubmit={saveAccount}>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">姓名</span>
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">账号</span>
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => {
                  setPasswordOpen((open) => !open);
                  setPassword("");
                }}
              >
                {passwordOpen ? "取消重置" : "重置密码"}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Icon name="save" />
                {isSaving ? "保存中" : "保存"}
              </button>
            </form>

            {passwordOpen ? (
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">新密码</span>
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                    type="password"
                    placeholder="填写后点击保存生效"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {localError ? <p className="mt-3 rounded-xl bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-danger">{localError}</p> : null}
            {localMessage ? (
              <p className="mt-3 rounded-xl bg-[var(--color-success-bg)] px-4 py-3 text-sm text-success">{localMessage}</p>
            ) : null}

            <div className="mt-4 border-t border-slate-100 pt-4">
              <PermissionGrid
                selectedAppIds={user.role === "admin" ? allAppIds : user.appPermissions}
                disabled={user.role === "admin"}
                onToggle={togglePermission}
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function UserManagementPage() {
  const { users, currentUser, isAdmin, createUser, updateUser, error } = useAuth();
  const [form, setForm] = useState(emptyCreateForm);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) {
      return users;
    }

    return users.filter((user) => {
      const searchText = [
        user.name,
        user.account,
        roleLabelMap[user.role],
        user.enabled ? "已启用" : "已停用",
        getPermissionText(user),
      ]
        .join(" ")
        .toLowerCase();

      return searchText.includes(keyword);
    });
  }, [query, users]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
  const pagedUsers = useMemo(() => {
    const start = (currentPage - 1) * userPageSize;
    return filteredUsers.slice(start, start + userPageSize);
  }, [currentPage, filteredUsers]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

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

    setIsSubmitting(true);
    const created = await createUser({ name, account, password, appPermissions: form.appPermissions });
    setIsSubmitting(false);

    if (created) {
      setForm(emptyCreateForm);
      setCreateDialogOpen(false);
    }
  };

  return (
    <div className="mx-auto min-h-full w-full max-w-7xl px-4 py-5 pb-10 md:px-8 md:py-6 md:pb-12">
      {isAdmin ? (
        <section className="min-w-0 rounded-2xl border border-border bg-white p-4 shadow-none md:p-5">
          <div className="mb-5 flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-slate-950">用户列表</h1>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block w-full sm:w-72">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  strokeWidth={1.7}
                />
                <input
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索姓名、账号、角色"
                />
              </label>
              <button
                type="button"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
                onClick={() => {
                  setForm(emptyCreateForm);
                  setFormError("");
                  setCreateDialogOpen(true);
                }}
              >
                <Icon name="plus" strokeWidth={1.7} />
                新增用户
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {pagedUsers.map((user) => (
              <AdminUserRow key={user.id} user={user} currentUserId={currentUser?.id} updateUser={updateUser} />
            ))}
            {!pagedUsers.length ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                未找到匹配用户。
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              共 {filteredUsers.length} 个用户，第 {currentPage} / {totalPages} 页
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-border bg-white p-5 shadow-none">
          <h1 className="text-2xl font-semibold text-slate-950">用户管理</h1>
          <p className="mt-2 text-sm text-slate-500">当前账号没有用户管理权限。</p>
        </section>
      )}

      {createDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <section className="max-h-full w-full max-w-xl overflow-auto rounded-2xl bg-white p-5 shadow-panel" role="dialog" aria-modal="true">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">新增用户</h2>
                <p className="mt-1 text-sm text-slate-500">姓名、账号和初始密码均为必填，角色默认业务用户。</p>
              </div>
              <button
                type="button"
                className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                onClick={() => setCreateDialogOpen(false)}
                aria-label="关闭"
              >
                <Icon name="close" strokeWidth={1.7} />
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleCreate}>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">姓名</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：赵六"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">账号</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  value={form.account}
                  onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
                  placeholder="例如：zhaoliu"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">初始密码</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors focus:border-brand-200 focus:ring-2 focus:ring-brand-200"
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="请输入初始密码"
                />
              </label>
              <div className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">应用权限</span>
                <PermissionGrid selectedAppIds={form.appPermissions} onToggle={toggleFormPermission} />
              </div>

              {formError || error ? <p className="rounded-xl bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-danger">{formError || error}</p> : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  onClick={() => setCreateDialogOpen(false)}
                  disabled={isSubmitting}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Icon name="plus" strokeWidth={1.7} />
                  {isSubmitting ? "正在创建..." : "创建用户"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
