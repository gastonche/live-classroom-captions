// Live speech, end to end, with the scripted fake engine (?engine=fake) standing in for the mic.
import { test, expect, type Page } from '@playwright/test';
import { closeAll, openDisplay, openPhone } from './helpers';

test.afterEach(closeAll);

const say = (phone: Page, kind: 'interim' | 'final', text: string) =>
  phone.evaluate(([k, t]) => (window as any).__fakeSpeech[k](t), [kind, text] as const);

async function liveSession(browser: import('@playwright/test').Browser) {
  const tv = await openDisplay(browser);
  const phone = await openPhone(browser, tv.code);
  await phone.locator('#start').click();
  await expect(phone.locator('#chip-mic')).toHaveAttribute('data-s', 'ok');
  await expect(phone.locator('#mic-state')).toHaveText('listening');
  await expect(tv.page.locator('#live')).toBeVisible();
  return { tv: tv.page, phone };
}

test('speech appears dimmed while in progress, then firms up, with word fixes applied', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await say(phone, 'interim', 'today we use grip');
  await expect(tv.locator('#stage .interim')).toHaveText('today we use grep');
  const colour = await tv.locator('#stage .interim').evaluate((e) => getComputedStyle(e).color);
  expect(colour).not.toBe('rgb(255, 255, 255)');

  await say(phone, 'final', 'today we use grip to search then see h mod the file');
  await expect(tv.locator('#stage')).toHaveText('today we use grep to search then chmod the file');
  await expect(tv.locator('#stage .interim')).toHaveText('');
  // The phone shows a small live preview of the same text.
  await expect(phone.locator('#preview')).toContainText('chmod the file');
});

test('captions resume by themselves when the OS ends the speech session', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await say(phone, 'final', 'before the pause');
  await phone.evaluate(() => (window as any).__fakeSpeech.end());
  await expect(phone.locator('#mic-state')).toHaveText('listening');
  await say(phone, 'final', 'after the pause');
  await expect(tv.locator('#stage')).toHaveText('before the pause after the pause');
});

test('a refused restart shows one plain fix, and one tap carries on', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await phone.evaluate(() => (window as any).__fakeSpeech.fail('needs-tap'));
  await expect(phone.locator('#fix')).toHaveText('Listening stopped. Tap here to carry on.');
  await expect(phone.locator('#chip-mic')).toHaveAttribute('data-s', 'bad');
  await phone.locator('#fix').click();
  await expect(phone.locator('#fix')).toBeHidden();
  await expect(phone.locator('#mic-state')).toHaveText('listening');
  await say(phone, 'final', 'back again');
  await expect(tv.locator('#stage')).toHaveText('back again');
});

test('a blocked microphone explains how to allow it', async ({ browser }) => {
  const { phone } = await liveSession(browser);
  await phone.evaluate(() => (window as any).__fakeSpeech.fail('blocked'));
  await expect(phone.locator('#fix')).toHaveText('Microphone blocked. Tap here to see how to allow it.');
  await phone.locator('#fix').click();
  await expect(phone.locator('#fix-help')).toContainText('Website Settings');
});

test('pause really turns the mic off; resume turns it back on', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await phone.locator('#pause').click();
  await expect(phone.locator('#mic-state')).toHaveText('off');
  await expect(tv.locator('#notice')).toHaveText('Captions paused');
  await phone.locator('#pause').click();
  await expect(phone.locator('#mic-state')).toHaveText('listening');
});

test('the word-list editor changes what appears on screen', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await phone.locator('#words-box summary').click();
  const box = phone.locator('#words');
  await expect(box).toHaveValue(/grip, grab, grape, g rep, grep => grep/);
  await box.fill((await box.inputValue()) + '\nlocal host => localhost');
  await phone.locator('#words-save').click();
  await expect(phone.locator('#words-msg')).toHaveText('Saved.');
  await say(phone, 'final', 'open local host in the browser');
  await expect(tv.locator('#stage')).toHaveText('open localhost in the browser');

  // Survives a reload (stored on the phone).
  await phone.reload();
  await phone.locator('#words-box summary').click();
  await expect(phone.locator('#words')).toHaveValue(/local host => localhost/);
});

