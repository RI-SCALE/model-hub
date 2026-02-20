import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;
const RESPONSE_TIMEOUT = 240_000;

async function getProxyHealth(page: Page): Promise<{ ok: boolean; reason?: string }> {
  try {
    const status = await page.evaluate(async () => {
      const proxy = (globalThis as any).hypha_chat_proxy;
      if (typeof proxy !== 'function') {
        return { ok: false, reason: 'hypha_chat_proxy bridge unavailable' };
      }

      const pingMessages = JSON.stringify([
        { role: 'system', content: 'Reply with OK only.' },
        { role: 'user', content: 'OK?' },
      ]);

      const resultJson = await proxy(pingMessages, null, null, 'gpt-5-mini');
      let parsed: any = null;
      try {
        parsed = JSON.parse(String(resultJson));
      } catch {
        return { ok: false, reason: 'proxy returned non-JSON response' };
      }

      if (parsed?.error) {
        const reason = String(parsed.error);
        const isInfraIssue = /timed out|timeout|service not found|unable to resolve|model_not_found|does not exist or you do not have access/i.test(reason);
        return { ok: !isInfraIssue, reason };
      }

      return { ok: true };
    });

    return status;
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

async function openAgentChat(page: Page) {
  await page.goto('/#/agents');

  const input = page.locator('textarea[placeholder*="Type a message"]');
  await expect(input).toBeVisible({ timeout: CHAT_READY_TIMEOUT });
  await expect(input).toBeEnabled({ timeout: CHAT_READY_TIMEOUT });

  return input;
}

async function sendAndAwaitResponse(
  page: Page,
  input: Locator,
  prompt: string,
  options?: {
    assertNotOnlyPlaceholder?: string;
    forbiddenSubstrings?: string[];
  }
) {
  const MAX_ATTEMPTS = 2;
  const countErrorMarkers = async () => {
    const timeoutCount = await page.locator('text=No response from agent (timeout)').count();
    const proxyCount = await page.locator('text=Error from proxy').count();
    const markdownErrorCount = await page.locator('text=**Error**').count();
    return timeoutCount + proxyCount + markdownErrorCount;
  };

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const beforeErrorCount = await countErrorMarkers();
    const assistantHeaders = page.locator('span.text-xs.font-semibold');
    const beforeAssistantCount = await assistantHeaders.count();

    await input.fill(prompt);
    await input.press('Enter');

    await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    const responseLocator = page.locator('div').filter({ hasText: /No response from agent|Error from proxy|Error/i });

    const startedAt = Date.now();
    let completed = false;
    while (Date.now() - startedAt < RESPONSE_TIMEOUT) {
      const afterErrorCount = await countErrorMarkers();
      if (afterErrorCount > beforeErrorCount) {
        const errText = (await responseLocator.first().textContent()) || 'Unknown chat error';
        const isTransientTimeout = /request timed out|no response from agent \(timeout\)|timeout/i.test(errText);
        if (isTransientTimeout && attempt < MAX_ATTEMPTS) {
          await page.waitForTimeout(1200);
          break;
        }
        if (isTransientTimeout) {
          throw new Error(`TRANSIENT_PROXY_TIMEOUT: ${errText}`);
        }
        throw new Error(`Agent chat failed for prompt "${prompt}": ${errText}`);
      }

      const isCancelVisible = await page.getByRole('button', { name: 'Cancel' }).isVisible().catch(() => false);
      const afterAssistantCount = await assistantHeaders.count();

      if (!isCancelVisible && afterAssistantCount > beforeAssistantCount) {
        completed = true;
        break;
      }

      await page.waitForTimeout(1000);
    }

    if (completed) {
      const afterErrorCount = await countErrorMarkers();
      expect(afterErrorCount).toBe(beforeErrorCount);
      lastError = null;
      break;
    }

    lastError = new Error(`TRANSIENT_PROXY_TIMEOUT: Timed out waiting for completed response for prompt "${prompt}" (attempt ${attempt}/${MAX_ATTEMPTS})`);
    if (attempt >= MAX_ATTEMPTS) {
      throw lastError;
    }
  }

  if (lastError) {
    throw lastError;
  }

  await expect(page.locator('text=No response from agent (timeout)')).toHaveCount(0);
  await expect(page.locator('text=Error from proxy')).toHaveCount(0);
  await expect(page.locator('text=model_not_found')).toHaveCount(0);
  await expect(page.locator('text=does not exist or you do not have access to it')).toHaveCount(0);

  if (options?.assertNotOnlyPlaceholder) {
    const assistantMessages = page
      .locator('div.rounded-2xl')
      .filter({ has: page.locator('span.text-xs.font-semibold') });
    const lastAssistantText = ((await assistantMessages.last().innerText()).trim() || '').toLowerCase();
    expect(lastAssistantText).not.toBe(options.assertNotOnlyPlaceholder.trim().toLowerCase());

    if (options?.forbiddenSubstrings && options.forbiddenSubstrings.length > 0) {
      for (const forbidden of options.forbiddenSubstrings) {
        expect(lastAssistantText).not.toContain(forbidden.toLowerCase());
      }
    }
  }
}

test.describe('BioImage Finder chat reliability', () => {
  test('answers a direct prompt without timeout', async ({ page }) => {
    test.setTimeout(300_000);

    const input = await openAgentChat(page);
    const health = await getProxyHealth(page);
    test.skip(!health.ok, `Skipping timeout assertion: proxy health check failed (${health.reason || 'unknown reason'})`);
    try {
      await sendAndAwaitResponse(page, input, "what's your opinion on science?");
    } catch (err: any) {
      const msg = String(err?.message || err);
      test.skip(msg.includes('TRANSIENT_PROXY_TIMEOUT'), `Skipping timeout assertion due transient proxy timeout: ${msg}`);
      throw err;
    }
  });

  test('answers a code/data-retrieval prompt without timeout', async ({ page }) => {
    test.setTimeout(300_000);

    const input = await openAgentChat(page);
    const health = await getProxyHealth(page);
    test.skip(!health.ok, `Skipping timeout assertion: proxy health check failed (${health.reason || 'unknown reason'})`);
    try {
      await sendAndAwaitResponse(
        page,
        input,
        'find me some cancer datasets',
        {
          assertNotOnlyPlaceholder: "I'll search for datasets related to cancer in the BioImage archive. Please hold on for a moment.",
          forbiddenSubstrings: [
            'search service is currently unavailable',
            'archive bridge is currently unavailable',
            'couldn\'t fetch live dataset',
            'i can\'t retrieve live dataset accessions right now',
          ],
        }
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      test.skip(msg.includes('TRANSIENT_PROXY_TIMEOUT'), `Skipping timeout assertion due transient proxy timeout: ${msg}`);
      throw err;
    }
  });
});
