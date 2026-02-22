import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;
const RESPONSE_TIMEOUT = 360_000;
const PROMPT = 'find me 5 tumor datasets';
const MAX_RESPONSE_MS = Number(process.env.REAL_PROXY_MAX_RESPONSE_MS || '30000');
const QUALITY_OBSERVE_MS = Number(process.env.REAL_PROXY_QUALITY_OBSERVE_MS || '120000');

async function openAgentChat(page: Page) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto('/#/agents');

    const input = page.locator('textarea[placeholder*="Type a message"]');
    try {
      await expect(input).toBeVisible({ timeout: CHAT_READY_TIMEOUT / 2 });
      await expect(input).toBeEnabled({ timeout: CHAT_READY_TIMEOUT / 2 });
      return input;
    } catch {
      if (attempt >= 2) throw new Error('Agent chat input not ready after retries');
      await page.reload();
      await page.waitForTimeout(1500);
    }
  }

  throw new Error('Agent chat input not ready');
}

async function setModelToGpt5Mini(page: Page) {
  const modelSelect = page.getByRole('combobox', { name: 'Model' });
  await expect(modelSelect).toBeVisible({ timeout: 30_000 });
  await modelSelect.selectOption({ label: 'GPT-5 mini' });
}

async function waitForCompletedAssistantMessage(page: Page, beforeAssistantCount: number, timeoutMs: number = RESPONSE_TIMEOUT) {
  const assistantHeaders = page.locator('span.text-xs.font-semibold');
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
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

  throw new Error(`Timed out waiting for assistant response completion after ${timeoutMs}ms`);
}

test.describe('Real proxy quality and performance', () => {
  test('does not produce 503 failed-resource signals for tumor dataset query', async ({ page }) => {
    test.skip(!process.env.RUN_REAL_PROXY_REPRO, 'Set RUN_REAL_PROXY_REPRO=1 to run against real proxy/kernel flow.');
    test.setTimeout(480_000);

    const failedFtsResponses: Array<{ url: string; status: number }> = [];
    const failedFtsConsoleErrors: string[] = [];

    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('bioimagearchive.org/search/search/fts') && response.status() >= 500) {
        failedFtsResponses.push({ url, status: response.status() });
      }
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/bioimagearchive\.org\/search\/search\/fts/i.test(text) && /503|service unavailable/i.test(text)) {
        failedFtsConsoleErrors.push(text);
      }
    });

    const input = await openAgentChat(page);
    await setModelToGpt5Mini(page);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    await input.fill(PROMPT);
    await input.press('Enter');

    const observedStartedAt = Date.now();
    while (Date.now() - observedStartedAt < QUALITY_OBSERVE_MS) {
      const isCancelVisible = await page.getByRole('button', { name: 'Cancel' }).isVisible().catch(() => false);
      if (!isCancelVisible) {
        break;
      }
      await page.waitForTimeout(1000);
    }

    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
      await expect(page.locator('text=Request cancelled by user.')).toBeVisible({ timeout: 20_000 });
    }

    expect(failedFtsResponses, `5xx responses: ${JSON.stringify(failedFtsResponses)}`).toEqual([]);
    expect(failedFtsConsoleErrors, `Console 503 errors: ${JSON.stringify(failedFtsConsoleErrors)}`).toEqual([]);
  });

  test('benchmark: returns answer within target latency on gpt-5-mini', async ({ page }) => {
    test.skip(!process.env.RUN_REAL_PROXY_REPRO, 'Set RUN_REAL_PROXY_REPRO=1 to run against real proxy/kernel flow.');
    test.setTimeout(480_000);

    const input = await openAgentChat(page);
    await setModelToGpt5Mini(page);

    await page.evaluate(() => {
      (globalThis as any).__chatProxyTestMode = undefined;
    });

    const assistantHeaders = page.locator('span.text-xs.font-semibold');
    const beforeAssistantCount = await assistantHeaders.count();

    const startedAt = Date.now();
    await input.fill(PROMPT);
    await input.press('Enter');

    const benchmarkTimeoutMs = Math.max(MAX_RESPONSE_MS + 30_000, 60_000);
    const assistantMessage = await waitForCompletedAssistantMessage(page, beforeAssistantCount, benchmarkTimeoutMs);
    const elapsedMs = Date.now() - startedAt;

    const assistantText = ((await assistantMessage.innerText()) || '').toLowerCase();
    expect(assistantText).not.toMatch(/\*\*error\*\*|no response from agent \(timeout\)|error from proxy/);

    test.info().annotations.push({
      type: 'benchmark',
      description: `elapsed_ms=${elapsedMs}; target_ms=${MAX_RESPONSE_MS}`,
    });

    expect(elapsedMs).toBeLessThanOrEqual(MAX_RESPONSE_MS);
  });
});