test('French: the French pack applies and the screen switches language', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await phone.locator('details:has(#lang) summary').click();
  await phone.locator('#lang').selectOption('fr');
  await expect(phone.locator('#start, #pause').first()).toHaveText(/Pause|Démarrer/);
  await expect(phone.locator('#mic-state')).toHaveText('écoute');
  await expect.poll(() => phone.evaluate(() => (window as any).__fakeSpeech.lang)).toBe('fr-FR');
  await say(phone, 'final', 'tapez soudeau puis elle esse');
  await expect(tv.locator('#stage')).toHaveText('tapez sudo puis ls');
});

test('Copy diagnostics gives a readable event log without the spoken words', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');
  const { phone } = await liveSession(browser);
  await phone.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await say(phone, 'final', 'a secret sentence');
  await phone.locator('#pause').click();
  await phone.locator('#diag-box summary').click();
  await phone.locator('#diag-copy').click();
  await expect(phone.locator('#diag-msg')).toHaveText('Copied. Paste it into a message.');
  const text = await phone.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Live Classroom Captions diagnostics');
  expect(text).toMatch(/app {2}start captions/);
  expect(text).toMatch(/app {2}pause/);
  expect(text).toMatch(/screen {2}connected/);
  expect(text).not.toContain('secret');
});

test('End stops the mic and offers the transcript as a .txt file', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await say(phone, 'final', 'first we use grip');
  await say(phone, 'final', 'then sudo');
  await phone.locator('#end').click();
  await expect(phone.locator('#mic-state')).toHaveText('off');
  await expect(tv.locator('#pair')).toBeVisible();
  await expect(phone.locator('#ended')).toBeVisible();
  const [dl] = await Promise.all([phone.waitForEvent('download'), phone.locator('#t-download').click()]);
  expect(dl.suggestedFilename()).toMatch(/^captions-\d{4}-\d{2}-\d{2}-\d{4}\.txt$/);
  const text = await (await import('node:fs/promises')).readFile((await dl.path())!, 'utf8');
  expect(text).toContain('Live Classroom Captions: transcript');
  expect(text).toMatch(/\[\d\d:\d\d\] first we use grep then sudo/);

  await phone.locator('#t-done').click();
  await expect(phone.locator('#ended')).toBeHidden();
  await expect(phone.locator('#start')).toBeVisible();
});

test('if the mic stays down, the screen says captions are interrupted; any tap resumes', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await say(phone, 'final', 'before the network drop');
  await phone.evaluate(() => (window as any).__fakeSpeech.fail('needs-tap'));
  await expect(tv.locator('#notice')).toHaveText('Captions interrupted. Teacher: check your phone.', { timeout: 8_000 });
  // A tap anywhere on the phone (not only the yellow button) resumes listening.
  await phone.locator('#preview').click();
  await expect(phone.locator('#mic-state')).toHaveText('listening');
  // That tap only resumes the mic; it doesn't open tap-to-fix.
  await expect(phone.locator('#tapfix')).toBeHidden();
  await expect(tv.locator('#notice')).toBeHidden({ timeout: 3_000 });
  await say(phone, 'final', 'and after');
  await expect(tv.locator('#stage')).toHaveText('before the network drop and after');
});

test('students see the interruption notice too', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  const code = (await tv.locator('#net-code').textContent())!;
  const { openViewer } = await import('./helpers');
  const student = await openViewer(browser, code);
  await say(phone, 'final', 'hello');
  await expect(student.locator('#transcript')).toHaveText('hello', { timeout: 15_000 });
  await phone.evaluate(() => (window as any).__fakeSpeech.fail('needs-tap'));
  await expect(student.locator('#state')).toHaveText('Captions interrupted. Teacher: check your phone.', { timeout: 8_000 });
});
