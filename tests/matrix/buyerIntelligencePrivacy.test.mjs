// BUYER INTELLIGENCE — derived from what people explicitly asked for, never
// from what they said in a chat or calculated in a mortgage tool.
//
// Source-level guards on the two migrations behind /admin/buyer-intelligence
// and /admin/market-segmentation. Behaviour is exercised by
// tests/sql/run-buyer-intelligence.sh against a local Postgres.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const stripComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const BI = read('supabase/migrations/20261024110000_buyer_intelligence.sql');
const SEG = read('supabase/migrations/20261024100000_market_segmentation.sql');
const BI_CODE = stripComments(BI);

test('buyer intelligence never reads chat text, mortgage data or external people', () => {
  for (const forbidden of [/mortgage_/i, /original_?text/i, /translated_text/i, /originalText/, /\bmessages\b/i,
    /\bconversations\b/i, /live_chat/i, /ai_conversations/i, /raw_signals/i, /find_buyers_leads\s+\w+\s+join/i]) {
    assert.doesNotMatch(BI_CODE, forbidden, `buyer intelligence SQL touches ${forbidden}`);
  }
});

test('a viewed property price is never read as a budget', () => {
  // The property-interest branch selects null budgets explicitly.
  const branch = BI_CODE.slice(BI_CODE.indexOf("'VIEWING_REQUEST' else 'PROPERTY_ENQUIRY'"));
  assert.ok(branch.length > 0, 'property-interest branch not found');
  assert.doesNotMatch(branch.slice(0, branch.indexOf('from public.intent_signals')), /total_price|price_per_sqm/);
});

test('external demand without a subscription is not a HOMATCH person', () => {
  assert.match(BI_CODE, /from public\.active_search_subscriptions s\s+join public\.intent_profiles ip on ip\.id = s\.intent_id/);
});

test('every admin_* function refuses a non-admin and is not executable by anon', () => {
  for (const [name, sql] of [['buyer', BI], ['segmentation', SEG]]) {
    const fns = [...sql.matchAll(/create or replace function public\.(admin_[a-z_]+)\(/g)].map((m) => m[1]);
    assert.ok(fns.length >= 3, `${name}: admin functions not found`);
    for (const fn of fns) {
      const body = sql.slice(sql.indexOf(`function public.${fn}(`));
      const end = body.indexOf('end $$;');
      const head = body.slice(0, end);
      const guarded = /if not public\.is_admin\(\) then raise exception 'FORBIDDEN/.test(head);
      const internal = new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`).test(sql);
      assert.ok(guarded || internal, `${fn} is neither admin-guarded nor internal`);
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`), `${fn} not revoked from anon`);
    }
  }
});

test('mass reclassification needs the expected change count AND the preview token', () => {
  const apply = SEG.slice(SEG.indexOf('function public.admin_market_segment_apply('));
  assert.match(apply, /p_expected_changes <> \(v_diff->>'changed_count'\)::int/);
  assert.match(apply, /p_confirmation <> v_diff->>'confirmation_token'/);
  assert.match(apply, /insert into public\.market_segment_rule_audit/);
  const preview = SEG.slice(SEG.indexOf('function public.admin_market_segment_preview('), SEG.indexOf('function public.admin_market_segment_save_draft('));
  assert.doesNotMatch(stripComments(preview), /\binsert\b|\bupdate\b|\bdelete\b/i, 'preview writes');
});

test('the segment list never returns an owner contact phone', () => {
  const list = stripComments(SEG.slice(SEG.indexOf('function public.admin_property_segments_list(')));
  assert.doesNotMatch(list, /contact_phone/);
});
