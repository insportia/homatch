// BACK MEANS THE PREVIOUS MEANINGFUL SCREEN.
//
// The rules live in lib/backNavigation.ts with no React in them, precisely
// so this file can state them as facts: which screen is the parent of
// which, and how the in-app counter decides between history and parent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parentRouteFor, canGoBackInApp, noteInAppNavigation, __resetNavigationCountForTests,
  noteHistoryEntry, stepsToPreviousScreen, previousScreen, safeReturnPath,
} from '../backNavigation.ts';
import { findBuyersSearchLink } from '../notifications/feed.ts';

test('the counter: nothing behind us until a real in-app navigation happens', () => {
  __resetNavigationCountForTests();
  assert.equal(canGoBackInApp(), false, 'a deep link has no Homatch history');
  noteInAppNavigation();
  assert.equal(canGoBackInApp(), true);
  __resetNavigationCountForTests();
});

test('detail screens go to their own list, not to the dashboard', () => {
  assert.equal(parentRouteFor('/verify/abc'), '/verify');
  assert.equal(parentRouteFor('/contracts/abc'), '/contracts');
  assert.equal(parentRouteFor('/deal-rooms/xyz'), '/deal-rooms');
  assert.equal(parentRouteFor('/outreach/contacts/c1'), '/outreach/contacts');
  assert.equal(parentRouteFor('/outreach/agents/a1'), '/outreach/agents');
});

test('a property belongs to the owner workspace', () => {
  assert.equal(parentRouteFor('/property/p1'), '/property');
  assert.equal(parentRouteFor('/property/add'), '/property');
  assert.equal(parentRouteFor('/property/p1/matches'), '/property/p1');
});

test('communications subflows return to their channel', () => {
  assert.equal(parentRouteFor('/outreach/campaigns/new'), '/outreach/campaigns');
  assert.equal(parentRouteFor('/outreach/contacts/import'), '/outreach/contacts');
  assert.equal(parentRouteFor('/outreach/whatsapp/inbox'), '/outreach/whatsapp');
  assert.equal(parentRouteFor('/outreach/whatsapp/templates'), '/outreach/whatsapp');
  assert.equal(parentRouteFor('/outreach/whatsapp/campaigns/new'), '/outreach/whatsapp');
  assert.equal(parentRouteFor('/outreach/email/contacts/import'), '/outreach/email');
  assert.equal(parentRouteFor('/outreach/email'), '/outreach');
});

test('notification destinations all have somewhere to go', () => {
  for (const path of ['/mortgage', '/for-expats/plan', '/for-expats/georgia/visas',
    '/credits', '/viewings', '/notifications', '/brokers']) {
    assert.notEqual(parentRouteFor(path), null, `${path} must have a parent`);
  }
  assert.equal(parentRouteFor('/for-expats/plan'), '/for-expats/georgia');
  assert.equal(parentRouteFor('/for-expats/georgia/visas'), '/for-expats/georgia');
});

test('a mortgage term goes back to the glossary, the glossary to the calculator', () => {
  assert.equal(parentRouteFor('/mortgage/terms/effective-rate'), '/mortgage/terms');
  assert.equal(parentRouteFor('/mortgage/terms'), '/mortgage');
});

test('top-level screens with no obvious container stay null (component decides home)', () => {
  assert.equal(parentRouteFor('/dashboard'), null);
  assert.equal(parentRouteFor('/'), null);
  assert.equal(parentRouteFor('/find-property'), null);
});

test('Find Buyers 3.0: result pages go back to the dashboard, details to their result page', () => {
  assert.equal(parentRouteFor('/property/p1/buyers/external'), '/property/p1/matches');
  assert.equal(parentRouteFor('/property/p1/buyers/internal'), '/property/p1/matches');
  assert.equal(parentRouteFor('/property/p1/buyers/opportunity/abc'), '/property/p1/buyers/external');
  assert.equal(parentRouteFor('/property/p1/buyers/lead/l-42'), '/property/p1/buyers/external', 'a lead detail returns to the live results page');
  assert.equal(parentRouteFor('/property/p1/buyers/lead/l-42/'), '/property/p1/buyers/external');
  assert.equal(parentRouteFor('/property/p1/buyer/demo'), '/property/p1/buyers/internal');
  assert.equal(parentRouteFor('/property/p1/leads'), '/property/p1/buyers/internal');
  assert.equal(parentRouteFor('/property/p1/matches'), '/property/p1');
});

/* ── Back means the previous SCREEN, not the previous history entry ─────── */

