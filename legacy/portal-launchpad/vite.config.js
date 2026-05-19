import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var backendPort = process.env.PORTAL_API_PORT || "5210";
var backendHttpTarget = process.env.PORTAL_API_TARGET || "http://localhost:".concat(backendPort);
var backendWsTarget = process.env.PORTAL_WS_TARGET || "ws://localhost:".concat(backendPort);
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
