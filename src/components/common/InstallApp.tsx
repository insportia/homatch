import React, { useCallback, useEffect, useState } from 'react';
import { Download, Share, Plus, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type BeforeInstallPromptEvent, type InstallMode,
  isIOSSafari, isStandalone, rememberDismissal, resolveInstallMode, wasDismissed,
} from '@/lib/pwa';

/**
 * THE INSTALL CONTROL.
 *
 * Two genuinely different affordances behind one button, because the two
 * platforms genuinely differ:
 *
 *   Chromium  fires `beforeinstallprompt`, which we hold and replay on the
 *             click. One tap, real native dialog.
 *   iOS       fires nothing and exposes no install API at all. There is no
 *             button anyone can write that installs a PWA on iOS. So the
 *             click opens a short sheet naming the Safari menu items to
 *             tap, instead of a button that would silently do nothing.
 *
 * Renders NOTHING when already installed, when the browser can do neither,
 * or when the customer said no recently. An install prompt that reappears on
 * every visit is how people learn to dismiss things without reading them.
 */
export function InstallApp({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<InstallMode>('unavailable');
  const [sheetOpen, setSheetOpen] = useState(false);

  const recompute = useCallback((held: BeforeInstallPromptEvent | null) => {
    setMode(resolveInstallMode({
      standalone: isStandalone(),
      hasNativePrompt: held !== null,
      iosSafari: isIOSSafari(),
      dismissed: wasDismissed(),
    }));
  }, []);

  useEffect(() => {
    recompute(null);

    const onBeforeInstall = (e: Event) => {
      // Chromium shows its own mini-infobar unless this is prevented; we
      // want the prompt to happen on OUR button, in context.
      e.preventDefault();
      const held = e as BeforeInstallPromptEvent;
      setPrompt(held);
      recompute(held);
    };
    // Fired after a successful install, in the tab that triggered it.
    const onInstalled = () => { setPrompt(null); setMode('standalone'); };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [recompute]);

  const onClick = useCallback(async () => {
    if (mode === 'ios-manual') { setSheetOpen(true); return; }
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // The event is single-use: Chromium will not let it be replayed.
    setPrompt(null);
    if (outcome === 'dismissed') rememberDismissal();
    recompute(null);
  }, [mode, prompt, recompute]);

  if (mode === 'standalone' || mode === 'unavailable') return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { void onClick(); }}
        aria-label={t('pwa_install_aria')}
        className={
          'inline-flex min-h-[44px] items-center gap-2 rounded-full border border-foreground/20 '
          + 'px-4 text-sm font-semibold text-foreground transition-colors hover:border-gold '
          + 'hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
          + 'focus-visible:ring-offset-2'
        }
      >
        <Download className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        {!compact && <span className="whitespace-nowrap">{t('pwa_install')}</span>}
      </button>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-[hsl(0_0%_0%/0.45)] p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t('pwa_ios_title')}
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-[1.25rem] bg-card p-6 shadow-xl sm:rounded-[1.25rem]"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-xl font-bold tracking-[-0.015em]">{t('pwa_ios_title')}</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label={t('pwa_close')}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-base leading-relaxed text-ink-soft">{t('pwa_ios_lead')}</p>

            <ol className="mt-5 space-y-3">
              {[
                { icon: Share, text: t('pwa_ios_step1') },
                { icon: Plus, text: t('pwa_ios_step2') },
                { icon: Download, text: t('pwa_ios_step3') },
              ].map((step, i) => (
                <li key={step.text} className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[0.7rem] border border-border bg-secondary">
                    <step.icon className="h-[18px] w-[18px] text-foreground" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 text-base leading-snug">
                    <span className="me-1.5 font-semibold text-muted-foreground">{i + 1}.</span>
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() => { rememberDismissal(); setSheetOpen(false); setMode('unavailable'); }}
              className="mt-6 min-h-[44px] w-full rounded-full border border-border text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              {t('pwa_dismiss')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
