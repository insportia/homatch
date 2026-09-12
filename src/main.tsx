import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import "./index.css";

Sentry.init({
  dsn: import.meta.env['VITE_SENTRY_DSN'] as string | undefined,
  environment: import.meta.env.MODE,
});

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p>应用发生错误，请刷新页面重试</p>}>
    <AppWrapper>
      <App />
    </AppWrapper>
  </Sentry.ErrorBoundary>
);

/*
 * The service worker is what makes the app installable and what lets an
 * installed Homatch open to something when the network is gone.
 *
 * Registered after `load` so it never competes with the first paint for
 * bandwidth, and only in a real browser build — a dev server serves the
 * unhashed module graph, so caching it would just serve yesterday's code
 * back to whoever is editing it.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unregistered worker costs installability, not correctness. The
      // app runs exactly as before, so this is not worth an error to the
      // customer.
    });
  });
}
