// THE CAPABILITY MATRIX MUST NOT FLATTER META.
//
// Every assertion here is about NOT claiming access. The failure mode this file
// guards is the one the brief named: "Logging into Facebook does NOT
// automatically mean Homatch can read arbitrary Facebook groups/posts/comments."
//
// The single most important test is the first one. Facebook Groups is the
// capability the product most wants, and Meta removed it on 2024-04-22. A matrix
// that recorded it as REQUIRES_APP_REVIEW would send an operator to submit a
// review for an API that no longer exists, and they would wait for an answer
// that never comes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  META_CAPABILITY_MATRIX,
  META_CAPABILITIES_VERIFIED_ON,
  metaCapabilitySpec,
  permanentlyUnavailable,
  resolveMetaCapabilities,
  capabilityEnabled,
  requestableScopes,
} from '../social/meta-capabilities.ts';

test('FACEBOOK GROUPS IS UNAVAILABLE, NOT PENDING REVIEW', () => {
  for (const capability of ['FACEBOOK_GROUP_LIST', 'FACEBOOK_GROUP_POSTS', 'FACEBOOK_GROUP_COMMENTS']) {
    const spec = metaCapabilitySpec(capability);
    assert.equal(spec.availability, 'UNAVAILABLE', `${capability} claims ${spec.availability}`);
    /* No permission to request, and no step that would help. Both empty, or the
       Admin screen would offer somebody a door that opens onto nothing. */
    assert.deepEqual(spec.permissions, [], `${capability} names a permission that cannot be granted`);
    assert.deepEqual(spec.externalSteps, [], `${capability} tells an operator to do something futile`);
    /* And the reason has to carry the evidence, not an assertion. */
    assert.match(spec.evidence, /Groups API|No API/);
  }
  assert.match(metaCapabilitySpec('FACEBOOK_GROUP_LIST').evidence, /2024-04-22/,
    'the removal date is not recorded, so nobody can check the claim');
});

test('no granted scope can resurrect a removed API', () => {
  /*
   * The adversarial case: a connection that somehow reports every permission
   * Meta ever had. Group access must still be UNAVAILABLE, because availability
   * is a fact about Meta and not about our token.
   */
  const resolved = resolveMetaCapabilities([
    'public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_read_user_content',
    'instagram_basic', 'instagram_manage_comments', 'instagram_manage_insights',
    // Permissions that no longer exist, offered here precisely to be ignored.
    'publish_to_groups', 'groups_access_member_info', 'user_managed_groups',
  ]);

  for (const capability of permanentlyUnavailable()) {
    assert.equal(capabilityEnabled(resolved, capability), false,
      `${capability} was enabled by a granted scope, which cannot be true`);
  }
  assert.equal(capabilityEnabled(resolved, 'FACEBOOK_GROUP_POSTS'), false);
  assert.equal(capabilityEnabled(resolved, 'FACEBOOK_PUBLIC_SEARCH'), false);
});

test('we never REQUEST a permission Meta has removed', () => {
  /*
   * Sending a dead permission gets the whole authorization rejected, and the
   * operator sees "authorization failed" with no clue that the cause was a
   * string we chose.
   */
  const scopes = requestableScopes();
  for (const dead of ['publish_to_groups', 'groups_access_member_info', 'user_managed_groups']) {
    assert.equal(scopes.includes(dead), false, `${dead} is still being requested`);
  }
  /* And the live ones are all there, or the connection is useless. */
  for (const live of ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content',
    'instagram_basic', 'instagram_manage_comments']) {
    assert.ok(scopes.includes(live), `${live} is not requested, so that capability can never work`);
  }
});

test('a partial grant enables only what was actually granted', () => {
  /*
   * A user can untick individual permissions on Meta's own consent screen. The
   * defect this prevents: treating the REQUESTED scopes as the granted ones, so
   * an adapter attempts a call that 403s — and a 403 nobody classified looks
   * exactly like an empty group.
   */
  const resolved = resolveMetaCapabilities(['public_profile', 'pages_show_list']);

  assert.equal(capabilityEnabled(resolved, 'FACEBOOK_LOGIN'), true);
  assert.equal(capabilityEnabled(resolved, 'FACEBOOK_PAGE_LIST'), true);
  assert.equal(capabilityEnabled(resolved, 'FACEBOOK_PAGE_POSTS'), false,
    'page posts were enabled without pages_read_engagement');

  const posts = resolved.find((r) => r.capability === 'FACEBOOK_PAGE_POSTS');
  assert.equal(posts.state, 'PERMISSION_MISSING');
  assert.deepEqual(posts.missingPermissions, ['pages_read_engagement']);
  assert.match(posts.reason, /did not grant/);
});

test('a capability whose dependency is missing says DEPENDENCY_MISSING, not PERMISSION_MISSING', () => {
  /*
   * Two different problems with two different fixes. "You are missing a
   * permission" sends somebody to App Review; "the thing this reads through is
   * not working" sends them to fix that first.
   */
  const resolved = resolveMetaCapabilities([
    'public_profile', 'instagram_basic', 'instagram_manage_comments',
    // pages_show_list withheld, so the Page list never enables.
  ]);
  const linkage = resolved.find((r) => r.capability === 'INSTAGRAM_ACCOUNT_LINKAGE');
  assert.equal(linkage.state, 'PERMISSION_MISSING');
  assert.ok(linkage.missingPermissions.includes('pages_show_list'));

  const comments = resolved.find((r) => r.capability === 'INSTAGRAM_COMMENTS');
  assert.equal(comments.state, 'PERMISSION_MISSING');
  assert.ok(comments.missingPermissions.includes('pages_show_list'));
});

