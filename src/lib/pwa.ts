/**
 * PWA INSTALL STATE.
 *
 * No React and no JSX so node:test can load it, and because the interesting
 * part is a small state machine that is easy to get subtly wrong.
 *
 * ── PLATFORM FIRST, BROWSER SECOND ────────────────────────────────────────
 *
 * The question is never "is this Chrome". It is "what can THIS engine, on
 * THIS operating system, actually do about installing a web app" -- and the
 * answer differs between two browsers that share a name. Chrome on Android
 * fires `beforeinstallprompt` and installs in one tap. Chrome on iPhone is
 * WebKit in Google's chrome: no install event exists, none is coming, and
 * waiting for one is a control that hangs for twelve seconds and then lies.
 *
 * So classification happens once, in `classifyPlatform`, and iOS is decided
 * BEFORE anything Chromium-shaped is considered. No iOS browser can reach a
 * Chromium state, and no Chromium browser can reach an iOS state -- not by
 * convention, but because the two live in different arms of one switch.
 *
 * ── WHAT CHANGED ABOUT iOS, AND WHY THE OLD COPY WAS WRONG ────────────────
 *
 * This code said "only Safari can add to the Home Screen on iOS". That was
 * true when it was written and has not been true since iOS 16.4 (March
 * 2023), which let third-party browsers offer the same Add to Home Screen as
 * Safari. Chrome, Edge, Firefox and DuckDuckGo on iOS all do. Sending those
 * people to Safari was not a smaller feature set -- it was wrong directions
 * to a menu item that was in front of them the whole time.
 *
 * ── AND WHAT COUNTS AS EVIDENCE THAT IT IS ALREADY INSTALLED ──────────────
 *
 * `appinstalled` only ever describes the page it fired on. Install Homatch,
 * close the browser, come back tomorrow to the ordinary website, and that
 * event is ancient history -- which is why the control sat there saying
 * "Preparing install…" for a browser that was never going to offer, because
 * Chromium does not offer an install for an app that is already installed.
 * Three signals of different strength answer it instead; see `resolveEvidence`.
 */

/* ------------------------------------------------------------------ *
 * PLATFORM                                                            *
 * ------------------------------------------------------------------ */

export type Platform =
  /** Running AS the installed app. Nothing to install, nothing to offer. */
  | 'standalone'
  /** iPhone/iPad Safari. Manual, via Share → Add to Home Screen. */
  | 'ios-safari'
  /**
   * Chrome on iOS. NOT Chromium.
   *
   * Every iOS browser is WebKit underneath, so `beforeinstallprompt` does
   * not exist here and no amount of waiting produces one. Since iOS 16.4
   * Chrome offers its own Add to Home Screen, in its own Share menu, in a
   * different place from Safari's -- which is the whole reason this is its
   * own platform rather than a footnote on `ios-other`.
   */
  | 'ios-chrome'
  /** Firefox, Edge, Opera, DuckDuckGo on iOS. Also manual, also capable. */
  | 'ios-other'
  /** Android Chrome, Samsung Internet, Edge: a real one-tap install. */
  | 'android-chromium'
  /** Desktop Chrome/Edge: the same install event, a different window. */
  | 'desktop-chromium'
  /** Firefox and Safari on the desktop. No install anything. */
  | 'unsupported';

/** The event Chromium fires. Not in lib.dom yet. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isStandalone(nav: Navigator = navigator, win: Window = window): boolean {
  // iOS uses a non-standard navigator flag; everyone else reports the
  // display-mode media query. A web app added to the Home Screen from
  // Chrome on iOS launches in the same standalone WebKit view as one added
  // from Safari, so both signals are read on both.
  const iosStandalone = (nav as Navigator & { standalone?: boolean }).standalone === true;
  const displayMode = typeof win.matchMedia === 'function'
    && win.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || displayMode;
}

/**
 * Does this engine implement the install prompt event?
 *
 * The closest honest question to "can this browser install", and the reason
 * it is asked of the engine rather than the user agent string. False on every
 * iOS browser including Chrome, which is correct: iOS installs are real, but
 * they are manual and they are never announced to the page.
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
 * Safari puts the Share control in the BOTTOM toolbar on iPhone and the TOP
 * RIGHT on iPad. Telling an iPad owner to look at the bottom of the screen
 * sends them to a toolbar that does not contain it, which is a worse failure
 * than saying nothing: they conclude the feature is missing.
 */
