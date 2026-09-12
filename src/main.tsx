import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import "./index.css";

Sentry.init({
  dsn: import.meta.env['VITE_SENTRY_DSN'] as string | undefined,
  environment: import.meta.env.MODE,
});

/*
 * The service worker is what makes the app installable and what lets an
 * installed Homatch open to something when the network is gone.
 *
 * REGISTERED BEFORE THE APP MOUNTS, NOT AFTER.
 *
 * This used to sit below createRoot().render(), so anything that threw
 * on the way to rendering took installability with it. That is not
 * hypothetical: a build without Supabase credentials throws
 * "supabaseUrl is required" while this module is still executing, and
 * the registration line below was simply never reached — no worker, no
 * install prompt, no offline shell, and nothing in the UI to suggest
 * why. Registration has no dependency on the app, so it should not
 * have a dependency on the app succeeding.
 *
 * And it no longer waits for an event that may already have happened.
 * `load` fires once; a listener attached after it has fired never runs.
 * Deferring to an idle callback keeps the original intent — never
 * compete with the first paint for bandwidth — without the race.
 *
 * Only in a real browser build: a dev server serves the unhashed module
 * graph, so caching it would serve yesterday's code back to whoever is
 * editing it.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const register = () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unregistered worker costs installability, not correctness. The
      // app runs exactly as before, so this is not worth an error to the
      // customer.
    });
  };
  // requestIdleCallback is absent in Safari before 16.4, where a short
  // timeout is the honest equivalent rather than a polyfill. Read off the
  // window rather than tested with `in`, which narrows the else branch to
  // `never` and takes setTimeout with it.
  const idle = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (idle) idle(register, { timeout: 3000 });
  else window.setTimeout(register, 1200);
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p>应用发生错误，请刷新页面重试</p>}>
    <AppWrapper>
      <App />
    </AppWrapper>
  </Sentry.ErrorBoundary>
);
