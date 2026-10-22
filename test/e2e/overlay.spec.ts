// The overlay page (what the desktop app shows), driven from a phone over the local signalling server.
// Native parts (on-top, click-through, cursor) are tested in the app itself.
import { test, expect, type Page } from '@playwright/test';
import { SIGNAL, closeAll, device } from './helpers';

test.afterEach(closeAll);

async function openOverlay(browser: import('@playwright/test').Browser) {
  const page = await device(browser);
  await page.goto(`/overlay/?${SIGNAL}`);
  await expect(page.locator('#card')).toBeVisible({ timeout: 15_000 }); // code card at launch
  const code = (await page.locator('#code').textContent())!;
  expect(code).toMatch(/^[A-Z2-9]{4}$/);
  return { page, code };
}

async function phoneFor(browser: import('@playwright/test').Browser, code: string): Promise<Page> {
  const phone = await device(browser);
  await phone.goto(`/speak/?room=${code}&engine=fake&${SIGNAL}`);
  await expect(phone.locator('#chip-tv')).toHaveAttribute('data-s', 'ok', { timeout: 15_000 });
  return phone;
}

const say = (phone: Page, t: string) => phone.evaluate((t) => (window as any).__fakeSpeech.final(t), t);

test('shows only a code card until paired, then nothing until live, then the caption box', async ({ browser }) => {
  const { page: ov, code } = await openOverlay(browser);
  await expect(ov.locator('#card-hint')).toContainText('/speak/');
  const phone = await phoneFor(browser, code);
  await expect(ov.locator('#card')).toBeHidden();
  await expect(ov.locator('#box')).toBeHidden();
  await expect(ov.locator('#chip')).toBeHidden();

  await phone.locator('#start').click();
  await expect(ov.locator('#box')).toBeVisible();
  await say(phone, 'pipe it into grip');
  await expect(ov.locator('#stage')).toHaveText('pipe it into grep');

  await phone.locator('#end').click();
  await expect(ov.locator('#box')).toBeHidden();
});

test('the page is see-through: only the box is drawn', async ({ browser }) => {
  const { page: ov } = await openOverlay(browser);
  const bg = await ov.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
  expect(bg).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
});

test('Top/Bottom on the phone moves the captions, and the computer menu updates the phone', async ({ browser }) => {
  const { page: ov, code } = await openOverlay(browser);
  const phone = await phoneFor(browser, code);
  await phone.locator('#start').click();
  await expect(ov.locator('body')).toHaveAttribute('data-position', 'bottom');
  await phone.locator('#pos-top').click();
  await expect(ov.locator('body')).toHaveAttribute('data-position', 'top');
  const top = await ov.locator('#box').boundingBox();
  expect(top!.y).toBeLessThan(200);

  // Menu-bar "Bottom" on the computer: the phone's buttons follow.
  await ov.evaluate(() => (window as any).__overlayAction('pos-bottom'));
  await expect(ov.locator('body')).toHaveAttribute('data-position', 'bottom');
  await expect(phone.locator('#pos-bottom')).toHaveAttribute('aria-pressed', 'true');
});

test('states are small chips: paused, interrupted, waiting for teacher', async ({ browser }) => {
  const { page: ov, code } = await openOverlay(browser);
  const phone = await phoneFor(browser, code);
  await phone.locator('#start').click();
  await phone.locator('#pause').click();
  await expect(ov.locator('#chip')).toHaveText('Captions paused');
  await expect(ov.locator('#box')).toBeHidden();
  await phone.locator('#pause').click();
  await expect(ov.locator('#box')).toBeVisible();

  await phone.evaluate(() => (window as any).__fakeSpeech.fail('needs-tap'));
  await expect(ov.locator('#chip')).toHaveText('Captions interrupted. Teacher: check your phone.', { timeout: 8_000 });
  await expect(ov.locator('#chip')).toHaveAttribute('data-kind', 'interrupted');

  await phone.close();
  await expect(ov.locator('#chip')).toHaveText('Waiting for teacher…', { timeout: 12_000 });
});

test('Hide captions (menu or shortcut) hides everything; again shows it', async ({ browser }) => {
  const { page: ov, code } = await openOverlay(browser);
  const phone = await phoneFor(browser, code);
  await phone.locator('#start').click();
  await expect(ov.locator('#box')).toBeVisible();
  await ov.evaluate(() => (window as any).__overlayAction('toggle-hide'));
  await expect(ov.locator('#box')).toBeHidden();
  await ov.evaluate(() => (window as any).__overlayAction('toggle-hide'));
  await expect(ov.locator('#box')).toBeVisible();
});

test('the overlay keeps its own text size: a reconnecting phone does not force TV-sized text', async ({ browser }) => {
  const { page: ov, code } = await openOverlay(browser);
  await phoneFor(browser, code);
  await expect.poll(() => ov.evaluate(() => (window as any).__lcc.settings.size)).toBe(4.5);
  await expect.poll(() => ov.evaluate(() => (window as any).__lcc.settings.lines)).toBe(2);
});

test('"Show room code" brings the card back while nobody is paired', async ({ browser }) => {
  const page = await device(browser);
  await page.goto(`/overlay/?${SIGNAL}`);
  await expect(page.locator('#card')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => (window as any).__overlayAction('toggle-hide'));
  await expect(page.locator('#card')).toBeHidden();
  await page.evaluate(() => (window as any).__overlayAction('toggle-hide'));
  await page.evaluate(() => (window as any).__overlayAction('show-code'));
  await expect(page.locator('#card')).toBeVisible();
});
