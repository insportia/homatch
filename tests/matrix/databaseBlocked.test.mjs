// What is actually finished, what is actually verified, and what is actually
// waiting on the owner — stated per feature, and checked against the repo.
//
// WHY THIS IS A TEST AND NOT A PARAGRAPH
//
// "Database blocked" is the kind of sentence that survives long after it stops
// being true. Written as prose it drifts: the migration gets applied, a test
// gets written, a function gets deployed, and the paragraph still says
// blocked — or worse, says verified when nothing verified it.
//
// So the matrix is executable. Every row makes claims the repository can be
// asked about, and this file asks:
//
//   BLOCKED_ONLY_BY_SCHEMA  must name tables that exist in the unapplied
//                           migration, and MUST NOT name a table that already
//                           exists in production. A feature blocked on a table
//                           the product already has is not blocked, it is
//                           unfinished, and calling it blocked hides that.
//   LOCAL_UNIT_VERIFIED     must name a test file that exists. A verification
//                           claim pointing at nothing is the worst row in any
//                           status report.
//   IMPLEMENTED             must name source files that exist.
//
// It also writes docs/communications-status.md from the same data, so the
// document and the check can never disagree.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();

const MIGRATIONS = [
  'supabase/migrations/20260912110000_communications_hub.sql',
  'supabase/migrations/20260912110500_communications_functions.sql',
];

/** Tables the product already has. A feature resting on these is not blocked. */
const PRE_EXISTING = new Set([
  'outreach_campaigns', 'outreach_sends', 'outreach_contacts', 'outreach_contact_lists',
  'admin_settings', 'admin_audit_log', 'provider_health', 'users',
  'credit_reservations', 'credit_transactions', 'billable_products', 'credit_packs',
  'finance_provider_cost_events', 'rate_limit_events', 'notifications',
]);

/*
 * Statuses, in the words the directive asked for.
 *
 *   IMPLEMENTED             the code is written and reviewable
 *   LOCAL_UNIT_VERIFIED     a test in this repo exercises it and passes
 *   BROWSER_VERIFIED        a real Chrome rendered it and it was measured
 *   BLOCKED_ONLY_BY_SCHEMA  nothing is missing but the owner applying the
 *                           migration; no code remains to write
 *   EXTERNAL                only a real call, a real device or a working
 *                           provider credential can settle it
 */
