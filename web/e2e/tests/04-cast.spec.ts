/**
 * 04 — Cast: drawer open, library search, click adds chip, @-mention autocompletes.
 */
import { test, expect } from '@playwright/test';
import { mockCastLibrary } from './helpers/mock-engine';

test.describe('cast', () => {
  test.beforeEach(async ({ page }) => {
    await mockCastLibrary(page);
  });

  test('opens drawer and searches library', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('cast-drawer-toggle').click();

    const drawer = page.getByTestId('cast-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('data-open', 'true');

    // Library shows three characters from the mock.
    const items = drawer.getByTestId('cast-library-item');
    await expect(items).toHaveCount(3);

    // Search narrows.
    await drawer.getByTestId('cast-search').fill('al');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Alex');
  });

  test('clicking character adds chip to chip row', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('cast-drawer-toggle').click();
    await page.getByTestId('cast-library-item').filter({ hasText: 'Alex' }).click();

    const chips = page.getByTestId('cast-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('Alex');

    // Adding the same character is idempotent.
    await page.getByTestId('cast-library-item').filter({ hasText: 'Alex' }).click();
    await expect(chips).toHaveCount(1);

    // Removing the chip clears it.
    await chips.first().getByTestId('cast-chip-remove').click();
    await expect(chips).toHaveCount(0);
  });

  test('@-mention in textarea opens autocomplete and selects', async ({ page }) => {
    await page.goto('/');
    const textarea = page.getByTestId('prompt-textarea');
    await textarea.click();
    await textarea.pressSequentially('Then @bl');

    const popover = page.getByTestId('mention-popover');
    await expect(popover).toBeVisible();
    const options = popover.getByTestId('mention-option');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Blair');

    await options.first().click();

    // Textarea should now contain the mention token, NOT the raw @bl.
    await expect(textarea).toHaveValue(/@Blair/);
    // And a chip should have been added.
    await expect(page.getByTestId('cast-chip').filter({ hasText: 'Blair' })).toBeVisible();
  });

  test('keyboard navigation in mention popover', async ({ page }) => {
    await page.goto('/');
    const textarea = page.getByTestId('prompt-textarea');
    await textarea.pressSequentially('@');
    const popover = page.getByTestId('mention-popover');
    await expect(popover).toBeVisible();

    // ArrowDown should move active option.
    const options = popover.getByTestId('mention-option');
    await expect(options.first()).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('data-active', 'true');

    await page.keyboard.press('Enter');
    await expect(textarea).toHaveValue(/@Blair/);
  });
});
