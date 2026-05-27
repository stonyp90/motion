import { defineConfig } from 'vitest/config';

// Vitest config — picks up unit tests under `src/` and steers clear of
// the Playwright suite under `e2e/`. Those are run separately by
// `playwright test`; loading them here would force every CI run to
// pull in `@playwright/test`.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    environment: 'node',
  },
});