test('the full grant enables the official surfaces and nothing more', () => {
  const resolved = resolveMetaCapabilities([
    'public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_read_user_content',
    'instagram_basic', 'instagram_manage_comments',
  ]);

  const enabled = resolved.filter((r) => r.state === 'ENABLED').map((r) => r.capability).sort();
  assert.deepEqual(enabled, [
    'FACEBOOK_LOGIN',
    'FACEBOOK_PAGE_COMMENTS',
    'FACEBOOK_PAGE_LIST',
    'FACEBOOK_PAGE_POSTS',
    'INSTAGRAM_ACCOUNT_LINKAGE',
    'INSTAGRAM_COMMENTS',
    'INSTAGRAM_MEDIA',
    'WEBHOOKS_INSTAGRAM',
    'WEBHOOKS_PAGE',
  ], 'the fully-granted capability set changed; confirm against Meta docs before updating this');

  /* The four that stay shut even on a perfect grant. */
  for (const shut of ['FACEBOOK_GROUP_LIST', 'FACEBOOK_GROUP_POSTS', 'FACEBOOK_GROUP_COMMENTS',
    'FACEBOOK_PUBLIC_SEARCH']) {
    assert.equal(capabilityEnabled(resolved, shut), false);
  }
  /* Instagram discovery is RESTRICTED, not enabled by a scope. */
  assert.equal(capabilityEnabled(resolved, 'INSTAGRAM_DISCOVERY'), false);
});

test('an empty grant enables nothing at all', () => {
  const resolved = resolveMetaCapabilities([]);
  assert.equal(resolved.filter((r) => r.state === 'ENABLED').length, 0);
  assert.equal(capabilityEnabled(resolved, 'FACEBOOK_LOGIN'), false,
    'login was enabled with no granted scopes');
});

test('every row carries evidence a reader can check, and the reading is dated', () => {
  assert.match(META_CAPABILITIES_VERIFIED_ON, /^\d{4}-\d{2}-\d{2}$/);
  for (const spec of META_CAPABILITY_MATRIX) {
    assert.ok(spec.evidence.length > 60,
      `${spec.capability} has a stub justification: ${spec.evidence}`);
    assert.equal(/TODO|TBD|probably|I think|assume/i.test(spec.evidence), false,
      `${spec.capability} evidence hedges instead of citing`);
  }
});

test('the Page surfaces admit that they only reach Pages we manage', () => {
  /*
   * The sentence that bounds the whole official integration, and the one most
   * likely to be forgotten when somebody reads "read Page posts" and imagines
   * reading any Page. pages_show_list is "the list of Pages a person MANAGES".
   */
  assert.match(metaCapabilitySpec('FACEBOOK_PAGE_LIST').evidence, /manages/i);
  assert.match(metaCapabilitySpec('FACEBOOK_PAGE_POSTS').evidence, /manages/i);
  for (const capability of ['FACEBOOK_PAGE_POSTS', 'FACEBOOK_PAGE_COMMENTS']) {
    assert.ok(metaCapabilitySpec(capability).externalSteps.some((s) => /role on the Page/i.test(s)),
      `${capability} does not tell the operator they need a Page role`);
  }
});

test('Instagram requires a Professional account, and says so as a step', () => {
  const linkage = metaCapabilitySpec('INSTAGRAM_ACCOUNT_LINKAGE');
  assert.equal(linkage.availability, 'REQUIRES_INSTAGRAM_PROFESSIONAL_ACCOUNT');
  assert.ok(linkage.externalSteps.some((s) => /Professional/i.test(s)));
  assert.ok(linkage.externalSteps.some((s) => /Link it to a Facebook Page/i.test(s)));
});

test('the matrix holds no hardcoded green', () => {
  /*
   * A capability matrix whose every row said SUPPORTED would compile, render
   * beautifully and be a lie. Exactly one capability is unconditionally
   * supported — authenticating — and it is the one that reads nothing.
   */
  const supported = META_CAPABILITY_MATRIX.filter((s) => s.availability === 'SUPPORTED');
  assert.deepEqual(supported.map((s) => s.capability), ['FACEBOOK_LOGIN'],
    'more than authentication is claimed to work with no permission or review');

  const unavailable = permanentlyUnavailable();
  assert.ok(unavailable.length >= 4,
    'the removed Meta surfaces are no longer recorded as removed');
});

test('the module cites documentation rather than asserting from memory', () => {
  const source = readFileSync('src/research-core/social/meta-capabilities.ts', 'utf8');
  /* The verbatim changelog quote is the load-bearing citation for four rows. */
  assert.match(source, /Deprecated the following Groups API permissions and features/);
  assert.match(source, /developers\.facebook\.com/);
  /* And it must not promise the product something the matrix denies. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/scrape|workaround|bypass/i.test(code), false,
    'the capability module mentions working around a restriction');
});
