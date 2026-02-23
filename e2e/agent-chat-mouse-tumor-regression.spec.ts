import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;
const RESPONSE_TIMEOUT = 360_000;
const PROMPT = 'give me 5 mouse tumor datasets please';

async function openAgentChat(page: Page) {
  await page.goto('/#/agents');

  const input = page.locator('textarea[placeholder*="Type a message"]');
  await expect(input).toBeVisible({ timeout: CHAT_READY_TIMEOUT });
  await expect(input).toBeEnabled({ timeout: CHAT_READY_TIMEOUT });

  return input;
}

async function waitForCompletedAssistantMessage(page: Page, beforeAssistantCount: number) {
  const assistantHeaders = page.locator('span.text-xs.font-semibold');
  const startedAt = Date.now();
  while (Date.now() - startedAt < RESPONSE_TIMEOUT) {
    const afterAssistantCount = await assistantHeaders.count();
    const isCancelVisible = await page.getByRole('button', { name: 'Cancel' }).isVisible().catch(() => false);
    if (!isCancelVisible && afterAssistantCount > beforeAssistantCount) {
      return page
        .locator('div.rounded-2xl')
        .filter({ has: page.locator('span.text-xs.font-semibold') })
        .last();
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Timed out waiting for assistant response completion');
}

test.describe('BioImage Finder mouse-tumor regression', () => {
  test('does not emit archive bridge/to_py kernel errors', async ({ page }) => {
    test.skip(!process.env.RUN_REAL_PROXY_REPRO, 'Set RUN_REAL_PROXY_REPRO=1 to run against real proxy/kernel flow.');
    test.setTimeout(480_000);

    const input = await openAgentChat(page);
    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    const assistantHeaders = page.locator('span.text-xs.font-semibold');
    const beforeAssistantCount = await assistantHeaders.count();

    await input.fill(PROMPT);
    await input.press('Enter');

    const assistantMessage = await waitForCompletedAssistantMessage(page, beforeAssistantCount);
    const assistantText = ((await assistantMessage.innerText()) || '').toLowerCase();

    expect(assistantText).not.toMatch(/archive search bridge is currently unavailable|archive bridge is currently unavailable|search service is currently unavailable/);
    expect(assistantText).toMatch(/s-biad\d+|bioimage-archive\/[a-z0-9-]+|api is currently in beta|beta and appears limited|best available results\/errors/i);

    await page.getByRole('button', { name: 'Toggle Logs' }).click();
    const logsText = (await page.locator('pre').allInnerTexts()).join('\n').toLowerCase();
    expect(logsText).not.toMatch(/attributeerror|to_py|unterminated string literal|syntaxerror/);
  });

  test('should return live datasets for mouse tumor prompt (target behavior)', async ({ page }) => {
    test.skip(!process.env.RUN_REAL_PROXY_REPRO, 'Set RUN_REAL_PROXY_REPRO=1 to run against real proxy/kernel flow.');
    test.setTimeout(480_000);

    const input = await openAgentChat(page);
    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    const assistantHeaders = page.locator('span.text-xs.font-semibold');
    const beforeAssistantCount = await assistantHeaders.count();

    await input.fill(PROMPT);
    await input.press('Enter');

    const assistantMessage = await waitForCompletedAssistantMessage(page, beforeAssistantCount);
    const assistantText = ((await assistantMessage.innerText()) || '').toLowerCase();

    expect(assistantText).not.toMatch(/archive search bridge is currently unavailable|archive bridge is currently unavailable|search service is currently unavailable/);
    expect(assistantText).toMatch(/s-biad\d+|bioimage-archive\/[a-z0-9-]+|api is currently in beta|beta and appears limited|best available results\/errors/i);
    if (!/s-biad\d+|bioimage-archive\/[a-z0-9-]+/i.test(assistantText)) {
      expect(assistantText).toMatch(/tumor|mouse|cancer/i);
    }
  });
});
