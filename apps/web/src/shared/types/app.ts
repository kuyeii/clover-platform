export type AppStatus =
  | "incubating"
  | "running"
  | "available"
  | "maintenance"
  | "offline"
  | "deprecated";

export type HealthStatus = "healthy" | "unhealthy" | "unknown" | "checking";

export type AppTheme = "blue" | "emerald" | "amber" | "orange" | "violet";

export type AppIconName =
  | "file-text"
  | "shield-check"
  | "chart-line"
  | "message-circle"
  | "file-pen-line";

export interface ToolkitApp {
  id: ModuleCode;
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
import type { ModuleCode } from "./portal";
