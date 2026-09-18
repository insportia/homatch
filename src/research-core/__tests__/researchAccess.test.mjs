// Authenticated research access, and the things it is not allowed to become.
//
// Two separate guarantees are asserted here.
//
// SECRETS. A connection carries the NAME of a platform secret, never the
// secret. Nothing credential-shaped may reach a log line, an admin payload or
// the frontend. The `scrub` and `redactConnection` tests below are the ones
// that would matter at three in the morning.
//
// RESTRAINT. There is no join, no bulk join, no account rotation, no CAPTCHA
// path, no stealth. A source needing membership becomes a queue entry for a
// human, and the tests assert the ABSENCE of the alternatives — because an
// absence is exactly what nobody notices has stopped being true.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  redactConnection,
  connectionHealth,
  isUsable,
  scrub,
  toAccessRequest,
  sourceStateAfter,
} from '../bridge/research-access.ts';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const inDays = (days) => new Date(NOW + days * 86_400_000).toISOString();

const connection = (over = {}) => ({
  id: 'conn1',
  platform: 'FACEBOOK',
  label: 'Homatch research account',
  credentialRef: 'homatch_fb_research_session',
  status: 'CONNECTED',
  statusDetail: null,
  lastValidatedAt: new Date(NOW - 3_600_000).toISOString(),
  expiresAt: null,
  lastFailureAt: null,
  lastFailureReason: null,
  consecutiveFailures: 0,
  createdAt: new Date(NOW - 86_400_000).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  ...over,
});

/* ── Secrets never leave ──────────────────────────────────────────────── */

test('the redacted shape has no credential reference at all', () => {
  const redacted = redactConnection(connection(), NOW);
  assert.equal('credentialRef' in redacted, false, 'the credential reference was serialised');
  assert.equal(redacted.hasCredential, true);
  assert.ok(!JSON.stringify(redacted).includes('homatch_fb_research_session'));
});

test('anything credential-shaped is scrubbed out of an operator-facing string', () => {
  const cases = [
    'session failed: c_user=100001234567890',
    'cookie xs=AbCdEf123456 rejected',
    'sessionid=59284756%3AabcdefGHIJ%3A12 expired',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef',
    'token 7f3a9b2c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70',
  ];
  for (const text of cases) {
    const cleaned = scrub(text);
    assert.match(cleaned, /\[redacted\]/, `nothing was redacted in: ${text}`);
    assert.ok(!/eyJhbGciOiJ|AbCdEf123456|100001234567890|59284756/.test(cleaned), cleaned);
  }
});

test('a failure reason containing a cookie is scrubbed before it is exposed', () => {
  const redacted = redactConnection(
    connection({ status: 'ACTION_REQUIRED', lastFailureReason: 'rejected: xs=SECRETVALUE123456' }),
    NOW,
  );
  assert.ok(!redacted.lastFailureReason.includes('SECRETVALUE123456'));
  assert.match(redacted.lastFailureReason, /\[redacted\]/);
});

test('ordinary operator text survives scrubbing intact', () => {
  // A scrubber that eats everything is a scrubber nobody will keep using.
  assert.equal(scrub('the session expired on Tuesday'), 'the session expired on Tuesday');
});

test('the migration refuses to store anything credential-shaped', () => {
  // Enforced by a CHECK constraint, so a mistake in application code is
  // rejected by the database rather than persisted forever.
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260918120000_research_core_source_graph.sql'),
    'utf8',
  );
  assert.match(sql, /research_access_connections_ref_is_a_reference/);
  assert.match(sql, /c_user\|xs=\|sessionid\|csrftoken\|datr\|access_token\|bearer/);
  assert.match(sql, /THE NAME OF A SECRET, NEVER THE SECRET/);
});

test('no credential column is DECLARED anywhere in the migration', () => {
  // Checked against declarations, not prose. The words appear repeatedly in
  // the comments that explain why the columns do not exist, and a test that
  // could not tell the difference would have to be weakened or deleted —
  // which is how a rule quietly stops being enforced.
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260918120000_research_core_source_graph.sql'),
    'utf8',
  );
  const statements = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  for (const forbidden of ['cookie', 'password', 'session_token', 'auth_token', 'access_token']) {
    assert.ok(
      !new RegExp(`^\\s*${forbidden}\\s+(text|jsonb|bytea)`, 'im').test(statements),
      `a ${forbidden} column is declared`,
    );
  }
  // The only credential-adjacent column is the reference, and it is named so.
  assert.match(statements, /credential_ref text/);
});

/* ── Health, from what the platform actually said ─────────────────────── */

