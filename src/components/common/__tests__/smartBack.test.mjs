import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parentRouteFor } from '../../../lib/backNavigation.ts';

/*
 * The back button's job is to never throw a customer out of Homatch.
 *
 * `navigate(-1)` does exactly that for anyone who arrived on a deep link —
 * from an email, a shared URL, a search result — because the entry behind
 * them is not ours. The component falls back to the CONTAINING screen in
 * that case, and this is the table of what contains what.
 *
 * Every destination asserted here has to be a route the router actually
 * serves; a fallback to a 404 is the same trap in a different costume.
 */

test('a verification case falls back to the verification centre', () => {
  assert.equal(parentRouteFor('/verify/abc-123'), '/verify');
});

test('a property matches list falls back to that same property', () => {
  // Not to the dashboard: the containing screen is the property itself.
  assert.equal(parentRouteFor('/property/p-1/matches'), '/property/p-1');
});

test('a property detail falls back to the dashboard', () => {
  assert.equal(parentRouteFor('/property/p-1'), '/dashboard');
});

test('the property creation flows fall back to the dashboard', () => {
  for (const p of ['/property/add', '/property/import', '/property/create']) {
    assert.equal(parentRouteFor(p), '/dashboard', p);
  }
});

test('a nested outreach screen falls back to the outreach hub', () => {
  for (const p of ['/outreach/email', '/outreach/calls', '/outreach/insights', '/outreach/communities']) {
    assert.equal(parentRouteFor(p), '/outreach', p);
  }
});

test('the outreach hub itself falls back to the dashboard, not to itself', () => {
  // A fallback that returns the current path is an infinite no-op.
  assert.equal(parentRouteFor('/outreach'), '/dashboard');
});

test('a document workspace case falls back to the workspace list', () => {
  assert.equal(parentRouteFor('/deal-rooms/room-9'), '/deal-rooms');
});

test('single-level product screens fall back to the dashboard', () => {
  for (const p of ['/ai', '/chat', '/live-chat', '/activity', '/notifications', '/credits', '/profile', '/viewings', '/active-search']) {
    assert.equal(parentRouteFor(p), '/dashboard', p);
  }
});

test('a trailing slash does not defeat the match', () => {
  assert.equal(parentRouteFor('/verify/abc-123/'), '/verify');
  assert.equal(parentRouteFor('/outreach/email/'), '/outreach');
});

test('the more specific pattern wins over the more general one', () => {
  // /property/:id/matches and /property/:id both match a two-segment path
  // prefix; order in the table is what keeps them apart.
  assert.notEqual(parentRouteFor('/property/p-1/matches'), '/dashboard');
});

test('a page with no obvious parent returns null rather than guessing', () => {
  // The component then sends the customer home, which is a deliberate
  // decision made once rather than a wrong parent invented per route.
  assert.equal(parentRouteFor('/'), null);
  assert.equal(parentRouteFor('/some-future-page'), null);
});

test('no fallback ever points at a path the table would bounce again', () => {
  // A fallback whose own parent is itself would loop.
  const sources = [
    '/verify/x', '/property/p/matches', '/property/p', '/property/add',
    '/deal-rooms/d', '/outreach/email', '/ai', '/chat', '/credits',
  ];
  for (const s of sources) {
    const target = parentRouteFor(s);
    assert.ok(target, `${s} produced no fallback`);
    assert.notEqual(target, s, `${s} falls back to itself`);
  }
});
