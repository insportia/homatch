import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISMISS_DAYS, isIOS, isIOSSafari, isStandalone, rememberDismissal,
  resolveInstallMode, wasDismissed,
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
  rememberDismissal(t0, store);
  assert.equal(wasDismissed(t0 + 1000, store), true, 'still dismissed a second later');
  const justInside = t0 + (DISMISS_DAYS * 24 * 60 * 60 * 1000) - 1000;
  assert.equal(wasDismissed(justInside, store), true, 'still dismissed just inside the window');
  const justOutside = t0 + (DISMISS_DAYS * 24 * 60 * 60 * 1000) + 1000;
  assert.equal(wasDismissed(justOutside, store), false, 'offered again after the window');
});

test('a corrupt or absent dismissal is treated as not dismissed', () => {
  assert.equal(wasDismissed(Date.now(), memoryStorage()), false);
  assert.equal(wasDismissed(Date.now(), memoryStorage({ homatch_install_dismissed_at: 'nonsense' })), false);
});

test('storage that throws does not permanently suppress the CTA', () => {
  const hostile = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(wasDismissed(Date.now(), hostile), false);
  assert.doesNotThrow(() => rememberDismissal(Date.now(), hostile));
});

/* ── the decision ───────────────────────────────────────────────────── */

test('an installed app never offers to install itself', () => {
  // Standalone beats everything, including a prompt Chromium is still holding.
  assert.equal(resolveInstallMode({
    standalone: true, hasNativePrompt: true, iosSafari: true, dismissed: false,
  }), 'standalone');
});

test('Chromium with a held prompt gets the one-tap install', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false, dismissed: false,
  }), 'native');
});

test('iOS Safari gets instructions, never a native prompt', () => {
  // The whole point: there is no API here, so the mode must not be 'native'.
  const mode = resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: true, dismissed: false,
  });
  assert.equal(mode, 'ios-manual');
  assert.notEqual(mode, 'native');
});

test('a browser that can do neither is offered nothing', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: false, dismissed: false,
  }), 'unavailable');
});

test('a dismissal suppresses both affordances but not standalone', () => {
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: true, iosSafari: false, dismissed: true,
  }), 'unavailable');
  assert.equal(resolveInstallMode({
    standalone: false, hasNativePrompt: false, iosSafari: true, dismissed: true,
  }), 'unavailable');
  assert.equal(resolveInstallMode({
    standalone: true, hasNativePrompt: false, iosSafari: false, dismissed: true,
  }), 'standalone');
});
