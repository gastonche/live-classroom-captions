// Tap-to-fix: the teacher taps a wrong word in the phone's preview and types the right spelling.
import { test, expect, type Page } from '@playwright/test';
import { closeAll, liveSession, say } from './helpers';

test.afterEach(closeAll);

/** Taps the last place `word` appears in the phone's preview, like a finger would. */
async function tapWord(phone: Page, word: string): Promise<void> {
  await phone.locator('#preview').scrollIntoViewIfNeeded();
  const at = await phone.evaluate((w) => {
    const walker = document.createTreeWalker(document.getElementById('preview')!, NodeFilter.SHOW_TEXT);
    let hit: { x: number; y: number } | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.lastIndexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + w.length);
      const b = r.getBoundingClientRect();
      hit = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return hit;
  }, word);
  expect(at, `"${word}" in the preview`).not.toBeNull();
  await phone.mouse.click(at!.x, at!.y);
}

async function editWords(phone: Page, edit: (text: string) => string): Promise<void> {
  const box = phone.locator('#words-box');
  if (!(await box.evaluate((d: HTMLDetailsElement) => d.open))) await box.locator('summary').click();
  await phone.locator('#words').fill(edit(await phone.locator('#words').inputValue()));
  await phone.locator('#words-save').click();
}

test('tap "bully", correct it to "boolean": new captions use it, and it is saved', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  // Act as if the built-in pack didn't know this one yet.
  await editWords(phone, (t) => t.split('\n').filter((l) => !/=> booleans?$/.test(l)).join('\n'));

  await say(phone, 'final', 'it returns a bully');
  await expect(phone.locator('#preview')).toHaveText('it returns a bully');
  // Position on the page, not in the viewport: scrolling to the preview is fine, moving it is not.
  const place = () =>
    phone.locator('#preview').evaluate((e) => {
      const r = e.getBoundingClientRect();
      return [r.top + scrollY, r.height, r.width];
    });
  const before = await place();

  await tapWord(phone, 'bully');
  const panel = phone.locator('#tapfix');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.wchip[aria-pressed="true"]')).toHaveText(['bully']);
  await expect(phone.locator('#tapfix-label')).toHaveText('Show instead of “bully”:');
  // The word chips are big enough for a thumb.
  expect((await panel.locator('.wchip').first().boundingBox())!.height).toBeGreaterThanOrEqual(48);
  // The preview itself didn't move or resize when the editor opened.
  expect(await place()).toEqual(before);

  await phone.locator('#tapfix-write').fill('boolean');
  await phone.locator('#tapfix-save').click();
  await expect(panel).toBeHidden();
  const hint = phone.locator('#tapfix-hint');
  await expect(hint).toHaveText('Saved: bully → boolean');
  // The confirmation doesn't cover the preview or move it, and goes back to the hint.
  expect(await place()).toEqual(before);
  const p = (await phone.locator('#preview').boundingBox())!;
  const h = (await hint.boundingBox())!;
  expect(h.y).toBeGreaterThanOrEqual(p.y + p.height);
  await expect(hint).toHaveText('Tap a wrong word in the preview to fix it.', { timeout: 5_000 });

  await say(phone, 'final', 'a bully value');
  await expect(tv.locator('#stage')).toHaveText('it returns a bully a boolean value');

  // The rule is in the Word list editor and survives a reload.
  await expect(phone.locator('#words')).toHaveValue(/^bully => boolean$/m);
  await phone.reload();
  await phone.locator('#words-box summary').click();
  await expect(phone.locator('#words')).toHaveValue(/^bully => boolean$/m);
  await phone.locator('#start').click();
  await say(phone, 'final', 'still a bully');
  await expect(phone.locator('#preview')).toHaveText('still a boolean');
});

test('a mishearing of two words: tap one, then the word beside it', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await say(phone, 'final', 'store it in a cash map please');
  await tapWord(phone, 'cash');
  await phone.locator('.wchip', { hasText: /^map$/ }).click();
  await expect(phone.locator('.wchip[aria-pressed="true"]')).toHaveText(['cash', 'map']);
  await expect(phone.locator('#tapfix-label')).toHaveText('Show instead of “cash map”:');
  // Tapping inside the selection starts again from that word.
  await phone.locator('.wchip', { hasText: /^cash$/ }).click();
  await expect(phone.locator('.wchip[aria-pressed="true"]')).toHaveText(['cash']);
  await phone.locator('.wchip', { hasText: /^map$/ }).click();
  await phone.locator('#tapfix-write').fill('hashmap');
  await phone.locator('#tapfix-write').press('Enter');
  await expect(phone.locator('#tapfix')).toBeHidden();
  await say(phone, 'final', 'a cash map again');
  await expect(tv.locator('#stage')).toContainText('a hashmap again');
});

test('captions keep flowing while the editor is open, and Cancel saves nothing', async ({ browser }) => {
  const { tv, phone } = await liveSession(browser);
  await say(phone, 'final', 'the jeep compiler');
  await tapWord(phone, 'jeep');
  await expect(phone.locator('#tapfix')).toBeVisible();
  await say(phone, 'final', 'more words while fixing');
  await expect(tv.locator('#stage')).toHaveText('the jeep compiler more words while fixing');
  await phone.locator('#tapfix-write').fill('JIT');
  await phone.locator('#tapfix-cancel').click();
  await expect(phone.locator('#tapfix')).toBeHidden();
  await say(phone, 'final', 'a jeep');
  await expect(tv.locator('#stage')).toContainText('more words while fixing a jeep');
});

test('French: the editor speaks French', async ({ browser }) => {
  const { phone } = await liveSession(browser);
  await phone.locator('details:has(#lang) summary').click();
  await phone.locator('#lang').selectOption('fr');
  await expect(phone.locator('#tapfix-hint')).toHaveText('Touchez un mot faux dans l’aperçu pour le corriger.');
  await say(phone, 'final', 'une valeur ouifi');
  await tapWord(phone, 'ouifi');
  await expect(phone.locator('#tapfix-label')).toHaveText('Afficher à la place de « ouifi » :');
  await expect(phone.locator('#tapfix-cancel')).toHaveText('Annuler');
  await phone.locator('#tapfix-write').fill('Wi-Fi');
  await phone.locator('#tapfix-save').click();
  await expect(phone.locator('#tapfix-hint')).toHaveText('Enregistré : ouifi → Wi-Fi');
  await say(phone, 'final', 'le ouifi marche');
  await expect(phone.locator('#preview')).toContainText('le Wi-Fi marche');
});