export function isIPad(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent || '';
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

/** Chrome on iOS announces itself as CriOS. Only meaningful when on iOS. */
export function isIOSChrome(nav: Navigator = navigator): boolean {
  return isIOS(nav) && /CriOS/.test(nav.userAgent || '');
}

/** Safari on iOS: iOS, and none of the other vendors' markers. */
export function isIOSSafari(nav: Navigator = navigator): boolean {
  if (!isIOS(nav)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(nav.userAgent || '');
}

/** On iOS, and not Safari. Since iOS 16.4 these install too. */
export function isIOSOtherBrowser(nav: Navigator = navigator): boolean {
  return isIOS(nav) && !isIOSSafari(nav);
}

/**
 * Where Safari keeps its Share control, which moved.
 *
 * iOS 26 made Compact the default tab bar layout, and in Compact there is no
 * Share button on screen at all: it is behind the ⋯ beside the address bar.
 * The old step one -- "tap Share at the bottom" -- is therefore wrong
 * directions on a current iPhone with default settings, in exactly the way
 * the iPad wording exists to prevent.
 *
 * Read from the OS version because there is no capability query for the
 * position of a button, and the alternative is being confidently wrong.
 */
export function iosMajorVersion(nav: Navigator = navigator): number | null {
  const m = /OS (\d+)[_ ]/.exec(nav.userAgent || '');
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * ONE CLASSIFICATION, AND EVERYTHING DOWNSTREAM READS IT.
 *
 * The order is the design. Standalone first, because an installed app must
 * never advertise installing itself. Then iOS in full -- all of it, before
 * any Chromium test -- so that a user agent containing "Chrome" on an iPhone
 * cannot possibly be classified as the thing that has an install event.
 */
export function classifyPlatform(nav: Navigator = navigator, win: Window = window): Platform {
  if (isStandalone(nav, win)) return 'standalone';
  if (isIOS(nav)) {
    if (isIOSSafari(nav)) return 'ios-safari';
    if (isIOSChrome(nav)) return 'ios-chrome';
    return 'ios-other';
  }
  if (!canInstall(win)) return 'unsupported';
  return /Android/.test(nav.userAgent || '') ? 'android-chromium' : 'desktop-chromium';
}

/** The two platforms that have a real `beforeinstallprompt`. */
export function isChromiumPlatform(platform: Platform): boolean {
  return platform === 'android-chromium' || platform === 'desktop-chromium';
}

/** The three that install manually, through their own Share menu. */
export function isIOSPlatform(platform: Platform): boolean {
  return platform === 'ios-safari' || platform === 'ios-chrome' || platform === 'ios-other';
}

/* ------------------------------------------------------------------ *
 * EVIDENCE OF AN EXISTING INSTALL                                     *
 * ------------------------------------------------------------------ */

export type InstallEvidence =
  /** Proven: we are the app, we watched it install, or the browser says so. */
  | 'confirmed'
  /** Remembered from a previous visit in this browser profile. Refutable. */
  | 'likely'
  | 'none';

const DISMISS_KEY = 'homatch_install_dismissed_at';
const INSTALLED_KEY = 'homatch_pwa_installed';
/** A dismissal is respected for this long before the CTA may return. */
export const DISMISS_DAYS = 60;

function readStore(storage?: Storage): Storage | null {
  try {
    return storage ?? window.localStorage;
  } catch {
    return null;
  }
}

export function wasMuted(now: number = Date.now(), storage?: Storage): boolean {
  try {
    const raw = readStore(storage)?.getItem(DISMISS_KEY);
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
    readStore(storage)?.setItem(DISMISS_KEY, String(now));
  } catch {
    // Nothing to do; the CTA simply reappears next visit.
  }
}

/**
 * Remember that this browser profile installed Homatch.
 *
 * Deliberately device-and-profile local. An account flag would say "this
 * person installed it somewhere", which is not the question: they are asking
 * about the phone in their hand, and the same account on a laptop has not
 * installed anything.
 */
export function rememberInstalled(now: number = Date.now(), storage?: Storage): void {
  try {
    readStore(storage)?.setItem(INSTALLED_KEY, String(now));
  } catch {
    /* Supplemental evidence only. Its absence costs nothing that the live
       signals do not also answer. */
  }
}

/**
 * Forget it, because the browser has just contradicted it.
 *
 * Chromium does not offer to install an app that is already installed. So a
 * `beforeinstallprompt` is not merely permission to install -- it is proof
 * that the remembered install is gone, and the memory must not be allowed to
 * outlive the fact. A marker that can never be wrong is a marker that is
 * eventually a permanent lie.
 */
export function forgetInstalled(storage?: Storage): void {
  try {
    readStore(storage)?.removeItem(INSTALLED_KEY);
  } catch {
    /* Nothing to do. */
  }
}

export function hasInstalledMarker(storage?: Storage): boolean {
  try {
    return Boolean(readStore(storage)?.getItem(INSTALLED_KEY));
  } catch {
    return false;
  }
}

/**
 * How sure are we, and on what.
 *
 *   standalone       we ARE the app. Not an inference.
 *   installedHere    `appinstalled` fired on this page. Not an inference.
 *   relatedApps      getInstalledRelatedApps() found our own manifest listed
 *                    as an installed `webapp`. The browser's own answer, and
 *                    the only one that survives closing the browser.
 *                    `null` means it has not answered yet, which is not "no".
 *   marker           localStorage, from a previous visit. Good evidence and
 *                    beatable evidence -- see forgetInstalled.
 */
export function resolveEvidence(o: {
  standalone: boolean;
  installedHere: boolean;
  relatedApps: boolean | null;
  marker: boolean;
}): InstallEvidence {
  if (o.standalone || o.installedHere || o.relatedApps === true) return 'confirmed';
  if (o.marker) return 'likely';
  return 'none';
}

/* ------------------------------------------------------------------ *
 * THE STATE                                                           *
 * ------------------------------------------------------------------ */

export type InstallState =
  /** Running as the app. The control does not render. */
  | 'standalone'
  /** A prompt is held. One tap raises the browser's own dialog. */
  | 'native-ready'
  /** Already on this device, and we are in an ordinary tab. */
  | 'installed'
  | 'ios-safari'
  | 'ios-chrome'
  | 'ios-other'
  /** Chromium, still deciding. Only ever reachable on a Chromium platform. */
  | 'checking'
  /** Chromium, decided against offering. */
  | 'unavailable'
  /** No install story at all. The control does not render. */
  | 'unsupported';

/**
 * ONE RESOLVER. THE PRECEDENCE IS THE PRODUCT.
 *
 * Read it as a list of things that beat the things below them, each for a
 * reason about how browsers actually behave:
 *
 * 1. STANDALONE beats everything. An app offering to install itself is
 *    absurd, and no other signal can make it less so.
 *
 * 2. A HELD PROMPT beats remembered installs. This is the stale-marker
 *    escape hatch: Chromium does not offer an install for an app that is
 *    already there, so an offer is live proof that it is not. Capability
 *    always outranks memory, in that direction.
 *
 * 3. CONFIRMED evidence beats the platform's manual flow. Being told by the
 *    browser that our app is installed is stronger than knowing which
 *    browser we are in.
 *
 * 4. THE iOS PLATFORMS. Placed above `checking` on purpose, and this is the
 *    second reported bug: iOS has no install event, so a state that waits
 *    for one can only ever end in a twelve-second wait and a false
 *    conclusion. On iOS there is nothing to wait FOR, and the instructions
 *    are correct immediately.
 *
 * 5. A REMEMBERED install, below the iOS flows because on iOS nothing can
 *    ever refute it -- no `appinstalled`, no prompt event, no related-apps
 *    API -- and evidence that cannot be corrected must not outrank an
 *    instruction that is always actionable.
 *
 * 6/7. Chromium, before and after it has made up its mind.
 */
export function resolveInstallState(o: {
  platform: Platform;
  hasNativePrompt: boolean;
  evidence: InstallEvidence;
  /** Chromium may still produce a prompt; time-bounded by the caller. */
  checking: boolean;
}): InstallState {
  if (o.platform === 'standalone') return 'standalone';
  if (o.hasNativePrompt) return 'native-ready';
  if (o.evidence === 'confirmed') return 'installed';
  if (o.platform === 'ios-safari') return 'ios-safari';
  if (o.platform === 'ios-chrome') return 'ios-chrome';
  if (o.platform === 'ios-other') return 'ios-other';
  if (o.evidence === 'likely') return 'installed';
  if (isChromiumPlatform(o.platform)) return o.checking ? 'checking' : 'unavailable';
  return 'unsupported';
}

/* ------------------------------------------------------------------ *
 * WHAT A PRESS OPENS                                                  *
 * ------------------------------------------------------------------ */

export type InstallDialogKind =
  | 'installed'
  | 'ios-safari'
  | 'ios-chrome'
  | 'ios-other'
  | 'unavailable';

/**
 * THE ONLY ROUTE FROM A PRESS TO A DIALOG.
 *
 * The reported Chromium bug -- a Chrome user shown iPhone instructions --
 * is unreachable here because the dialog kind is derived from the STATE, and
 * the state is derived from the PLATFORM. A Chromium platform cannot produce
 * an iOS state, so it cannot produce an iOS dialog. There is no condition to
 * get wrong and no literal for a caller to pass by mistake: the component
 * calls this function and renders whatever it returns.
 *
 * `null` for the three states where a press does something other than open a
 * dialog -- raise the browser's own prompt, record an intent, or nothing at
 * all because the control is not rendered.
 */
export function dialogForState(state: InstallState): InstallDialogKind | null {
  switch (state) {
    case 'installed': return 'installed';
    case 'ios-safari': return 'ios-safari';
    case 'ios-chrome': return 'ios-chrome';
    case 'ios-other': return 'ios-other';
    case 'unavailable': return 'unavailable';
    /* native-ready raises the real prompt, checking records the press, and
       standalone/unsupported never render a control to press. */
    default: return null;
  }
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
 * So the prompt is held HERE, once, for the page.
 */
let heldPrompt: BeforeInstallPromptEvent | null = null;
let installedHere = false;
/** getInstalledRelatedApps has not answered yet. Not the same as "no". */
let relatedApps: boolean | null = null;
const watchers = new Set<() => void>();

function announce(): void {
  for (const watcher of watchers) watcher();
}

/**
 * ASK THE BROWSER WHETHER OUR OWN APP IS INSTALLED.
 *
 * getInstalledRelatedApps() is the only signal that survives closing the
 * browser: Chrome on Android since 84, Chrome and Edge on the desktop since
 * 140. It answers about the `webapp` entry Homatch lists in its own manifest
 * under `related_applications`, which is why that entry exists -- without it
 * this returns an empty array forever and the whole question is unanswerable.
 *
 * Requires a secure top-level context and a page inside the manifest scope.
 * Anything else, including the API simply not existing, resolves to "no
 * evidence" rather than throwing: this is supplemental, and a browser that
 * cannot answer must not break the control.
 */
function probeInstalledApps(): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; id?: string }>>;
  };
  if (typeof nav.getInstalledRelatedApps !== 'function') {
    relatedApps = false;
    return;
  }
  void nav.getInstalledRelatedApps().then(
    (apps) => {
      relatedApps = apps.some((app) => app.platform === 'webapp');
      /* Promote the browser's answer into the local marker, so the next
         visit is right immediately rather than after another round trip. */
      if (relatedApps) rememberInstalled();
      announce();
    },
    () => { relatedApps = false; },
  );
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
    /* The offer itself refutes a remembered install -- see forgetInstalled.
       This is what lets somebody who uninstalled Homatch install it again. */
    relatedApps = false;
    forgetInstalled();
    announce();
  });
  window.addEventListener('appinstalled', () => {
    heldPrompt = null;
    installedHere = true;
    /* The one moment we know for certain, and the one worth writing down:
       every later visit in this profile starts from it. */
    rememberInstalled();
    announce();
  });
  probeInstalledApps();
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

