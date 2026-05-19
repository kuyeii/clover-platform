import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = Number(process.env.HISTORY_SERVER_PORT || process.env.BACKEND_PORT || 8788);
const apiTarget =
  process.env.VITE_API_BASE_URL ||
  process.env.VITE_API_TARGET ||
  `http://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});
