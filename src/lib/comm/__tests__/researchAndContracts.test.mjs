// The ResearchPlan contract, and the two kinds of drift that would break this
// subsystem silently.
//
// §60 makes the plan a SECURITY boundary: the model's output is data, it is
// validated here, and the only thing that ever runs is Homatch's own
// allowlisted workers. The tests that matter most are the ones where the model
// asks for something it should not have.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateResearchPlan, cascadeReport, groupEvidence, assertableClaims,
  RESEARCH_SOURCE_KINDS,
} from '../researchPlan.ts';
import {
  CAMPAIGN_STATUSES, SEND_STATUSES, MESSAGE_STATUSES, LEAD_STAGES,
  AGENT_TEMPLATES, TEMPLATE_STATUSES, CONVERSATION_MODES, TRUST_TIERS,
  isUserResumable, isSendTerminal, isCallLive, isTemplateSendable,
} from '../vocabulary.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const VALID_PLAN = {
  entity_type: 'developer',
  entity_name: 'Example Development',
  location: 'Tbilisi',
  questions: ['official presence', 'public reputation'],
  queries: [{ q: 'Example Development Tbilisi reviews', language: 'ka', priority: 90 }],
  sources: ['WEB_SEARCH', 'NEWS'],
  languages: ['ka', 'en'],
  countries: ['GE'],
  time_range: '5y',
  max_results: 100,
};

// ── The contract ────────────────────────────────────────────────────────────

test('a well-formed plan validates and normalises', () => {
  const result = validateResearchPlan(VALID_PLAN);
  assert.equal(result.ok, true);
  assert.equal(result.plan.entityName, 'Example Development');
  assert.deepEqual(result.plan.sourceKinds, ['WEB_SEARCH', 'NEWS']);
  assert.equal(result.plan.queries.length, 1);
});

test('a plan with no entity, no questions or no queries is refused', () => {
  assert.equal(validateResearchPlan({ ...VALID_PLAN, entity_name: '' }).ok, false);
  assert.equal(validateResearchPlan({ ...VALID_PLAN, questions: [] }).ok, false);
  assert.equal(validateResearchPlan({ ...VALID_PLAN, queries: [] }).ok, false);
  assert.equal(validateResearchPlan('not an object').ok, false);
  assert.equal(validateResearchPlan(null).ok, false);
});