/** The browser's own answer about our app, or null if it has not given one. */
export function relatedAppsInstalled(): boolean | null {
  return relatedApps;
}

/**
 * Everything the page knows about an existing install, in one call.
 *
 * Kept here rather than in the component so that a second control cannot
 * assemble the evidence differently from the first.
 */
export function currentEvidence(): InstallEvidence {
  return resolveEvidence({
    standalone: typeof window === 'undefined' ? false : isStandalone(),
    installedHere,
    relatedApps,
    marker: hasInstalledMarker(),
  });
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

  try {
    await prompt.prompt();
  } catch {
    /*
     * REFUSED IS NOT SPENT, AND THE DIFFERENCE IS THE SECOND TAP.
     *
     * The refusal Chromium actually raises here is NotAllowedError, "the
     * prompt() method must be called with a user gesture" -- measured against
     * the deployed site, where the same held event is allowed 0.3s after a tap
     * and refused 7.0s after it. The event was never shown, so it is not used
     * up; what expired was the gesture.
     *
     * Chromium does not send a replacement on request, so dropping it here
     * would leave the "Ready — Install App" control with nothing behind it --
     * a second dead button, which is precisely the defect this exists to
     * remove. Keeping it is what lets the next press, carrying a fresh
     * gesture, actually install the app.
     */
    announce();
    return 'unavailable';
  }

  // Shown, and therefore spent, whatever the answer turns out to be.
  heldPrompt = null;
  try {
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      installedHere = true;
      rememberInstalled();
    }
    announce();
    return outcome;
  } catch {
    announce();
    return 'unavailable';
  }
}

