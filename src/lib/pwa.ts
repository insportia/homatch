/**
 * PWA INSTALL STATE.
 *
 * No React and no JSX so node:test can load it, and because the interesting
 * part is a small state machine that is easy to get subtly wrong.
 *
 * THE HONEST PART
 *
 * Chromium fires `beforeinstallprompt`, which we can hold and replay on a
 * click — that is a real one-tap install. Safari fires nothing and exposes
 * no API, so on iOS there is no button we can wire to an install. Pretending
 * otherwise produces a button that does nothing, which is worse than saying
 * "Share, then Add to Home Screen". So the platform decides which of two
 * genuinely different affordances is offered, and `canPromptNatively` is
 * never true on iOS.
 */

export type InstallMode =
  /** Already running as an installed app. Nothing to offer. */
  | 'standalone'
  /** Chromium held a prompt for us; one click installs. */
  | 'native'
  /**
   * The browser can install, but has not offered a prompt yet.
   *
   * beforeinstallprompt fires late, and on a browser that has not yet
   * decided the site is engaging enough it may never fire. Treating that
   * as "unavailable" made the control appear a second or two after load,
   * which reads as a glitch. This keeps it on the page and says what is
   * true: installing is possible, and here is how.
   */
  | 'pending'
  /** iOS Safari: real, but manual, and it needs instructions. */
  | 'ios-manual'
  /** Nothing to offer: unsupported browser, or the customer muted it. */
  | 'unavailable';

/** The event Chromium fires. Not in lib.dom yet. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'homatch_install_dismissed_at';
/** A dismissal is respected for this long before the CTA may return. */
export const DISMISS_DAYS = 60;

export function isStandalone(nav: Navigator = navigator, win: Window = window): boolean {
  // iOS uses a non-standard navigator flag; everyone else reports the
  // display-mode media query.
  const iosStandalone = (nav as Navigator & { standalone?: boolean }).standalone === true;
  const displayMode = typeof win.matchMedia === 'function'
    && win.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || displayMode;
}

/**
 * Can this browser install a web app at all?
 *
 * There is no feature query for "is installable", so this asks the
 * closest honest question: does the engine implement the install prompt
 * event? Chromium-family browsers do. Firefox and desktop Safari do not,
 * and correctly get no control rather than a button that cannot work.
 */
export function canInstall(win: Window = window): boolean {
  return 'BeforeInstallPromptEvent' in win || 'onbeforeinstallprompt' in win;
}

export function isIOS(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent || '';
  // iPadOS 13+ reports as a Mac, and is distinguished by having touch points.
  const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

/** Only Safari can add to the home screen on iOS; other iOS browsers cannot. */
export function isIOSSafari(nav: Navigator = navigator): boolean {
  if (!isIOS(nav)) return false;
  const ua = nav.userAgent || '';
  // Chrome (CriOS), Firefox (FxiOS) and Edge (EdgiOS) on iOS cannot install.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function wasMuted(now: number = Date.now(), storage?: Storage): boolean {
  try {
    const store = storage ?? window.localStorage;
    const raw = store.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    // A browser that refuses storage should still get the CTA rather than
    // being permanently opted out by an exception.
    return false;
  }
}

export function rememberMuted(now: number = Date.now(), storage?: Storage): void {
  try {
    (storage ?? window.localStorage).setItem(DISMISS_KEY, String(now));
  } catch {
    // Nothing to do; the CTA simply reappears next visit.
  }
}

/**
 * What to offer, given everything we know.
 *
 * `standalone` wins over every other state: an installed app must never show
 * its own install button.
 */
export function resolveInstallMode(opts: {
  standalone: boolean;
  hasNativePrompt: boolean;
  iosSafari: boolean;
  /** The browser can install web apps at all (Chromium, Edge, Samsung). */
  installable: boolean;
  /**
   * The customer asked not to be offered this again — and ONLY that.
   *
   * Closing the browser's own install dialog is not this. That used to
   * set the same flag, so pressing Install and then changing your mind
   * removed the button for sixty days: the likeliest interaction was the
   * one that destroyed the entry point. Dismissing a dialog means "not
   * now", and "not now" leaves the door where it was.
   */
  muted: boolean;
}): InstallMode {
  if (opts.standalone) return 'standalone';
  if (opts.muted) return 'unavailable';
  if (opts.hasNativePrompt) return 'native';
  if (opts.iosSafari) return 'ios-manual';
  /*
   * No native prompt yet, and not iOS.
   *
   * beforeinstallprompt fires late, and on a browser that supports
   * installing but has not decided the site is engaging enough it may
   * never fire at all. Returning 'unavailable' here is what made the
   * button appear a second or two after load, which reads as a glitch.
   * 'pending' keeps the control on the page in a state that says what it
   * is: installing is possible, the browser has not offered it yet, and
   * pressing it explains how.
   */
  if (opts.installable) return 'pending';
  return 'unavailable';
}
