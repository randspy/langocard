/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const backend = fileURLToPath(new URL("../backend/convex", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Generated API and shared rules come straight from the backend; no workspace.
      "@backend": backend,
    },
    // The backend's generated files import `convex`; use this app's single copy.
    dedupe: ["convex", "react", "react-dom"],
  },
  // This local app serves a shared credential; other origins must not read its modules.
  server: { host: "127.0.0.1", cors: false, port: 5173, strictPort: true, fs: { allow: [".", backend] } },
  preview: { host: "127.0.0.1", cors: false },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
