import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, Plus, X, Check, Loader2, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { recordPwaEvent } from '@/lib/engagement';
import {
  type InstallDialogKind,
  type InstallState,
  classifyPlatform, currentEvidence, dialogForState, heldInstallPrompt,
  installedInThisTab, iosMajorVersion, isCheckingInstall, isIPad,
  rememberMuted, resolveInstallState, showInstallPrompt, wasMuted, watchInstall,
} from '@/lib/pwa';

/**
 * THE INSTALL CONTROL.
 *
 * One rule, and everything here follows from it:
 *
 *   A VISIBLE INSTALL CONTROL ALWAYS ANSWERS A PRESS, IMMEDIATELY.
 *
 * There are exactly two shapes a press can take. Either the browser has
 * handed us a real prompt and we raise it, or it has not and the press opens
 * a small dialog that says what is true on this platform. Which dialog is not
 * decided here: `dialogForState` in lib/pwa.ts derives it from the state,
 * which is derived from the platform. So a Chrome user cannot be shown iPhone
 * instructions, and an iPhone user cannot be left waiting for an Android
 * event -- not by convention, but because neither value can be constructed.
 *
 * THE THIRD SHAPE, WHICH IS NOT A THIRD SHAPE
 *
 * On Chromium, in the first few seconds, there may be no prompt yet. The
 * press is RECORDED rather than refused: the control shows it is working and
 * the event is spent the moment it lands. That is still an immediate answer;
 * it is just an answer that takes a moment to finish. It is reachable only on
 * a platform where the event genuinely exists.
 */

/** Only one success dialog per page, however many controls are mounted. */
let announcedInstall = false;

/**
 * THE PAGE'S INSTALL STATE, FOR ANYONE WHO NEEDS TO LAY OUT AROUND IT.
 *
 * Readable BEFORE the control is rendered, from the same store the control
 * reads, so a strip and the button inside it cannot disagree about whether
 * there is anything to show.
 */
export function useInstallState(): InstallState {
  const [, restate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    restate();
    return watchInstall(restate);
  }, []);
  return resolveInstallState({
    platform: classifyPlatform(),
    hasNativePrompt: heldInstallPrompt() !== null,
    evidence: currentEvidence(),
    checking: isCheckingInstall(),
  });
}

/**
 * Is there an app affordance worth giving room to?
 *
 * False in exactly the two states that render nothing:
 *
 *   standalone   you ARE the app. An installed app must not carry a control
 *                for installing itself, and a chip saying "Installed" inside
 *                the installed app is clutter reporting the obvious.
 *   unsupported  the browser has no install story at all.
 *
 * Every other state renders something pressable, which is why the caller can
 * reserve the space without risking the empty rectangle this exists to stop.
 */
