import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const CHAT_READY_TIMEOUT = 120_000;
const RESPONSE_TIMEOUT = 240_000;

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
  const countErrorMarkers = async () => {
    const timeoutCount = await page.locator('text=No response from agent (timeout)').count();
    const proxyCount = await page.locator('text=Error from proxy').count();
    const markdownErrorCount = await page.locator('text=**Error**').count();
    return timeoutCount + proxyCount + markdownErrorCount;
  };

  const beforeErrorCount = await countErrorMarkers();
  const assistantHeaders = page.locator('span.text-xs.font-semibold');
  const beforeAssistantCount = await assistantHeaders.count();

  await input.fill(prompt);
  await input.press('Enter');

  await expect(page.getByText(prompt, { exact: true })).toBeVisible({ timeout: 30_000 });

  const responseLocator = page.locator('div').filter({ hasText: /No response from agent|Error from proxy|Error/i });

  const startedAt = Date.now();
  let completed = false;
  while (Date.now() - startedAt < RESPONSE_TIMEOUT) {
    const afterErrorCount = await countErrorMarkers();
    if (afterErrorCount > beforeErrorCount) {
      const errText = (await responseLocator.first().textContent()) || 'Unknown chat error';
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

  if (!completed) {
    throw new Error(`Timed out waiting for completed response for prompt "${prompt}"`);
  }

  const afterErrorCount = await countErrorMarkers();
  expect(afterErrorCount).toBe(beforeErrorCount);

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
    await sendAndAwaitResponse(page, input, "what's your opinion on science?");
  });

  test('answers a code/data-retrieval prompt without timeout', async ({ page }) => {
    test.setTimeout(300_000);

    const input = await openAgentChat(page);
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
  });
});
