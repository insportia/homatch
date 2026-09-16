import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, Plus, X, Check, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { recordPwaEvent } from '@/lib/engagement';
import {
  type InstallMode,
  awaitInstallPrompt, isCheckingInstall,
  canInstall, heldInstallPrompt, installedInThisTab, isIOSSafari, isIOSOtherBrowser,
  isIPad, isStandalone,
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
/**
 * THE PAGE'S INSTALL STATE, FOR ANYONE WHO NEEDS TO LAY OUT AROUND IT.
 *
 * The control renders nothing at all in three of its states — unsupported
 * browser, already running as the app, and muted by an explicit "don't show
 * me this again". A caller that reserves room for it anyway draws a hole:
 * the mobile utility strip rendered its divider and a flex-1 gap beside the
 * language chip, so somebody who had once dismissed the sheet saw a wide
 * empty rectangle where the button used to be.
 *
 * So the state is readable BEFORE the control is rendered, from the same
 * store the control itself reads. One source, so the strip and the button
 * cannot disagree about whether there is anything to show.
 */
export function useInstallMode(): InstallMode {
  const [, restate] = useReducer((n: number) => n + 1, 0);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    restate();
    return watchInstall(restate);
  }, []);
  // Kept so a mute performed in one control collapses the other immediately.
  useEffect(() => {
    const id = window.setInterval(() => setMuted(wasMuted()), 2000);
    return () => window.clearInterval(id);
  }, []);
  return resolveInstallMode({
    standalone: isStandalone(),
    hasNativePrompt: heldInstallPrompt() !== null,
    iosSafari: isIOSSafari(),
    iosOther: isIOSOtherBrowser(),
    installable: canInstall(),
    muted: muted || wasMuted(),
    installed: installedInThisTab(),
  });
}

/**
 * Is there an app affordance worth giving room to?
 *
 * True for every state except the one browser that genuinely cannot install
 * a web app. That is a deliberate widening: it used to exclude `standalone`
 * and the dismissed state too, and those are the two cases the owner kept
 * finding — open Homatch as an installed app, or press "not now" once, and
 * the application row simply stopped existing.
 *
 * Standalone and dismissed now render a compact app chip instead of nothing,
 * so the strip has the same shape in every state a person will actually be
 * in. `unsupported` still renders nothing, because a control that cannot do
 * its job is worse than an absence.
 */
export function hasInstallAction(mode: InstallMode): boolean {
  return mode !== 'unsupported';
}

