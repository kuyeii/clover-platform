import { CloverLauncher } from "../components/CloverLauncher";
import type { NavigateFn } from "../routes";
import { useRuntimeApps } from "../shared/runtime/RuntimeAppsProvider";

export function WorkspacePage({ navigate }: { navigate: NavigateFn }) {
  const { apps } = useRuntimeApps();

  return (
    <div className="legacy-portal-ui flex min-h-0 flex-1 flex-col">
      <CloverLauncher apps={apps} navigate={navigate} />
    </div>
  );
}
