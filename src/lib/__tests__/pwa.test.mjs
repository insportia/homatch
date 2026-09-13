import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DISMISS_DAYS, heldInstallPrompt, installedInThisTab, isIOS, isIOSSafari,
  isStandalone, rememberMuted, resolveInstallMode, showInstallPrompt, wasMuted,
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
   installable: false,}), 'unavailable');
});

test('a dismissal suppresses both affordances but not standalone', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false, muted: true,
   installable: false,}), 'unavailable');
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: true, muted: true,
   installable: false,}), 'unavailable');
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

test('a snoozed prompt leaves the control on the page', () => {
  // Chromium, prompt already spent by a dismissal: still installable.
  assert.equal(
    resolveInstallMode({
      standalone: false, hasNativePrompt: false, iosSafari: false,
      installable: true, muted: false,
    }),
    'pending',
    'dismissing the native dialog must not remove the way back in',
  );
});

test('only an explicit mute hides the control', () => {
  assert.equal(
    resolveInstallMode({
      standalone: false, hasNativePrompt: true, iosSafari: false,
      installable: true, muted: true,
    }),
    'unavailable',
  );
});

test('a browser that cannot install is offered nothing', () => {
  // Firefox and desktop Safari: a button here could never work.
  assert.equal(
    resolveInstallMode({
      standalone: false, hasNativePrompt: false, iosSafari: false,
      installable: false, muted: false,
    }),
    'unavailable',
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
  const files = [
    'src/components/common/InstallApp.tsx',
    'src/components/home/PublicHeader.tsx',
    'src/components/home/sections/ContractDocument.tsx',
  ];
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
