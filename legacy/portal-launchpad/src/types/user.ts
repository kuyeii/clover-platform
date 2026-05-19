import { ToolkitApp } from "./app";

export type UserRole = "admin" | "operator" | "viewer";

export interface PortalUser {
  id: string;
  name: string;
  account: string;
  role: UserRole;
  enabled: boolean;
  appPermissions: ToolkitApp["id"][];
  createdAt: string;
  lastLoginAt?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface CreatePortalUserInput {
  name: string;
  account: string;
  password: string;
  role?: UserRole;
  appPermissions?: ToolkitApp["id"][];
}

export type UpdatePortalUserInput = Partial<
  Pick<PortalUser, "name" | "account" | "role" | "enabled" | "appPermissions">
> & {
  password?: string;
};

export interface AppUsageSession {
  id: string;
  appId: ToolkitApp["id"];
  clientId: string;
  userId: string;
  userName: string;
  startedAt: string;
  lastActiveAt: string;
  confirmedConflict: boolean;
}

export interface AppUsageSummary {
  appId: ToolkitApp["id"];
  sessions: AppUsageSession[];
  otherUserSessions: AppUsageSession[];
  currentUserSessions: AppUsageSession[];
  inUse: boolean;
  inUseByOthers: boolean;
  userNames: string[];
  otherUserNames: string[];
}