const MATRIX = [
  {
    feature: 'WhatsApp inbound webhook — signature check, dedupe, inbound record',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['supabase/functions/whatsapp-webhook/index.ts', 'supabase/functions/_shared/comm/meta.ts'],
    tests: ['src/lib/comm/__tests__/costAndStatus.test.mjs'],
    tables: ['comm_webhook_events', 'comm_conversations', 'comm_messages'],
    blocked: 'comm_claim_webhook_event() and comm_record_inbound() do not exist until the migration is applied, so an end-to-end delivery cannot be replayed against a database.',
  },
  {
    feature: 'WhatsApp outbound send — template gate, 24-hour service window',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['supabase/functions/whatsapp-send/index.ts', 'src/lib/comm/statusMap.ts'],
    tests: ['src/lib/comm/__tests__/costAndStatus.test.mjs'],
    tables: ['comm_conversations', 'comm_messages', 'comm_whatsapp_templates'],
    blocked: 'The window and template state are read from comm_conversations and comm_whatsapp_templates.',
  },
  {
    feature: 'WhatsApp template sync from Meta',
    status: ['IMPLEMENTED', 'BLOCKED_ONLY_BY_SCHEMA', 'EXTERNAL'],
    code: ['supabase/functions/whatsapp-sync/index.ts'],
    tests: [],
    tables: ['comm_whatsapp_templates', 'comm_channel_accounts'],
    blocked: 'The synced rows land in comm_whatsapp_templates and the account they belong to in comm_channel_accounts; neither table exists until the migration is applied.',
    external: 'The production Meta access token is currently rejected with HTTP 401, so a live sync cannot be run even once the schema exists.',
  },
  {
    feature: 'Campaign launch — audience summary, cost estimate, credit reservation',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['supabase/functions/comm-campaign-launch/index.ts', 'src/lib/comm/cost.ts'],
    tests: ['src/lib/comm/__tests__/costAndStatus.test.mjs'],
    tables: ['comm_agents'],
    blocked: 'comm_audience_summary() and comm_enqueue_campaign() ship in the unapplied migration. The reservation half runs on the EXISTING wallet (beginExecution in _shared/billing.ts) and needs nothing new.',
  },
  {
    feature: 'Dispatch worker — claim, send, settle, reclaim stale',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['supabase/functions/comm-dispatch-worker/index.ts'],
    tests: ['src/lib/comm/__tests__/costAndStatus.test.mjs'],
    tables: [],
    blocked: 'comm_claim_sends() and comm_reclaim_stale_sends() ship in the unapplied migration. The rows themselves live in outreach_sends, which already exists.',
  },
  {
    feature: 'Voice call lifecycle — provider webhook, transcript, cost settlement',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['supabase/functions/voice-webhook/index.ts', 'supabase/functions/_shared/comm/vapi.ts'],
    tests: ['src/lib/comm/__tests__/voice.test.mjs', 'src/lib/comm/__tests__/costAndStatus.test.mjs'],
    tables: ['comm_extractions'],
    blocked: 'The extraction is written to comm_extractions. The send row and the cost event both land in tables that already exist.',
  },
  {
    feature: 'Realtime Georgian conversation — endpointing, barge-in, language lock',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'EXTERNAL'],
    code: ['src/lib/comm/transcript.ts', 'src/lib/comm/voiceClient.ts', 'supabase/functions/_shared/comm/cartesia.ts'],
    tests: ['src/lib/comm/__tests__/voice.test.mjs', 'src/lib/comm/__tests__/georgianCorpus.test.mjs'],
    tables: [],
    external: 'GE-VOICE-CORPUS-v1 measures every text-level decision. Acoustic STT accuracy on real telephony audio, Georgian TTS naturalness and true mouth-to-ear latency need a real call to a Georgian speaker.',
  },
  {
    feature: 'Agent builder — draft, version, publish',
    status: ['IMPLEMENTED', 'BROWSER_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['src/pages/outreach/AgentBuilderPage.tsx', 'supabase/functions/comm-agent/index.ts'],
    tests: ['tests/browser/commSurfaces.test.mjs'],
    tables: ['comm_agents', 'comm_agent_versions'],
    blocked: 'comm_publish_agent() writes the immutable version row into comm_agent_versions.',
  },
  {
    feature: 'AI TALK homepage demo — allowance, session, transcript',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['src/components/home/AiTalkPanel.tsx', 'supabase/functions/ai-talk-session/index.ts', 'src/lib/comm/talkAllowance.ts'],
    tests: ['src/lib/comm/__tests__/voice.test.mjs'],
    tables: ['comm_talk_sessions'],
    blocked: 'The per-visitor allowance is counted in comm_talk_sessions. The admin switch and the limits themselves live in admin_settings, which already exists — so the ADMIN side of this feature is live today.',
  },
  {
    feature: 'Compliance and risk engine — scoring, auto-pause, admin review',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['src/lib/comm/risk.ts', 'src/pages/admin/AdminRiskPage.tsx'],
    tests: ['src/lib/comm/__tests__/policy.test.mjs'],
    tables: ['comm_risk_assessments', 'comm_account_trust'],
    blocked: 'comm_compliance_pause() and the two tables it reads and writes.',
  },
  {
    feature: 'Provider routing and kill switches',
    status: ['IMPLEMENTED', 'BROWSER_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['src/components/admin/CommunicationsRoutingPanel.tsx', 'supabase/functions/comm-provider-status/index.ts'],
    tests: ['tests/browser/commSurfaces.test.mjs'],
    tables: ['comm_provider_routes'],
    blocked: 'comm_provider_routes, which holds the per-role priority, the enabled flag and the kill switch. The panel already degrades with a named reason rather than a blank card when that table is absent, which is the state a reader can see today.',
  },
  {
    feature: 'Admin voice tuning and AI Talk allowance',
    status: ['IMPLEMENTED', 'BROWSER_VERIFIED'],
    code: ['src/components/admin/CommunicationsVoicePanel.tsx'],
    tests: ['tests/browser/commSurfaces.test.mjs'],
    tables: [],
    note: 'Nothing is blocked. Both write admin_settings, which exists in production, and the server code that reads them ships in the same branch.',
  },
  {
    feature: 'Customer billing screen — balance, spend, breakdown, top-up',
    status: ['IMPLEMENTED', 'BROWSER_VERIFIED'],
    code: ['src/pages/outreach/CommunicationsBillingPage.tsx', 'src/services/communications.ts'],
    tests: ['tests/browser/commSurfaces.test.mjs'],
    tables: [],
    note: 'Reads the EXISTING wallet and the existing outreach_sends rows. No second ledger was created, so nothing here waits on the migration.',
  },
  {
    feature: 'Contact import — header detection, phone normalisation, dedupe',
    status: ['IMPLEMENTED', 'LOCAL_UNIT_VERIFIED', 'BROWSER_VERIFIED'],
    code: ['src/lib/comm/importFile.ts', 'src/lib/comm/headerDetect.ts', 'src/lib/comm/phone.ts'],
    tests: ['src/lib/comm/__tests__/phoneAndImport.test.mjs', 'tests/browser/commSurfaces.test.mjs'],
    tables: [],
    note: 'Writes outreach_contacts, which already exists.',
  },
  {
    feature: 'Inbox — conversation list, thread, AI/human handoff',
    status: ['IMPLEMENTED', 'BROWSER_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['src/pages/outreach/WhatsAppInboxPage.tsx', 'src/lib/comm/handoff.ts'],
    tests: ['src/lib/comm/__tests__/voice.test.mjs', 'tests/browser/commSurfaces.test.mjs'],
    tables: ['comm_conversations', 'comm_messages'],
    blocked: 'comm_set_conversation_mode() and the two tables the thread is read from.',
  },
  {
    feature: 'Analytics — delivery, outcome and cost aggregates',
    status: ['IMPLEMENTED', 'BROWSER_VERIFIED', 'BLOCKED_ONLY_BY_SCHEMA'],
    code: ['src/pages/outreach/CommunicationsAnalyticsPage.tsx'],
    tests: ['tests/browser/commSurfaces.test.mjs'],
    tables: ['comm_conversations'],
    blocked: 'The messaging half of every figure reads comm_conversations. The call half reads outreach_sends and works today.',
  },
];

/* ── The checks ─────────────────────────────────────────────────────────── */

const migrationSql = MIGRATIONS.map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n');
const migrationTables = new Set(
  [...migrationSql.matchAll(/create table if not exists\s+(?:public\.)?([a-z_]+)/gi)].map((m) => m[1].toLowerCase())
);

test('the migration really does create every table the matrix leans on', () => {
  assert.ok(migrationTables.size >= 12, `only found ${migrationTables.size} tables in the migration`);
  const named = new Set(MATRIX.flatMap((r) => r.tables ?? []));
  const missing = [...named].filter((t) => !migrationTables.has(t));
  assert.deepEqual(missing, [], 'the matrix names tables that no migration creates');
});

test('nothing is called blocked that rests on a table the product already has', () => {
  const wrong = [];
  for (const row of MATRIX) {
    if (!row.status.includes('BLOCKED_ONLY_BY_SCHEMA')) continue;
    for (const table of row.tables ?? []) {
      if (PRE_EXISTING.has(table)) wrong.push(`${row.feature}: ${table} already exists in production`);
    }
    // A blocked row must say WHAT is blocking it, in a sentence naming the
    // object. "Database blocked" on its own is the wording this file exists
    // to make impossible.
    assert.ok(row.blocked && row.blocked.length > 40,
      `${row.feature}: BLOCKED_ONLY_BY_SCHEMA with no specific reason. Name the table or function.`);
    assert.ok(/comm_[a-z_]+/.test(row.blocked),
      `${row.feature}: the blocking reason must name the actual object, not just say "database".`);
  }
  assert.deepEqual(wrong, []);
});

test('every verification claim points at a test that exists', () => {
  const missing = [];
  for (const row of MATRIX) {
    const claimsVerified = row.status.includes('LOCAL_UNIT_VERIFIED') || row.status.includes('BROWSER_VERIFIED');
    if (claimsVerified && !(row.tests ?? []).length) missing.push(`${row.feature}: claims verification, names no test`);
    for (const t of row.tests ?? []) {
      if (!existsSync(join(ROOT, t))) missing.push(`${row.feature}: names ${t}, which does not exist`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every implementation claim points at code that exists', () => {
  const missing = [];
  for (const row of MATRIX) {
    assert.ok((row.code ?? []).length, `${row.feature}: names no source file`);
    for (const c of row.code ?? []) {
      if (!existsSync(join(ROOT, c))) missing.push(`${row.feature}: names ${c}, which does not exist`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every row says something definite about every axis', () => {
  const vague = [];
  for (const row of MATRIX) {
    if (!row.status.length) vague.push(`${row.feature}: no status`);
    if (row.status.includes('EXTERNAL') && !row.external) vague.push(`${row.feature}: EXTERNAL with no reason`);
    if (!row.status.includes('BLOCKED_ONLY_BY_SCHEMA') && !row.status.includes('EXTERNAL') && !row.note) {
      vague.push(`${row.feature}: not blocked and not external, but does not say so`);
    }
  }
  assert.deepEqual(vague, []);
});

test('the status document is regenerated from this matrix', () => {
  const counts = {
    total: MATRIX.length,
    blocked: MATRIX.filter((r) => r.status.includes('BLOCKED_ONLY_BY_SCHEMA')).length,
    external: MATRIX.filter((r) => r.status.includes('EXTERNAL')).length,
    clear: MATRIX.filter((r) => !r.status.includes('BLOCKED_ONLY_BY_SCHEMA') && !r.status.includes('EXTERNAL')).length,
  };

  const lines = [
    '# Communications Hub — what is finished and what is waiting',
    '',
    '<!-- GENERATED by tests/matrix/databaseBlocked.test.mjs. Edit the matrix there, not this file. -->',
    '',
    `${counts.total} features. ${counts.clear} are complete and unblocked today. ` +
    `${counts.blocked} are finished in code and wait only on the owner applying the migration. ` +
    `${counts.external} additionally need something outside this repository.`,
    '',
    'No row below is waiting on code that has not been written.',
    '',
    '| Feature | Status | What it waits on |',
    '| --- | --- | --- |',
    ...MATRIX.map((r) => {
      const waits = r.status.includes('BLOCKED_ONLY_BY_SCHEMA')
        ? r.blocked + (r.external ? ` ALSO: ${r.external}` : '')
        : r.external ?? r.note ?? 'Nothing.';
      return `| ${r.feature} | ${r.status.join(', ')} | ${waits.replace(/\|/g, '\\|')} |`;
    }),
    '',
    '## The two migrations, unapplied on purpose',
    '',
    ...MIGRATIONS.map((m) => `- \`${m}\``),
    '',
    `They create ${migrationTables.size} tables: ${[...migrationTables].sort().map((t) => `\`${t}\``).join(', ')}.`,
    '',
    'Applying them is a production schema change and is the owner\'s decision, not this branch\'s.',
    '',
  ];

  const target = join(ROOT, 'docs', 'communications-status.md');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, lines.join('\n'), 'utf8');

  /*
   * Three features are complete and unblocked TODAY: admin voice tuning, the
   * customer billing screen and contact import. All three were built
   * deliberately on tables the product already has, which is why they work
   * before the migration and why the reuse rule in the brief mattered.
   *
   * The floor is 3 because that is the honest number, not a target. If a
   * future edit drops it, something that used to work on the existing schema
   * has been moved onto the new one, and that is worth failing over.
   */
  assert.ok(counts.clear >= 3, `only ${counts.clear} features are unblocked; something regressed onto the new schema`);
  assert.ok(existsSync(target));
});
