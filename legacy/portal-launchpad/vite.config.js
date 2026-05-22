import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var backendPort = process.env.PORTAL_API_PORT || "5210";
var backendHttpTarget = process.env.PORTAL_API_TARGET || "http://localhost:".concat(backendPort);
var backendWsTarget = process.env.PORTAL_WS_TARGET || "ws://localhost:".concat(backendPort);
var platformBackendPort = process.env.PLATFORM_API_PORT || "5220";
var platformHttpTarget = process.env.VITE_PLATFORM_API_PROXY_TARGET ||
    process.env.PLATFORM_API_URL ||
    "http://localhost:".concat(platformBackendPort);
var platformWsTarget = process.env.VITE_PLATFORM_WS_PROXY_TARGET ||
    process.env.PLATFORM_WS_URL ||
    platformHttpTarget.replace(/^http/i, "ws");
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            "/api/v1/core": {
                target: platformHttpTarget,
                changeOrigin: true,
            },
            "/api/v1/rag": {
                target: platformHttpTarget,
                changeOrigin: true,
            },
            "/api/v1/competitor-analysis": {
                target: platformHttpTarget,
                changeOrigin: true,
            },
            "/ws/core": {
                target: platformWsTarget,
                ws: true,
            },
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
