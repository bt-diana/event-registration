/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API owns these prefixes; the web routes avoid them (events-web.md assumptions).
    proxy: {
      "/auth": "http://localhost:3000",
      "/events": "http://localhost:3000",
      "/public": "http://localhost:3000",
    },
  },
  test: { environment: "jsdom", globals: true },
});
