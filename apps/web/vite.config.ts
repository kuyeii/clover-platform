import { resolve } from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || process.env.PLATFORM_API_URL || "http://127.0.0.1:5221";
const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET || process.env.PLATFORM_WS_URL || apiProxyTarget.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/modules/rag/legacy"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5300,
    allowedHosts: ["arkmind.local", "10.88.21.93"],
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: wsProxyTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
