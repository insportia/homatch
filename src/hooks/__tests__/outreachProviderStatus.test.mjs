import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * AN UNRECOGNISED PROVIDER STATUS MUST NOT KILL THE PAGE.
 *
 * The hook fetches whether each outreach channel is really sending or only
 * pretending. Its documented contract has always been: return null when it
 * cannot tell, and let callers fall back to the conservative assume-mock
 * message. What it actually did was CAST whatever came back to the expected
 * type. A payload without the three channels then satisfied `if (data)`, and
 * the pages read `status.email.real` on an undefined `status.email`.
 *
 * The result was not a wrong banner. It was "An application error has
 * occurred" in place of the entire Email Campaigns, SMS Campaigns and AI Call
 * Center screens: no campaign list, no navigation, nothing. Found by
 * rendering the three routes in a browser, where all three were dead.
 *
 * These assertions are source-level because the property is about a shape
 * check and three JSX branches, and holds with no network and no provider.
 */

const hook = readFileSync('src/hooks/useOutreachProviderStatus.ts', 'utf8');
const PAGES = {
  email: readFileSync('src/pages/outreach/EmailCampaignsPage.tsx', 'utf8'),
  sms: readFileSync('src/pages/outreach/SmsCampaignsPage.tsx', 'utf8'),
  calling: readFileSync('src/pages/outreach/AiCallCenterPage.tsx', 'utf8'),
};

test('the hook checks the payload instead of asserting it', () => {
  assert.match(hook, /function asProviderStatus\(data: unknown\): OutreachProviderStatus \| null/);
  assert.match(hook, /if \(!channel\(d\.email\) \|\| !channel\(d\.sms\) \|\| !channel\(d\.calling\)\) return null;/);
  // The cast that caused this must not come back.
  assert.equal(
    hook.includes('setStatus(data as OutreachProviderStatus)'), false,
    'casting the payload is what made a bad response a crash',
  );
});

test('every channel is read defensively at every call site', () => {
  // Belt as well as braces: the hook now refuses a bad shape, and the pages
  // no longer depend on it having done so.
  for (const [channel, src] of Object.entries(PAGES)) {
    const unsafe = new RegExp(`providerStatus\\??\\.${channel}\\.`);
    assert.equal(
      unsafe.test(src), false,
      `${channel}: providerStatus.${channel}. is read without a guard, which is the exact crash`,
    );
  }
});

test('checking is distinguished from could not tell', () => {
  // `!providerStatus` was used for both, so a request that finished without a
  // usable answer left the banner saying "Checking provider status…" forever.
  for (const [channel, src] of Object.entries(PAGES)) {
    assert.match(src, /loading: providerLoading/,
      `${channel}: the page does not know whether the request is still in flight`);
    assert.match(src, /\{providerLoading\s*\n?\s*\? t\('outreach_status_checking'\)/,
      `${channel}: "checking" is not tied to the request actually being in flight`);
  }
});

test('an unknown status still reads as not sending', () => {
  // The conservative fallback is the whole reason null is an acceptable
  // return value. Claiming a channel is live when we could not confirm it
  // would be the one genuinely dangerous outcome here.
  for (const [channel, src] of Object.entries(PAGES)) {
    assert.match(
      src, new RegExp(`providerStatus\\?\\.${channel}\\?\\.real`),
      `${channel}: the "really sending" branch must require a confirmed status`,
    );
  }
  assert.match(hook, /callers should treat null as/);
});
