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
  /** iOS Safari: real, but manual, and it needs instructions. */
  | 'ios-manual'
  /** Nothing to offer: unsupported browser, or already dismissed. */
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

export function wasDismissed(now: number = Date.now(), storage?: Storage): boolean {
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

export function rememberDismissal(now: number = Date.now(), storage?: Storage): void {
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
  dismissed: boolean;
}): InstallMode {
  if (opts.standalone) return 'standalone';
  if (opts.dismissed) return 'unavailable';
  if (opts.hasNativePrompt) return 'native';
  if (opts.iosSafari) return 'ios-manual';
  return 'unavailable';
}
