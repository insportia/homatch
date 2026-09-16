import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DISMISS_DAYS, classifyPlatform, dialogForState, forgetInstalled,
  hasInstalledMarker, heldInstallPrompt, installedInThisTab, iosMajorVersion,
  isChromiumPlatform, isIOS, isIOSChrome, isIOSOtherBrowser, isIOSPlatform,
  isIOSSafari, isIPad, isStandalone, rememberInstalled, rememberMuted,
  resolveEvidence, resolveInstallState, showInstallPrompt, wasMuted, watchInstall,
} from '../pwa.ts';

/*
 * THE TWO WAYS AN INSTALL CONTROL CAN BE ACTIVELY HARMFUL.
 *
 * It can offer a one-tap install where the platform provides none, so the
 * button does nothing. And it can send somebody the wrong way -- iPhone
 * instructions on Android, Safari instructions to a Chrome user who never
 * needed to leave Chrome, or a twelve-second wait for an event that the
 * engine in their hand does not implement.
 *
 * Both are routing failures, so most of what follows is about routing: one
 * classification, one resolver, and a mapping from state to dialog that no
 * caller can bypass.
 */

const nav = (userAgent, maxTouchPoints = 0, standalone = undefined) =>
  ({ userAgent, maxTouchPoints, ...(standalone === undefined ? {} : { standalone }) });

const noMatch = { matchMedia: () => ({ matches: false }) };

const UA = {
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iPhone26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iPhoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
  iPhoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/604.1',
  iPhoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0 Mobile/15E148 Safari/604.1',
  iPadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
};

/* A window that implements the install prompt event, and one that does not. */
const chromiumWin = { ...noMatch, onbeforeinstallprompt: null };
const webkitWin = { ...noMatch };

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

test('Chrome on iOS is iOS Chrome, and is neither Safari nor Chromium', () => {
  /*
   * THE SECOND REPORTED BUG, AT ITS ROOT.
   *
   * Every install concept named after Chrome belongs to a different engine.
   * On iOS this IS WebKit: no beforeinstallprompt, no install API, and
   * nothing whatsoever to wait for.
   */
  const n = nav(UA.iPhoneChrome);
  assert.equal(isIOS(n), true);
  assert.equal(isIOSChrome(n), true);
  assert.equal(isIOSSafari(n), false);
  assert.equal(classifyPlatform(n, webkitWin), 'ios-chrome');
  assert.equal(isChromiumPlatform('ios-chrome'), false,
    'iOS Chrome was classified as a platform with a native install event');
});

test('a user agent shaped like Chrome on a phone is not enough to be Chromium', () => {
  /*
   * The decisive case, and the one a UA-sniffing implementation gets wrong:
   * the same window capability, the same "Chrome"-ish string, two different
   * operating systems, two different answers.
   */
  assert.equal(classifyPlatform(nav(UA.android), chromiumWin), 'android-chromium');
  assert.equal(classifyPlatform(nav(UA.iPhoneChrome), chromiumWin), 'ios-chrome',
    'iOS was decided after Chromium, so an iPhone reached the Android branch');
});

test('Firefox and Edge on iOS are the third iOS platform, not Safari', () => {
  assert.equal(classifyPlatform(nav(UA.iPhoneFirefox), webkitWin), 'ios-other');
  assert.equal(classifyPlatform(nav(UA.iPhoneEdge), webkitWin), 'ios-other');
  assert.equal(isIOSOtherBrowser(nav(UA.iPhoneFirefox)), true);
});

test('desktop Chromium and Android Chromium are told apart', () => {
  // Same install event, different sentence about where the app ends up.
  assert.equal(classifyPlatform(nav(UA.mac), chromiumWin), 'desktop-chromium');
  assert.equal(classifyPlatform(nav(UA.android), chromiumWin), 'android-chromium');
  assert.equal(isChromiumPlatform('desktop-chromium'), true);
  assert.equal(isChromiumPlatform('android-chromium'), true);
});

test('a browser with no install event at all is unsupported', () => {
  // Desktop Safari and desktop Firefox. Nothing to offer and nothing to say.
  assert.equal(classifyPlatform(nav(UA.mac), webkitWin), 'unsupported');
});

