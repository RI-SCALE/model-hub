import { expect, test } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;

async function openAgentChat(page: Parameters<typeof test>[0]['page']) {
  await page.goto('/#/agents');

  const input = page.locator('textarea[placeholder*="Type a message"]');
  await expect(input).toBeVisible({ timeout: CHAT_READY_TIMEOUT });
  await expect(input).toBeEnabled({ timeout: CHAT_READY_TIMEOUT });

  return input;
}

test.describe('BioImage Finder chat resilience', () => {
  test('allows cancel when proxy call stalls', async ({ page }) => {
    test.setTimeout(180_000);

    const input = await openAgentChat(page);

    await page.evaluate(() => {
      (globalThis as any).hypha_chat_proxy = async () => {
        await new Promise(() => {
          // intentionally never resolves
        });
        return JSON.stringify({});
      };
    });

    const prompt = 'find me some tumor datasets';
    await input.fill(prompt);
    await input.press('Enter');

    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('text=Still working...')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('text=Request cancelled by user.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  });

  test('shows explicit proxy error when upstream fails', async ({ page }) => {
    test.setTimeout(180_000);

    const input = await openAgentChat(page);

    await page.evaluate(() => {
      (globalThis as any).hypha_chat_proxy = async () => {
        return JSON.stringify({ error: 'simulated-upstream-error' });
      };
    });

    const assistantHeaders = page.locator('span.text-xs.font-semibold');
    const beforeAssistantCount = await assistantHeaders.count();

    const prompt = 'search for cancer datasets';
    await input.fill(prompt);
    await input.press('Enter');

    await expect
      .poll(async () => await assistantHeaders.count(), { timeout: 90_000 })
      .toBeGreaterThan(beforeAssistantCount);

    const assistantResponse = page
      .locator('div.rounded-2xl')
      .filter({ has: page.locator('span.text-xs.font-semibold') })
      .last();

    await expect(assistantResponse).toBeVisible({ timeout: 90_000 });

    const responseText = (await assistantResponse.innerText()).toLowerCase();
    expect(
      responseText.includes('error from proxy') ||
      responseText.includes('bridge is currently unavailable') ||
      responseText.includes('proxy')
    ).toBeTruthy();

    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  });
});
