import { expect, test } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;

test.describe('Kernel randomUUID compatibility', () => {
  test('initializes chat when crypto.randomUUID is unavailable', async ({ page }) => {
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      const cryptoObj = globalThis.crypto as (Crypto & { randomUUID?: (() => string) | undefined }) | undefined;
      if (!cryptoObj) return;
      try {
        Object.defineProperty(cryptoObj, 'randomUUID', {
          configurable: true,
          writable: true,
          value: undefined,
        });
      } catch {
        try {
          (cryptoObj as { randomUUID?: (() => string) | undefined }).randomUUID = undefined;
        } catch {
        }
      }
    });

    await page.goto('/#/agents');

    const input = page.locator('textarea[placeholder*="Type a message"]');
    await expect(input).toBeVisible({ timeout: CHAT_READY_TIMEOUT });
    await expect(input).toBeEnabled({ timeout: CHAT_READY_TIMEOUT });

    await expect(page.locator('text=Kernel initialization failed')).toHaveCount(0);
    await expect(page.locator('text=crypto.randomUUID is not a function')).toHaveCount(0);
  });
});
