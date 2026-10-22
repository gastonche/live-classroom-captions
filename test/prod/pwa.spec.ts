import { test, expect } from '@playwright/test';

test('manifest is installable: name, standalone, start_url at /speak, maskable icon', async ({ request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.name).toBe('Live Classroom Captions');
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('./speak/');
  expect(m.theme_color).toBe('#0b0b0c');
  expect(m.icons.some((i: any) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
  for (const i of m.icons) expect((await request.get('/' + i.src)).ok()).toBe(true);
});

test('after one visit, every page opens offline (app shell from the service worker)', async ({ page, context }) => {
  await page.goto('/speak/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  for (const path of ['/speak/?room=K7PX', '/show/', '/view/', '/']) {
    await page.goto(path);
    await expect(page.locator('body')).not.toBeEmpty();
  }
  await page.goto('/speak/');
  await expect(page.locator('#join h1')).toHaveText('Enter the code shown on the screen');
  await page.goto('/show/');
  await expect(page.locator('.label')).toHaveText('Room code');
  await context.setOffline(false);
});

test('repeat load is interactive in under 500 ms', async ({ page }) => {
  await page.goto('/speak/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.reload();
    times.push(await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).domInteractive));
  }
  times.sort((a, b) => a - b);
  console.log('repeat-load domInteractive ms', JSON.stringify(times));
  expect(times[2]).toBeLessThan(500);
});

test('a new build replaces the old cache (versioned cache names)', async ({ page }) => {
  await page.goto('/speak/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const keys = await page.evaluate(() => caches.keys());
  expect(keys.filter((k) => k.startsWith('lcc-shell-'))).toHaveLength(1);
  const sw = await (await page.request.get('/sw.js')).text();
  expect(sw).toMatch(/const VERSION = '[0-9a-f]{12}'/);
  expect(sw).not.toContain('models/');
});

test('an update reloads an idle page into the new version', async ({ browser }) => {
  // A real release, simulated: serve a copy of dist/, then rewrite its sw.js on disk.
  const { cpSync, mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
  const { createServer } = await import('node:http');
  const { join, extname } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'lcc-dist-'));
  cpSync('dist', dir, { recursive: true });
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.mp4': 'video/mp4' };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const body = readFileSync(join(dir, p));
      res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(4175, '127.0.0.1', r));
  const base = 'http://127.0.0.1:4175';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(base + '/show/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    const release = (v: string) => {
      const sw = readFileSync(join(dir, 'sw.js'), 'utf8').replace(/const VERSION = '([0-9a-f]+)'/, `const VERSION = '${v}'`);
      writeFileSync(join(dir, 'sw.js'), sw);
    };
    const update = () => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r!.update()));

    // Idle screen: reloads into the new version by itself.
    release('feedfacecafe');
    await page.evaluate(() => ((window as any).__marker = 1));
    const reloaded = page.waitForEvent('load');
    await update();
    await reloaded;
    expect(await page.evaluate(() => (window as any).__marker)).toBeUndefined();
    expect(await page.evaluate(() => caches.keys())).toEqual(['lcc-shell-feedfacecafe']);
  } finally {
    await ctx.close();
    server.close();
  }
});
