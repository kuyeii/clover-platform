import { resolve } from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  },
});
