// End-to-end: display, teacher phone and student viewers as separate browser contexts
// (separate storage, like separate devices), over a local PeerJS server.
import { test, expect } from '@playwright/test';

import { SIGNAL, closeAll, device, openDisplay, openPhone, openViewer, typeOn } from './helpers';

test.afterEach(closeAll);

test('pairs by code, goes live and shows typed captions', async ({ browser }) => {
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);

  await expect(tv.page.locator('#pair')).toBeVisible();
  await phone.locator('#start').click();
  await expect(tv.page.locator('#live')).toBeVisible({ timeout: 2_000 });

  await typeOn(phone, 'use grep to', false);
  await expect(tv.page.locator('#stage .interim')).toHaveText(' use grep to'.trim(), { timeout: 2_000 });
  await phone.locator('#test-text').press('Enter');
  await expect(tv.page.locator('#stage')).toHaveText('use grep to');
  await expect(tv.page.locator('#stage .interim')).toHaveText('');
});

test('start to live on the display in under 2 s', async ({ browser }) => {
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);
  const t0 = Date.now();
  await phone.locator('#start').click();
  await expect(tv.page.locator('#live')).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(2000);
});

test('pause hides captions and says so; resume shows them again', async ({ browser }) => {
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);
  await phone.locator('#start').click();
  await typeOn(phone, 'private');
  await expect(tv.page.locator('#stage')).toHaveText('private');

  await phone.locator('#pause').click();
  await expect(tv.page.locator('#notice')).toHaveText('Captions paused');
  await expect(tv.page.locator('#stage')).toBeHidden();

  await phone.locator('#pause').click();
  await expect(tv.page.locator('#notice')).toBeHidden();
  await expect(tv.page.locator('#stage')).toBeVisible();
});

test('shows "Waiting for teacher…" when the phone goes away, and recovers', async ({ browser }) => {
  const tv = await openDisplay(browser);
  let phone = await openPhone(browser, tv.code);
  await phone.locator('#start').click();
  await typeOn(phone, 'before');
  await expect(tv.page.locator('#stage')).toHaveText('before');

  const ctx = phone.context();
  await phone.close();
  await expect(tv.page.locator('#notice')).toHaveText('Waiting for teacher…', { timeout: 12_000 });
  await expect(tv.page.locator('#stage')).toBeHidden();

  // Same phone (same storage, so same token) comes back.
  phone = await ctx.newPage();
  await phone.goto(`/speak/?engine=fake&${SIGNAL}`); // no ?room: it remembers the last screen
  await expect(phone.locator('#chip-tv')).toHaveAttribute('data-s', 'ok', { timeout: 15_000 });
  await phone.locator('#start').click();
  await expect(tv.page.locator('#notice')).toBeHidden();
  await typeOn(phone, 'after');
  await expect(tv.page.locator('#stage')).toHaveText('before after');
});

test('the phone reconnects by itself when the display reloads', async ({ browser }) => {
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);
  await phone.locator('#start').click();
  await expect(tv.page.locator('#live')).toBeVisible();

  const t0 = Date.now();
  await tv.page.reload();
  await expect(tv.page.locator('#code')).toHaveText(tv.code, { timeout: 15_000 }); // the display remembers its code
  // The phone resends "live" on rejoin, so the display goes back to captions with no taps.
  await expect(tv.page.locator('#live')).toBeVisible({ timeout: 10_000 });
  const took = Date.now() - t0;
  test.info().annotations.push({ type: 'reconnect-ms', description: String(took) });
  expect(took).toBeLessThan(10_000);

  await typeOn(phone, 'still here');
  await expect(tv.page.locator('#stage')).toHaveText('still here');
});

test('a second phone cannot take over while the teacher is connected', async ({ browser }) => {
  const tv = await openDisplay(browser);
  await openPhone(browser, tv.code);
  const intruder = await device(browser);
  await intruder.goto(`/speak/?room=${tv.code}&${SIGNAL}`);
  await expect(intruder.locator('#main-error')).toHaveText('Another phone is already the teacher on this screen.', {
    timeout: 15_000,
  });
});

test('several student viewers get the backlog and live captions', async ({ browser }) => {
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);
  await phone.locator('#start').click();
  await typeOn(phone, 'first line');

  const a = await openViewer(browser, tv.code);
  const b = await openViewer(browser, tv.code);
  await expect(a.locator('#transcript')).toHaveText('first line', { timeout: 15_000 });
  await expect(b.locator('#transcript')).toHaveText('first line', { timeout: 15_000 });

  await typeOn(phone, 'second', false);
  await expect(a.locator('#transcript .interim')).toHaveText(' second');
  await phone.locator('#test-text').press('Enter');
  await expect(a.locator('#transcript')).toHaveText('first line second');
  await expect(b.locator('#transcript')).toHaveText('first line second');

  await phone.locator('#pause').click();
  await expect(a.locator('#state')).toHaveText('Captions paused');
});

test('display settings from the phone apply to the display', async ({ browser }) => {
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);
  await phone.locator('details:has(#lang) summary').click();
  await phone.locator('#margin').fill('10');
  await expect.poll(() => tv.page.evaluate(() => document.documentElement.style.getPropertyValue('--margin'))).toBe('10');
  await phone.locator('#lang').selectOption('fr');
  await expect(tv.page.locator('#pair .label')).toHaveText('Code de la salle');
});

test('after a network change, a dead channel is noticed in seconds, not 10 s', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebKit reports the close itself, so there is nothing to probe');
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);
  // Chromium doesn't tell the phone when the screen's page closes: the channel looks open but is dead.
  await tv.page.close();
  await phone.evaluate(() => window.dispatchEvent(new Event('online')));
  const t0 = Date.now();
  await expect(phone.locator('#chip-tv')).not.toHaveAttribute('data-s', 'ok', { timeout: 5_000 });
  expect(Date.now() - t0).toBeLessThan(5_000);
});

test('iPhone Safari shows the Add to Home Screen tip once', async ({ browser }) => {
  const tv = await openDisplay(browser);
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1',
  });
  const phone = await ctx.newPage();
  await phone.goto(`/speak/?room=${tv.code}&engine=fake&${SIGNAL}`);
  await expect(phone.locator('#a2hs')).toBeVisible();
  await phone.locator('#a2hs-ok').click();
  await expect(phone.locator('#a2hs')).toBeHidden();
  await phone.reload();
  await expect(phone.locator('#main')).toBeVisible();
  await expect(phone.locator('#a2hs')).toBeHidden();
  await ctx.close();
});
