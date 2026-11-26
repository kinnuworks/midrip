import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  outputDir: "../.kit/e2e-results",
  use: { baseURL: process.env.BASE_URL || "http://localhost:5175", video: "on", viewport: { width: 1280, height: 800 } },
  webServer: process.env.BASE_URL ? undefined : { command: "npm run dev -- --port 5175 --strictPort --bypass-lock", port: 5175, reuseExistingServer: false, timeout: 60_000 },
});
