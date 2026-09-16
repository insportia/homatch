import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DISMISS_DAYS, heldInstallPrompt, installedInThisTab, isIOS, isIOSSafari,
  isStandalone, isIPad, isIOSOtherBrowser, resetInstallState,
  rememberMuted, resolveInstallMode, showInstallPrompt, wasMuted,
  watchInstall,
} from '../pwa.ts';

/*
 * The install CTA has one way of being actively harmful: offering a one-tap
 * install where the browser provides none, so the button does nothing. iOS is
 * that case. These tests pin the rule that `native` is reachable only when
 * Chromium has actually handed us a prompt.
 */

const nav = (userAgent, maxTouchPoints = 0, standalone = undefined) =>
  ({ userAgent, maxTouchPoints, ...(standalone === undefined ? {} : { standalone }) });

const UA = {
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iPhoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
  iPadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
};

/* ── platform detection ─────────────────────────────────────────────── */

test('an iPhone is iOS', () => {
  assert.equal(isIOS(nav(UA.iPhone)), true);
});

test('iPadOS is iOS even though it claims to be a Mac', () => {
  // Safari on iPad reports a Macintosh UA; touch points are the giveaway.
  assert.equal(isIOS(nav(UA.iPadOS, 5)), true);
});

test('a real Mac is not iOS', () => {
  assert.equal(isIOS(nav(UA.mac, 0)), false);
});

test('Android is not iOS', () => {
  assert.equal(isIOS(nav(UA.android)), false);
});

test('Chrome on iOS cannot add to the home screen, so it is not iOS Safari', () => {
  // Only Safari can install on iOS. Showing Share/Add instructions in Chrome
  // iOS would describe a menu item the user does not have.
  assert.equal(isIOS(nav(UA.iPhoneChrome)), true);
  assert.equal(isIOSSafari(nav(UA.iPhoneChrome)), false);
  assert.equal(isIOSSafari(nav(UA.iPhone)), true);
});

/* ── standalone detection ───────────────────────────────────────────── */

test('iOS reports standalone through its own navigator flag', () => {
  const win = { matchMedia: () => ({ matches: false }) };
  assert.equal(isStandalone(nav(UA.iPhone, 0, true), win), true);
  assert.equal(isStandalone(nav(UA.iPhone, 0, false), win), false);
});

test('everyone else reports standalone through the display-mode query', () => {
  const installed = { matchMedia: (q) => ({ matches: q.includes('standalone') }) };
  const browser = { matchMedia: () => ({ matches: false }) };
  assert.equal(isStandalone(nav(UA.android), installed), true);
  assert.equal(isStandalone(nav(UA.android), browser), false);
});

/* ── dismissal ──────────────────────────────────────────────────────── */

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test('a dismissal is respected, then expires', () => {
  const store = memoryStorage();
  const t0 = 1_000_000_000_000;
  rememberMuted(t0, store);
  assert.equal(wasMuted(t0 + 1000, store), true, 'still dismissed a second later');
  const justInside = t0 + (DISMISS_DAYS * 24 * 60 * 60 * 1000) - 1000;
  assert.equal(wasMuted(justInside, store), true, 'still dismissed just inside the window');
  const justOutside = t0 + (DISMISS_DAYS * 24 * 60 * 60 * 1000) + 1000;
  assert.equal(wasMuted(justOutside, store), false, 'offered again after the window');
});

test('a corrupt or absent dismissal is treated as not dismissed', () => {
  assert.equal(wasMuted(Date.now(), memoryStorage()), false);
  assert.equal(wasMuted(Date.now(), memoryStorage({ homatch_install_dismissed_at: 'nonsense' })), false);
});

test('storage that throws does not permanently suppress the CTA', () => {
  const hostile = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(wasMuted(Date.now(), hostile), false);
  assert.doesNotThrow(() => rememberMuted(Date.now(), hostile));
});

/* ── the decision ───────────────────────────────────────────────────── */

test('an installed app never offers to install itself', () => {
  // Standalone beats everything, including a prompt Chromium is still holding.
  assert.equal(resolveInstallMode({
    standalone: true, hasNativePrompt: true, iosSafari: true, muted: false,
   installable: false,}), 'standalone');
});

test('Chromium with a held prompt gets the one-tap install', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false, muted: false,
   installable: false,}), 'native');
});

