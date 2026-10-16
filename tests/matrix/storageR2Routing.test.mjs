// R2 routing (20261107090000): applying the migration re-routes, copies and
// deletes nothing; the authoriser is production's exact function plus one
// branch; every routed call site reads R2-first with a Supabase fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const FILE = 'supabase/migrations/20261107090000_storage_r2_routing.sql';
const sql = readFileSync(FILE, 'utf8');

test('applying it moves, copies, deletes and schedules nothing', () => {
  const code = sql.replace(/--.*$/gm, '');
  assert.ok(!/\bdelete\s+from\b/i.test(code));
  assert.ok(!/\btruncate\b/i.test(code));
  assert.ok(!/\bdrop\s+(table|function|schema|policy|bucket)\b/i.test(code));
  assert.ok(!/cron\.schedule\(/.test(code));
  assert.ok(!/\bupdate\s+storage\./i.test(code), 'touches Supabase Storage rows');
  // every routed bucket starts on SUPABASE, and the row never overwrites a later choice
  const seed = sql.slice(sql.indexOf("'storage_r2_routing', jsonb_build_object("), sql.indexOf('on conflict (key) do nothing'));
  assert.ok(!/'R2'/.test(seed), 'a bucket seeded on R2');
  assert.match(sql, /'storage_r2_routing'[\s\S]*?on conflict \(key\) do nothing/);
});

test('storage_authorize is production\'s exact function plus the meta-ads-media branch', () => {
  const start = sql.indexOf('as $fn$') + 'as $fn$'.length;
  const body = sql.slice(start, sql.indexOf('$fn$;', start));
  const branchStart = body.indexOf('  -- Meta Ads creatives (20261107090000)');
  const branchEnd = body.indexOf('  -- ══ DESIGN STUDIO CATALOGUE');
  assert.ok(branchStart > 0 && branchEnd > branchStart);
  const withoutBranch = body.slice(0, branchStart) + body.slice(branchEnd);
  // md5(prosrc) of public.storage_authorize in production before this migration
  assert.equal(createHash('md5').update(withoutBranch).digest('hex'), '6ea98b22a21a8e506da7a9db10ea9356');
  const branch = body.slice(branchStart, branchEnd);
  assert.match(branch, /if v_admin and p_action = 'READ' then return 'ALLOW'/);
  assert.ok(!/p_action in \('WRITE'|v_admin then return 'ALLOW'/.test(branch), 'admin must not write or delete');
});

test('the switch and the inventory are admin-only; anon reaches nothing', () => {
  for (const fn of ['storage_admin_set_write_target', 'storage_admin_inventory']) {
    const body = sql.slice(sql.indexOf(`function public.${fn}`));
    assert.match(body.slice(0, 600), /if not public\.is_admin\(\) then raise exception 'forbidden'/, `${fn} has no admin check`);
  }
  assert.match(sql, /revoke all on function public\.storage_write_target\(text\) from public, anon/);
  assert.match(sql, /revoke all on function public\.storage_admin_inventory\(\) from public, anon/);
});

test('no routed bucket is read or signed from Supabase Storage directly any more', () => {
  const sites = {
    'src/services/metaAds.ts': 'meta-ads-media',
    'src/services/dealRoomDocuments.ts': 'deal-room-documents',
    'src/services/documentWorkspace.ts': 'deal-room-documents',
    'supabase/functions/meta-ads-api/engine.ts': 'meta-ads-media',
    'supabase/functions/deal-room-document-analyze/index.ts': 'deal-room-documents',
  };
  for (const [file, bucket] of Object.entries(sites)) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!new RegExp(`storage\\s*\\.from\\(\\s*'${bucket}'`).test(src), `${file} still calls storage.from('${bucket}')`);
  }
  const ai = readFileSync('supabase/functions/meta-ads-api/creativeAi.ts', 'utf8');
  assert.ok(!/storage\.from\(BUCKET\)/.test(ai), 'creativeAi still uses Supabase Storage directly');
});

test('a browser read never renders nothing: a missing URL or any signer failure falls back to Supabase', () => {
  const src = readFileSync('src/services/storage/routed.ts', 'utf8');
  const fn = src.slice(src.indexOf('export async function signedRoutedUrl'), src.indexOf('export async function removeRouted'));
  // Found in CI (mobile:meta-ads): a signer answering 200 with no url made a creative render as nothing.
  assert.match(fn, /if \(typeof url === 'string' && url\.length > 0\) return url;/);
  assert.match(fn, /\} catch \{/, 'every signer failure falls through');
  assert.match(fn, /supabase\.storage\.from\(bucket\)\s*\.createSignedUrl\(path, expiresIn/);
  assert.ok(!/throw e;/.test(fn), 'no signer error escapes before the Supabase fallback');
});
