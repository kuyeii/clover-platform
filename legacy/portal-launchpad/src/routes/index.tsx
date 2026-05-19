import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";
import App from "../App";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { PortalShellProvider } from "../contexts/PortalShellContext";
import { AppLayout } from "../layouts/AppLayout";
import { DashboardPage } from "../pages/DashboardPage";
import { EmbeddedAppPage } from "../pages/EmbeddedAppPage";
import { KnowledgePage } from "../pages/KnowledgePage";
import { LoginPage } from "../pages/LoginPage";
import { FeedbackPage } from "../pages/FeedbackPage";
import { SettingsPage } from "../pages/SettingsPage";
import { BidReferenceSitesPage } from "../pages/BidReferenceSitesPage";

function PortalWorkspace() {
  return (
    <ProtectedRoute>
      <PortalShellProvider>
        <AppLayout>
          <Outlet />
        </AppLayout>
      </PortalShellProvider>
    </ProtectedRoute>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "login",
        element: <LoginPage />,
      },
      {
        element: <PortalWorkspace />,
        children: [
          {
            index: true,
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: "dashboard",
            element: <DashboardPage />,
          },
          {
            path: "apps/:appId",
            element: <EmbeddedAppPage />,
          },
          {
            path: "knowledge",
            element: <KnowledgePage />,
          },
          {
            path: "modules",
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: "settings",
            element: <SettingsPage />,
          },
          {
            path: "bid-reference-sites",
            element: <BidReferenceSitesPage />,
          },
          {
            path: "feedback",
            element: <FeedbackPage />,
          },
        ],
      },
    ],
  },
]);
