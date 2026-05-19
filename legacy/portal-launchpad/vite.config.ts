import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

const backendPort = process.env.PORTAL_API_PORT || "5210";
const backendHttpTarget = process.env.PORTAL_API_TARGET || `http://localhost:${backendPort}`;
const backendWsTarget = process.env.PORTAL_WS_TARGET || `ws://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: backendHttpTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: backendWsTarget,
        ws: true,
      },
    },
  },
});