test('iPad is distinguished, because Safari puts Share somewhere else on it', () => {
  assert.equal(isIPad(nav(UA.iPadOS, 5)), true);
  assert.equal(isIPad(nav(UA.iPhone)), false);
});

test('the iOS version is read, because Safari moved its Share button', () => {
  /*
   * iOS 26 made Compact the default tab bar layout, and Compact has no Share
   * control on screen -- it is behind the ••• beside the address bar. "Tap
   * Share at the bottom" is wrong directions on a current iPhone with default
   * settings, which is the same failure the iPad wording exists to prevent.
   */
  assert.equal(iosMajorVersion(nav(UA.iPhone)), 17);
  assert.equal(iosMajorVersion(nav(UA.iPhone26)), 26);
  assert.equal(iosMajorVersion(nav(UA.android)), null);
});

/* ── standalone detection ───────────────────────────────────────────── */

test('iOS reports standalone through its own navigator flag', () => {
  assert.equal(isStandalone(nav(UA.iPhone, 0, true), noMatch), true);
  assert.equal(isStandalone(nav(UA.iPhone, 0, false), noMatch), false);
});

test('everyone else reports standalone through the display-mode query', () => {
  const win = { matchMedia: (q) => ({ matches: /standalone/.test(q) }) };
  assert.equal(isStandalone(nav(UA.android), win), true);
});

test('standalone is a platform, and it is the first thing decided', () => {
  const win = { matchMedia: (q) => ({ matches: /standalone/.test(q) }) };
  assert.equal(classifyPlatform(nav(UA.android), win), 'standalone');
  assert.equal(classifyPlatform(nav(UA.iPhone, 0, true), noMatch), 'standalone');
});

/* ── evidence of an existing install ────────────────────────────────── */

test('being the app, or watching it install, is confirmation rather than a guess', () => {
  const base = { standalone: false, installedHere: false, relatedApps: null, marker: false };
  assert.equal(resolveEvidence({ ...base, standalone: true }), 'confirmed');
  assert.equal(resolveEvidence({ ...base, installedHere: true }), 'confirmed');
  assert.equal(resolveEvidence({ ...base, relatedApps: true }), 'confirmed',
    'the browser answered that our own web app is installed, and was not believed');
});

test('a remembered install is likely, not confirmed, because it can go stale', () => {
  const base = { standalone: false, installedHere: false, relatedApps: null, marker: true };
  assert.equal(resolveEvidence(base), 'likely');
});

test('"has not answered yet" is not the same as "no"', () => {
  /*
   * getInstalledRelatedApps is asynchronous, and a null read as false would
   * declare the app missing during the very first render of every page --
   * which is the moment the control is most likely to be pressed.
   */
  const base = { standalone: false, installedHere: false, marker: false };
  assert.equal(resolveEvidence({ ...base, relatedApps: null }), 'none');
  assert.equal(resolveEvidence({ ...base, relatedApps: false }), 'none');
  assert.equal(resolveEvidence({ ...base, relatedApps: true }), 'confirmed');
});

test('the marker is device-local, and survives being read from a broken store', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(hasInstalledMarker(storage), false);
  rememberInstalled(1000, storage);
  assert.equal(hasInstalledMarker(storage), true);
  forgetInstalled(storage);
  assert.equal(hasInstalledMarker(storage), false);

  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.equal(hasInstalledMarker(hostile), false, 'a throwing store must not throw through');
  assert.doesNotThrow(() => rememberInstalled(1, hostile));
  assert.doesNotThrow(() => forgetInstalled(hostile));
});

/* ── dismissal ──────────────────────────────────────────────────────── */

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('a dismissal is respected, then expires', () => {
  const day = 24 * 60 * 60 * 1000;
  const store = fakeStorage();
  rememberMuted(0, store);
  assert.equal(wasMuted(0, store), true);
  assert.equal(wasMuted((DISMISS_DAYS - 1) * day, store), true);
  assert.equal(wasMuted((DISMISS_DAYS + 1) * day, store), false);
});

test('a corrupt or absent dismissal is treated as not dismissed', () => {
  assert.equal(wasMuted(0, fakeStorage()), false);
  assert.equal(wasMuted(0, fakeStorage({ homatch_install_dismissed_at: 'soon' })), false);
});

