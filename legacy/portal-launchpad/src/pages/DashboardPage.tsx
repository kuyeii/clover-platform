import { CloverLauncher } from "../components/CloverLauncher";
import { appsConfig } from "../config/apps.config";

export function DashboardPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CloverLauncher apps={appsConfig} />
    </div>
  );
}
