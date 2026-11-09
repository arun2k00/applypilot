import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: "**/._*",
  testMatch: "**/*.spec.ts",
  workers: 1,
  use: {
    baseURL: process.env.APPLYPILOT_E2E_URL ?? "http://localhost:3000",
    channel: process.env.APPLYPILOT_BROWSER_CHANNEL ?? "chromium",
  },
});