test('storage that throws does not permanently suppress the CTA', () => {
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(wasMuted(0, hostile), false);
  assert.doesNotThrow(() => rememberMuted(0, hostile));
});

/* ------------------------------------------------------------------ *
 * THE RESOLVER                                                        *
 * ------------------------------------------------------------------ */

const PLATFORMS = [
  'standalone', 'ios-safari', 'ios-chrome', 'ios-other',
  'android-chromium', 'desktop-chromium', 'unsupported',
];
const EVIDENCE = ['confirmed', 'likely', 'none'];

/** Every combination of inputs the resolver can be given. */
function everyCase() {
  const out = [];
  for (const platform of PLATFORMS) {
    for (const hasNativePrompt of [false, true]) {
      for (const evidence of EVIDENCE) {
        for (const checking of [false, true]) {
          out.push({ platform, hasNativePrompt, evidence, checking });
        }
      }
    }
  }
  return out;
}

test('an installed app never offers to install itself', () => {
  for (const c of everyCase().filter((x) => x.platform === 'standalone')) {
    assert.equal(resolveInstallState(c), 'standalone',
      `standalone was overridden by ${JSON.stringify(c)}`);
  }
});

test('a held prompt means one tap, and never an explanatory dialog first', () => {
  // A Homatch modal before the browser's own modal is a tap we invented.
  const state = resolveInstallState({
    platform: 'android-chromium', hasNativePrompt: true, evidence: 'none', checking: false,
  });
  assert.equal(state, 'native-ready');
  assert.equal(dialogForState(state), null, 'a dialog stands between the tap and the install');
});

test('a stale installed marker never blocks a browser that is offering', () => {
  /*
   * The reason the marker is safe to keep at all. Somebody uninstalls
   * Homatch; Chromium starts offering again; the memory of the old install
   * must not turn that offer into "already installed". Capability outranks
   * memory, in that direction only.
   */
  for (const evidence of EVIDENCE) {
    assert.equal(
      resolveInstallState({
        platform: 'android-chromium', hasNativePrompt: true, evidence, checking: false,
      }),
      'native-ready',
      `evidence "${evidence}" outranked a live offer from the browser`,
    );
  }
});

test('installed in an ordinary tab is answered immediately, not waited out', () => {
  /*
   * THE FIRST REPORTED BUG.
   *
   * Install Homatch, close the browser, come back to the website. Chromium
   * does not offer an install for an app that is already installed, so there
   * is no event and there never will be -- and the old control sat in
   * CHECKING, said "Preparing install…", and after twelve seconds concluded
   * nothing. Pressing it did nothing a person could see.
   */
  for (const evidence of ['confirmed', 'likely']) {
    for (const checking of [false, true]) {
      const state = resolveInstallState({
        platform: 'android-chromium', hasNativePrompt: false, evidence, checking,
      });
      assert.equal(state, 'installed', `evidence "${evidence}", checking=${checking}`);
      assert.equal(dialogForState(state), 'installed',
        'the press had nothing immediate to answer with');
    }
  }
});

test('no iOS platform can ever be left waiting for beforeinstallprompt', () => {
  /*
   * THE SECOND REPORTED BUG, AS A PROPERTY RATHER THAN A PROMISE.
   *
   * There is no arrangement of the other inputs that puts an iPhone into the
   * Chromium waiting state, because that state is reachable only from the two
   * Chromium platforms. Twelve seconds of "Preparing install…" on an iPhone
   * is not merely unlikely; there is no path to it.
   */
  const iosCases = everyCase().filter((x) => isIOSPlatform(x.platform));
  for (const c of iosCases) {
    assert.notEqual(resolveInstallState(c), 'checking',
      `${JSON.stringify(c)} put an iOS browser into a wait`);
  }

  /*
   * And on every iOS browser that exists today -- none of which implements
   * the event, which `canInstall` is the capability query for -- the answer
   * is one a person can act on now: their own Share menu, or the fact that
   * Homatch is already there.
   *
   * Deliberately NOT asserted: that a held prompt on iOS would be ignored. If
   * WebKit ever ships the event, using it is the right answer, and refusing a
   * real capability because of the operating system is the mistake this whole
   * file exists to prevent -- just pointing the other way.
   */
  const settled = ['ios-safari', 'ios-chrome', 'ios-other', 'installed'];
  for (const c of iosCases.filter((x) => !x.hasNativePrompt)) {
    assert.ok(settled.includes(resolveInstallState(c)),
      `${JSON.stringify(c)} left an iPhone with nothing it can act on`);
  }
});

