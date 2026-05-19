import { Outlet } from "react-router-dom";
import { AppUsageProvider } from "./contexts/AppUsageContext";
import { AuthProvider } from "./contexts/AuthContext";

export default function App() {
  return (
    <AuthProvider>
      <AppUsageProvider>
        <Outlet />
      </AppUsageProvider>
    </AuthProvider>
  );
}
