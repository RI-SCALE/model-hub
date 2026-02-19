import { expect, test } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;
const RESPONSE_TIMEOUT = 300_000;
const REAL_PROMPT = 'give me 5 mouse tumor datasets please';

async function openAgentChat(page: Parameters<typeof test>[0]['page']) {
  await page.goto('/#/agents');

  const input = page.locator('textarea[placeholder*="Type a message"]');
  await expect(input).toBeVisible({ timeout: CHAT_READY_TIMEOUT });
  await expect(input).toBeEnabled({ timeout: CHAT_READY_TIMEOUT });

  return input;
}

test.describe('BioImage Finder real proxy reproduction', () => {
  test('reproduces archive fallback and preserves progress after completion', async ({ page }) => {
    test.skip(!process.env.RUN_REAL_PROXY_REPRO, 'Set RUN_REAL_PROXY_REPRO=1 to run against the real proxy backend.');
    test.setTimeout(420_000);

    const input = await openAgentChat(page);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    const archiveFallbackRegex = /archive bridge is currently unavailable|archive search bridge is currently unavailable|search service is currently unavailable|can't fetch live results|cannot fetch live results/;
    const observedOutcomes: string[] = [];
    let assistantMessage: ReturnType<typeof page.locator> | null = null;
    let assistantText = '';
    let observedTimeout = false;
    let observedArchiveFallback = false;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const assistantHeaders = page.locator('span.text-xs.font-semibold');
      const beforeAssistantCount = await assistantHeaders.count();
      const timeoutMarker = page.locator('text=Chat request timed out after');
      const beforeTimeoutCount = await timeoutMarker.count();

      await input.fill(REAL_PROMPT);
      await input.press('Enter');

      await expect(page.getByText(REAL_PROMPT, { exact: true })).toBeVisible({ timeout: 30_000 });

      const startedAt = Date.now();
      let attemptCompleted = false;
      while (Date.now() - startedAt < RESPONSE_TIMEOUT) {
        const afterAssistantCount = await assistantHeaders.count();
        if (afterAssistantCount > beforeAssistantCount) {
          assistantMessage = page
            .locator('div.rounded-2xl')
            .filter({ has: page.locator('span.text-xs.font-semibold') })
            .last();
          assistantText = ((await assistantMessage.innerText()) || '').toLowerCase();
          attemptCompleted = true;
          break;
        }

        const afterTimeoutCount = await timeoutMarker.count();
        if (afterTimeoutCount > beforeTimeoutCount) {
          observedOutcomes.push(`attempt ${attempt}: timeout`);
          observedTimeout = true;
          attemptCompleted = true;
          break;
        }

        await page.waitForTimeout(1000);
      }

      if (!attemptCompleted) {
        observedOutcomes.push(`attempt ${attempt}: no completion within timeout window`);
        continue;
      }

      if (assistantText && archiveFallbackRegex.test(assistantText)) {
        observedOutcomes.push(`attempt ${attempt}: archive fallback reproduced`);
        observedArchiveFallback = true;
        break;
      }

      if (assistantText) {
        observedOutcomes.push(`attempt ${attempt}: assistant replied without archive fallback`);
      }
    }

    expect(observedArchiveFallback || observedTimeout, `Outcomes: ${observedOutcomes.join('; ')}`).toBeTruthy();

    if (!observedArchiveFallback) {
      await expect(page.getByText('Chat request timed out after', { exact: false })).toBeVisible({ timeout: 30_000 });
      return;
    }

    expect(assistantMessage, `Outcomes: ${observedOutcomes.join('; ')}`).not.toBeNull();
    expect(assistantText, `Outcomes: ${observedOutcomes.join('; ')}`).toMatch(archiveFallbackRegex);

    const collapseButton = assistantMessage!.getByRole('button', { name: 'Collapse' });
    await expect(collapseButton).toBeVisible({ timeout: 30_000 });

    const progressToggle = assistantMessage!.getByRole('button', { name: 'Show generation progress' });
    await expect(progressToggle).toBeVisible({ timeout: 30_000 });
    await progressToggle.click();

    await expect(assistantMessage!.getByText('Calling tool:', { exact: false }).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Toggle Logs' }).click();
    await expect(page.getByText(/AttributeError|to_py/).first()).toBeVisible({ timeout: 30_000 });
  });
});
