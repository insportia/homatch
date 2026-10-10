// LEADS CRM — pure rules: export allowlist, deep links, event descriptions, statuses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CRM_CSV_COLUMNS, CRM_STATUSES, KNOWN_EVENT_KINDS, buildCrmCsv, conversationHref, csvCell, describeEvent,
  emailStudioHref, humanizeKind, isFollowUpDue, isoToLocalInput, localInputToIso, parseEntryParam, statusLabelKey,
} from '../model.ts';
import { LEADS_CRM_STRINGS } from '../../../scripts/leads-crm-i18n-data.mjs';
import { validate } from '../../../scripts/lib/i18nSplice.mjs';

const opts = {
  headers: { name: 'Name', status: 'Status', property: 'Property', homatchId: 'HOMATCH ID', lastActivity: 'Last activity', followUp: 'Follow-up' },
  statusLabel: (s) => `L:${s}`,
  formatDate: (iso) => iso.slice(0, 10),
  anonymous: 'HOMATCH member',
};

test('the CSV never carries a phone number or an email address', () => {
  const rows = [{
    displayName: 'Nino', status: 'REPLIED', propertyTitle: 'Vake 2BR', homatchId: 123456,
    lastActivityAt: '2026-10-01T10:00:00Z', followUpAt: '2026-10-12T09:00:00Z',
    /* Fields a future row might carry. None may reach the file. */
    phone: '+995 555 12 34 56', email: 'nino@example.com', contactPhone: '599000000', contact_email: 'x@y.z',
    followUpNote: 'call her on +995 599 11 22 33',
  }];
  const csv = buildCrmCsv(rows, opts);
  assert.ok(!/555 12 34 56|599000000|599 11 22 33/.test(csv), 'a phone number reached the CSV');
  assert.ok(!/@/.test(csv), 'an email address reached the CSV');
  assert.ok(!/phone|e-?mail/i.test(csv), 'a contact column reached the CSV');
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split(',').length, CRM_CSV_COLUMNS.length);
  assert.equal(lines[1], '"Nino","L:REPLIED","Vake 2BR","123456","2026-10-01","2026-10-12"');
});

test('the CSV column allowlist is exactly the permitted set', () => {
  assert.deepEqual([...CRM_CSV_COLUMNS], ['name', 'status', 'property', 'homatchId', 'lastActivity', 'followUp']);
});

test('CSV cells are quoted and spreadsheet formulas are defused', () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1'), `"'+1"`);
  assert.equal(csvCell(null), '""');
  const csv = buildCrmCsv([{ displayName: null, status: 'UNLOCKED' }], opts);
  assert.ok(csv.startsWith('﻿'), 'BOM missing — Georgian would open garbled');
  assert.match(csv, /"HOMATCH member"/);
});

test('the ?entry= deep link accepts only a UUID', () => {
  assert.equal(parseEntryParam('3E7F132B-D0BE-4804-9BC0-0B6AD368AD15'), '3e7f132b-d0be-4804-9bc0-0b6ad368ad15');
  assert.equal(parseEntryParam('../admin'), null);
  assert.equal(parseEntryParam(''), null);
  assert.equal(parseEntryParam(null), null);
});

test('navigation targets', () => {
  assert.equal(conversationHref('abc'), '/chat?conversation=abc');
  assert.equal(emailStudioHref([]), null);
  assert.equal(
    emailStudioHref([{ entryId: 'e1', propertyId: 'p1' }, { entryId: 'e2', propertyId: 'p1' }]),
    '/email-studio?property=p1&entries=e1,e2',
  );
  /* Mixed properties: do not guess one. */
  assert.equal(
    emailStudioHref([{ entryId: 'e1', propertyId: 'p1' }, { entryId: 'e2', propertyId: 'p2' }]),
    '/email-studio?entries=e1,e2',
  );
  assert.equal(emailStudioHref([{ entryId: 'e1', propertyId: null }]), '/email-studio?entries=e1');
});

test('due follow-ups', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(isFollowUpDue('2026-10-10T11:59:00Z', now), true);
  assert.equal(isFollowUpDue('2026-10-10T12:01:00Z', now), false);
  assert.equal(isFollowUpDue(null, now), false);
  assert.equal(isFollowUpDue('garbage', now), false);
});

