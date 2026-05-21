export type AppStatus =
  | "incubating"
  | "running"
  | "available"
  | "maintenance"
  | "offline"
  | "deprecated";

export type HealthStatus = "healthy" | "unhealthy" | "unknown" | "checking";

export type AppTheme = "blue" | "emerald" | "amber" | "orange";

export type AppIconName =
  | "file-text"
  | "shield-check"
  | "chart-line"
  | "message-circle";

export interface ToolkitApp {
  id: string;
  name: string;
  shortName: string;
  description: string;
  bannerText: string;
  ctaLabel: string;
  backgroundImage: string;
  url: string;
  backendUrl?: string;
  healthUrl: string;
  status: AppStatus;
  healthStatus: HealthStatus;
  theme: AppTheme;
  icon: AppIconName;
  moduleRepo: string;
  group: string;
}
