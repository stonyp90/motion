/**
 * Auth helper: drives the NextAuth → Keycloak flow.
 *
 * Flow:
 *   1. /          → "Sign in" button (or auto-redirect if route is gated).
 *   2. NextAuth   → posts to /api/auth/signin/keycloak → 302 to keycloak.
 *   3. Keycloak   → username + password form (kc-form).
 *   4. NextAuth   → /api/auth/callback/keycloak sets session cookie.
 *   5. App        → /home with user menu visible.
 */
import { Page, expect } from '@playwright/test';

export async function signInViaKeycloak(page: Page, email: string, password: string) {
  await page.goto('/');

  // The simplified home shows a single CTA. If we're gated, NextAuth has
  // already kicked us at the provider — handle both shapes.
  const signInBtn = page.getByTestId('signin-button');
  if (await signInBtn.isVisible().catch(() => false)) {
    await signInBtn.click();
  }

  // Keycloak login page. Keycloak's stock login template uses #username/#password.
  await page.waitForURL(/\/realms\/motion-forge\/protocol\/openid-connect\/auth/, { timeout: 15_000 });
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();

  // Back on app after NextAuth callback.
  await page.waitForURL((url) => !url.pathname.startsWith('/realms/'), { timeout: 15_000 });
}

export async function signOut(page: Page) {
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('user-menu-signout').click();
  // NextAuth signout posts then redirects to '/'.
  await expect(page.getByTestId('signin-button')).toBeVisible({ timeout: 15_000 });
}
