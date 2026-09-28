// BACK MEANS THE PREVIOUS MEANINGFUL SCREEN.
//
// The rules live in lib/backNavigation.ts with no React in them, precisely
// so this file can state them as facts: which screen is the parent of
// which, and how the in-app counter decides between history and parent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parentRouteFor, canGoBackInApp, noteInAppNavigation, __resetNavigationCountForTests,
} from '../backNavigation.ts';

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

test('top-level screens with no obvious container stay null (component decides home)', () => {
  assert.equal(parentRouteFor('/dashboard'), null);
  assert.equal(parentRouteFor('/'), null);
  assert.equal(parentRouteFor('/find-property'), null);
});
