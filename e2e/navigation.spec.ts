import { expect, test } from '@playwright/test';

test('main navigation links are clickable', async ({ page }) => {
  await page.goto('/');

  const nav = page.getByRole('navigation');
  await expect(nav).toBeVisible();

  await nav.getByRole('link', { name: 'Models', exact: true }).click();
  await expect(page).toHaveURL(/\/models/);

  await nav.getByRole('link', { name: 'Partners', exact: true }).click();
  await expect(page).toHaveURL(/\/partners/);

  await nav.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs/);

  await nav.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/\/about/);

  await nav.getByRole('link', { name: 'Upload', exact: true }).click();
  await expect(page).toHaveURL(/\/upload/);
});