export function hasInstallAction(state: InstallState): boolean {
  return state !== 'unsupported' && state !== 'standalone';
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
   * foreground-on-transparent treatment is all but invisible until hover.
   */
  tone?: 'auto' | 'dark';
  /** `block` fills its container, for the mobile menu. */
  variant?: 'pill' | 'block';
  className?: string;
}) {
  const { t } = useLanguage();
  const [dialog, setDialog] = useState<InstallDialogKind | null>(null);
  const [muted, setMuted] = useState(false);

  /*
   * Re-render when the page's install state changes, and read it fresh.
   *
   * Not a copy in state: there is one prompt, one "was it installed here",
   * one answer from the browser about related apps, and every control on the
   * page is a view of them.
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
   * on a browser that has finished deciding.
   */
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const checking = isCheckingInstall();
  useEffect(() => {
    if (!checking) return undefined;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [checking]);

  /*
   * ── THE TAP IS A FACT, EVEN BEFORE THE BROWSER IS READY ────────────
   *
   * Chromium's transient user activation lasts five seconds, so a prompt
   * arriving soon after the tap can still be raised from that gesture. If it
   * arrives too late for that, the control says "Ready" and the second tap
   * costs one more touch rather than a mystery.
   */
  const [intent, setIntent] = useState(false);
  const [readyToPrompt, setReadyToPrompt] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const tappedAt = React.useRef(0);

  const platform = classifyPlatform();
  const prompt = heldInstallPrompt();
  const justInstalled = installedInThisTab();
  const state = resolveInstallState({
    platform,
    hasNativePrompt: prompt !== null,
    evidence: currentEvidence(),
    checking,
  });

  /*
   * ── THE INSTALL LANDED ─────────────────────────────────────────────
   *
   * `appinstalled` is the one unambiguous moment. It closes whatever install
   * UI is open, stops any wait, and says so once -- by page, not by control,
   * or three mounted controls would stack three dialogs on top of each other.
   *
   * The marker is persisted in lib/pwa.ts, at the event, rather than here:
   * the fact belongs to the browser profile and must not depend on which
   * component happened to be mounted.
   */
  useEffect(() => {
    if (!justInstalled || announcedInstall) return;
    announcedInstall = true;
    setIntent(false);
    setPrompting(false);
    setReadyToPrompt(false);
    setDialog('installed');
  }, [justInstalled]);

  /*
   * WHAT WAS OFFERED, AND ON WHICH SURFACE.
   *
   * Once per state per surface per page view — `recordPwaEvent` de-duplicates
   * on that key — so a re-render is not a second impression.
   */
  useEffect(() => {
    if (state === 'unsupported') return;
    void recordPwaEvent('PWA_AFFORDANCE_VIEWED', 'DETECTED', { source: `${source}:${state}` });
    if (state === 'standalone') return;
    if (prompt !== null) {
      void recordPwaEvent('PWA_NATIVE_PROMPT_AVAILABLE', 'DETECTED', { source });
    }
  }, [state, prompt, source]);

  /*
   * ACTIVATION IS A CLOCK, AND IT IS THE BROWSER'S CLOCK.
   *
   * Chromium allows prompt() only while the gesture that triggered it is
   * still transiently active, which lasts five seconds. Measured against the
   * deployed site: the same held event is ALLOWED 0.3s after a tap and
   * refused with NotAllowedError 7.0s after it. 3.5s leaves margin for the
   * call rather than racing the limit.
   */
  const ACTIVATION_SAFE_MS = 3500;
  /*
   * And a browser that never answers. Observed arrivals on the deployed site
   * were 1668, 1791, 2145 and 3687ms; twelve seconds is more than three times
   * the slowest, so reaching it means the answer is not coming.
   */
  const GIVE_UP_MS = 12000;

  useEffect(() => {
    if (!intent || prompting) return undefined;
    const held = heldInstallPrompt();

    if (held) {
      const withinGesture = Date.now() - tappedAt.current < ACTIVATION_SAFE_MS;
      if (!withinGesture) { setIntent(false); setReadyToPrompt(true); return undefined; }
      setPrompting(true);
      void (async () => {
        void recordPwaEvent('PWA_NATIVE_PROMPT_SHOWN', 'CONFIRMED', { source, once: false });
        const outcome = await showInstallPrompt();
        setIntent(false);
        setPrompting(false);
        /* The browser refused the delayed call -- the gesture had expired
           after all. Say so with a control that works, not with silence. */
        if (outcome === 'unavailable') setReadyToPrompt(true);
        if (outcome === 'accepted') {
          void recordPwaEvent('PWA_NATIVE_PROMPT_ACCEPTED', 'CONFIRMED', { source, once: false });
        } else if (outcome === 'dismissed') {
          void recordPwaEvent('PWA_NATIVE_PROMPT_DISMISSED', 'CONFIRMED', { source, once: false });
        }
      })();
      return undefined;
    }

    /*
     * Nothing arrived. The wait ends in a control that states the outcome and
     * still opens an explanation when pressed -- never in a spinner that
     * outlives the question.
     */
    const id = window.setTimeout(() => { setIntent(false); }, GIVE_UP_MS);
    return () => window.clearTimeout(id);
  }, [intent, prompting, prompt, source]);

  const onClick = useCallback(async () => {
    void recordPwaEvent('PWA_INSTALL_CLICKED', 'CONFIRMED', { source: `${source}:${state}`, once: false });

    /*
     * ── THE IMMEDIATE ANSWER ───────────────────────────────────────────
     *
     * Already installed, or on a platform that installs through its own menu,
     * or on a browser that declined: all of them open a small dialog on this
     * press, with no loading and no waiting.
     *
     * The kind is DERIVED, never chosen here. That is what makes the reported
     * Chromium bug unreachable: there is no branch in this file that could
     * name an iOS dialog, and no state a Chromium platform can produce that
     * `dialogForState` maps to one.
     */
    const kind = dialogForState(state);
    if (kind) {
      if (kind !== 'installed' && kind !== 'unavailable') {
        void recordPwaEvent('PWA_IOS_INSTRUCTIONS_SHOWN', 'CONFIRMED', { source: `${source}:${kind}` });
      }
      setDialog(kind);
      return;
    }

    /*
     * ── THE PRESS IS ALWAYS ANSWERED ──────────────────────────────────
     *
     * No prompt in hand means the browser has not offered YET, not that this
     * press meant nothing. It is recorded, the control immediately shows it
     * is working, and the effect above spends the event the moment it lands.
     */
    if (!heldInstallPrompt()) {
      tappedAt.current = Date.now();
      setIntent(true);
      return;
    }

    void recordPwaEvent('PWA_NATIVE_PROMPT_SHOWN', 'CONFIRMED', { source, once: false });
    const outcome = await showInstallPrompt();
    /* Spent, whatever the answer: Chromium will not replay it. The control
       goes back to its ordinary word rather than staying on "Ready". */
    setReadyToPrompt(false);
    if (outcome === 'accepted') {
      void recordPwaEvent('PWA_NATIVE_PROMPT_ACCEPTED', 'CONFIRMED', { source, once: false });
    } else if (outcome === 'dismissed') {
      void recordPwaEvent('PWA_NATIVE_PROMPT_DISMISSED', 'CONFIRMED', { source, once: false });
    }
  }, [state, source]);

  const panel = dialog && (
    <InstallDialog
      kind={dialog}
      justInstalled={justInstalled}
      onClose={() => setDialog(null)}
      onMute={() => { rememberMuted(); setDialog(null); setMuted(true); }}
    />
  );

  /*
   * ── THE TWO STATES WITH NOTHING TO SAY ──────────────────────────────
   *
   * `standalone` is the app itself: offering to install it would be absurd,
   * and so would a chip announcing that the app you are looking at exists.
   * `unsupported` is a browser with no install story at all.
   *
   * Both return null, and `hasInstallAction` says so in advance so the strip
   * around them does not reserve a hole.
   */
  if (state === 'standalone' || state === 'unsupported') return panel ?? null;

  const quiet = tone === 'dark'
    ? 'bg-white/[0.06] text-white/70 ring-1 ring-inset ring-white/15'
    : 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border';
  const shape = variant === 'block'
    ? 'w-full min-h-[3rem] rounded-[0.9rem] px-4 text-[17px]'
    : `min-h-[2.5rem] rounded-full text-sm ${compact ? 'w-10 px-0' : 'px-3.5'}`;

  /*
   * WORKING IS NOT DEAD.
   *
   * Somebody has already pressed, and this is the progress of that press --
   * a response to their tap rather than a refusal of it. Reachable only on
   * Chromium, because only there is there an event to be waiting for.
   */
  if (intent || prompting) {
    return (
      <>
        <span
          role="status"
          aria-live="polite"
          aria-label={t('pwa_preparing')}
          className={`inline-flex items-center justify-center gap-2 font-medium ${shape} ${quiet} ${className}`}
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {!compact && <span className="min-w-0 truncate">{t('pwa_preparing')}</span>}
        </span>
        {panel}
      </>
    );
  }

  /*
   * ── HOW LOUD, AND ONLY HOW LOUD ─────────────────────────────────────
   *
   * Muting, and the states that are not an offer, change the SKIN. They never
   * change what a press does. "Not now" asked us to stop shouting, which is a
   * request about volume; it was never a request to make the control useless,
   * and treating it as one is how pressing the quiet chip used to open the
   * wrong thing.
   */
  const isOffer = state === 'native-ready' || state === 'checking'
    || state === 'ios-safari' || state === 'ios-chrome' || state === 'ios-other';
  const loud = isOffer && !(muted || wasMuted());

  const base = 'inline-flex items-center justify-center gap-2 font-semibold transition-colors '
    + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '
    + 'motion-reduce:transition-none';
  const loudShape = variant === 'block'
    ? 'w-full min-h-[3rem] rounded-[0.9rem] px-4 text-[17px]'
    : `min-h-[2.5rem] rounded-full text-sm ${compact ? 'w-10 px-0' : 'px-4'}`;
  const skin = tone === 'dark'
    /* bg-white/[0.12], not bg-white/12. Tailwind's opacity scale goes in
       fives, so `/12` names no rule at all and silently generates nothing. */
    ? 'bg-white/[0.12] text-white ring-1 ring-inset ring-white/30 hover:bg-white/20 hover:ring-white/50'
    : 'bg-gold-soft text-gold-ink ring-1 ring-inset ring-gold/45 hover:bg-gold hover:text-[#0D0D0D] hover:ring-gold';

  /*
   * INSTALLED, IN AN ORDINARY TAB.
   *
   * The reported bug: install Homatch, come back to the website, press
   * Install, nothing happens -- because Chromium does not offer an install
   * for an app that is already installed, so the control sat waiting for an
   * event that was never coming.
   *
   * It now says what is true before the press, and answers the press with a
   * small dialog. It stays PRESSABLE on purpose: a greyed-out control that
   * explains nothing is the same dead end in a different colour.
   */
  const installed = state === 'installed';
  const declined = state === 'unavailable';
  /*
   * THE WORD HAS TO MATCH THE STATE BEFORE THE PRESS, NOT AFTER IT.
   *
   * A browser that has decided not to offer still gets a pressable control
   * that explains itself -- but it must not be labelled "Install App" while
   * it does. That is the same promise-with-nothing-behind-it that started
   * this, one step quieter: the press would be answered, and answered with a
   * refusal the word had not prepared anyone for.
   */
  const label = installed ? t('pwa_installed')
    : declined ? t('pwa_unavailable')
      : readyToPrompt ? t('pwa_ready_install')
        : t('pwa_install');

  return (
    <>
      <button
        type="button"
        onClick={() => { void onClick(); }}
        aria-label={installed ? t('pwa_installed_body')
          : declined ? t('pwa_unavailable_body')
            : t('pwa_install_aria')}
        className={`${base} ${loud ? `${loudShape} ${skin}` : `${shape} ${quiet}`} ${className}`}
      >
        {installed
          ? <Check className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          : declined
            ? <Info className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2.25} aria-hidden="true" />
            : <Download className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />}
        {!compact && <span className="min-w-0 truncate">{label}</span>}
      </button>
      {panel}
    </>
  );
}

