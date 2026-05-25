/**
 * 01 — Auth: sign-in via Keycloak, sign-out, session persistence across reloads.
 *
 * These tests run against the unauthenticated state, NOT the shared owner.json
 * storage state, so we override here.
 */
import { test, expect } from '@playwright/test';
import { signInViaKeycloak, signOut } from './helpers/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('auth', () => {
  test('signs in via Keycloak and lands on home', async ({ page }) => {
    await signInViaKeycloak(page, 'owner@motion-forge.io', 'dev');
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible();
    await expect(page.getByTestId('prompt-textarea')).toBeVisible();
  });

  test('rejects bad credentials at Keycloak', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('signin-button').click();
    await page.waitForURL(/\/realms\/motion-forge\//);
    await page.locator('#username').fill('owner@motion-forge.io');
    await page.locator('#password').fill('wrong-password');
    await page.locator('#kc-login').click();
    // Keycloak's standard error message.
    await expect(page.locator('#input-error, .alert-error')).toBeVisible({ timeout: 10_000 });
  });

  test('signs out and clears session', async ({ page }) => {
    await signInViaKeycloak(page, 'owner@motion-forge.io', 'dev');
    await signOut(page);

    // Re-visit home — should still be signed out.
    await page.goto('/');
    await expect(page.getByTestId('signin-button')).toBeVisible();
    await expect(page.getByTestId('user-menu-trigger')).not.toBeVisible();
  });

  test('session persists across reload', async ({ page }) => {
    await signInViaKeycloak(page, 'owner@motion-forge.io', 'dev');
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible();

    await page.reload();
    // No Keycloak round-trip on reload — session cookie should be hot.
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible();
    await expect(page).not.toHaveURL(/\/realms\//);
  });

  test('role visible in user menu', async ({ page }) => {
    await signInViaKeycloak(page, 'member@motion-forge.io', 'dev');
    await page.getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('user-menu-role')).toContainText(/member/i);
  });
});
