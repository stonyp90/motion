/**
 * Global setup: authenticate once per dev user, persist storage state.
 *
 * Specs that want the unauthenticated state override with
 *   test.use({ storageState: { cookies: [], origins: [] } });
 *
 * We log in three roles so multi-role tests can switch via project fixtures.
 */
import { test as setup, expect } from '@playwright/test';
import { signInViaKeycloak } from './helpers/auth';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_DIR = path.join(__dirname, '..', 'playwright', '.auth');

const USERS = [
  { id: 'owner', email: 'owner@motion-forge.io', password: 'dev' },
  { id: 'member', email: 'member@motion-forge.io', password: 'dev' },
  { id: 'viewer', email: 'viewer@motion-forge.io', password: 'dev' },
];

setup('authenticate dev users', async ({ browser }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  for (const u of USERS) {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    await signInViaKeycloak(page, u.email, u.password);
    // Sanity check: app home shows the user's avatar / email once signed in.
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible({ timeout: 15_000 });
    await ctx.storageState({ path: path.join(AUTH_DIR, `${u.id}.json`) });
    await ctx.close();
  }
});
