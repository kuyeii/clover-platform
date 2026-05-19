import { Outlet } from "react-router-dom";
import { AppUsageProvider } from "./contexts/AppUsageContext";
import { AuthProvider } from "./contexts/AuthContext";
import { RuntimeAppsProvider } from "./contexts/RuntimeAppsContext";

export default function App() {
  return (
    <RuntimeAppsProvider>
      <AuthProvider>
        <AppUsageProvider>
          <Outlet />
        </AppUsageProvider>
      </AuthProvider>
    </RuntimeAppsProvider>
  );
}