test('a healthy connection is usable and an expired one is not', () => {
  assert.equal(connectionHealth(connection(), NOW), 'HEALTHY');
  assert.equal(isUsable(connection(), NOW), true);

  const expired = connection({ expiresAt: inDays(-1) });
  assert.equal(connectionHealth(expired, NOW), 'EXPIRED');
  assert.equal(isUsable(expired, NOW), false);
});

test('EXPIRING is reported only when the platform gave an expiry', () => {
  // Never a guess about a session we have not tested.
  assert.equal(connectionHealth(connection({ expiresAt: inDays(2) }), NOW), 'EXPIRING');
  assert.equal(connectionHealth(connection({ expiresAt: null }), NOW), 'HEALTHY');
});

test('repeated failures report FAILING rather than silently continuing', () => {
  assert.equal(connectionHealth(connection({ consecutiveFailures: 4 }), NOW), 'FAILING');
});

test('a connection with no credential is never usable, whatever its status says', () => {
  assert.equal(isUsable(connection({ credentialRef: null }), NOW), false);
  assert.equal(isUsable(connection({ status: 'PENDING_CREDENTIALS' }), NOW), false);
  assert.equal(isUsable(connection({ status: 'DISABLED' }), NOW), false);
});

test('a disconnected or disabled connection reports ABSENT, not an error', () => {
  assert.equal(connectionHealth(connection({ status: 'NOT_CONNECTED' }), NOW), 'ABSENT');
  assert.equal(connectionHealth(connection({ status: 'DISABLED' }), NOW), 'ABSENT');
});

/* ── The access queue: a human decides ────────────────────────────────── */

test('a join-required source becomes a queue entry, not an automated join', () => {
  const request = toAccessRequest({
    id: 'req1',
    sourceUrl: 'https://www.facebook.com/groups/private-housing/',
    platform: 'FACEBOOK',
    sourceName: 'Private Housing Group',
    rationale: 'Identified but not readable anonymously (join wall).',
    countryCode: 'GE',
    city: 'Tbilisi',
    languages: ['ka', 'ru'],
    profiles: ['BUYER_SEARCH'],
    at: new Date(NOW).toISOString(),
  });

  assert.equal(request.state, 'REQUESTED');
  assert.equal(request.decidedBy, null);
  assert.equal(request.decidedAt, null);
});

test('there is no state meaning "joined automatically"', () => {
  const states = ['REQUESTED', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'DENIED_BY_PLATFORM'];
  for (const state of states) {
    assert.ok(!/AUTO/i.test(state), `${state} suggests automation`);
  }
  // Every state that grants access requires a decision, and both decision
  // states carry a person.
  assert.equal(sourceStateAfter({ state: 'APPROVED' }), 'AUTHENTICATED_ACCESS');
  assert.equal(sourceStateAfter({ state: 'REQUESTED' }), 'JOIN_REQUIRED');
  assert.equal(sourceStateAfter({ state: 'IN_PROGRESS' }), 'JOIN_REQUIRED');
});

test('approval never makes a source PUBLIC', () => {
  // A group behind a membership wall is not public just because we are now
  // inside it, and the access class travels onto every signal read from it.
  assert.notEqual(sourceStateAfter({ state: 'APPROVED' }), 'PUBLIC');
});

test('a refusal closes the source rather than re-queueing it forever', () => {
  assert.equal(sourceStateAfter({ state: 'REJECTED' }), 'INACCESSIBLE');
  assert.equal(sourceStateAfter({ state: 'DENIED_BY_PLATFORM' }), 'INACCESSIBLE');
});

/* ── The absences ─────────────────────────────────────────────────────── */

function coreFiles(dir = join(process.cwd(), 'src/research-core'), out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') coreFiles(full, out);
    } else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = coreFiles();
const codeOf = (file) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

test('nothing in the core solves a CAPTCHA, handles a challenge or evades detection', () => {
  const forbidden = [
    /solveCaptcha|captchaSolver|anticaptcha|2captcha/i,
    /stealth|puppeteer-extra|fingerprint(Spoof|Evasion)/i,
    /proxyRotat|rotateProxy|proxyPool/i,
    /rotateAccount|accountPool|nextAccount/i,
    /autoJoin|joinGroup|bulkJoin|requestToJoin/i,
  ];
  for (const file of FILES) {
    const code = codeOf(file);
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(code), `${file.split('research-core')[1]} matches ${pattern}`);
    }
  }
});

test('no file writes a credential to a log', () => {
  for (const file of FILES) {
    const code = codeOf(file);
    assert.ok(
      !/console\.(log|info|warn|error)/.test(code),
      `${file.split('research-core')[1]} logs directly; the core logs through an injected sink`,
    );
  }
});
