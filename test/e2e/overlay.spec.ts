// The desktop app's page, in a browser. The native recognition engine is replaced by
// injected events (window.__asr), exactly as the app emits them; students join with /view.
import { test, expect, type Page } from '@playwright/test';
import { SIGNAL, closeAll, device, openViewer } from './helpers';

test.afterEach(closeAll);

async function openOverlay(browser: import('@playwright/test').Browser) {
  const page = await device(browser);
  await page.goto(`/overlay/?${SIGNAL}`);
  await expect(page.locator('#card')).toBeVisible({ timeout: 15_000 }); // student QR at launch
  const code = (await page.locator('#code').textContent())!;
  expect(code).toMatch(/^[A-Z2-9]{4}$/);
  return { page, code };
}

const act = (p: Page, id: string) => p.evaluate((id) => (window as any).__overlayAction(id), id);
const asr = (p: Page, e: object) => p.evaluate((e) => (window as any).__asr(e), e);
const listening = (p: Page) => asr(p, { kind: 'state', state: 'listening', detail: 'Test mic' });

test('the QR card is for students: it opens the follow-along page', async ({ browser }) => {
  const { page } = await openOverlay(browser);
  await expect(page.locator('#card-hint')).toHaveText('Students: scan to follow the captions on your phone.');
});

test('Start, then recognised speech appears with word fixes; End hides it', async ({ browser }) => {
  const { page } = await openOverlay(browser);
  await expect(page.locator('#box')).toBeHidden();
  await act(page, 'start');
  await listening(page);
  await expect(page.locator('#box')).toBeVisible();
  await asr(page, { kind: 'interim', text: 'it returns a bully' });
  await expect(page.locator('#stage .interim')).toHaveText('it returns a boolean');
  await asr(page, { kind: 'final', text: 'it returns a bully and then we grip the file' });
  await expect(page.locator('#stage')).toHaveText('it returns a boolean and then we grep the file');
  await act(page, 'end');
  await asr(page, { kind: 'state', state: 'idle', detail: '' });
  await expect(page.locator('#box')).toBeHidden();
});

test('students on their phones get the captions, the backlog, and pause', async ({ browser }) => {
  const { page, code } = await openOverlay(browser);
  await act(page, 'start');
  await listening(page);
  await asr(page, { kind: 'final', text: 'first we open the terminal' });
  const student = await openViewer(browser, code);
  await expect(student.locator('#transcript')).toHaveText('first we open the terminal', { timeout: 15_000 });
  await asr(page, { kind: 'final', text: 'then we type ls' });
  await expect(student.locator('#transcript')).toHaveText('first we open the terminal then we type ls');
  await act(page, 'pause');
  await expect(page.locator('#chip')).toHaveText('Captions paused');
  await expect(student.locator('#state')).toHaveText('Captions paused');
});

test('a microphone down for 5 s says so on screen and to students; it clears when it recovers', async ({ browser }) => {
  const { page, code } = await openOverlay(browser);
  await act(page, 'start');
  await listening(page);
  const student = await openViewer(browser, code);
  await expect(student.locator('#transcript')).toBeVisible({ timeout: 15_000 });
  await asr(page, { kind: 'state', state: 'error', detail: 'microphone stopped; retrying' });
  await expect(page.locator('#chip')).toHaveText('Captions interrupted: microphone problem.', { timeout: 8_000 });
  await expect(student.locator('#state')).toHaveText('Captions interrupted: microphone problem.', { timeout: 8_000 });
  await listening(page);
  await expect(page.locator('#box')).toBeVisible();
});

test('phones cannot take over as teacher: the computer is the microphone', async ({ browser }) => {
  const { code } = await openOverlay(browser);
  const phone = await device(browser);
  await phone.goto(`/speak/?room=${code}&engine=fake&${SIGNAL}`);
  await expect(phone.locator('#main-error')).toHaveText('Another phone is already the teacher on this screen.', { timeout: 15_000 });
});

test('End keeps the transcript, with word fixes, and late words still count', async ({ browser }) => {
  const { page } = await openOverlay(browser);
  await act(page, 'start');
  await listening(page);
  await asr(page, { kind: 'final', text: 'we use sudo' });
  await act(page, 'end');
  // The engine flushes the sentence in progress after stop: it still belongs to the lesson.
  await asr(page, { kind: 'final', text: 'and chmod at the end' });
  await asr(page, { kind: 'state', state: 'idle', detail: '' });
  const t = await page.evaluate(() => (window as any).__lcc.transcript);
  expect(t).toMatch(/we use sudo and chmod at the end/);
});

test('position, hide and language from the menu', async ({ browser }) => {
  const { page } = await openOverlay(browser);
  await act(page, 'start');
  await listening(page);
  await act(page, 'pos-top');
  await expect(page.locator('body')).toHaveAttribute('data-position', 'top');
  await act(page, 'toggle-hide');
  await expect(page.locator('#box')).toBeHidden();
  await act(page, 'toggle-hide');
  await expect(page.locator('#box')).toBeVisible();
  await act(page, 'lang:fr');
  await asr(page, { kind: 'final', text: 'tapez soudeau puis elle esse' });
  await expect(page.locator('#stage')).toHaveText('tapez sudo puis ls');
});

test('the page is see-through: only the box is drawn', async ({ browser }) => {
  const { page: ov } = await openOverlay(browser);
  const bg = await ov.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
  expect(bg).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
});

test('first run: models missing → clear setup message, Start refused, progress, then ready', async ({ browser }) => {
  const page = await device(browser);
  await page.goto(`/overlay/?models=missing&${SIGNAL}`);
  await expect(page.locator('#setup')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#setup-text')).toContainText('Speech models needed (467 MB, one time)');
  await act(page, 'start');
  await expect(page.locator('#box')).toBeHidden(); // can't listen yet

  const models = (e: object) => page.evaluate((e) => (window as any).__models(e), e);
  const total = 489_483_156;
  await act(page, 'download-models');
  await models({ stage: 'download', done: total / 4, total, detail: '' });
  await expect(page.locator('#setup-text')).toHaveText('Downloading speech models… 25% (117 of 467 MB)');
  await expect.poll(() => page.locator('#setup-bar').evaluate((e) => (e as HTMLElement).style.width)).toBe('25%');
  await models({ stage: 'error', done: 0, total, detail: 'connection lost' });
  await expect(page.locator('#setup-text')).toContainText('Download stopped: connection lost');
  await models({ stage: 'unpack', done: total, total, detail: '' });
  await models({ stage: 'done', done: total, total, detail: '' });
  await expect(page.locator('#setup-text')).toHaveText('Speech models ready. Choose Start captions.');

  await act(page, 'start');
  await asr(page, { kind: 'state', state: 'listening', detail: 'Test mic' });
  await asr(page, { kind: 'final', text: 'ready to teach' });
  await expect(page.locator('#stage')).toHaveText('ready to teach');
});
