import { defineConfig, devices } from "@playwright/test";

/**
 * e2e: a dev server on its own port and DATA_DIR (.e2e-data, gitignored) with the dev-only
 * replay route enabled (GEPA_DEV_REPLAY=1). No `claude` process is involved: runs are driven
 * by synthetic stream-json fixtures (lib/agents/replayFixtures.ts).
 */
const PORT = Number(process.env.E2E_PORT ?? 3119);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ko-KR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/projects`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATA_DIR: ".e2e-data", GEPA_DEV_REPLAY: "1", PORT: String(PORT), NEXT_DIST_DIR: ".next-e2e" },
  },
});