test('iOS Safari gets instructions, never a native prompt', () => {
  // The whole point: there is no API here, so the mode must not be 'native'.
  const mode = resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: true, muted: false,
   installable: false,});
  assert.equal(mode, 'ios-manual');
  assert.notEqual(mode, 'native');
});

test('a browser that can do neither is offered nothing', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false, muted: false,
   installable: false,}), 'unsupported');
});

/*
 * "NOT NOW" IS NOT "NEVER", AND THE DIFFERENCE IS A STATE.
 *
 * Both used to resolve to one value that rendered nothing, and the owner kept
 * finding the same two holes: press "not now" once, or open Homatch as the
 * installed app, and the application row stopped existing. A row that is
 * sometimes there and sometimes not is worse than either.
 *
 * So a dismissal on a browser that COULD install keeps a quiet, pressable
 * chip — a door, not an offer; it never raises the browser's own prompt by
 * itself. A dismissal on a browser that could never have installed it is
 * `unsupported`, because there is nothing to come back to.
 */
test('a dismissal leaves the door where it was, on a browser that has one', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false, muted: true,
    installable: true,
  }), 'dismissed');
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: true, muted: true,
    installable: false,
  }), 'dismissed', 'iOS can always add to the home screen, prompt or not');
});

test('a dismissal on a browser that cannot install is simply unsupported', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false, muted: true,
    installable: false,
  }), 'unsupported');
});

test('standalone beats every kind of dismissal', () => {
  assert.equal(resolveInstallMode({
    standalone: true, hasNativePrompt: false, iosSafari: false, muted: true,
   installable: false,}), 'standalone');
});

/*
 * REGISTRATION MUST NOT DEPEND ON THE APP BOOTING.
 *
 * The registration used to sit below createRoot().render(), so anything that
 * threw on the way to rendering took installability with it — no worker, no
 * install prompt, no offline shell, and nothing in the UI to say why. Proved
 * by building without Supabase credentials: the client throws "supabaseUrl is
 * required" while main.tsx is still executing, and the registration line was
 * never reached. After the move, the same broken build still registers and
 * activates its worker.
 *
 * It also no longer hangs off `load`. That event fires once, and a listener
 * attached after it has fired never runs at all.
 */
const main = readFileSync('src/main.tsx', 'utf8');

test('the service worker is registered before the app is mounted', () => {
  const registerAt = main.indexOf("serviceWorker.register('/sw.js')");
  // `createRoot(document` and not `createRoot(`: the comment explaining this
  // very rule says "createRoot().render()", and matching prose instead of
  // code made the assertion compare the comment against itself.
  const renderAt = main.indexOf('createRoot(document');
  assert.notEqual(registerAt, -1, 'nothing registers the service worker');
  assert.notEqual(renderAt, -1);
  assert.ok(
    registerAt < renderAt,
    'registration sits after render, so a failure to mount would also cost installability',
  );
});

test('registration does not wait for an event that may already have fired', () => {
  assert.equal(
    /addEventListener\('load'/.test(main), false,
    'a load listener attached after load has fired never runs',
  );
  assert.match(main, /requestIdleCallback/);
  assert.match(main, /window\.setTimeout\(register, \d+\)/);
});

test('it still only registers in a real build', () => {
  // A dev server serves the unhashed module graph; caching it serves
  // yesterday's code back to whoever is editing it.
  assert.match(main, /if \('serviceWorker' in navigator && import\.meta\.env\.PROD\)/);
});

/*
 * DISMISSING THE BROWSER'S DIALOG IS NOT "NEVER ASK ME AGAIN".
 *
 * This is the bug the install control actually had. resolveInstallMode
 * treated one flag as both "not now" and "never", and InstallApp set it when
 * Chromium's own dialog came back `dismissed`. So the sequence that a curious
 * visitor performs — press Install, read the dialog, change your mind — removed
 * the entry point for sixty days. It looked exactly like a button that had
 * broken itself.
 *
 * Muting is now a separate, explicit act, available only from the sheet.
 */

test('a snoozed prompt leaves a way back in, without inventing one', () => {
  /*
   * The defect this guards is real and unchanged: refusing Chrome's own
   * dialog must not permanently remove the entry point.
   *
   * What changed is the answer. It used to resolve to `pending`, which
   * rendered an active "Install App" button with NO prompt behind it -- and
   * pressing that button opened Add to Home Screen instructions. Keeping the
   * door by mislabelling it is not keeping the door; it is the bug.
   *
   * Chromium will not replay a spent event, it offers a new one later. So the
   * honest sequence is: quiet while there is nothing to offer, and a real
   * install control the moment there is.
   */
  const spent = resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false,
    installable: true, muted: false,
  });
  assert.notEqual(spent, 'native', 'an active install was offered with no prompt behind it');
  assert.notEqual(spent, 'ios-manual', 'a Chrome user was routed into the manual flow');

  // And the way back in, the moment the browser offers again.
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false,
    installable: true, muted: false,
  }), 'native', 'a fresh prompt did not restore the install control');
});

