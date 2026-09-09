import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * MATCHING LIFECYCLE — STATIC.
 *
 * markMatchPreviewed() issued `.from('matches').update({status:'PREVIEWED'})`.
 * public.matches has no UPDATE policy for a customer, so that matched zero
 * rows, and PostgREST answers a zero-row UPDATE with 204 and no error. Proven
 * against production as the real owner of a real NEW match, rolled back:
 *
 *   PROBE rows_updated=0 status_now=NEW
 *
 * The page hid it by setting PREVIEWED in local state straight afterwards, so
 * it looked right until reload. The cost is not cosmetic: the matching cleanup
 * sweep spares "UNLOCKED/PREVIEWED/ARCHIVED" rows and rejects NEW ones, so a
 * match the customer had opened was still eligible for deletion.
 *
 * The transition now lives in a SECURITY DEFINER function rather than an
 * UPDATE policy, because `status` is not the customer's column to write --
 * UNLOCKED is what credits buy.
 */

const ROOT = process.cwd();
const MIG = path.join(ROOT, 'supabase', 'migrations');
const rpc = fs.readFileSync(path.join(MIG, '20260911160000_match_preview_lifecycle.sql'), 'utf8');
const grants = fs.readFileSync(path.join(MIG, '20260911170000_properties_column_grants.sql'), 'utf8');
const api = fs.readFileSync(path.join(ROOT, 'src', 'services', 'api.ts'), 'utf8');

/** api.ts with comments stripped. The doc comment above markMatchPreviewed
 *  quotes the very call it replaced, so scanning the raw file finds the
 *  explanation and reports it as the defect. */
const apiCode = api.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the preview transition goes through the RPC, not a direct UPDATE', () => {
  assert.match(apiCode, /supabase\.rpc\('mark_match_previewed'/);
  assert.ok(
    !/from\('matches'\)\s*\n?\s*\.update\(/.test(apiCode),
    'a direct UPDATE on matches cannot work — there is no policy for it'
  );
});

test('the RPC can only move NEW to PREVIEWED', () => {
  assert.match(rpc, /if v_status = 'NEW' then/);
  assert.match(rpc, /set status = 'PREVIEWED'/);
  assert.match(rpc, /and status = 'NEW'/);
  // Nothing else may be written by it.
  assert.ok(!/'UNLOCKED'/.test(rpc.replace(/--.*$/gm, '')), 'the RPC must never assign UNLOCKED');
});

test('the RPC checks the caller owns the match before touching it', () => {
  assert.match(rpc, /m\.user_id = v_uid/);
  assert.match(rpc, /select p\.id from public\.properties p where p\.user_id = v_uid/);
  assert.match(rpc, /MATCH_NOT_FOUND/);
});

test('the RPC is not reachable anonymously', () => {
  assert.match(rpc, /revoke all on function public\.mark_match_previewed\(uuid\) from public, anon/);
  assert.match(rpc, /grant execute on function public\.mark_match_previewed\(uuid\) to authenticated, service_role/);
});

test('the page shows what the server recorded, not what it hoped', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'property', 'MatchesPage.tsx'), 'utf8');
  assert.match(page, /const recorded = await markMatchPreviewed\(match\.id\)/);
  assert.match(page, /if \(recorded\)/);
});

/* ---------------- derived columns on properties ---------------- */

test('a listing owner cannot rate their own property', () => {
  assert.match(grants, /revoke update on public\.properties from authenticated, anon/);
  const granted = grants.slice(grants.indexOf('grant update ('), grants.indexOf('on public.properties to authenticated'));
  for (const col of ['matchability_score', 'developer_id', 'canonical_group_id', 'user_id', 'source_type']) {
    assert.ok(!granted.includes(col), `${col} must not be client-writable`);
  }
  for (const col of ['title', 'matching_status', 'cover_photo_url', 'transaction_type', 'property_type', 'is_deleted']) {
    assert.ok(granted.includes(col), `${col} is a legitimate client write and must stay granted`);
  }
});

test('derived columns cannot be seeded at insert either', () => {
  assert.match(grants, /revoke insert \(matchability_score, developer_id, canonical_group_id\)/);
});

test('the client API no longer offers to write the derived score', () => {
  const fn = api.slice(api.indexOf('export async function updateProperty'), api.indexOf('export async function softDeleteProperty'));
  assert.ok(!fn.includes('matchability_score'), 'the signature must not invite a write the database refuses');
});

/* ---------------- campaign controls actually change something ---------------- */

test('starting a campaign fails loudly when a write does not land', () => {
  const fn = api.slice(api.indexOf('export async function startMatchingCampaign'), api.indexOf('export async function pauseMatchingCampaign'));
  assert.match(fn, /if \(campErr\) throw/);
  assert.match(fn, /if \(propErr\) throw/);
  assert.match(fn, /if \(insertErr \|\| !data\)/);
});

test('pausing reports failure instead of claiming a pause that did not happen', () => {
  const fn = api.slice(api.indexOf('export async function pauseMatchingCampaign'));
  assert.match(fn.slice(0, 1600), /Could not pause the campaign/);
  assert.match(fn.slice(0, 1600), /Could not pause the property/);

  for (const p of ['MatchesPage.tsx', 'PropertyDetailPage.tsx']) {
    const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'property', p), 'utf8');
    const handler = page.slice(page.indexOf('pauseMatchingCampaign(propertyId'));
    assert.match(handler.slice(0, 700), /matches_pause_error/, `${p} must surface a failed pause`);
    // The active flag must not be cleared on the failure path — the campaign is
    // still running and still spending credits.
    const success = handler.slice(0, handler.indexOf('catch'));
    assert.match(success, /set(Campaign)?Active\(false\)/);
  }
});

test('"could not pause" is translated in every supported language', () => {
  const translations = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'translations.ts'), 'utf8');
  assert.equal((translations.match(/matches_pause_error:/g) ?? []).length, 6);
});
