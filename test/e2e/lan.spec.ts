// Student phones on the school Wi-Fi: the desktop app serves /lan/ and pushes captions over
// a WebSocket (src-tauri/src/lan.rs, tested in Rust). Here the app's page runs in a browser
// in Wi-Fi mode (?lan=), and the WebSocket server is played by Playwright, carrying exactly
// what the app's page hands to the server.
import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { closeAll, device } from './helpers';

test.afterEach(closeAll);

const URL = 'http://10.0.0.5:47213/';
const act = (p: Page, id: string) => p.evaluate((id) => (window as any).__overlayAction(id), id);
const asr = (p: Page, e: object) => p.evaluate((e) => (window as any).__asr(e), e);
const out = (p: Page) => p.evaluate(() => (window as any).__lanOut as { sent: string[]; snapshot: string });

async function openApp(browser: import('@playwright/test').Browser) {
  const page = await device(browser);
  await page.goto(`/overlay/?lan=${encodeURIComponent(URL)}`);
  await expect(page.locator('#card')).toBeVisible({ timeout: 15_000 });
  return page;
}

/** A phone on the Wi-Fi; `server` gets each connection the page opens. */
async function openPhone(browser: import('@playwright/test').Browser, server: (ws: WebSocketRoute) => void) {
  const phone = await device(browser);
  await phone.routeWebSocket(/\/ws$/, server);
  await phone.goto('/lan/');
  return phone;
}

test('the app shows the Wi-Fi address and QR, with no internet room', async ({ browser }) => {
  const page = await openApp(browser);
  await expect(page.locator('#card-label')).toHaveText('On this Wi-Fi, open');
  await expect(page.locator('#code')).toHaveText('10.0.0.5:47213');
  await expect(page.locator('#qr')).toBeVisible();
  await expect(page.locator('#card-hint')).toHaveText('Students: join this Wi-Fi, then scan to follow on your phone.');
});

test('captions reach a phone, and a phone joining late gets the lesson so far', async ({ browser }) => {
  const page = await openApp(browser);
  await act(page, 'start');
  await asr(page, { kind: 'state', state: 'listening', detail: 'Test mic' });
  await asr(page, { kind: 'final', text: 'first we open the terminal' });
  await expect.poll(async () => (await out(page)).snapshot).toContain('first we open the terminal');

  // Late phone: the server hands it the snapshot, then forwards live messages.
  const snapshot = (await out(page)).snapshot;
  let send: (m: string) => void = () => {};
  const phone = await openPhone(browser, (ws) => {
    ws.send(snapshot);
    send = (m) => ws.send(m);
  });
  await expect(phone.locator('#transcript')).toHaveText('first we open the terminal');
  await expect(phone.locator('#state')).toBeHidden();

  const before = (await out(page)).sent.length;
  await asr(page, { kind: 'interim', text: 'then a bully' });
  await asr(page, { kind: 'final', text: 'then we check the bully' });
  await expect.poll(async () => (await out(page)).sent.length).toBeGreaterThan(before + 1);
  for (const m of (await out(page)).sent.slice(before)) send(m);
  await expect(phone.locator('#transcript')).toHaveText('first we open the terminal then we check the boolean');

  await act(page, 'pause');
  for (const m of (await out(page)).sent.slice(-1)) send(m);
  await expect(phone.locator('#state')).toHaveText('Captions paused');
});

test('a phone reconnects by itself when the laptop drops it, without repeating words', async ({ browser }) => {
  const page = await openApp(browser);
  await act(page, 'start');
  await asr(page, { kind: 'state', state: 'listening', detail: 'Test mic' });
  await asr(page, { kind: 'final', text: 'hello class' });
  await expect.poll(async () => (await out(page)).snapshot).toContain('hello class');

  let connections = 0;
  let current: WebSocketRoute | null = null;
  const phone = await openPhone(browser, async (ws) => {
    connections++;
    current = ws;
    ws.send((await out(page)).snapshot);
  });
  await expect(phone.locator('#transcript')).toHaveText('hello class');
  await current!.close();
  await expect(phone.locator('#state')).toHaveText('Connecting…');
  await expect.poll(() => connections, { timeout: 10_000 }).toBe(2);
  await expect(phone.locator('#state')).toBeHidden();
  await expect(phone.locator('#transcript')).toHaveText('hello class');
});