test('only an explicit mute quiets the control', () => {
  assert.equal(
    resolveInstallMode({
      standalone: false, hasNativePrompt: true, iosSafari: false,
      installable: true, muted: true,
    }),
    'dismissed',
  );
});

test('a browser that cannot install is offered nothing', () => {
  // Firefox and desktop Safari: a button here could never work.
  assert.equal(
    resolveInstallMode({
      standalone: false, hasNativePrompt: false, iosSafari: false,
      installable: false, muted: false,
    }),
    'unsupported',
  );
});

test('an installed app never offers to install itself', () => {
  for (const installable of [true, false]) {
    for (const muted of [true, false]) {
      assert.equal(
        resolveInstallMode({
          standalone: true, hasNativePrompt: true, iosSafari: true, installable, muted,
        }),
        'standalone',
      );
    }
  }
});

test('the control is reachable from every surface it should be', () => {
  // A phone is where installing matters most, and where it used to be
  // impossible: the component was `hidden sm:block` and appeared in no menu.
  const header = readFileSync('src/components/home/PublicHeader.tsx', 'utf8');
  assert.match(header, /<InstallApp tone=\{onDark \? 'dark' : 'auto'\} \/>/, 'desktop utility cluster');
  assert.match(header, /<InstallApp variant="block" \/>/, 'mobile menu');
  assert.equal(
    /hidden sm:block"><InstallApp/.test(header), false,
    'install must not be hidden from small screens',
  );
});

test('the install control is visible at rest, not on hover', () => {
  // On the black hero it was a dark hairline over near-black — invisible
  // until a hover background introduced it. Both tones must paint something.
  const src = readFileSync('src/components/common/InstallApp.tsx', 'utf8');
  assert.match(src, /bg-white\/\[0?\.\d+\] text-white ring-1 ring-inset/, 'dark tone has its own surface');
  assert.match(src, /bg-gold-soft text-gold-ink ring-1 ring-inset/, 'light tone has its own surface');
});

test('no opacity modifier names a rule Tailwind will not generate', () => {
  /*
   * THE TEST THAT SHOULD HAVE EXISTED.
   *
   * The previous version of the test above pinned the literal `bg-white/12`
   * — and `/12` is not on Tailwind's opacity scale, which goes in fives. It
   * generates NOTHING. So the button was fully transparent on every dark
   * surface it ever appeared on, and the test asserting its appearance was
   * pinning the bug in place.
   *
   * A dead utility class fails silently and looks exactly like a design
   * choice, so this checks the whole family rather than one string: every
   * `/NN` must be on the scale, and anything else must be an arbitrary
   * value in brackets, which always generates.
   */
  /*
   * WIDENED, BECAUSE THREE FILES WAS NOT THE PROBLEM.
   *
   * This checked the three files the first dead class was found in. Running
   * it across the whole tree found six more, in four other components: a
   * findings card whose border had never rendered, three admin status
   * badges, and a banner's hover state. Every one of them looked deliberate
   * in the source and produced nothing in the browser.
   */
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx')) files.push(full);
    }
  };
  walk('src');
  const bad = [];
  for (const file of files) {
    // Comments discuss the broken class by name; only real classes count.
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');
    for (const m of src.matchAll(/(?:bg|text|border|ring|from|to|via|shadow)-[a-z-]+[/](\d+)(?![\d])/g)) {
      if (Number(m[1]) % 5 !== 0) bad.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [],
    `these classes name no Tailwind rule and generate nothing: ${bad.join(', ')}`);
});

