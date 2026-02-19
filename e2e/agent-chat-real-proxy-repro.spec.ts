import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;
const RESPONSE_TIMEOUT = 300_000;
const REAL_PROMPT = 'give me 5 mouse tumor datasets please';

async function openAgentChat(page: Page) {
  await page.goto('/#/agents');

  const input = page.locator('textarea[placeholder*="Type a message"]');
  await expect(input).toBeVisible({ timeout: CHAT_READY_TIMEOUT });
  await expect(input).toBeEnabled({ timeout: CHAT_READY_TIMEOUT });

  return input;
}

test.describe('BioImage Finder real proxy reproduction', () => {
  test('returns dataset results and preserves progress after completion', async ({ page }) => {
    test.skip(!process.env.RUN_REAL_PROXY_REPRO, 'Set RUN_REAL_PROXY_REPRO=1 to run against the real proxy backend.');
    test.setTimeout(420_000);

    const input = await openAgentChat(page);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    const assistantHeaders = page.locator('span.text-xs.font-semibold');
    const beforeAssistantCount = await assistantHeaders.count();

    await input.fill(REAL_PROMPT);
    await input.press('Enter');

    await expect(page.getByText(REAL_PROMPT, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    const startedAt = Date.now();
    let assistantMessage: ReturnType<typeof page.locator> | null = null;
    while (Date.now() - startedAt < RESPONSE_TIMEOUT) {
      const afterAssistantCount = await assistantHeaders.count();
      if (afterAssistantCount > beforeAssistantCount) {
        assistantMessage = page
          .locator('div.rounded-2xl')
          .filter({ has: page.locator('span.text-xs.font-semibold') })
          .last();
        break;
      }
      await page.waitForTimeout(1000);
    }

    expect(assistantMessage).not.toBeNull();
    const assistantText = ((await assistantMessage!.innerText()) || '').toLowerCase();
    expect(assistantText).toMatch(/s-biad\d+|bioimage-archive\/[a-z0-9-]+/i);
    expect(assistantText).not.toMatch(/archive bridge is currently unavailable|archive search bridge is currently unavailable|search service is currently unavailable/);

    const collapseButton = assistantMessage!.getByRole('button', { name: 'Collapse' });
    await expect(collapseButton).toBeVisible({ timeout: 30_000 });

    const progressToggle = assistantMessage!.getByRole('button', { name: 'Show generation progress' });
    await expect(progressToggle).toBeVisible({ timeout: 30_000 });
    await progressToggle.click();

    await expect(assistantMessage!.getByText('Calling tool:', { exact: false }).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Toggle Logs' }).click();
    const logsText = (await page.locator('pre').allInnerTexts()).join('\n').toLowerCase();
    expect(logsText).not.toMatch(/attributeerror|to_py|syntaxerror/);
  });
});
