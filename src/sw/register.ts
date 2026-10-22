// Registers the service worker in production builds only (the dev server changes too often).
// `root` is the path from the current page to the site root, e.g. '../' from /speak/.
// When an update takes over, the page reloads into it, but never while `busy()` says
// captions are live; then it waits until they aren't.
export function registerSW(root: string, busy: () => boolean = () => false): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // The very first install also takes control; that's not an update, so don't reload for it.
  const hadController = !!sw.controller;
  let pending = false;
  sw.addEventListener('controllerchange', () => {
    if (!hadController) return;
    pending = true;
    reloadWhenIdle();
  });
  function reloadWhenIdle(): void {
    if (!pending) return;
    if (busy()) setTimeout(reloadWhenIdle, 5000);
    else location.reload();
  }
  const url = new URL(root + 'sw.js', location.href);
  sw.register(url.href, { scope: new URL(root, location.href).href })
    .then((reg) => {
      // Check for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {
      /* No offline mode this time. The app still works online. */
    });
}