/*
 * ONE PROMPT FOR THE PAGE, NOT ONE PER CONTROL.
 *
 * `beforeinstallprompt` fires once, at the window, early. A control that
 * registers its own listener when it mounts sees the event only if it was
 * already on screen — and the control inside a phone's menu is mounted when
 * the menu is OPENED, which is always afterwards. It held nothing, fell back
 * to "your browser can install this from its own menu", and on the device
 * where installing matters most, one-tap install was unreachable.
 *
 * Nothing reported it: the control was present, looked right, and gave a
 * plausible answer. So the guard is structural — the listener belongs to the
 * module, and the component must not grow its own again.
 */
const pwaSource = readFileSync('src/lib/pwa.ts', 'utf8');
const installSource = readFileSync('src/components/common/InstallApp.tsx', 'utf8');

test('the page listens for the install prompt exactly once', () => {
  assert.equal(
    (pwaSource.match(/addEventListener\('beforeinstallprompt'/g) ?? []).length, 1,
    'the store registers the window listener more than once',
  );
  assert.equal(
    installSource.includes("addEventListener('beforeinstallprompt'"), false,
    'the control registers its own listener again — a control mounted later will hold nothing',
  );
  assert.equal(
    installSource.includes("addEventListener('appinstalled'"), false,
    'the control listens for appinstalled itself instead of reading the shared state',
  );
});

test('the listener is wired at module scope, before React has mounted anything', () => {
  // Wiring it from the first subscriber would be too late for a browser that
  // fires the event during the initial script evaluation.
  assert.match(pwaSource, /^wire\(\);$/m,
    'nothing calls wire() at module scope, so the listener depends on a component mounting');
});

test('the store is safe where there is no window at all', () => {
  // It is imported by a module the server renders; a ReferenceError here is
  // a blank page rather than a missing button.
  assert.equal(heldInstallPrompt(), null);
  assert.equal(installedInThisTab(), false);
  const stop = watchInstall(() => {});
  assert.equal(typeof stop, 'function');
  stop();
});

test('spending a prompt that was never offered says so, rather than throwing', async () => {
  assert.equal(await showInstallPrompt(), 'unavailable');
});

test('a prompt the browser REFUSED is not thrown away, because it was never shown', () => {
  /*
   * Chromium refuses a prompt() whose gesture has expired, and it says so:
   *
   *   NotAllowedError: Failed to execute 'prompt' on
   *   'BeforeInstallPromptEvent': The prompt() method must be called with a
   *   user gesture
   *
   * Measured in a real Chrome against the deployed site -- the same held
   * event was ALLOWED 0.3s after a tap and refused 7.0s after it.
   *
   * A refusal is not a spend: no dialog was raised, so the event is still
   * good. Chromium sends no replacement on request, so discarding it here
   * leaves the "Ready — Install App" control with nothing behind it, and the
   * person's second tap does nothing -- the exact defect being closed.
   *
   * Asserted structurally because the behaviour cannot be reached without a
   * browser: the discard must sit AFTER the call it depends on. There is a
   * browser gate that exercises it for real; this one fails in milliseconds
   * if somebody moves one line.
   */
  const body = pwaSource.slice(
    pwaSource.indexOf('export async function showInstallPrompt'),
  ).split('\n}')[0];

  const shown = body.indexOf('await prompt.prompt()');
  const discarded = body.indexOf('heldPrompt = null');
  assert.ok(shown > 0, 'showInstallPrompt no longer calls prompt()');
  assert.ok(discarded > 0, 'showInstallPrompt never releases the held prompt');
  assert.ok(
    discarded > shown,
    'the held prompt is discarded before it is shown, so a refusal loses it and '
    + 'the "Ready" control becomes a second dead button',
  );
});

/*
 * ── THE SHORTEST PATH EACH PLATFORM ACTUALLY ALLOWS ───────────────────────
 *
 * The goal is the fewest taps the OS permits, which is a different number on
 * each platform and is not ours to choose:
 *
 *   Chromium   ONE. beforeinstallprompt is held and replayed on the click, so
 *              our control raises the real native dialog. No modal first --
 *              a Homatch confirmation before the browser's own confirmation
 *              is a tap we invented.
 *
 *   iOS Safari THREE, and all three belong to Safari: Share, Add to Home
 *              Screen, Add. There is no beforeinstallprompt, no navigator
 *              install API, and "Add to Home Screen" is a Safari chrome
 *              action that the Web Share API does not expose as a target --
 *              so navigator.share() would open a sheet WITHOUT it. Verified
 *              against current documentation, not assumed.
 *
 *   iOS other  ZERO, in that browser. Chrome, Firefox and Edge on iOS have no
 *              such menu item at all. The shortest real path is Safari.
 */

test('a held prompt means one tap, and never an explanatory modal first', () => {
  const mode = resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false,
    installable: true, muted: false,
  });
  assert.equal(mode, 'native',
    'a browser holding a real prompt must go straight to it; anything else adds a tap we invented');
});

