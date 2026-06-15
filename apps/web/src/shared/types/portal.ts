export type UserRole = "admin" | "operator" | "viewer";

export type AppStatus = "running" | "available" | "maintenance" | "offline";

export type ModuleCode =
  | "competitor-analysis"
  | "rag-web-search"
  | "contract-review"
  | "bid-generator"
  | "patent-disclosure";

export interface PortalUser {
  id: string;
  name: string;
  account: string;
  role: UserRole;
  enabled: boolean;
  appPermissions: ModuleCode[];
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
}

export interface PortalModule {
  code: ModuleCode;
  slug: "competitor-analysis" | "rag" | "contract-review" | "bid-generator" | "patent-disclosure";
  name: string;
  shortName: string;
  description: string;
  route: string;
  iframeRoute?: string;
  apiPrefix: string;
  legacyFrontend?: string;
  status: AppStatus;
}

export interface RuntimeAppConfig {
  code: ModuleCode;
  name: string;
  routePath?: string;
  frontendUrl?: string;
  backendUrl?: string;
  iframeUrl: string;
  url?: string;
  healthUrl?: string;
  enabled: boolean;
  devMode?: string;
}

export interface AppUsageSession {
  id: string;
  appId: ModuleCode;
  clientId: string;
  userId: string;
  userName: string;
  startedAt: string;
  lastActiveAt: string;
  confirmedConflict: boolean;
}

export interface AppUsageSummary {
  appId: ModuleCode;
  sessions: AppUsageSession[];
  otherUserSessions: AppUsageSession[];
  currentUserSessions: AppUsageSession[];
  inUse: boolean;
  inUseByOthers: boolean;
  userNames: string[];
  otherUserNames: string[];
}

export interface CreatePortalUserInput {
  name: string;
  account: string;
  password: string;
  role?: UserRole;
  appPermissions?: ModuleCode[];
}

export type UpdatePortalUserInput = Partial<
  Pick<PortalUser, "name" | "account" | "role" | "enabled" | "appPermissions">
> & {
  password?: string;
};

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
