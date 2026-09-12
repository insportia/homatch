import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { Download, Share, Plus, X, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type InstallMode,
  canInstall, heldInstallPrompt, installedInThisTab, isIOSSafari, isStandalone,
  rememberMuted, resolveInstallMode, showInstallPrompt, wasMuted, watchInstall,
} from '@/lib/pwa';

/**
 * THE INSTALL CONTROL.
 *
 * Four genuinely different situations behind one button, because the
 * platforms genuinely differ:
 *
 *   native      Chromium handed us a `beforeinstallprompt`, which we hold and
 *               replay on the click. One tap, real native dialog.
 *   pending     Chromium CAN install but has not offered a prompt yet. The
 *               event fires late, and on a first visit it may not fire at all.
 *   ios-manual  iOS fires nothing and exposes no install API whatsoever.
 *               There is no button anyone can write that installs a PWA on
 *               iOS, so the click opens a sheet naming the Safari menu items.
 *   standalone  already installed. Offer nothing.
 *
 * WHY DISMISSING THE BROWSER DIALOG NO LONGER HIDES THIS
 *
 * It used to. Pressing Install and then changing your mind in Chrome's own
 * dialog called rememberDismissal(), and the control vanished for sixty days
 * — the single likeliest interaction was the one that destroyed the entry
 * point, and it looked like the button had broken itself.
 *
 * Closing a dialog means "not now". Only the explicit "don't show me this
 * again" in the iOS sheet mutes the control, and only for that period.
 *
 * WHY THE PROMPT IS NOT HELD HERE
 *
 * `beforeinstallprompt` fires once, at the window, early. A control that
 * registers its own listener on mount only sees it if it was already on
 * screen — and the control in the phone's menu is mounted when the menu is
 * OPENED, which is always afterwards. It held nothing, reported `pending`,
 * and offered the manual instructions instead: on a phone, one-tap install
 * was unreachable, and nothing said so.
 *
 * So lib/pwa.ts listens once for the page and every control reads from
 * there. See the note on that store.
 */
