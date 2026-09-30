// /brokers: title and one line, the listed directory (paid first), the
// customer's own discovered firms with evidence links, then one compact
// professional line. No hero, no explanatory block, no application form.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const page = read('src/pages/BrokersPage.tsx');
const body = page.slice(page.indexOf('export default function BrokersPage'));

test('the page order is directory, found-for-you, then the professional line', () => {
  const dir = body.indexOf('id="broker-directory-heading"');
  const found = body.indexOf('<FoundForYouSection />');
  const bar = body.indexOf('<ProfessionalBar />');
  assert.ok(dir > 0 && found > dir && bar > found, 'order changed');
  assert.equal(body.split('<ProfessionalBar />').length - 1, 1, 'one professional line, not two');
});

test('no hero, no explanatory block, no inline application', () => {
  assert.doesNotMatch(body, /bg-\[#0C1119\]/, 'the navy hero is back');
  assert.doesNotMatch(body, /data-broker-distinction/);
  assert.doesNotMatch(page, /id="apply"|broker_directory_apply\(/);
});

test('paid listings come first', () => {
  assert.match(body, /paid\(b\) - paid\(a\)/);
});

test('discovered firms link to evidence, scoped to the caller library, http(s) only', () => {
  assert.match(page, /listMyDiscoveredBrokerEvidence\(/);
  assert.match(page, /data-broker-evidence/);
  assert.match(page, /rel="noopener noreferrer nofollow"/);
  const m = read('supabase/migrations/20261001150000_discovered_broker_evidence.sql');
  assert.match(m, /join public\.user_broker_discoveries d\s+on d\.broker_id = s\.broker_id and d\.user_id = v_uid/);
  assert.match(m, /canonical_url ~ '\^https\?:\/\//);
  assert.match(m, /revoke all on function public\.list_my_discovered_broker_evidence\(uuid\[\]\) from public, anon/);
  assert.match(read('src/services/brokers.ts'), /\/\^https\?:\\\/\\\/\/i\.test\(row\.url\)/);
});
