// Every community_targets column the Telegram sync and source discovery read
// or write must be created by a migration. The first authenticated production
// sync failed because last_message_at was selected but never created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');

test('the Telegram code uses no community_targets column that no migration creates', () => {
  for (const col of ['last_message_at', 'telegram_peer_id', 'discovered_via', 'relevance_score', 'audited_at']) {
    assert.match(migrations, new RegExp(`add column if not exists ${col}\\b`), `${col} is used but never created`);
  }
  const sync = readFileSync(join(root, 'supabase/functions/community-sync/index.ts'), 'utf8');
  assert.match(sync, /last_message_at/, 'guard: the sync still reads last_message_at');
});
