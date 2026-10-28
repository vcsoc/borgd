import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:1438",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: "npm run dev -- --port 1438",
    url: "http://127.0.0.1:1438",
    reuseExistingServer: false,
  },
  reporter: "list",
});
