import { expect, test } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;

test.describe('Agent chat runtime is agent-agnostic', () => {
  test('does not register BioImage-specific global bridges', async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto('/#/agents');

    const input = page.locator('textarea[placeholder*="Type a message"]');
    await expect(input).toBeVisible({ timeout: CHAT_READY_TIMEOUT });
    await expect(input).toBeEnabled({ timeout: CHAT_READY_TIMEOUT });

    await expect
      .poll(async () => {
        return await page.evaluate(() => ({
          hasChatProxyBridge: typeof (globalThis as any).__pyodide_chat_proxy_bridge === 'function',
          hasLegacyBioimageBridge: typeof (globalThis as any).bioimage_archive_search === 'function',
        }));
      }, { timeout: 30_000 })
      .toEqual({
        hasChatProxyBridge: true,
        hasLegacyBioimageBridge: false,
      });
  });
});