test('each iOS browser gets its own flow, and Chrome is not sent to Safari', () => {
  /*
   * "Only Safari can add to the Home Screen" was true until iOS 16.4, which
   * let third-party browsers offer the same thing. Chrome, Edge, Firefox and
   * DuckDuckGo on iOS all do. Telling a Chrome user to go to Safari was not a
   * smaller feature set -- it was wrong directions to a menu item already in
   * front of them.
   */
  const base = { hasNativePrompt: false, evidence: 'none', checking: false };
  assert.equal(resolveInstallState({ ...base, platform: 'ios-safari' }), 'ios-safari');
  assert.equal(resolveInstallState({ ...base, platform: 'ios-chrome' }), 'ios-chrome');
  assert.equal(resolveInstallState({ ...base, platform: 'ios-other' }), 'ios-other');
  assert.equal(dialogForState('ios-chrome'), 'ios-chrome',
    'iOS Chrome was answered with another browser’s instructions');
});

test('a browser that can do neither is offered nothing', () => {
  assert.equal(
    resolveInstallState({
      platform: 'unsupported', hasNativePrompt: false, evidence: 'none', checking: true,
    }),
    'unsupported',
  );
});

test('Chromium before and after it has made up its mind', () => {
  const base = { platform: 'android-chromium', hasNativePrompt: false, evidence: 'none' };
  assert.equal(resolveInstallState({ ...base, checking: true }), 'checking');
  assert.equal(resolveInstallState({ ...base, checking: false }), 'unavailable');
});

/* ------------------------------------------------------------------ *
 * THE ROUTING GUARANTEE                                               *
 * ------------------------------------------------------------------ */

const IOS_DIALOGS = ['ios-safari', 'ios-chrome', 'ios-other'];

test('NO CHROMIUM PLATFORM CAN REACH iPHONE INSTRUCTIONS, IN ANY COMBINATION', () => {
  /*
   * THE ACCEPTANCE RULE, PROVED BY ENUMERATION RATHER THAN BY ARGUMENT.
   *
   * The dialog is derived from the state; the state is derived from the
   * platform. So "can a Chrome user be shown Add to Home Screen instructions"
   * has a finite answer, and this computes all of it: every platform, both
   * prompt conditions, every evidence level, both clocks.
   *
   * Every earlier attempt at this bug was a condition inside a click handler,
   * and a condition is only as good as the next person to edit it.
   */
  const offenders = [];
  for (const c of everyCase()) {
    if (isIOSPlatform(c.platform)) continue;
    const kind = dialogForState(resolveInstallState(c));
    if (kind && IOS_DIALOGS.includes(kind)) offenders.push(`${JSON.stringify(c)} -> ${kind}`);
  }
  assert.deepEqual(offenders, [],
    `these non-iOS cases reach iOS instructions:\n  ${offenders.join('\n  ')}`);
});

