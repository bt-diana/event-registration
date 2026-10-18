/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API owns these prefixes; the web routes avoid them (events-web.md assumptions).
const proxy = {
  "/auth": "http://localhost:3000",
  "/events": "http://localhost:3000",
  "/public": "http://localhost:3000",
  "/checkin": "http://localhost:3000",
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // Same proxy for `npm run preview:host` (the built app on the phone).
  preview: { port: 4173, proxy },
  test: { environment: "jsdom", globals: true },
});
