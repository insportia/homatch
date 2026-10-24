/*
 * Tells the service worker which language the site is open in, so a push it
 * draws later reads in that language rather than the server's stored English
 * (owner 2026-10-24). The worker keeps the last language it was told; with no
 * worker (dev, an unsupported browser) this does nothing.
 */
export function tellServiceWorkerLanguage(lang: string): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const message = { type: 'HOMATCH_LANG', lang };
    navigator.serviceWorker.controller?.postMessage(message);
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(message)).catch(() => {});
  } catch {
    /* A language that cannot be passed on still renders on the page. */
  }
}