/** Test seam: forget the captured prompt and the install that followed it. */
export function resetInstallState(): void {
  heldPrompt = null;
  installedHere = false;
  relatedApps = null;
  announce();
}

/**
 * How long after load a Chromium browser is still deciding.
 *
 * Measured twice against the deployed site in a real Chrome:
 * beforeinstallprompt arrived at 1668ms on one run and about 4000ms on
 * another. The variance is the point -- it depends on when the manifest is
 * parsed and the worker takes control, which depends on the network.
 *
 * Six seconds covers both with room, and is short enough that a browser which
 * is genuinely never going to offer is not misdescribed for long.
 */
const CHECK_WINDOW_MS = 6000;
const loadedAt = Date.now();

/**
 * Is the browser still making up its mind?
 *
 * Only ever true where there is something to make up a mind ABOUT. `canInstall`
 * is false on every iOS browser, Chrome included, so no iPhone can enter a
 * waiting state for an event its engine does not implement -- which was the
 * second reported bug, seen as twelve seconds of "Preparing install…" on a
 * device where nothing was ever going to arrive.
 */
export function isCheckingInstall(): boolean {
  if (heldPrompt) return false;
  if (typeof window === 'undefined') return false;
  if (!isChromiumPlatform(classifyPlatform())) return false;
  return Date.now() - loadedAt < CHECK_WINDOW_MS;
}
