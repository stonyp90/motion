/**
 * Playwright config for motion-forge E2E suite.
 *
 * Brings up the full local stack via `webServer` so CI and local runs share
 * the same entrypoint: keycloak (docker), engine (cargo run), web (next dev).
 *
 * Determinism rules:
 *  - retries=1 to absorb flake from cold dev-server starts, not real bugs.
 *  - parallel workers per project but tests within a project run serially
 *    when they hit Keycloak (login storage state shared).
 *  - trace/video on first retry only; screenshot always on failure.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT_WEB = Number(process.env.PORT_WEB ?? 3001);
const PORT_ENGINE = Number(process.env.PORT_ENGINE ?? 3000);
const PORT_KEYCLOAK = Number(process.env.PORT_KEYCLOAK ?? 8080);

const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT_WEB}`;

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  // One global timeout per test; webServer has its own boot timeout below.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'results.xml' }]]
    : [['list'], ['html', { open: 'on-failure' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Most tests run as an authenticated user; per-test we override when needed.
    storageState: 'playwright/.auth/owner.json',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // Pin viewport so layout-dependent a11y/theme tests are stable.
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/Toronto',
  },

  projects: [
    // setup project authenticates once, saves storage state, then specs reuse it.
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    // Keycloak: assumed to be brought up by docker-compose in CI.
    // Locally, the dev script handles it. We just wait for /health.
    {
      command:
        process.env.SKIP_KEYCLOAK === '1'
          ? 'echo "skipping keycloak boot"'
          : 'docker compose -f ../docker-compose.dev.yml up -d keycloak',
      url: `http://localhost:${PORT_KEYCLOAK}/realms/motion-forge/.well-known/openid-configuration`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    // Engine: axum on :3000. /v1/themes is a cheap GET that returns 200 once
    // routes are mounted.
    {
      command: 'cd ../engine && cargo run --release',
      url: `http://localhost:${PORT_ENGINE}/v1/themes`,
      reuseExistingServer: !isCI,
      timeout: 180_000, // first cargo build can be slow
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        RUST_LOG: 'info',
        // Use deterministic mock LLM in tests — see engine/src/llm/mock.rs
        MF_LLM_PROVIDER: 'mock',
      },
    },
    // Web: next dev on :3001 (3000 is taken by engine).
    {
      command: 'cd ../web && npm run dev',
      url: BASE_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NEXTAUTH_URL: BASE_URL,
        NEXTAUTH_SECRET: 'e2e-test-secret-not-for-prod',
        KEYCLOAK_ISSUER: `http://localhost:${PORT_KEYCLOAK}/realms/motion-forge`,
        KEYCLOAK_CLIENT_ID: 'motion-forge-web',
        KEYCLOAK_CLIENT_SECRET: 'dev-secret',
        NEXT_PUBLIC_ENGINE_URL: `http://localhost:${PORT_ENGINE}`,
        // Tells the web app to expose hooks for test injection (audio worklet stub etc).
        NEXT_PUBLIC_E2E: '1',
      },
    },
  ],
});
