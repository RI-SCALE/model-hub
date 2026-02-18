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
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    }).catch(() => {
    });
  });

  test('uses chat-proxy-dev in local development', async ({ page }) => {
    test.setTimeout(120_000);

    await openAgentChat(page);

    await expect
      .poll(async () => {
        const serviceId = await page.evaluate(() => (globalThis as any).__chatProxyServiceId || '');
        return String(serviceId);
      }, { timeout: 30_000 })
      .toContain('default@chat-proxy-dev');
  });

  test('allows cancel when proxy call stalls', async ({ page }) => {
    test.setTimeout(180_000);

    const input = await openAgentChat(page);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = 'stall';
    });

    const prompt = 'find me some tumor datasets';
    await input.fill(prompt);
    await input.press('Enter');

    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('text=Request cancelled by user.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });
  });

  test('completes with user-facing fallback when upstream fails', async ({ page }) => {
    test.setTimeout(180_000);

    const input = await openAgentChat(page);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = 'upstream-error';
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

    const responseText = (await assistantResponse.innerText()).trim().toLowerCase();
    expect(responseText.length).toBeGreaterThan(20);

    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });
  });

  test('does not remain stuck indefinitely on stalled requests', async ({ page }) => {
    test.setTimeout(180_000);

    const input = await openAgentChat(page);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = 'stall';
    });

    const assistantHeaders = page.locator('span.text-xs.font-semibold');
    const beforeAssistantCount = await assistantHeaders.count();

    const prompt = 'find me some tumor datasets quickly';
    await input.fill(prompt);
    await input.press('Enter');

    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0, { timeout: 90_000 });

    const timeoutCount = await page.locator('text=Chat request timed out after').count();
    const afterAssistantCount = await assistantHeaders.count();
    expect(timeoutCount > 0 || afterAssistantCount > beforeAssistantCount).toBeTruthy();

    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });
  });
});