test('AN UNSUPPORTED SOURCE KIND IS DROPPED AND RECORDED, NEVER ATTEMPTED', () => {
  // §62: never bypass a login, a CAPTCHA or a private profile control. A model
  // asking for LINKEDIN_SCRAPE is asking for exactly that, and the answer is
  // to drop it and say so.
  const result = validateResearchPlan({
    ...VALID_PLAN,
    sources: ['WEB_SEARCH', 'LINKEDIN_SCRAPE', 'INSTAGRAM_PRIVATE'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.sourceKinds, ['WEB_SEARCH']);
  assert.equal(result.repairs.filter((r) => r.includes('dropped unsupported source kind')).length, 2);
});

test('a URL inside a query is stripped, because a plan requests searches and not fetches', () => {
  const result = validateResearchPlan({
    ...VALID_PLAN,
    queries: [{ q: 'check https://internal.example.com/admin?token=abc for details' }],
  });
  assert.equal(result.ok, true);
  assert.ok(!result.plan.queries[0].q.includes('https://'));
  assert.ok(result.repairs.some((r) => r.includes('removed a URL')));
});

test('control characters never reach a search provider or a log', () => {
  const withControl = `Example${String.fromCharCode(0, 27, 7)}Development`;
  const result = validateResearchPlan({ ...VALID_PLAN, entity_name: withControl });
  assert.equal(result.ok, true);
  assert.ok(!/[\u0000-\u001F\u007F]/.test(result.plan.entityName));
});

test('budgets are capped rather than obeyed', () => {
  const result = validateResearchPlan({ ...VALID_PLAN, max_results: 999_999 });
  assert.ok(result.plan.maxResults <= 500);
  assert.ok(result.repairs.some((r) => r.includes('capped max_results')));
});

test('an oversized plan is trimmed, not refused', () => {
  const result = validateResearchPlan({
    ...VALID_PLAN,
    questions: Array.from({ length: 40 }, (_, i) => `question ${i}`),
    queries: Array.from({ length: 100 }, (_, i) => ({ q: `query ${i}` })),
  });
  assert.equal(result.ok, true);
  assert.ok(result.plan.questions.length <= 12);
  assert.ok(result.plan.queries.length <= 40);
});

test('a plan that asks for nothing usable still runs, with a recorded default', () => {
  const result = validateResearchPlan({ ...VALID_PLAN, sources: [], languages: ['klingon'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.sourceKinds, ['WEB_SEARCH']);
  assert.deepEqual(result.plan.languages, ['ka', 'en']);
  assert.ok(result.repairs.length >= 2);
});

test('queries run in priority order', () => {
  const result = validateResearchPlan({
    ...VALID_PLAN,
    queries: [{ q: 'low', priority: 10 }, { q: 'high', priority: 99 }, { q: 'middle', priority: 50 }],
  });
  assert.deepEqual(result.plan.queries.map((q) => q.q), ['high', 'middle', 'low']);
});

test('every allowlisted source kind is a KIND, never a URL', () => {
  for (const kind of RESEARCH_SOURCE_KINDS) {
    assert.ok(!/https?:|\.\w{2,}\//.test(kind), `${kind} looks like an address`);
  }
});

// ── §64's accounting ────────────────────────────────────────────────────────

test('the cascade reports what it counted and invents no savings figure', () => {
  // §64: "Do not fabricate savings numbers." Computing a cost avoided requires
  // assuming what a model WOULD have charged for records it never saw.
  const report = cascadeReport({
    totalRecords: 100_000, droppedByRule: 80_000, droppedByNormalisation: 5_000,
    droppedByDedupe: 9_000, scoredDeterministically: 5_500, sentToLlm: 500, cacheHits: 0,
  });
  assert.equal(report.resolvedWithoutAi, 99_500);
  assert.ok(Math.abs(report.withoutAiRate - 0.995) < 1e-9);
  assert.equal('costAvoided' in report, false);
  assert.equal('aiCostAvoided' in report, false);
});

test('an empty cascade reports zero rather than dividing by nothing', () => {
  const report = cascadeReport({
    totalRecords: 0, droppedByRule: 0, droppedByNormalisation: 0,
    droppedByDedupe: 0, scoredDeterministically: 0, sentToLlm: 0, cacheHits: 0,
  });
  assert.equal(report.withoutAiRate, 0);
});

// ── §65's evidence ──────────────────────────────────────────────────────────

const evidence = (over) => ({
  entity: 'Example Development', claim: 'registered in 2019',
  sourceUrl: 'https://example.com/a', sourcePlatform: 'registry', sourceKind: 'PUBLIC_REGISTRY',
  publishedAt: null, fetchedAt: '2026-09-12', excerpt: '…', language: 'en',
  sourceConfidence: 0.9, entityMatchConfidence: 0.9, ...over,
});

test('sources that disagree are reported as a conflict, never silently reconciled', () => {
  const groups = groupEvidence(
    [
      evidence({ excerpt: 'registered 2019' }),
      evidence({ excerpt: 'registered 2021', sourceUrl: 'https://example.com/b', sourceConfidence: 0.6 }),
    ],
    (a, b) => a.excerpt !== b.excerpt,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].conflicted, true);
  assert.equal(groups[0].contradicting.length, 1);
});

test('a synthesis may only assert what is supported and unconflicted', () => {
  const groups = groupEvidence(
    [
      evidence({ claim: 'strong', sourceConfidence: 0.95, entityMatchConfidence: 0.95 }),
      evidence({ claim: 'weak', sourceConfidence: 0.3, entityMatchConfidence: 0.4 }),
    ],
    () => false,
  );
  const { assertable, tooWeak } = assertableClaims(groups, 0.5);
  assert.equal(assertable.length, 1);
  assert.equal(assertable[0].claim, 'strong');
  assert.equal(tooWeak.length, 1);
});

// ── Drift guard 1: the vocabulary and the schema ────────────────────────────

const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260912110000_communications_hub.sql'), 'utf8',
);

test('every campaign status the UI can render is a value the database accepts', () => {
  // A component that renders a status Postgres would refuse is a component
  // showing a row that can never exist.
  const constraint = MIGRATION.match(/outreach_campaigns_status_check\s*\n?\s*check \(status in \(([^)]+)\)\)/);
  assert.ok(constraint, 'could not find the campaign status constraint in the migration');
  for (const status of CAMPAIGN_STATUSES) {
    assert.ok(constraint[1].includes(`'${status}'`), `${status} is not in the database constraint`);
  }
});

test('every send status the UI can render is a value the database accepts', () => {
  const constraint = MIGRATION.match(/outreach_sends_status_check\s*\n?\s*check \(status in \(([\s\S]*?)\)\);/);
  assert.ok(constraint, 'could not find the send status constraint in the migration');
  for (const status of SEND_STATUSES) {
    assert.ok(constraint[1].includes(`'${status}'`), `${status} is not in the database constraint`);
  }
});

test('the other vocabularies appear in the schema that stores them', () => {
  for (const value of [...MESSAGE_STATUSES, ...LEAD_STAGES, ...CONVERSATION_MODES, ...TRUST_TIERS, ...AGENT_TEMPLATES, ...TEMPLATE_STATUSES]) {
    assert.ok(MIGRATION.includes(`'${value}'`), `${value} does not appear in the migration`);
  }
});

test('the widening migration only ever adds values to the existing constraints', () => {
  // §146: a schema deployed before the frontend merges must not break the
  // frontend already in production. Every value the old constraint allowed has
  // to still be allowed.
  const before = ['DRAFT', 'READY', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'];
  for (const status of before) {
    assert.ok(CAMPAIGN_STATUSES.includes(status), `${status} was legal before and must stay legal`);
  }
  const sendsBefore = ['PENDING', 'QUEUED', 'SENDING', 'DIALING', 'ANSWERED', 'SENT', 'DELIVERED',
    'COMPLETED', 'FAILED', 'NO_ANSWER', 'BUSY', 'BOUNCED', 'OPTED_OUT', 'SUPPRESSED'];
  for (const status of sendsBefore) {
    assert.ok(SEND_STATUSES.includes(status), `${status} was legal before and must stay legal`);
  }
});

test('the migration adds no column that is NOT NULL without a default', () => {
  // §145/§146: a NOT NULL column with no default fails instantly against a
  // table that already has rows.
  const additions = MIGRATION.match(/add column if not exists [^\n,;]+/g) ?? [];
  assert.ok(additions.length > 0, 'expected the migration to add columns');
  for (const line of additions) {
    if (/not null/i.test(line)) {
      assert.ok(/default/i.test(line), `unsafe on existing rows: ${line.trim()}`);
    }
  }
});

test('the migration drops nothing', () => {
  // §103: no destructive drop. Dropping and re-adding a CHECK constraint is
  // the one exception, and it is how a constraint is widened at all.
  const drops = (MIGRATION.match(/^\s*(drop table|drop column|alter column [^\n]*type)/gim) ?? []);
  assert.deepEqual(drops, []);
});

test('the resume rule a customer cannot bypass is the one the UI offers', () => {
  assert.equal(isUserResumable('PAUSED'), true);
  assert.equal(isUserResumable('COMPLIANCE_PAUSED'), false);
  // And the SQL function's predicate agrees.
  const functions = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260912110500_communications_functions.sql'), 'utf8',
  );
  const resume = functions.slice(functions.indexOf('comm_user_resume_campaign'));
  assert.ok(resume.includes("status = 'PAUSED'"), 'the resume function must match only PAUSED');
  assert.ok(!resume.slice(0, resume.indexOf('$$;')).includes("'COMPLIANCE_PAUSED'"));
});

test('the small vocabulary predicates agree with themselves', () => {
  assert.equal(isSendTerminal('COMPLETED'), true);
  assert.equal(isSendTerminal('DIALING'), false);
  assert.equal(isCallLive('ANSWERED'), true);
  assert.equal(isCallLive('COMPLETED'), false);
  assert.equal(isTemplateSendable('APPROVED'), true);
  assert.equal(isTemplateSendable('PENDING'), false);
  assert.equal(isTemplateSendable('DRAFT'), false);
});

// ── Drift guard 2: the server and the browser ───────────────────────────────

test('THE SERVER ENFORCES EXACTLY WHAT THE BROWSER PREVIEWS', () => {
  // §6 and §32: a frontend check is not enforcement, so the same logic has to
  // exist on both sides. It genuinely exists twice on disk — Vite cannot bundle
  // from supabase/functions and Deno cannot read src/ — so this is the gate
  // that stops the two copies diverging.
  const result = spawnCheck();
  assert.equal(result.status, 0, `generated edge copies are out of date:\n${result.output}`);
});

function spawnCheck() {
  const res = spawnSync(process.execPath, ['scripts/sync-comm-domain.mjs', '--check'], {
    cwd: ROOT, encoding: 'utf8',
  });
  return { status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}