test('same-screen entries (a page number, a fragment) are skipped', () => {
  __resetNavigationCountForTests();
  noteHistoryEntry(0, '/property/p1/matches');
  noteHistoryEntry(1, '/property/p1/buyers/external');
  noteHistoryEntry(2, '/property/p1/buyers/external'); // ?rp=2 pushed by an older build
  noteHistoryEntry(3, '/property/p1/buyers/external/'); // trailing slash is the same screen
  assert.equal(stepsToPreviousScreen(3, '/property/p1/buyers/external'), 3);
  assert.deepEqual(previousScreen(3, '/property/p1/buyers/external'), { steps: 3, pathname: '/property/p1/matches' });
  assert.equal(stepsToPreviousScreen(1, '/property/p1/buyers/external'), 1);
  __resetNavigationCountForTests();
});

test('unknown history answers null, so the caller falls back to the parent', () => {
  __resetNavigationCountForTests();
  assert.equal(stepsToPreviousScreen(0, '/property/p1'), null, 'first entry: nothing behind');
  assert.equal(stepsToPreviousScreen(null, '/property/p1'), null, 'no router index');
  assert.equal(stepsToPreviousScreen(5, '/property/p1'), null, 'reload: entries never seen');
  noteHistoryEntry(3, '/property/p1/matches');
  noteHistoryEntry(4, '/property/p1/edit');
  assert.equal(stepsToPreviousScreen(4, '/property/p1/edit'), 1);
  noteHistoryEntry(4, '/property/p1/matches'); // replaced in place
  assert.equal(stepsToPreviousScreen(4, '/property/p1/matches'), null, 'a gap below is unknown, not guessed');
  __resetNavigationCountForTests();
});

test('no loops: only same-screen entries behind → null, never 0 steps', () => {
  __resetNavigationCountForTests();
  noteHistoryEntry(0, '/property/p1/buyers/external');
  noteHistoryEntry(1, '/property/p1/buyers/external');
  noteHistoryEntry(2, '/property/p1/buyers/external');
  assert.equal(stepsToPreviousScreen(2, '/property/p1/buyers/external'), null);
  noteHistoryEntry(-1, '/x');
  noteHistoryEntry(1.5, '/x');
  noteHistoryEntry(undefined, '/x');
  assert.equal(stepsToPreviousScreen(2, '/property/p1/buyers/external'), null, 'bad indexes are ignored');
  __resetNavigationCountForTests();
});

test('editing a property returns to that property', () => {
  assert.equal(parentRouteFor('/property/p1/edit'), '/property/p1');
  assert.equal(parentRouteFor('/property/p1/edit/'), '/property/p1');
});

test('a handed return path is accepted only inside the app', () => {
  assert.equal(safeReturnPath('/property/p1/matches'), '/property/p1/matches');
  assert.equal(safeReturnPath('/property/p1/buyers/external?job=j1'), '/property/p1/buyers/external?job=j1');
  assert.equal(safeReturnPath('/property'), '/property');
  assert.equal(safeReturnPath('/property?view=grid'), '/property?view=grid');
  for (const bad of ['//evil.example/property/p1', 'https://evil.example/property/p1', 'javascript:alert(1)',
    '/\\evil.example', '/dashboard', '/propertyx', '', null, 42, '/property/p1\n']) {
    assert.equal(safeReturnPath(bad), null, `${String(bad)} is refused`);
  }
});

/* ── Notifications open THE search ─────────────────────────────────────── */

test('an old Find Buyers notice (generic /matches link) opens its own search', () => {
  assert.equal(findBuyersSearchLink('/property/p1/matches', 'matching_jobs', 'j-1'), '/property/p1/buyers/external?job=j-1');
  assert.equal(findBuyersSearchLink('/property/p1/matches/', 'matching_jobs', 'j-1'), '/property/p1/buyers/external?job=j-1');
  assert.equal(findBuyersSearchLink('/property/p1/buyers/external?job=j-2', 'matching_jobs', 'j-1'),
    '/property/p1/buyers/external?job=j-2', 'a specific link is the producer\'s decision');
  assert.equal(findBuyersSearchLink('/property/p1/matches', 'properties', 'j-1'), '/property/p1/matches', 'other entities keep the link');
  assert.equal(findBuyersSearchLink('/property/p1/matches', 'matching_jobs', null), '/property/p1/matches');
  assert.equal(findBuyersSearchLink('/property/p1/matches', 'matching_jobs', '../x'), '/property/p1/matches', 'odd ids are not spliced in');
  assert.equal(findBuyersSearchLink(null, 'matching_jobs', 'j-1'), null);
});