test('iOS browsers that cannot install are told where it can be done', () => {
  /* This resolved to `unsupported` and therefore rendered NOTHING: no button,
     no explanation, and no way to discover that the same page in Safari
     installs in three taps. */
  const mode = resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false,
    installable: false, muted: false, iosOther: true,
  });
  assert.equal(mode, 'ios-browser');
});

test('iOS Safari still gets the instructions, unchanged', () => {
  const mode = resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: true,
    installable: false, muted: false, iosOther: false,
  });
  assert.equal(mode, 'ios-manual');
});

test('an installed app offers no install anything', () => {
  assert.equal(resolveInstallMode({
    standalone: true, hasNativePrompt: false, iosSafari: true,
    installable: false, muted: false, iosOther: true,
  }), 'standalone', 'the CTA must disappear once Homatch is running as the app');
});

test('iPad is distinguished, because Safari puts Share somewhere else on it', () => {
  const iPad = { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Safari/604.1', maxTouchPoints: 5 };
  const iPhone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
  const desktop = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', maxTouchPoints: 0 };
  assert.equal(isIPad(iPad), true);
  assert.equal(isIPad(iPhone), false, 'an iPhone would be sent to the wrong toolbar');
  assert.equal(isIPad(desktop), false);
});

test('iOS Chrome is iOS, and is not Safari', () => {
  const criOS = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
  assert.equal(isIOSOtherBrowser(criOS), true);
  assert.equal(isIOSSafari(criOS), false);
  const safari = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
  assert.equal(isIOSOtherBrowser(safari), false, 'Safari would be denied the instructions it is the only browser able to follow');
});

/*
 * ── A REAL PROMPT OUTRANKS EVERYTHING WE REMEMBER ─────────────────────────
 *
 * Both of these were live defects, and both produced the same symptom: the
 * Add to Home Screen instructions appearing on a browser that could have
 * installed in one tap.
 */

test('muting quiets the control without disabling the capability', () => {
  /*
   * The mode stays `dismissed`, because somebody who asked not to be nagged
   * should not get the gold button back. What must NOT happen is the quiet
   * chip then opening Add to Home Screen instructions while the browser is
   * holding a real prompt -- that lives in InstallApp, and is asserted there.
   */
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false,
    installable: true, muted: true,
  }), 'dismissed', 'a mute must still quiet the control');
});

test('installed and standalone still outrank a held prompt', () => {
  /* Capability-first must not offer to install something already installed. */
  assert.equal(resolveInstallMode({
    standalone: true, hasNativePrompt: true, iosSafari: false, installable: true, muted: false,
  }), 'standalone');
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false,
    installable: true, muted: false, installed: true,
  }), 'installed');
});



/*
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * If the button says "Install App", a real native prompt is already held.
 *
 * Everything below exists because the old architecture broke that rule for
 * the first few seconds of every Chromium visit, and answered the press with
 * iOS Add to Home Screen instructions. The fix is not a better timeout; it is
 * that no Chromium state renders a control that can open the sheet.
 */

test('CHROMIUM_CHECKING is not an install action', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false,
    installable: true, muted: false, checking: true,
  }), 'checking', 'a browser still deciding was described as something else');
});

test('CHROMIUM_NATIVE_READY requires the held event, not the user agent', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false,
    installable: true, muted: false, checking: true,
  }), 'native', 'a held prompt must win even while the check window is open');
});

test('CHROMIUM_NATIVE_UNAVAILABLE is not the manual-install case', () => {
  /* Add to Home Screen on Chromium is a different and worse product than a
     native install. Offering it answers a question Chromium already
     declined. */
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false,
    installable: true, muted: false, checking: false,
  }), 'native-unavailable');
});

test('CHROMIUM_DISMISSED never becomes a manual-install state', () => {
  const mode = resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false,
    installable: true, muted: true, checking: false,
  });
  assert.equal(mode, 'dismissed');
  assert.notEqual(mode, 'ios-manual');
});