export function InstallApp({
  compact = false, tone = 'auto', variant = 'pill', className = '', source = 'header',
}: {
  /** Which surface offered it, so the funnel can say where installs come from. */
  source?: string;
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
  const [sheet, setSheet] = useState<null | 'ios' | 'pending' | 'ios-browser'>(null);
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

  /*
   * The CHECKING window closes on a clock, not on an event, so nothing would
   * otherwise re-render when it expires and the label would stay "Preparing"
   * on a browser that has finished deciding. One second is far finer than a
   * person notices and stops as soon as the answer is known.
   */
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const checking = isCheckingInstall();
  useEffect(() => {
    if (!checking) return undefined;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [checking]);

  const prompt = heldInstallPrompt();
  const justInstalled = installedInThisTab();
  const mode: InstallMode = resolveInstallMode({
    standalone: isStandalone(),
    hasNativePrompt: prompt !== null,
    iosSafari: isIOSSafari(),
    iosOther: isIOSOtherBrowser(),
    installable: canInstall(),
    muted: muted || wasMuted(),
    installed: justInstalled,
  });

  /*
   * WHAT WAS OFFERED, AND ON WHICH SURFACE.
   *
   * Once per mode per surface per page view — `recordPwaEvent` de-duplicates
   * on that key — so a re-render is not a second impression and the funnel's
   * denominator means what it says. A browser holding a native prompt is
   * recorded separately: the gap between "could install in one tap" and
   * "tapped" is the number worth knowing.
   */
  useEffect(() => {
    if (mode === 'unsupported') return;
    void recordPwaEvent('PWA_AFFORDANCE_VIEWED', 'DETECTED', { source: `${source}:${mode}` });
    if (mode === 'standalone') return;
    if (prompt !== null) {
      void recordPwaEvent('PWA_NATIVE_PROMPT_AVAILABLE', 'DETECTED', { source });
    }
  }, [mode, prompt, source]);

  const onClick = useCallback(async () => {
    void recordPwaEvent('PWA_INSTALL_CLICKED', 'CONFIRMED', { source: `${source}:${mode}`, once: false });

    /*
     * INSTALLED, AND THE HONEST NEXT ACTION.
     *
     * No browser lets a page launch an installed app on demand — and faking
     * it, by showing a spinner and doing nothing, is worse than saying what
     * is true. So the control becomes a door: opening the app's own scope.
     * Where the platform honours installed scope this lands in the app
     * window; where it does not, it is a new tab, which is a real thing that
     * really happened rather than a pretend launch.
     */
    if (mode === 'installed') {
      window.open(window.location.origin, '_blank', 'noopener');
      return;
    }
    if (mode === 'ios-browser') {
      /* Not an install, and not pretending to be. The only thing this browser
         can contribute is getting the person to the one that can. */
      void recordPwaEvent('PWA_IOS_INSTRUCTIONS_SHOWN', 'CONFIRMED', { source: `${source}:browser` });
      setSheet('ios-browser');
      return;
    }
    if (mode === 'ios-manual') {
      /* The end of the road for measurement: iOS installs happen in the Share
         menu, which no page can observe. The funnel records that the
         instructions were shown and stops claiming anything after it. */
      void recordPwaEvent('PWA_IOS_INSTRUCTIONS_SHOWN', 'CONFIRMED', { source });
      setSheet('ios');
      return;
    }
    /*
     * ── NOT YET IS NOT THE SAME AS NEVER ──────────────────────────────
     *
     * Measured on the deployed site in a real Chrome: beforeinstallprompt
     * lands about four seconds after load. Pressing Install before then used
     * to open a page of instructions -- on a browser that was about to offer
     * a one-tap install, and whose prompt then sat captured and unused.
     *
     * So a pending press WAITS for it, briefly, instead of concluding. The
     * window is inside Chromium's five-second transient activation, because
     * prompt() needs the gesture that is being spent right now; longer would
     * buy an event we are no longer allowed to use.
     *
     * The instructions remain the answer when nothing arrives -- which is
     * what a browser that genuinely will not offer looks like from here.
     */
    if (mode === 'pending' || !prompt) {
      const arrived = await awaitInstallPrompt();
      if (!arrived) { setSheet('pending'); return; }
    }
    /* The event is single-use — Chromium will not replay it. A dismissal is
       NOT a mute: the control stays, in its pending state, and explains
       itself if pressed again. */
    void recordPwaEvent('PWA_NATIVE_PROMPT_SHOWN', 'CONFIRMED', { source, once: false });
    /* Reads the store rather than the `prompt` captured when this callback
       was created: in the pending case it arrived after that. */
    const outcome = await showInstallPrompt();
    /* The browser's OWN answer, which is the only CONFIRMED install signal
       that exists outside `appinstalled`. A click is not an install and is
       never recorded as one. */
    if (outcome === 'accepted') {
      void recordPwaEvent('PWA_NATIVE_PROMPT_ACCEPTED', 'CONFIRMED', { source, once: false });
    } else if (outcome === 'dismissed') {
      void recordPwaEvent('PWA_NATIVE_PROMPT_DISMISSED', 'CONFIRMED', { source, once: false });
    }
  }, [mode, prompt, source]);

  /*
   * ── THE STATES THAT USED TO RENDER NOTHING ──────────────────────────
   *
   * `standalone` — Homatch is ALREADY the app you are looking at. Offering
   * to install it would be absurd, and rendering nothing left a hole where
   * the application row was. So: a compact, non-interactive identity chip.
   * It does not claim the browser can launch anything, because in standalone
   * there is nothing to launch: you are there.
   *
   * `dismissed` — somebody pressed "not now". That is not "never", and it is
   * not a reason to delete the entry point: the same quiet chip, pressable,
   * opening the explanation sheet rather than the browser's own prompt. It
   * cannot nag, because it never raises a native dialog by itself.
   *
   * `unsupported` — the browser cannot install web apps at all. This is the
   * one case where nothing is the honest answer.
   */
  if (mode === 'unsupported') return null;

  if (mode === 'standalone' || mode === 'dismissed') {
    const quiet = tone === 'dark'
      ? 'bg-white/[0.08] text-white/85 ring-1 ring-inset ring-white/20'
      : 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border';
    const chip = 'inline-flex items-center justify-center gap-2 font-medium transition-colors '
      + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
      + `motion-reduce:transition-none ${variant === 'block'
        ? 'w-full min-h-[3rem] rounded-[0.9rem] px-4 text-[17px]'
        : `min-h-[2.5rem] rounded-full text-sm ${compact ? 'w-10 px-0' : 'px-3.5'}`}`;

    if (mode === 'standalone') {
      return (
        <span className={`${chip} ${quiet} ${className}`} aria-label={t('pwa_ready')}>
          <Check className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {!compact && <span className="min-w-0 truncate">{t('pwa_installed')}</span>}
        </span>
      );
    }

    return (
      <>
        <button
          type="button"
          /*
           * QUIET IS NOT DISABLED.
           *
           * The mute makes this a chip instead of a button, which is what
           * somebody who pressed "not now" asked for. It must not also cost
           * them the real install: pressing the chip on a browser that is
           * holding a prompt used to open Add to Home Screen instructions
           * while the actual dialog sat captured and unused.
           *
           * Pressing is asking. Asking gets the browser's own dialog.
           *
           * Three fallbacks, not two -- the pending sheet explains a browser
           * menu that on iOS Chrome does not contain the item.
           */
          onClick={() => {
            void (async () => {
              if (heldInstallPrompt()) {
                void recordPwaEvent('PWA_NATIVE_PROMPT_SHOWN', 'CONFIRMED', { source, once: false });
                const outcome = await showInstallPrompt();
                if (outcome !== 'unavailable') return;
              }
              setSheet(isIOSSafari() ? 'ios' : isIOSOtherBrowser() ? 'ios-browser' : 'pending');
            })();
          }}
          aria-label={t('pwa_install_aria')}
          className={`${chip} ${quiet} ${className}`}
        >
          <Download className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {!compact && <span className="min-w-0 truncate">{t('pwa_install')}</span>}
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
    /* bg-white/[0.12], not bg-white/12. Tailwind's opacity scale goes in
       fives, so `/12` names no rule at all and silently generates nothing:
       this button has been fully transparent on every dark surface it has
       ever appeared on — the exact "invisible until hover" it was supposed
       to have fixed. An arbitrary value keeps the intended 12%. */
    ? 'bg-white/[0.12] text-white ring-1 ring-inset ring-white/30 hover:bg-white/20 hover:ring-white/50'
    : 'bg-gold-soft text-gold-ink ring-1 ring-inset ring-gold/45 hover:bg-gold hover:text-[#0D0D0D] hover:ring-gold';

  return (
    <>
      <button
        type="button"
        onClick={() => { void onClick(); }}
        aria-label={mode === 'installed' ? t('pwa_open_aria') : t('pwa_install_aria')}
        className={`${base} ${shape} ${skin} ${className}`}
      >
        {mode === 'installed'
          ? <ExternalLink className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          : <Download className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />}
        {!compact && (
          <span className="min-w-0 truncate">
            {/*
              * THE CONTROL SAYS WHAT IT KNOWS.
              *
              * While the browser is still deciding, this used to read
              * "Install App" and then hand over Add to Home Screen
              * instructions -- a label that promised something the control
              * could not yet do. Naming the state instead costs a few
              * seconds of a quieter word and never misdescribes what a press
              * will produce.
              */}
            {mode === 'installed' ? t('pwa_open')
              : (mode === 'pending' && checking) ? t('pwa_preparing')
                : t('pwa_install')}
          </span>
        )}
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
}: { kind: 'ios' | 'pending' | 'ios-browser'; onClose: () => void; onMute: () => void }) {
  const { t } = useLanguage();

  /*
   * THE PAGE BEHIND DOES NOT SCROLL WHILE THIS IS OPEN.
   *
   * On iOS a drag that begins on the overlay scrolls the document, and
   * scrolling the document is what moves the address bar -- which resizes
   * the visual viewport underneath a sheet the person is in the middle of
   * reading. `overscroll-behavior` on the panel stops a flick that STARTS
   * inside it; this stops one that starts anywhere else.
   *
   * Restored exactly, including an inline overflow the page may have set
   * for itself, rather than assumed to have been the default.
   */
  useEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = previous; };
  }, []);

  /*
   * ESCAPE CLOSES IT.
   *
   * It is a real modal -- aria-modal, a backdrop, focus over the page -- and
   * a modal a keyboard cannot dismiss is a trap. Cheap, and the only thing
   * standing between somebody and the page when a pointer is not available.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const steps = kind === 'ios'
    ? [
      /*
       * Safari puts Share in the BOTTOM toolbar on iPhone and the TOP RIGHT
       * on iPad. One sentence, and getting it wrong sends an iPad owner to a
       * toolbar that does not contain the control -- from which the only
       * available conclusion is that the feature does not exist.
       *
       * This is the whole of the difference: the modal, its wording and its
       * three steps are otherwise exactly as they were.
       */
      { icon: Share, text: isIPad() ? t('pwa_ios_step1_ipad') : t('pwa_ios_step1') },
      { icon: Plus, text: t('pwa_ios_step2') },
      { icon: Download, text: t('pwa_ios_step3') },
    ]
    : kind === 'ios-browser'
      ? [
        { icon: Share, text: t('pwa_iosbrowser_step1') },
        { icon: Download, text: t('pwa_iosbrowser_step2') },
      ]
      : [
        { icon: Download, text: t('pwa_pending_step1') },
        { icon: Plus, text: t('pwa_pending_step2') },
      ];

  const title = kind === 'ios' ? t('pwa_ios_title')
    : kind === 'ios-browser' ? t('pwa_iosbrowser_title')
      : t('pwa_pending_title');
  const lead = kind === 'ios' ? t('pwa_ios_lead')
    : kind === 'ios-browser' ? t('pwa_iosbrowser_lead')
      : t('pwa_pending_lead');

  /*
   * ── RENDERED AT THE BODY, NOT WHERE IT WAS DECLARED ───────────────────
   *
   * This control appears in the header, on the hero, and inside the mobile
   * menu. The sheet used to render as a sibling of whichever button opened
   * it, which means it inherited that button's ancestors -- and three
   * ordinary ancestors each break a fixed overlay in a different way:
   *
   *   display:none   a collapsed mobile menu. The sheet mounts with no box
   *                  at all, so the instructions exist and are 0px tall.
   *   transform      ANY transformed ancestor becomes the containing block
   *                  for `position: fixed`. The overlay then measures that
   *                  element instead of the viewport, which is the classic
   *                  way a modal ends up off-screen on iOS -- and no amount
   *                  of dvh arithmetic can correct it, because the box it is
   *                  being sized against is the wrong box.
   *   overflow       clips it.
   *
   * A portal to the body has none of those ancestors, by construction. It
   * also puts the overlay at the end of the document, so its stacking
   * context is the page's rather than a header's.
   */
  return createPortal((
    <div
      /*
       * `viewport-sheet` sets the height from the DYNAMIC viewport. Without
       * it, `inset-0` alone measures the layout viewport -- taller than the
       * visible one on iOS whenever the browser chrome is showing -- and
       * `items-end` then aligns the panel to the bottom of a box whose top
       * is above the screen. That is what clipped these instructions down to
       * their last step.
       *
       * `top-0 left-0 right-0` rather than `inset-0`, because a `bottom: 0`
       * would reintroduce the layout-viewport height the class just replaced.
       */
      className="viewport-sheet fixed left-0 right-0 top-0 z-[60] flex items-end justify-center overflow-hidden bg-[hsl(0_0%_0%/0.45)] p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="viewport-sheet-panel w-full max-w-md rounded-t-[1.25rem] bg-card p-6 shadow-xl sm:rounded-[1.25rem]"
        style={{
          /* The inset is added to the padding, not used as an offset: the
             panel stays flush to the bottom edge and keeps its content clear
             of the home indicator. */
          paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-bold tracking-[-0.015em]">
            {title}
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
          {lead}
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
  ), document.body);
}