test('events: known kinds have keys, status changes carry labels, unknown kinds degrade', () => {
  for (const k of KNOWN_EVENT_KINDS) assert.equal(describeEvent({ kind: k }).key, `crm_event_${k}`);
  const sc = describeEvent({ kind: 'STATUS_CHANGED', detail: { from: 'CONTACTED', to: 'REPLIED', by: 'SYSTEM' } });
  assert.deepEqual(sc.vars, { fromKey: 'crm_status_CONTACTED', toKey: 'crm_status_REPLIED' });
  assert.equal(sc.automatic, true);
  assert.equal(describeEvent({ kind: 'FOLLOW_UP_SCHEDULED', detail: { at: '2026-10-12T09:00:00Z' } }).at, '2026-10-12T09:00:00Z');
  const unknown = describeEvent({ kind: 'EMAIL_UNSUBSCRIBED', detail: null });
  assert.equal(unknown.key, 'crm_event_generic');
  assert.equal(unknown.vars.kind, 'email unsubscribed');
  assert.equal(humanizeKind(''), '');
  assert.equal(statusLabelKey('NOPE'), 'crm_status_unknown');
});

test('datetime-local round trip', () => {
  const iso = localInputToIso('2026-10-12T09:30');
  assert.ok(iso && iso.endsWith('Z'));
  assert.equal(isoToLocalInput(iso), '2026-10-12T09:30');
  assert.equal(localInputToIso(''), null);
  assert.equal(isoToLocalInput('bad'), '');
});

test('every key the CRM renders dynamically exists in six languages, with valid placeholders', () => {
  assert.deepEqual(validate(LEADS_CRM_STRINGS, 'leads-crm'), []);
  const need = [
    ...CRM_STATUSES.map((s) => `crm_status_${s}`), 'crm_status_unknown', 'crm_event_generic',
    ...KNOWN_EVENT_KINDS.map((k) => `crm_event_${k}`),
    ...['follow_up_due', 'reply', 'first_message', 'wait_for_reply', 'follow_up_no_reply', 'propose_viewing',
      'confirm_viewing', 'record_outcome', 'respect_decision', 'review'].flatMap((c) => [`crm_next_${c}_title`, `crm_next_${c}_body`]),
  ];
  for (const k of need) assert.ok(LEADS_CRM_STRINGS[k], `missing ${k}`);
});

test('approved copy is verbatim, and Georgian terminology holds', () => {
  const en = (k) => LEADS_CRM_STRINGS[k][0];
  assert.equal(en('crm_headline'), 'Your Buyer Relationships');
  assert.equal(en('crm_description'), 'Keep every conversation, property offer and follow-up organized in one place.');
  assert.equal(en('crm_empty'), 'Your unlocked contacts will appear here. Start with a matching buyer and build the conversation from there.');
  assert.equal(en('crm_next_label'), 'Suggested Next Step');
  assert.equal(en('crm_next_disclaimer'), 'Suggestions are based on available activity and should be reviewed before use.');
  for (const [k, v] of [['crm_open_conversation', 'Open Conversation'], ['crm_create_email', 'Create Email'], ['crm_add_note', 'Add Note'],
    ['crm_schedule_follow_up', 'Schedule Follow-Up'], ['crm_update_status', 'Update Status'], ['crm_view_activity', 'View Activity'],
    ['notif_property_offer_title', 'New Property Message'], ['notif_property_offer_cta', 'Open Conversation'],
    ['notif_native_supply_new_title', 'New Matching Buyers Found'], ['notif_native_supply_cta', 'View New Matches']]) {
    assert.equal(en(k), v);
  }
  const all = JSON.stringify(LEADS_CRM_STRINGS);
  assert.ok(!all.includes('შესატყვისი'), 'match is დამთხვევა, never შესატყვისი');
  assert.ok(!/confirmed buyer/i.test(all), 'never "confirmed buyer"');
});

test('the CRM UI never reads a contact field', () => {
  const files = [
    'src/pages/LeadsCrmPage.tsx', 'src/components/crm/CrmEntryDrawer.tsx', 'src/components/crm/CrmEntryRow.tsx',
    'src/services/leadsCrm.ts',
  ];
  for (const f of files) {
    const src = readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');
    assert.ok(!/\.(phone|email|contactPhone|contact_phone|contactEmail|contact_email)\b/.test(src), `${f} reads a contact field`);
  }
});