/**
 * ONE DIALOG, FIVE THINGS TO SAY.
 *
 * Compact by default and only as tall as its content: the two notices have no
 * steps at all and are a few lines in a small card, which is what "Homatch is
 * already installed" deserves. The three instruction kinds add a numbered
 * list, and nothing else about the component changes.
 *
 * Five kinds and one design, rather than five modals that drift apart.
 */
function InstallDialog({
  kind, justInstalled, onClose, onMute,
}: {
  kind: InstallDialogKind;
  /** The install happened just now, so the notice congratulates rather than informs. */
  justInstalled: boolean;
  onClose: () => void;
  onMute: () => void;
}) {
  const { t } = useLanguage();

  /*
   * THE PAGE BEHIND DOES NOT SCROLL WHILE THIS IS OPEN.
   *
   * On iOS a drag that begins on the overlay scrolls the document, and
   * scrolling the document moves the address bar -- which resizes the visual
   * viewport underneath a dialog somebody is in the middle of reading.
   * Restored exactly, including an inline overflow the page may have set.
   */
  useEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = previous; };
  }, []);

  /* A modal a keyboard cannot dismiss is a trap. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /*
   * Safari moved its Share button. iOS 26 made Compact the default tab bar
   * layout, and in Compact there is no Share control on screen -- it lives
   * behind the ••• beside the address bar. "Tap Share at the bottom" is
   * therefore wrong directions on a current iPhone with default settings,
   * in exactly the way the iPad wording exists to prevent.
   */
  const iosVersion = iosMajorVersion();
  const safariStep1 = isIPad() ? t('pwa_ios_step1_ipad')
    : (iosVersion ?? 0) >= 26 ? t('pwa_ios_step1_compact')
      : t('pwa_ios_step1');

  const steps = kind === 'ios-safari'
    ? [
      { icon: Share, text: safariStep1 },
      { icon: Plus, text: t('pwa_ios_step2') },
      { icon: Download, text: t('pwa_ios_step3') },
    ]
    : kind === 'ios-chrome'
      ? [
        { icon: Share, text: t('pwa_ioschrome_step1') },
        { icon: Plus, text: t('pwa_ioschrome_step2') },
        { icon: Download, text: t('pwa_ioschrome_step3') },
      ]
      : kind === 'ios-other'
        ? [
          { icon: Share, text: t('pwa_iosbrowser_step1') },
          { icon: Plus, text: t('pwa_iosbrowser_step2') },
          { icon: Download, text: t('pwa_iosbrowser_step3') },
        ]
        : [];

  const title = kind === 'installed'
    ? (justInstalled ? t('pwa_install_success') : t('pwa_already_installed'))
    : kind === 'unavailable' ? t('pwa_unavailable')
      : kind === 'ios-safari' ? t('pwa_ios_title')
        : kind === 'ios-chrome' ? t('pwa_ioschrome_title')
          : t('pwa_iosbrowser_title');

  const lead = kind === 'installed'
    ? (justInstalled ? t('pwa_install_success_body') : t('pwa_installed_body'))
    : kind === 'unavailable' ? t('pwa_unavailable_body')
      : kind === 'ios-safari' ? t('pwa_ios_lead')
        : kind === 'ios-chrome' ? t('pwa_ioschrome_lead')
          : t('pwa_iosbrowser_lead');

  /* Only an offer can be muted. "Not now" on a notice would be answering a
     question nobody asked. */
  const mutable = steps.length > 0;

  /*
   * ── RENDERED AT THE BODY, NOT WHERE IT WAS DECLARED ───────────────────
   *
   * This control appears in the header, on the hero, and inside the mobile
   * menu. Three ordinary ancestors each break a fixed overlay differently:
   * `display:none` gives it no box, a `transform` makes that element the
   * containing block for `position: fixed` (the classic way a modal ends up
   * off-screen on iOS), and `overflow` clips it. A portal to the body has
   * none of them, by construction.
   */
  return createPortal((
    <div
      /*
       * `viewport-sheet` sets the height from the DYNAMIC viewport. Without
       * it, `inset-0` measures the layout viewport -- taller than the visible
       * one on iOS whenever the browser chrome is showing -- and the panel is
       * aligned inside a box whose top is above the screen.
       */
      className="viewport-sheet fixed left-0 right-0 top-0 z-[60] flex items-center justify-center overflow-hidden bg-[hsl(0_0%_0%/0.5)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="viewport-sheet-panel w-full max-w-[21.5rem] rounded-[1.25rem] border border-border bg-card p-5 shadow-2xl
          animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        style={{
          /* Clear of the home indicator without detaching from the centre. */
          marginBottom: 'env(safe-area-inset-bottom)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          {/* The app's own icon, so the dialog is recognisably about Homatch
              and not a generic browser notice. */}
          <img
            src="/icon-192.png"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-[0.7rem] ring-1 ring-inset ring-border"
          />
          <span className="min-w-0 flex-1 font-display text-[15px] font-bold tracking-[-0.01em]">
            Homatch
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('pwa_close')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2 className="mt-4 flex items-center gap-2 font-display text-[17px] font-bold leading-snug tracking-[-0.015em]">
          {kind === 'installed' && (
            <Check className="h-[18px] w-[18px] shrink-0 text-gold" strokeWidth={2.75} aria-hidden="true" />
          )}
          {kind === 'unavailable' && (
            <Info className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={2.25} aria-hidden="true" />
          )}
          <span className="min-w-0">{title}</span>
        </h2>

        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
          {lead}
        </p>

        {steps.length > 0 && (
          <ol className="mt-4 space-y-2.5">
            {steps.map((step, i) => (
              <li key={step.text} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[0.6rem] border border-border bg-secondary">
                  <step.icon className="h-[17px] w-[17px] text-foreground" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="min-w-0 text-[15px] leading-snug">
                  <span className="me-1.5 font-semibold text-muted-foreground">{i + 1}.</span>
                  {step.text}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 flex items-center gap-2">
          {mutable && (
            /* The ONLY thing that quietens the control, and it says so. */
            <button
              type="button"
              onClick={onMute}
              className="min-h-[2.75rem] flex-1 rounded-full border border-border text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              {t('pwa_dismiss')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[2.75rem] flex-1 rounded-full bg-gold-soft text-sm font-semibold text-gold-ink ring-1 ring-inset ring-gold/45 hover:bg-gold hover:text-[#0D0D0D]"
          >
            {mutable ? t('pwa_close') : t('pwa_ok')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
