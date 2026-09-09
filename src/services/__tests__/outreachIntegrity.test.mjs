import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * OUTREACH SEND INTEGRITY — STATIC.
 *
 * The defect these guard against: outreach-send excluded already-contacted
 * people by SELECTing them first and filtering in JavaScript, then called the
 * provider, then inserted the row that was supposed to prevent a second call.
 * Two overlapping invocations both read an empty exclusion set and both dialled
 * the same person -- a real phone call, twice, billed twice.
 *
 * The fix is a claim: insert the outreach_sends row BEFORE contacting anyone,
 * and let a unique index decide who won. These tests pin both halves, because
 * either half alone is useless -- the index without the claim still allows the
 * duplicate call, and the claim without the index is just the old race again.
 */

const ROOT = process.cwd();
const MIG = path.join(ROOT, 'supabase', 'migrations');
const FN = path.join(ROOT, 'supabase', 'functions');

const integrity = fs.readFileSync(path.join(MIG, '20260911150000_outreach_send_integrity.sql'), 'utf8');
const send = fs.readFileSync(path.join(FN, 'outreach-send', 'index.ts'), 'utf8');
const importFn = fs.readFileSync(path.join(FN, 'contact-import', 'index.ts'), 'utf8');

/* ------------------------- the database half ------------------------- */

test('one non-failed send per contact per campaign is enforced by a unique index', () => {
  assert.match(
    integrity,
    /create unique index[\s\S]*?outreach_sends \(campaign_id, contact_id\)/i,
    'without this the claim is not atomic and the race is still open'
  );
  // Partial: a genuine provider failure must not permanently block a retry.
  assert.match(integrity, /where contact_id is not null and status <> 'FAILED'/i);
});

test('the index predicate matches the exclusion query outreach-send runs', () => {
  // If these two ever disagree, the function selects a contact the index then
  // refuses -- every send in the batch turns into a skip and the campaign
  // stalls without an error.
  assert.match(send, /\.neq\('status', 'FAILED'\)/);
  assert.match(integrity, /status <> 'FAILED'/i);
});

test('a contact cannot appear twice in the same list', () => {
  assert.match(integrity, /outreach_contacts \(list_id, lower\(email\)\)/i);
  assert.match(integrity, /outreach_contacts \(list_id, phone\)/i);
});

test('campaign counters are recomputed, never accumulated', () => {
  assert.match(integrity, /create or replace function public\.outreach_recompute_campaign_counters/i);
  // Derived from the send log, so running it twice cannot double a number.
  assert.match(integrity, /from public\.outreach_sends\s+where campaign_id = p_campaign_id/i);
  // Webhook-fed counters must not be clobbered by a recompute that cannot see them.
  for (const c of ['open_count', 'click_count', 'reply_count', 'unsubscribe_count', 'complaint_count']) {
    assert.ok(!integrity.includes(`${c} =`), `${c} comes from provider webhooks and must not be recomputed`);
  }
});

test('a campaign owner cannot rewrite their own spend figure', () => {
  assert.match(integrity, /revoke all on function public\.outreach_recompute_campaign_counters\(uuid\) from public, anon, authenticated/i);
  assert.match(integrity, /grant execute on function public\.outreach_recompute_campaign_counters\(uuid\) to service_role/i);
});

test('the recommendation rationale is stored as an object', () => {
  // Three writers store {location_match, ..., summary}; the panel reads
  // rationale?.summary. A text column silently breaks that whole explanation.
  assert.match(integrity, /alter column rationale type jsonb/i);
});

/* ------------------------ the application half ------------------------ */

test('outreach-send claims a contact before contacting them', () => {
  const claimAt = send.indexOf("status: 'QUEUED'");
  assert.ok(claimAt > 0, 'the claim insert must exist');

  for (const dispatch of ['emailAdapter.send(', 'smsAdapter.send(', 'voiceAdapter.initiateCall(']) {
    const at = send.indexOf(dispatch);
    assert.ok(at > 0, `${dispatch} should still be there`);
    assert.ok(at > claimAt, `${dispatch} must happen after the claim, not before it`);
  }
});

