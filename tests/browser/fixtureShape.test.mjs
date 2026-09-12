// The fixture must describe the database the product actually has.
//
// WHY THIS EXISTS
//
// A browser sweep is only worth running if its fixtures are true. The first
// draft of commFixtures.mjs was written from memory: a campaign got a
// `channel` column, which was renamed to `campaign_type` two migrations ago.
// The Overview page read `c.campaign_type.toLowerCase()`, got undefined, and
// the error boundary blanked the screen. The sweep dutifully reported a
// critical rendering failure in code that was entirely correct.
//
// A fixture that is wrong in that direction wastes an afternoon. A fixture
// that is wrong in the other direction is worse: it makes a broken screen
// pass, because the page never receives the shape that would break it.
//
// So the fixtures are checked against the declared row types in
// src/types/communications.ts and against the vocabularies in
// src/lib/comm/vocabulary.ts — which are themselves checked against the
// database's own CHECK constraints by an existing test. That makes this an
// indirect but real check against the schema.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TABLES } from './commFixtures.mjs';
import {
  AGENT_STATUSES, AGENT_TEMPLATES, CAMPAIGN_STATUSES, CAMPAIGN_TYPES, CHANNELS,
  CONVERSATION_MODES, LEAD_STAGES, MESSAGE_STATUSES, SEND_STATUSES,
  TEMPLATE_STATUSES, TRUST_TIERS, RISK_LEVELS, POLICY_DECISIONS,
} from '../../src/lib/comm/vocabulary.ts';

const ROOT = process.cwd();
const TYPES = readFileSync(join(ROOT, 'src', 'types', 'communications.ts'), 'utf8');

/**
 * Pull the declared field names out of one exported interface.
 *
 * Text parsing rather than the TypeScript compiler on purpose: this file has
 * to run under plain `node --test` alongside every other suite here, and the
 * shapes it reads are flat lists of `name: type;` lines.
 */
