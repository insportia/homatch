// A Telegram community a real read proved public is registered in
// source_registry, so every signal it yields carries source_id and
// revalidate-evidence can re-read it instead of answering "unregistered".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

test('source discovery registers an audited community and links the target', () => {
  const d = read('supabase/functions/community-sync/sourceDiscovery.ts');
  assert.match(d, /export async function registerSource/);
  assert.match(d, /access_finding: 'PUBLIC_HTML'/);
  assert.match(d, /active: false/, 'the registry never starts a second reader');
  assert.match(d, /ignoreDuplicates: true/, 'an operator decision on an existing entry is kept');
  assert.ok(d.indexOf('await registerSource(db, target, market)') > d.indexOf("lifecycle: audit.qualifies ? 'AUDITED' : 'LOW_SIGNAL'"), 'registered only after the read');
});

test('the sync self-heals a readable target without a registry entry', () => {
  const s = read('supabase/functions/community-sync/index.ts');
  const heal = s.indexOf('if (!target.source_id && collected.length > 0)');
  assert.ok(heal > 0 && heal < s.indexOf('source_id: (target as Record<string, unknown>).source_id ?? null'), 'linked before signals are written');
});

test('the backfill links existing targets and their signals', () => {
  const m = read('supabase/migrations/20261001160000_telegram_discovered_source_registry.sql');
  assert.match(m, /on conflict \(platform, external_id\) do nothing/);
  assert.match(m, /update public\.raw_signals s\s+set source_id = t\.source_id/);
});