test('and no iOS platform can reach a native prompt it does not have', () => {
  const offenders = [];
  for (const c of everyCase()) {
    if (!isIOSPlatform(c.platform)) continue;
    const kind = dialogForState(resolveInstallState(c));
    if (kind && !IOS_DIALOGS.includes(kind) && kind !== 'installed') {
      offenders.push(`${JSON.stringify(c)} -> ${kind}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n  '));
});

test('EVERY VISIBLE CONTROL HAS AN IMMEDIATE ANSWER TO A PRESS', () => {
  /*
   * The product rule, restated as a total function.
   *
   * Two states render no control at all. Two answer the press by talking to
   * the browser -- raising the held prompt, or recording the press until the
   * event lands. Every other state must have a dialog to open on the spot, or
   * there exists a visible control that ignores a tap.
   */
  const silent = ['standalone', 'unsupported'];
  const browserAnswers = ['native-ready', 'checking'];
  const seen = new Set(everyCase().map((c) => resolveInstallState(c)));
  const dead = [];
  for (const state of seen) {
    if (silent.includes(state) || browserAnswers.includes(state)) continue;
    if (!dialogForState(state)) dead.push(state);
  }
  assert.deepEqual(dead, [],
    `these states render a control with nothing to answer a press:\n  ${dead.join('\n  ')}`);
});

test('the states that render nothing are exactly the two that have nothing to say', () => {
  assert.equal(dialogForState('standalone'), null);
  assert.equal(dialogForState('unsupported'), null);
  assert.equal(dialogForState('unavailable'), 'unavailable',
    'a browser that declined still owes the person a sentence');
});

/* ------------------------------------------------------------------ *
 * REGISTRATION                                                        *
 * ------------------------------------------------------------------ */

/*
 * REGISTRATION MUST NOT DEPEND ON THE APP BOOTING.
 *
 * The registration used to sit below createRoot().render(), so anything that
 * threw on the way to rendering took installability with it — no worker, no
 * install prompt, no offline shell, and nothing in the UI to say why.
 *
 * It also no longer hangs off `load`. That event fires once, and a listener
 * attached after it has fired never runs at all.
 */
const main = readFileSync('src/main.tsx', 'utf8');

test('the service worker is registered before the app is mounted', () => {
  const registerAt = main.indexOf("serviceWorker.register('/sw.js')");
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

/* ------------------------------------------------------------------ *
 * THE MANIFEST                                                        *
 * ------------------------------------------------------------------ */

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));

test('the manifest lists Homatch as its own related app, or nothing can detect it', () => {
  /*
   * getInstalledRelatedApps() is the only signal that survives closing the
   * browser, and it answers about entries in `related_applications`. Without
   * a self-referential `webapp` entry it returns an empty array forever, and
   * "is Homatch already installed on this device" becomes unanswerable in an
   * ordinary tab -- which is the first reported bug.
   */
  const self = (manifest.related_applications ?? []).find((a) => a.platform === 'webapp');
  assert.ok(self, 'no webapp entry, so the browser can never tell us we are installed');
  assert.ok(self.url, 'the entry needs the manifest URL');
  assert.equal(self.id, manifest.id, 'the id must match the manifest id, or desktop ignores it');
});

test('listing a related app did not accidentally suppress installing the web app', () => {
  // `prefer_related_applications: true` tells the browser to promote a native
  // app INSTEAD of offering to install this one. It would silently remove the
  // native prompt on Android.
  assert.notEqual(manifest.prefer_related_applications, true);
});

/* ------------------------------------------------------------------ *
 * THE SOURCE, WHERE THE SHAPE MATTERS MORE THAN THE VALUE             *
 * ------------------------------------------------------------------ */

const INSTALL_SRC = readFileSync(join('src', 'components', 'common', 'InstallApp.tsx'), 'utf8');
const PWA_SRC = readFileSync(join('src', 'lib', 'pwa.ts'), 'utf8');

test('the component never names a dialog kind it could get wrong', () => {
  /*
   * There is exactly one setter, and its argument is DERIVED. A literal like
   * setDialog('ios-safari') in a click handler is how a Chrome user was shown
   * iPhone instructions in the first place, so writing one fails here rather
   * than being a judgement call.
   *
   * 'installed' is allowed, and only from the appinstalled effect: that is
   * not routing, it is reporting a fact the browser has just announced.
   */
  const bad = [];
  for (const m of INSTALL_SRC.matchAll(/setDialog\(([^)]*)\)/g)) {
    const arg = m[1].trim();
    const ok = arg === 'kind' || arg === 'null' || arg === "'installed'"
      || arg.startsWith('dialogForState(');
    if (!ok) bad.push(m[0]);
  }
  assert.deepEqual(bad, [],
    `these choose a dialog by hand instead of deriving it:\n  ${bad.join('\n  ')}`);
});

test('the component never decides an install route from a user agent', () => {
  /*
   * Platform classification happens once, in the store. A component that asks
   * "is this Safari" is a second classifier, and two classifiers disagree
   * eventually.
   *
   * isIPad and iosMajorVersion are exempt: they choose the WORDING of a step
   * that has already been routed, not the route.
   */
  const bad = [];
  for (const m of INSTALL_SRC.matchAll(/\bis(IOSSafari|IOSChrome|IOSOtherBrowser|Standalone|IOS)\(/g)) {
    bad.push(m[0]);
  }
  assert.deepEqual(bad, [],
    `the component re-derives the platform instead of reading the state:\n  ${bad.join('\n  ')}`);
});

test('no press is ever refused', () => {
  /*
   * A `disabled` install control was shipped once and the owner found it on
   * their phone: a primary CTA that looks pressable and ignores a press is
   * indistinguishable from a broken app. Removing the user's action is not a
   * way of fixing where the action goes.
   */
  assert.equal(/\bdisabled\b/.test(INSTALL_SRC), false,
    'something in the install control can be disabled');
});

test('no timeout can decide what a press means', () => {
  /* An earlier fix waited a guessed number of milliseconds and then opened
     instructions. Measurement showed the event arriving at 1668, 1791, 2145
     and 3687ms on the same site, so any such number is a coin flip. */
  assert.equal(/setTimeout[^\n]*setDialog/.test(INSTALL_SRC), false,
    'a timer opens a dialog');
});

test('the page listens for the install prompt exactly once, at module scope', () => {
  /*
   * Every control used to hold its own copy, captured by its own listener.
   * That works for exactly one control: the one already on screen when the
   * event arrives. The control inside the phone's menu is mounted when the
   * menu is opened -- always afterwards -- so it held nothing.
   */
  const listeners = PWA_SRC.match(/addEventListener\('beforeinstallprompt'/g) ?? [];
  assert.equal(listeners.length, 1, 'the prompt is captured in more than one place');
  assert.equal(/addEventListener\('beforeinstallprompt'/.test(INSTALL_SRC), false,
    'a component captures the prompt for itself');
  assert.match(PWA_SRC, /^wire\(\);$/m,
    'nothing calls wire() at module scope, so the listener depends on a component mounting');
});

test('an offer from the browser erases the memory that contradicts it', () => {
  /*
   * The stale-marker correction, at its source. Chromium does not offer to
   * install an app that is already installed, so the arrival of the event is
   * proof the remembered install is gone. Written here, at the event, rather
   * than in a component -- the fact belongs to the browser profile, not to
   * whatever happened to be mounted.
   */
  const handler = PWA_SRC.slice(
    PWA_SRC.indexOf("addEventListener('beforeinstallprompt'"),
    PWA_SRC.indexOf("addEventListener('appinstalled'"),
  );
  assert.match(handler, /forgetInstalled\(\)/,
    'a live offer does not clear the remembered install, so a stale marker outlives the app');
  const installed = PWA_SRC.slice(PWA_SRC.indexOf("addEventListener('appinstalled'"));
  assert.match(installed, /rememberInstalled\(\)/,
    'the one certain moment is not written down, so tomorrow starts from nothing');
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
  assert.match(INSTALL_SRC, /bg-white\/\[0?\.\d+\] text-white ring-1 ring-inset/, 'dark tone has its own surface');
  assert.match(INSTALL_SRC, /bg-gold-soft text-gold-ink ring-1 ring-inset/, 'light tone has its own surface');
});

test('no opacity modifier names a rule Tailwind will not generate', () => {
  /*
   * THE TEST THAT SHOULD HAVE EXISTED.
   *
   * A previous version pinned the literal `bg-white/12` — and `/12` is not on
   * Tailwind's opacity scale, which goes in fives. It generates NOTHING. The
   * button was fully transparent on every dark surface it ever appeared on,
   * and the test asserting its appearance was pinning the bug in place.
   *
   * Run across the whole tree it found six more, in four other components:
   * every one looked deliberate in the source and produced nothing.
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

/* ------------------------------------------------------------------ *
 * THE STORE, WHERE THERE IS NO BROWSER                                *
 * ------------------------------------------------------------------ */

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
   * person's second tap does nothing.
   *
   * Asserted structurally because the behaviour cannot be reached without a
   * browser: the discard must sit AFTER the call it depends on.
   */
  const body = PWA_SRC.slice(
    PWA_SRC.indexOf('export async function showInstallPrompt'),
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

test('an accepted install is written down, not merely noted in memory', () => {
  const body = PWA_SRC.slice(PWA_SRC.indexOf('export async function showInstallPrompt'));
  const accepted = body.slice(body.indexOf("outcome === 'accepted'"));
  assert.match(accepted.slice(0, 220), /rememberInstalled\(\)/,
    'accepting the browser dialog leaves nothing for the next visit to read');
});
