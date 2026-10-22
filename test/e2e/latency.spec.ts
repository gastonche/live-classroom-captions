// Transport latency harness: timestamps each caption at send (phone) and at render (display),
// same machine, same clock. Phase 1 target: median under 300 ms for transport alone.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIGNAL = 'signal=' + encodeURIComponent('http://127.0.0.1:9123/lcc');
const N = 100;

test('transport latency, phone to display', async ({ browser }, info) => {
  const tvCtx = await browser.newContext();
  const phoneCtx = await browser.newContext();
  const tv = await tvCtx.newPage();
  await tv.goto(`/show/?${SIGNAL}`);
  await expect(tv.locator('#code')).toHaveText(/^[A-Z2-9]{4}$/, { timeout: 15_000 });
  const code = (await tv.locator('#code').textContent())!;

  const phone = await phoneCtx.newPage();
  await phone.goto(`/speak/?room=${code}&engine=fake&${SIGNAL}`);
  await expect(phone.locator('#chip-tv')).toHaveAttribute('data-s', 'ok', { timeout: 15_000 });
  await phone.locator('#start').click();
  await expect(tv.locator('#live')).toBeVisible();

  // Record when each "m<N>" token first appears on the display.
  await tv.evaluate(() => {
    const seen: Record<string, number> = {};
    (window as any).__seen = seen;
    new MutationObserver(() => {
      const t = performance.timeOrigin + performance.now();
      const m = document.getElementById('stage')!.textContent!.match(/m\d+/g) || [];
      for (const k of m) if (!(k in seen)) seen[k] = t;
    }).observe(document.getElementById('stage')!, { childList: true, subtree: true, characterData: true });
  });

  const sent: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const k = 'm' + i;
    sent[k] = await phone.evaluate((k) => {
      const t = performance.timeOrigin + performance.now();
      (window as any).__lcc.caption('f', k);
      return t;
    }, k);
    await phone.waitForTimeout(20); // about 50 captions/s: far more than speech produces
  }
  await expect.poll(() => tv.evaluate(() => Object.keys((window as any).__seen).length), { timeout: 10_000 }).toBe(N);
  const seen: Record<string, number> = await tv.evaluate(() => (window as any).__seen);

  const lat = Object.keys(sent)
    .map((k) => seen[k] - sent[k])
    .sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
  const result = {
    browser: info.project.name,
    n: lat.length,
    medianMs: +pct(50).toFixed(2),
    p95Ms: +pct(95).toFixed(2),
    maxMs: +lat[lat.length - 1].toFixed(2),
  };
  console.log('latency', JSON.stringify(result));
  info.annotations.push({ type: 'latency', description: JSON.stringify(result) });
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/latency-${info.project.name}.json`, JSON.stringify(result, null, 2));

  expect(result.medianMs).toBeLessThan(300);
  expect(result.p95Ms).toBeLessThan(1500);
  await tvCtx.close();
  await phoneCtx.close();
});
