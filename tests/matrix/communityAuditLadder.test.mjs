// THE LOOPHOLE THIS MODE MUST NOT BECOME.
//
// Telegram channels are correctly ineligible for source-audit's website mode:
// classifyRegistryRow('https://t.me/tbilisikvartiri') answers COMMUNITY_IDENTIFIER
// with auditable: false. The obvious shortcut was to loosen that classifier, or to
// write a lifecycle straight onto the row and call the source promoted.
//
// mode "audit-community" exists instead, and its whole justification is that it
// promotes through the SAME advance() ladder every portal goes through. If it ever
// stops doing that, it becomes exactly the thing it was built to avoid: a second
// definition of what permission means, with Telegram on the easy side of it.
//
// So these tests assert the SHAPE of the promotion path rather than any particular
// outcome. The outcomes are covered by src/research-core/__tests__/communityAudit,
// against the real ladder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'supabase', 'functions', 'source-audit', 'index.ts'), 'utf8');

/** Comments stripped, so no assertion can be satisfied by prose. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Just the audit-community function body. */
function communityMode() {
  const start = code.indexOf('async function auditCommunity(');
  assert.ok(start > 0, 'guard: mode "audit-community" still exists');
  return code.slice(start);
}

test('the mode is reachable, and an unknown mode still names the real options', () => {
  assert.match(code, /mode === 'audit-community'/);
  assert.match(code, /expected classify, discover, audit or audit-community/);
});

test('promotion goes through advance(), never by writing a lifecycle directly', () => {
  const body = communityMode();

  assert.match(body, /advance\(state, evidence\)/,
    'the ladder must decide each rung, not this function');

  /*
   * The lifecycle written to the row must be the one advance() returned. A literal
   * here -- lifecycle: 'LIVE_TESTED' and the like -- would be the shortcut this
   * whole mode exists to avoid.
   */
  assert.match(body, /lifecycle: state\.state/);
  for (const rung of ['AUDITED', 'PERMITTED', 'IMPLEMENTED', 'FIXTURE_TESTED',
    'LIVE_TESTED', 'PRODUCTIVE']) {
    assert.doesNotMatch(
      body,
      new RegExp(`lifecycle:\\s*'${rung}'`),
      `a literal lifecycle: '${rung}' bypasses the ladder`,
    );
  }
});

test('the finding and family written are the ones the ladder settled on', () => {
  const body = communityMode();
  assert.match(body, /access_finding: state\.finding/);
  assert.match(body, /source_family: state\.family/);
  assert.doesNotMatch(
    body,
    /access_finding:\s*'PUBLIC_HTML'/,
    'writing a permitting finding as a literal decides access without evidence',
  );
});

test('the evidence comes from the audit module, in the order it gave', () => {
  const body = communityMode();
  assert.match(body, /auditCommunityAccess\(\{/);
  assert.match(body, /for \(const evidence of audit\.evidence\)/,
    'the evidence sequence must be applied as given: AUDIT, then ADAPTER_CLAIMED, '
    + 'then LIVE_FETCH. Reordering it would promote a source that had not earned a rung');
});

test('a rejected transition stops the walk instead of being pushed past', () => {
  const body = communityMode();
  assert.match(body, /if \(step\.transition\.rejected\) break/,
    'advance() rejecting a rung is a refusal, and continuing would apply later '
    + 'evidence to a state that never legitimately existed');
});

test('an INCONCLUSIVE audit writes nothing at all', () => {
  const body = communityMode();
  const branch = body.indexOf("audit.verdict === 'INCONCLUSIVE'");
  assert.ok(branch > 0, 'the inconclusive case must be handled explicitly');
  const ladderWalk = body.indexOf('advance(state, evidence)');
  assert.ok(
    branch < ladderWalk,
    'INCONCLUSIVE has to short-circuit BEFORE the ladder is touched; a rate limit or '
    + 'an unfamiliar page must not move a source anywhere',
  );
});

test('audit does not activate a source or assign it a tier', () => {
  /*
   * Inherited from the website mode rather than re-argued: `active` and
   * priority_tier say what a source is WORTH, which stays a judgement for a person.
   * An audit that flipped active = true would put an unvetted community into a
   * customer's campaign budget.
   */
  const body = communityMode();
  assert.doesNotMatch(body, /active:\s*true/, 'an audit must not activate a source');
  assert.doesNotMatch(body, /priority_tier:/, 'an audit must not assign worth');
});

test('BLOCKED and RETIRED sources are not re-probed by this mode', () => {
  const body = communityMode();
  assert.match(
    body,
    /\['DISCOVERED', 'AUDITED', 'IMPLEMENTED', 'FIXTURE_TESTED'\]\.includes\(state\)/,
    'the eligible set must be explicit; BLOCKED and RETIRED are decisions and a '
    + 'worker that re-probes them is the bypass the lifecycle exists to prevent',
  );
});

test('robots is fetched rather than assumed, and a failure is not permission', () => {
  const body = communityMode();
  assert.match(body, /t\.me\/robots\.txt/, 'robots must be read, not remembered');
  assert.match(
    body,
    /robotsStatus: number \| null = null/,
    'a robots fetch that throws must leave the status null, which robotsPermits() '
    + 'treats as NOT permission',
  );
});

test('the adapter id is the policy constant, not a string typed from memory', () => {
  const body = communityMode();
  assert.match(body, /TELEGRAM_PREVIEW_POLICY\.id/);
  assert.doesNotMatch(
    code,
    /telegram-public-preview/,
    "an invented adapter id would leave the registry claiming a source was claimed "
    + 'by an adapter nothing answers to',
  );
});

test('the readability it writes keeps empty, walled and readable apart', () => {
  const body = communityMode();
  /*
   * Three states, because the column has three meanings. Collapsing walled into
   * API_UNAVAILABLE would say the platform offers no route when the truth is that
   * WE lack standing -- and would send somebody looking for a technical fix to a
   * membership problem.
   */
  assert.match(body, /'READABLE'/);
  assert.match(body, /'AUTHORIZATION_REQUIRED'/);
  assert.match(body, /'API_UNAVAILABLE'/);
  assert.match(body, /'JOIN_REQUIRED'/, 'the enum word for not being a member');
  assert.doesNotMatch(body, /'NOT_A_MEMBER'/, 'that is not a value the CHECK permits');
});