test('IOS_SAFARI keeps the manual flow, which is correct there', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: true,
    installable: false, muted: false, iosOther: false,
  }), 'ios-manual');
});

test('IOS_CHROME is its own answer, not Android and not Safari', () => {
  /* CriOS is WebKit in someone else's chrome: no beforeinstallprompt, and no
     Add to Home Screen in its menu either. Telling it either of the other two
     stories would be false. */
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false,
    installable: false, muted: false, iosOther: true,
  }), 'ios-browser');
});

test('STANDALONE offers nothing at all', () => {
  assert.equal(resolveInstallMode({
    standalone: true, hasNativePrompt: true, iosSafari: false,
    installable: true, muted: false, checking: true,
  }), 'standalone');
});

test('the mode that used to lie no longer exists', () => {
  /* `pending` rendered an active Install App button with no prompt behind it.
     Its absence from every resolution is the invariant. */
  const every = [
    { standalone: false, hasNativePrompt: false, iosSafari: false, installable: true, muted: false, checking: true },
    { standalone: false, hasNativePrompt: false, iosSafari: false, installable: true, muted: false, checking: false },
    { standalone: false, hasNativePrompt: false, iosSafari: false, installable: false, muted: false },
    { standalone: false, hasNativePrompt: true, iosSafari: false, installable: true, muted: false },
    { standalone: false, hasNativePrompt: false, iosSafari: true, installable: false, muted: false },
    { standalone: false, hasNativePrompt: false, iosSafari: false, installable: false, muted: false, iosOther: true },
  ];
  for (const opts of every) {
    assert.notEqual(resolveInstallMode(opts), 'pending');
  }
});

/*
 * ── THE SCREENSHOT MUST BE UNREACHABLE, NOT UNLIKELY ──────────────────────
 *
 * Every earlier attempt at this bug was a condition: wait a bit longer, check
 * one more flag, reorder two tests. Each narrowed the window and none closed
 * it, because a condition is only as good as the next person who edits it.
 *
 * These read the source and assert the SHAPE instead: the sheet has no
 * Chromium kind to be opened with, and every call site that opens one is
 * guarded by an iOS test. A future edit that reintroduces the path fails here
 * rather than in somebody's hand.
 */
const INSTALL_SRC = readFileSync(join('src', 'components', 'common', 'InstallApp.tsx'), 'utf8');

test('the manual sheet has no Chromium kind to be opened with', () => {
  const decl = INSTALL_SRC.match(/kind:\s*('[a-z-]+'(?:\s*\|\s*'[a-z-]+')*)\s*;/);
  assert.ok(decl, 'the Sheet kind union could not be found');
  const kinds = decl[1].split('|').map((k) => k.trim().replace(/'/g, ''));
  assert.deepEqual(
    kinds.filter((k) => !k.startsWith('ios')), [],
    `the Sheet accepts a non-iOS kind (${kinds.join(', ')}), so a Chromium user can be shown it`,
  );
});

test('every sheet is opened behind an iOS test', () => {
  /* Each setSheet call must sit within a few lines of an iOS predicate or an
     iOS mode check. Crude on purpose: it is a shape check, and a call that
     drifts away from its guard is exactly the edit worth failing on. */
  const lines = INSTALL_SRC.split(/\r?\n/);
  const offenders = [];
  lines.forEach((line, i) => {
    if (!/setSheet\('/.test(line)) return;
    const context = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
    const guarded = /isIOSSafari\(\)|isIOSOtherBrowser\(\)|mode === 'ios-manual'|mode === 'ios-browser'/.test(context);
    if (!guarded) offenders.push(`line ${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(offenders, [],
    `these open the manual sheet without an iOS guard:\n  ${offenders.join('\n  ')}`);
});

test('no timeout can decide that installation is manual', () => {
  /* The previous fix waited a guessed number of milliseconds and then opened
     the instructions. Measurement showed the event arriving at 1668, 1791,
     2145 and 3687ms on the same site, so any such number is a coin flip. */
  assert.equal(/awaitInstallPrompt/.test(INSTALL_SRC), false,
    'a timeout-based wait is back in the install click path');
  assert.equal(/setTimeout[^\n]*setSheet/.test(INSTALL_SRC), false,
    'a timer opens the manual sheet');
});
