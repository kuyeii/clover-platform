import { CloverLauncher } from "../components/CloverLauncher";
import { useRuntimeApps } from "../contexts/RuntimeAppsContext";

export function DashboardPage() {
  const { apps } = useRuntimeApps();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CloverLauncher apps={apps} />
    </div>
  );
}
