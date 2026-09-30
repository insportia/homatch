// "Launch now" asks Meta to start in one minute — by the server's clock, as an
// absolute UTC instant — and a customer's own later schedule is kept exactly.
// Whether the campaign is ACTIVE is Meta's answer, never the clock's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAUNCH_START_BUFFER_MS, launchStartTime, mapMetaStatus } from '../payload.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-30T18:30:00.000Z');

test('launch now → requested start is now + 1 minute, nothing more', () => {
  assert.equal(LAUNCH_START_BUFFER_MS, 60_000);
  const start = launchStartTime(NOW);
  assert.equal(start.toISOString(), '2026-09-30T18:31:00.000Z');
  // Not a day later, not midnight, not shifted by a zone offset.
  assert.ok(start.getTime() - NOW <= 60_000, 'no buffer beyond a minute');
  assert.notEqual(start.getUTCDate(), 1);
  assert.notEqual(start.toISOString().slice(11, 19), '00:00:00');
  // Late in a Tbilisi evening (UTC+4) is still the same instant + 1 minute.
  const lateTbilisi = Date.parse('2026-09-30T23:59:30+04:00');
  assert.equal(launchStartTime(lateTbilisi).getTime() - lateTbilisi, 60_000);
});

test('a past or too-soon schedule falls back to now + 1 minute; a later one is kept exactly', () => {
  assert.equal(launchStartTime(NOW, '2026-09-30T18:00:00Z').toISOString(), '2026-09-30T18:31:00.000Z', 'a stale schedule');
  assert.equal(launchStartTime(NOW, '2026-09-30T18:30:30Z').toISOString(), '2026-09-30T18:31:00.000Z', 'inside the buffer');
  assert.equal(launchStartTime(NOW, 'not a date').toISOString(), '2026-09-30T18:31:00.000Z');
  assert.equal(launchStartTime(NOW, null).toISOString(), '2026-09-30T18:31:00.000Z');
  // Tomorrow 09:00 in Tbilisi is exactly that instant.
  assert.equal(launchStartTime(NOW, '2026-10-01T09:00:00+04:00').toISOString(), '2026-10-01T05:00:00.000Z');
});

test('the server builds the start from its own clock, and the browser sends none', () => {
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  assert.match(engine, /const start = launchStartTime\(Date\.now\(\), c\.start_at \?\? null\);/);
  assert.doesNotMatch(engine, /Date\.now\(\) \+ 5 \* 60_000/, 'the old five-minute buffer is gone');
  assert.match(engine, /startTime: start\.toISOString\(\)/, 'sent as UTC ISO-8601');
  assert.match(engine, /endTime: new Date\(start\.getTime\(\) \+ Number\(c\.duration_days\) \* 86_400_000\)/);
  // Requested start and Meta's start are kept apart.
  assert.match(read('supabase/functions/meta-ads-api/index.ts'), /plan: \{ \.\.\.plan, requestedStartAt: external\.requestedStartAt \}/);
  assert.match(engine, /meta_start_time: info\.start_time \?\? null/);
  const svc = read('src/services/metaAds.ts');
  // Read-only display fields are fine; no request ever carries a start time.
  assert.doesNotMatch(svc, /startTime\s*[:,]|start_time\s*:/, 'the client never supplies a start time');
});

test('Meta, not the clock, decides ACTIVE', () => {
  // Requested start long past, Meta still reviewing the ads → still reviewing.
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['PENDING_REVIEW'] }).status, 'META_REVIEW');
  assert.equal(mapMetaStatus({ campaign: 'IN_PROCESS', ads: ['IN_PROCESS'] }).status, 'META_REVIEW');
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: [] }).status, 'META_REVIEW');
  // Meta reports delivery → ACTIVE.
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['ACTIVE'] }).status, 'ACTIVE');
  assert.equal(mapMetaStatus({ campaign: 'PAUSED', ads: ['ACTIVE'] }).status, 'PAUSED');
  // The sync has no notion of "start time passed → active".
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  const sync = engine.slice(engine.indexOf('export async function syncCampaign'), engine.indexOf('export const SETTLEMENT_GRACE_DAYS'));
  assert.doesNotMatch(sync, /requestedStartAt[^\n]*ACTIVE|start_time[^\n]*ACTIVE/);
});