function declaredFields(interfaceName) {
  // `extends` sits between the name and the brace, so the declaration cannot
  // be found by looking for "Name {".
  const decl = new RegExp(`export interface ${interfaceName}(\\s+extends\\s+\\w+)?\\s*\\{`).exec(TYPES);
  assert.ok(decl, `${interfaceName} is not declared in src/types/communications.ts`);
  const open = decl.index + decl[0].length - 1;
  let depth = 0;
  let end = open;
  for (let i = open; i < TYPES.length; i++) {
    if (TYPES[i] === '{') depth++;
    else if (TYPES[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = TYPES.slice(open + 1, end);
  const fields = new Set();
  for (const m of body.matchAll(/^\s{2}(\w+)\??:/gm)) fields.add(m[1]);

  // `extends` carries the parent's fields too (AgentListRow extends CommAgent).
  const ext = new RegExp(`export interface ${interfaceName} extends (\\w+)`).exec(TYPES);
  if (ext) for (const f of declaredFields(ext[1])) fields.add(f);
  return fields;
}

/*
 * table -> the interface the UI reads its rows as, and the enum columns whose
 * values the database CHECKs.
 */
const SHAPES = [
  { table: 'comm_agents', type: 'AgentListRow', enums: { status: AGENT_STATUSES, template_code: AGENT_TEMPLATES } },
  { table: 'outreach_campaigns', type: 'CommCampaign', enums: { campaign_type: CAMPAIGN_TYPES, status: CAMPAIGN_STATUSES, risk_level: RISK_LEVELS } },
  { table: 'outreach_sends', type: 'CommSend', enums: { status: SEND_STATUSES } },
  { table: 'outreach_contacts', type: 'CommContact', enums: { lead_stage: LEAD_STAGES } },
  { table: 'comm_conversations', type: 'CommConversation', enums: { channel: CHANNELS, mode: CONVERSATION_MODES, lead_stage: LEAD_STAGES } },
  { table: 'comm_messages', type: 'CommMessage', enums: { status: MESSAGE_STATUSES } },
  { table: 'comm_whatsapp_templates', type: 'CommTemplate', enums: { status: TEMPLATE_STATUSES } },
  { table: 'comm_channel_accounts', type: 'CommChannelAccount', enums: {} },
  { table: 'comm_risk_assessments', type: 'RiskAssessmentRow', enums: { decision: POLICY_DECISIONS, risk_level: RISK_LEVELS } },
  { table: 'comm_extractions', type: 'CommExtraction', enums: {} },
];

test('no fixture row invents a column the UI types do not declare', () => {
  const invented = [];
  for (const { table, type } of SHAPES) {
    const declared = declaredFields(type);
    for (const row of TABLES[table] ?? []) {
      for (const key of Object.keys(row)) {
        if (!declared.has(key)) invented.push(`${table}.${row.id ?? '?'}: "${key}" is not a field of ${type}`);
      }
    }
  }
  assert.deepEqual(invented, [],
    'a fixture column that does not exist is a fixture that tests nothing:\n  - ' + invented.join('\n  - '));
});

test('no fixture row omits a column the UI types declare as required', () => {
  /*
   * The direction that actually hides bugs.
   *
   * A missing column arrives as `undefined`, and a page that would crash on a
   * REAL null passes anyway, because undefined and null take different paths
   * through optional chaining. Optional fields (`foo?:`) are exempt; a field
   * typed `| null` is NOT — the database returns null for those and the UI
   * must receive null.
   */
  const missing = [];
  for (const { table, type } of SHAPES) {
    const declared = [...declaredFields(type)];
    const optional = new Set(
      [...TYPES.matchAll(/^\s{2}(\w+)\?:/gm)].map((m) => m[1])
    );
    for (const row of TABLES[table] ?? []) {
      for (const field of declared) {
        if (optional.has(field)) continue;
        if (!(field in row)) missing.push(`${table}.${row.id ?? '?'}: missing "${field}"`);
      }
    }
  }
  assert.deepEqual(missing, [],
    'every declared column must be present, with null where the row has no value:\n  - ' + missing.join('\n  - '));
});

test('every enum column holds a value the database would accept', () => {
  const bad = [];
  for (const { table, enums } of SHAPES) {
    for (const row of TABLES[table] ?? []) {
      for (const [column, allowed] of Object.entries(enums)) {
        const value = row[column];
        if (value == null) continue; // a nullable enum column may be null
        if (!allowed.includes(value)) {
          bad.push(`${table}.${row.id ?? '?'}: ${column}="${value}" is not one of ${allowed.join(', ')}`);
        }
      }
    }
  }
  assert.deepEqual(bad, [],
    'a value outside the CHECK constraint could never come out of the database:\n  - ' + bad.join('\n  - '));
});

test('the fixtures keep the adversarial cases they were built for', () => {
  /*
   * The rows exist to break layouts and to exercise the honest-empty paths.
   * A future tidy-up that "simplifies" them would quietly turn this sweep into
   * a test of the happy path, so the awkward ones are named.
   */
  const campaigns = TABLES.outreach_campaigns;
  const sends = TABLES.outreach_sends;
  const contacts = TABLES.outreach_contacts;
  const conversations = TABLES.comm_conversations;
  const templates = TABLES.comm_whatsapp_templates;

  assert.ok(campaigns.some((c) => /^[Ⴀ-ჿ-]{30,}$/.test(c.name)),
    'a long unbroken Georgian campaign name is what finds a table that will not wrap');

  assert.ok(sends.some((s) => s.cost_usd === null && s.status !== 'PENDING'),
    'a completed send with a null cost is what proves the billing screen says "no price set" rather than "$0.00"');

  assert.ok(contacts.some((c) => c.full_name === null),
    'a contact with no name is what finds the screen that renders "undefined"');

  assert.ok(contacts.some((c) => c.suppressed === true && c.whatsapp_opted_out === true),
    'an opted-out contact is what proves the UI refuses to offer a send');

  assert.ok(conversations.some((c) => Date.parse(c.service_window_expires_at) < Date.now()),
    'an expired 24-hour window is what proves the inbox offers a template instead of a free-text box');

  assert.ok(conversations.some((c) => c.peer_name === null),
    'a conversation with no peer name must still render a usable row');

  assert.ok(templates.some((t) => t.status === 'REJECTED' && (t.rejection_reason ?? '').length > 80),
    'a long rejection reason is what finds the card that will not wrap');

  const numbers = sends.map((s) => s.recipient_phone).filter(Boolean);
  const prefixes = new Set(numbers.map((n) => n.slice(0, 3)));
  assert.ok(prefixes.size >= 3,
    `phone numbers from at least three countries are needed to catch a column sized for one; found ${[...prefixes].join(', ')}`);

  assert.ok(sends.some((s) => (s.error_message ?? '').includes('token is invalid or expired')),
    'a send that failed on the rejected WhatsApp token keeps the real production state visible in the sweep');
});

test('the fixture carries no real credential and no real phone number', () => {
  const text = readFileSync(join(ROOT, 'tests', 'browser', 'commFixtures.mjs'), 'utf8');

  // Reserved ranges only: +1 202 555 01xx, +995 5xx and +971 5x are either
  // documentation ranges or unassigned test numbers. A fixture must never
  // carry a number that could ring somebody.
  const usNumbers = [...text.matchAll(/\+1(\d{10})/g)].map((m) => m[1]);
  for (const n of usNumbers) {
    assert.match(n, /^202555\d{4}$/,
      `+1${n} is not in the 555 documentation range; a fixture must not hold a number that could ring someone`);
  }

  assert.ok(!/ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(text),
    'the fixture contains something shaped like a real JWT');
  assert.ok(!/(sk-[A-Za-z0-9]{16,}|EAA[A-Za-z0-9]{20,})/.test(text),
    'the fixture contains something shaped like a real provider key');
});
