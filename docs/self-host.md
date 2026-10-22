# Host your own copy (free)

Everything runs on free services. You need a GitHub account, and nothing else.

## 1. Publish the web app on GitHub Pages

1. **Fork** this repository on GitHub (top right, *Fork*).
2. In your fork: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions** tab → *Deploy to GitHub Pages* → **Run workflow** (it also runs on every push to `main`).
4. After about two minutes your address appears under **Settings → Pages**, for example
   `https://your-name.github.io/live-classroom-captions/`.

Your teachers open:
- `…/speak/` on their phone,
- `…/show/` on a TV or projector browser (or install the Mac captions app),
- `…/view/` on student phones.

**Custom domain (optional):** a short address like `captions.yourschool.org` is much easier to type
on a TV remote. Add it under *Settings → Pages → Custom domain*, and point a `CNAME` DNS record at
`your-name.github.io`.

## 2. Build the Mac captions app for your address

The app needs to know your web address for its QR code. Releases from the original project point
at the original address. For your own:

```bash
npm install
VITE_WEB_URL=https://your-name.github.io/live-classroom-captions/ npm run build
npx tauri build --bundles app      # needs Rust: https://rustup.rs
```

The app is at `src-tauri/target/release/bundle/macos/Captions.app`.

## 3. Optional: your own signalling server

Phones and screens find each other through the free public PeerJS server (`0.peerjs.com`).
Only the introduction goes through it. Captions then travel directly between devices.
If it's down or blocked on your network, run your own:

```bash
npx peer --port 9000 --path /
```

Put it behind HTTPS (for example with a Cloudflare tunnel or a reverse proxy), then change
`SIGNAL` in `src/config.ts` to your server's host, port and path, and rebuild.

To try a server without rebuilding, add `?signal=https://your-server.example/` to the web
addresses. This is meant for testing.

## Keeping up to date

On your fork's GitHub page, click **Sync fork** now and then. Pages redeploys automatically.
Teachers' phones pick up the new version the next time they open the app (never during a live class).
