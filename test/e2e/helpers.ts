// Shared end-to-end helpers: each "device" is its own browser context.
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const SIGNAL = 'signal=' + encodeURIComponent('http://127.0.0.1:9123/lcc');

// Each "device" is its own context. Close them all after each test, or old pages
// keep reconnecting in the background and slow later tests down.
const contexts: BrowserContext[] = [];
export async function device(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  return ctx.newPage();
}
export async function closeAll(): Promise<void> {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
}

export async function openDisplay(browser: Browser): Promise<{ page: Page; code: string }> {
  const page = await device(browser);
  await page.goto(`/show/?${SIGNAL}`);
  await expect(page.locator('#code')).toHaveText(/^[A-Z2-9]{4}$/, { timeout: 15_000 });
  return { page, code: (await page.locator('#code').textContent())! };
}

export async function openPhone(browser: Browser, code: string): Promise<Page> {
  const page = await device(browser);
  await page.goto(`/speak/?room=${code}&engine=fake&${SIGNAL}`);
  await expect(page.locator('#chip-tv')).toHaveAttribute('data-s', 'ok', { timeout: 15_000 });
  return page;
}

/** Types into the phone's "Type a caption" box (opening it first). Enter makes it final. */
export async function typeOn(phone: Page, text: string, enter = true): Promise<void> {
  const box = phone.locator('#type-box');
  if (!(await box.evaluate((d: HTMLDetailsElement) => d.open))) await box.locator('summary').click();
  await phone.locator('#test-text').fill(text);
  if (enter) await phone.locator('#test-text').press('Enter');
}

export async function openViewer(browser: Browser, code: string): Promise<Page> {
  const page = await device(browser);
  await page.goto(`/view/?room=${code}&${SIGNAL}`);
  return page;
}


/** Drives the phone's scripted fake engine (?engine=fake). */
export const say = (phone: Page, kind: 'interim' | 'final', text: string) =>
  phone.evaluate(([k, t]) => (window as any).__fakeSpeech[k](t), [kind, text] as const);

export async function liveSession(browser: Browser): Promise<{ tv: Page; phone: Page }> {
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);
  await phone.locator('#start').click();
  await expect(phone.locator('#mic-state')).toHaveText('listening');
  await expect(tv.page.locator('#live')).toBeVisible();
  return { tv: tv.page, phone };
}