test('losing the claim race skips the contact instead of sending', () => {
  assert.match(send, /claimErr\?\.code === '23505'/, 'a unique violation is the guard firing, not an error to ignore');
  const guard = send.slice(send.indexOf("claimErr?.code === '23505'"));
  assert.match(guard.slice(0, 120), /continue;/, 'it must skip the contact, not fall through to a send');
});

test('outreach-send records every outcome on the claimed row', () => {
  // One row per attempt. Inserting a second row for the outcome would leave the
  // QUEUED claim behind and double the campaign's send count.
  const loop = send.slice(send.indexOf('for (const contact of contacts)'));
  const inserts = loop.match(/from\('outreach_sends'\)\s*\.insert\(/g) ?? [];
  assert.equal(inserts.length, 1, 'only the claim may INSERT into outreach_sends inside the loop');
  assert.match(loop, /const finalize = async/, 'outcomes are written by updating the claimed row');
});

test('a claimed contact whose send never dispatched is released', () => {
  // Otherwise a channel with no adapter leaves a QUEUED row that blocks that
  // contact for the life of the campaign.
  assert.match(send, /No provider adapter available for channel/);
});

test('a stuck claim keeps a campaign from being called COMPLETED', () => {
  const inflight = send.match(/\.in\('status', \[[^\]]*\]\)/g) ?? [];
  assert.ok(inflight.length > 0);
  for (const m of inflight) {
    assert.match(m, /'QUEUED'/, `in-flight check ${m} must count claimed-but-undispatched rows`);
  }
});

test('duplicate contacts are never contacted', () => {
  // Two independent defences: import does not store them, and send filters
  // them out anyway -- rows imported before the fix are still in the table.
  assert.match(importFn, /const insertable = contactRows\.filter\(\(r\) => !r\.is_duplicate\)/);
  assert.match(send, /\.eq\('is_duplicate', false\)/);
});

test('an import that could not store its contacts does not report READY', () => {
  assert.match(importFn, /const importStatus = failures\.length > 0 \? 'FAILED' : 'READY'/);
  // The stats must describe rows that exist, not rows that were uploaded.
  assert.match(importFn, /valid_rows: inserted/);
});

test('a re-uploaded file adds new contacts instead of failing the whole batch', () => {
  assert.match(importFn, /rowErr\.code === '23505'/);
  assert.match(importFn, /alreadyInList\+\+/);
});

/* ------------------------ silent-success guards ------------------------ */

test('a generated social post that was not saved is reported as a failure', () => {
  const gen = fs.readFileSync(path.join(FN, 'social-post-generate', 'index.ts'), 'utf8');
  assert.match(gen, /if \(postErr \|\| !post\)/);
  assert.match(gen, /Post was generated but could not be saved/);
});

test('deleting a contact list confirms something was actually deleted', () => {
  // PostgREST answers 204 with no error when a DELETE matches zero rows, so
  // "deleted" was shown for rows RLS had filtered out.
  const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'outreach', 'ContactListsPage.tsx'), 'utf8');
  assert.match(page, /\.delete\(\)\.eq\('id', id\)\.select\('id'\)/);
  assert.match(page, /!data \|\| data\.length === 0/);
});

/* -------------------- the schema is reproducible -------------------- */

test('the outreach tables are created by a migration, not by hand', () => {
  const manifest = fs.readFileSync(
    path.join(MIG, '20260829150950_remote_applied_outreach_community_email_foundation.sql'),
    'utf8'
  );
  for (const t of [
    'outreach_contact_lists',
    'outreach_contacts',
    'community_directory',
    'property_community_recommendations',
  ]) {
    assert.match(
      manifest,
      new RegExp(`create table if not exists public\\.${t}\\b`, 'i'),
      `${t} must exist before the next migration ALTERs it`
    );
  }
});

test('the capture runs before the migration that renames its columns', () => {
  // 20260829180000 opens with ALTER TABLE ... RENAME COLUMN. It can only work
  // if the capture above has a strictly lower version.
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
  const capture = files.indexOf('20260829150950_remote_applied_outreach_community_email_foundation.sql');
  const rename = files.indexOf('20260829180000_outreach_schema_reconciliation.sql');
  assert.ok(capture >= 0 && rename >= 0);
  assert.ok(capture < rename, 'the tables must be created before they are altered');
});
