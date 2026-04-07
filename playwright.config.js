const { defineConfig, devices } = require("@playwright/test");

const runCrossBrowser =
  process.env.CI === "true" || process.env.CI === "1" || process.env.PLAYWRIGHT_ALL_BROWSERS === "1";

const projects = [
  {
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
    },
  },
];

if (runCrossBrowser) {
  projects.push(
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
      },
    }
  );
}

module.exports = defineConfig({
  testDir: "./tests/playwright",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python3 -m http.server 4173 -d web",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects,
});