export function InstallApp({
  compact = false, tone = 'auto', variant = 'pill', className = '',
}: {
  /** Icon only. For a top bar that has run out of room. */
  compact?: boolean;
  /**
   * `dark` is for a control sitting on the black hero, where the default
   * foreground-on-transparent treatment is all but invisible until hover —
   * which is how this button used to look on the home page.
   */
  tone?: 'auto' | 'dark';
  /** `block` fills its container, for the mobile menu. */
  variant?: 'pill' | 'block';
  className?: string;
}) {
  const { t } = useLanguage();
  const [sheet, setSheet] = useState<null | 'ios' | 'pending'>(null);
  const [muted, setMuted] = useState(false);

  /*
   * Re-render when the page's install state changes, and read it fresh.
   *
   * Not a copy in state: a copy is what produced the bug in the header note.
   * There is one prompt, one "was it installed here", and every control on
   * the page is a view of them.
   */
  const [, restate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    // Also re-read on mount: everything below is computed from browser state
    // that the first render, before hydration, could not see.
    restate();
    return watchInstall(restate);
  }, []);

  const prompt = heldInstallPrompt();
  const justInstalled = installedInThisTab();
  const mode: InstallMode = resolveInstallMode({
    standalone: isStandalone(),
    hasNativePrompt: prompt !== null,
    iosSafari: isIOSSafari(),
    installable: canInstall(),
    muted: muted || wasMuted(),
  });

  const onClick = useCallback(async () => {
    if (mode === 'ios-manual') { setSheet('ios'); return; }
    // No prompt to replay: the honest answer is the browser's own menu.
    if (mode === 'pending' || !prompt) { setSheet('pending'); return; }
    /* The event is single-use — Chromium will not replay it. A dismissal is
       NOT a mute: the control stays, in its pending state, and explains
       itself if pressed again. */
    await showInstallPrompt();
  }, [mode, prompt]);

  if (mode === 'standalone') {
    /* Installed. Said once, quietly, rather than leaving a dead button. */
    if (!justInstalled) return null;
    return (
      <span
        className={`inline-flex min-h-[2.5rem] items-center gap-2 rounded-full px-3 text-sm font-medium ${
          tone === 'dark' ? 'text-white/80' : 'text-ink-soft'
        } ${className}`}
      >
        <Check className="h-4 w-4 shrink-0 text-[#12A06B]" strokeWidth={2.5} aria-hidden="true" />
        {!compact && t('pwa_installed')}
      </span>
    );
  }
  if (mode === 'unavailable') return null;

  /*
   * A FILLED CONTROL, NOT AN OUTLINE THAT APPEARS ON HOVER.
   *
   * On the black hero the old treatment was `border-foreground/20` over
   * transparent: a dark hairline on near-black, invisible until a hover
   * background revealed it. A control nobody can see is a control nobody
   * presses. Both tones now carry their own surface at rest, and hover
   * strengthens what is already there instead of introducing it.
   */
  const base = 'inline-flex items-center justify-center gap-2 font-semibold transition-colors '
    + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '
    + 'motion-reduce:transition-none';
  const shape = variant === 'block'
    ? 'w-full min-h-[3rem] rounded-[0.9rem] px-4 text-[17px]'
    : `min-h-[2.5rem] rounded-full text-sm ${compact ? 'w-10 px-0' : 'px-4'}`;
  const skin = tone === 'dark'
    ? 'bg-white/12 text-white ring-1 ring-inset ring-white/30 hover:bg-white/20 hover:ring-white/50'
    : 'bg-gold-soft text-gold-ink ring-1 ring-inset ring-gold/45 hover:bg-gold hover:text-[#0D0D0D] hover:ring-gold';

  return (
    <>
      <button
        type="button"
        onClick={() => { void onClick(); }}
        aria-label={t('pwa_install_aria')}
        className={`${base} ${shape} ${skin} ${className}`}
      >
        <Download className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
        {!compact && <span className="whitespace-nowrap">{t('pwa_install')}</span>}
      </button>

      {sheet && (
        <Sheet
          kind={sheet}
          onClose={() => setSheet(null)}
          onMute={() => { rememberMuted(); setSheet(null); setMuted(true); }}
        />
      )}
    </>
  );
}

/**
 * The explanation, for the two cases a click cannot resolve by itself.
 *
 * `ios` names the Safari menu items, because iOS has no install API at all.
 * `pending` is Chromium before it has offered a prompt: the honest answer is
 * that the browser's own menu can do it now, and the button will too once the
 * browser offers.
 */
function Sheet({
  kind, onClose, onMute,
}: { kind: 'ios' | 'pending'; onClose: () => void; onMute: () => void }) {
  const { t } = useLanguage();

  const steps = kind === 'ios'
    ? [
      { icon: Share, text: t('pwa_ios_step1') },
      { icon: Plus, text: t('pwa_ios_step2') },
      { icon: Download, text: t('pwa_ios_step3') },
    ]
    : [
      { icon: Download, text: t('pwa_pending_step1') },
      { icon: Plus, text: t('pwa_pending_step2') },
    ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[hsl(0_0%_0%/0.45)] p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={kind === 'ios' ? t('pwa_ios_title') : t('pwa_pending_title')}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-[1.25rem] bg-card p-6 shadow-xl sm:rounded-[1.25rem]"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-bold tracking-[-0.015em]">
            {kind === 'ios' ? t('pwa_ios_title') : t('pwa_pending_title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('pwa_close')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-base leading-relaxed text-ink-soft">
          {kind === 'ios' ? t('pwa_ios_lead') : t('pwa_pending_lead')}
        </p>

        <ol className="mt-5 space-y-3">
          {steps.map((step, i) => (
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

        {/* The ONLY thing that hides the control, and it says so. */}
        <button
          type="button"
          onClick={onMute}
          className="mt-6 min-h-[2.75rem] w-full rounded-full border border-border text-sm font-medium text-muted-foreground hover:bg-secondary"
        >
          {t('pwa_dismiss')}
        </button>
      </div>
    </div>
  );
}
