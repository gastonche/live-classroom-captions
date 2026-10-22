// Diagnostic only (always passes): which ICE candidates does this browser gather with no
// STUN/TURN? Explains CI environments where two pages can't connect over WebRTC.
import { test } from '@playwright/test';

test('ICE candidates gathered locally (diagnostic)', async ({ page, browserName }) => {
  await page.goto('/');
  const out = await page.evaluate(async () => {
    const a = new RTCPeerConnection({ iceServers: [] });
    a.createDataChannel('x');
    const cands: string[] = [];
    a.onicecandidate = (e) => e.candidate && cands.push(e.candidate.candidate.split(' ').slice(4, 8).join(' '));
    await a.setLocalDescription(await a.createOffer());
    await new Promise((r) => setTimeout(r, 2500));
    a.close();
    return cands;
  });
  const kinds = out.map((c) => (/\.local /.test(c) ? 'mdns' : /^(127\.|::1)/.test(c) ? 'loopback' : 'ip')).join(',');
  console.log(`ICE ${browserName}: ${out.length} candidates [${kinds}] ${JSON.stringify(out)}`);
});
