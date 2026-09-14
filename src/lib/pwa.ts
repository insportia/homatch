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
   * Installed during this visit.
   *
   * The browser will not let a page launch an installed app on command, so
   * the honest next action is an OPEN control rather than a claim that we
   * launched it. See InstallApp for what the press actually does.
   */
  | 'installed'
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
  /**
   * iOS, but not Safari.
   *
   * Chrome, Firefox and Edge on iOS are Safari's engine in someone else's
   * chrome, and none of them can add to the home screen -- the menu item
   * simply is not there. This used to resolve to `unsupported`, which renders
   * nothing at all: a person on iOS Chrome saw no button, got no explanation,
   * and had no way to learn that the same page in Safari installs in three
   * taps. The install was one hop away and the product never said so.
   */
  | 'ios-browser'
  /** Nothing to offer: unsupported browser, or the customer muted it. */
  /**
    * The customer said "not now", and meant it.
    *
    * Distinct from `unsupported`, and the distinction is the whole point:
    * this browser CAN install Homatch, so the door still exists and the
    * control still renders — quietly, as a way back in rather than as an
    * offer. Nothing here ever raises the browser's own prompt by itself.
    */
  | 'dismissed'
  /** The browser cannot install web apps. There is nothing to render. */
  | 'unsupported';

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

/**
 * An iPad, which matters for one sentence.
 *
 * Safari puts the Share control in the BOTTOM toolbar on iPhone and in the
 * TOP RIGHT on iPad. Telling an iPad owner to look at the bottom of the
 * screen sends them to a toolbar that does not contain it, which is a worse
 * failure than saying nothing: they conclude the feature is missing.
 */
export function isIPad(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent || '';
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

/** Only Safari can add to the home screen on iOS; other iOS browsers cannot. */
export function isIOSSafari(nav: Navigator = navigator): boolean {
  if (!isIOS(nav)) return false;
  const ua = nav.userAgent || '';
  // Chrome (CriOS), Firefox (FxiOS) and Edge (EdgiOS) on iOS cannot install.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/** On iOS, in a browser that cannot install. Reachable in one hop: Safari. */
export function isIOSOtherBrowser(nav: Navigator = navigator): boolean {
  return isIOS(nav) && !isIOSSafari(nav);
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
  /** An install completed in this tab. */
  installed?: boolean;
  /** iOS, in a browser that cannot install. Safari can, one hop away. */
  iosOther?: boolean;
}): InstallMode {
  if (opts.standalone) return 'standalone';
  /* Installed beats muted: somebody who has just installed it wants the door,
     not silence, and "don't offer me this again" was about the offer. */
  if (opts.installed) return 'installed';
  /* "Not now" from somebody whose browser could install it: the control
     stays, in its quiet state. "Not now" on a browser that could never have
     installed it resolves to `unsupported` below, because there is nothing
     to come back to. */
  if (opts.muted) return opts.installable || opts.iosSafari ? 'dismissed' : 'unsupported';
  if (opts.hasNativePrompt) return 'native';
  if (opts.iosSafari) return 'ios-manual';
  /* Before the `installable` test below, which is false on every iOS browser
     and would otherwise send these to `unsupported`. */
  if (opts.iosOther) return 'ios-browser';
  /*
   * No native prompt yet, and not iOS.
   *
   * beforeinstallprompt fires late, and on a browser that supports
   * installing but has not decided the site is engaging enough it may
   * never fire at all. Returning a nothing-to-show state here is what made
   * the button appear a second or two after load, which reads as a glitch.
   * 'pending' keeps the control on the page in a state that says what it
   * is: installing is possible, the browser has not offered it yet, and
   * pressing it explains how.
   */
  if (opts.installable) return 'pending';
  return 'unsupported';
}

/* ------------------------------------------------------------------ *
 * THE ONE CAPTURED PROMPT                                             *
 * ------------------------------------------------------------------ */

/**
 * `beforeinstallprompt` fires ONCE, at the window, and the event it delivers
 * is the only way to install without the browser's own menu.
 *
 * Every install control used to hold its own copy, captured by its own
 * listener. That works for exactly one control: the one already on screen
 * when the event arrives. The control inside the phone's menu is mounted when
 * the menu is OPENED — always after the event — so it registered its listener
 * too late, held nothing, and offered the manual instructions instead. On a
 * phone, where installing matters most, one-tap install was unreachable.
 *
 * So the prompt is held HERE, once, for the page. A control mounted at any
 * later moment reads the same captured event, and a control that uses it
 * spends it for everyone — because there is only one, and Chromium will not
 * replay it.
 */
let heldPrompt: BeforeInstallPromptEvent | null = null;
let installedHere = false;
const watchers = new Set<() => void>();

function announce(): void {
  for (const watcher of watchers) watcher();
}

/**
 * Listen at the window, once per page.
 *
 * Called at module scope, so the listener is in place as soon as anything
 * imports this — well before React has mounted anything, and therefore
 * before the event can realistically arrive.
 */
function wire(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    // Chromium shows its own mini-infobar unless this is prevented; the
    // prompt should happen on OUR control, in context.
    e.preventDefault();
    heldPrompt = e as BeforeInstallPromptEvent;
    announce();
  });
  window.addEventListener('appinstalled', () => {
    heldPrompt = null;
    installedHere = true;
    announce();
  });
}
wire();

/** Subscribe to changes in the held prompt. Returns the unsubscribe. */
export function watchInstall(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => { watchers.delete(onChange); };
}

/** The captured prompt, or null if the browser has not offered one. */
export function heldInstallPrompt(): BeforeInstallPromptEvent | null {
  return heldPrompt;
}

/** Did an install complete in this tab? Distinct from "is standalone". */
export function installedInThisTab(): boolean {
  return installedHere;
}

/**
 * Spend the prompt.
 *
 * Chromium will not let a `beforeinstallprompt` be replayed, so once it has
 * been shown it is gone whatever the customer chose. `accepted` is recorded
 * so the control can say so; `dismissed` changes nothing but the fact that
 * there is no longer a prompt to replay — it is "not now", never "never".
 */
export async function showInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = heldPrompt;
  if (!prompt) return 'unavailable';
  heldPrompt = null;
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') installedHere = true;
    announce();
    return outcome;
  } catch {
    // A browser that refuses to show the dialog leaves the control in its
    // pending state, which explains the browser's own menu.
    announce();
    return 'unavailable';
  }
}

/** Test seam: forget the captured prompt and the install that followed it. */
export function resetInstallState(): void {
  heldPrompt = null;
  installedHere = false;
  announce();
}
