import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * ALERTS — PRODUCER TO SCREEN.
 *
 * notificationTypes.test.mjs checks the other direction: that nothing sends a
 * type the enum will reject. This one checks the chain is joined up at both
 * ends -- that a type which reaches the bell also has an icon, a translated
 * string and somewhere to go when tapped.
 *
 * What was found:
 *
 *   LOW_CREDITS   in the enum since it was created, with a click branch in
 *                 NotificationsPage -- misspelled CREDITS_LOW, so the branch
 *                 could never fire -- and NO PRODUCER anywhere. The first a
 *                 customer heard about an empty balance was an unlock that
 *                 refused.
 *
 *   RESEARCH_PRODUCT_PURCHASED  produced by research-purchase, but with no
 *                 entry in the copy mapping, so it rendered whatever English
 *                 the backend stored regardless of the viewer's language --
 *                 the exact thing that mapping exists to prevent.
 *
 *   MATCH_UNLOCKED / CAMPAIGN_PAUSED  icons for types the enum does not have.
 */

const ROOT = process.cwd();
const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'NotificationsPage.tsx'), 'utf8');
const unlock = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'atomic-unlock', 'index.ts'), 'utf8');
const translations = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'translations.ts'), 'utf8');
const grant = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260911200000_notifications_read_only_flag.sql'), 'utf8');

/** Enum values, read from the migrations so this cannot drift from production. */
function enumValues() {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const out = new Set([
    'IMPORT_COMPLETED', 'IMPORT_FAILED', 'MATCHING_STARTED',
    'MATCHING_PAUSED', 'LOW_CREDITS', 'MATCH_FOUND',
  ]);
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(
      /alter\s+type\s+(?:public\.)?notification_type\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([A-Z_]+)'/gi
    )) out.add(m[1]);
  }
  return out;
}

test('the notification icon map contains only real enum values', () => {
  const cfg = page.slice(page.indexOf('NOTIF_CONFIG'), page.indexOf('// Maps a notification'));
  const named = [...cfg.matchAll(/\b([A-Z][A-Z_]{3,}):\s*\{\s*icon:/g)].map((m) => m[1]);
  const valid = enumValues();
  const bogus = named.filter((n) => n !== 'DEFAULT' && !valid.has(n));
  assert.deepEqual(bogus, [], `icons for types that cannot exist: ${bogus.join(', ')}`);
});

test('LOW_CREDITS is spelled the way the enum spells it', () => {
  // The click handler said CREDITS_LOW, so the branch was unreachable.
  assert.ok(!page.includes("'CREDITS_LOW'"), 'CREDITS_LOW is not a notification type');
  assert.match(page, /notif\.type === 'LOW_CREDITS'/);
});

test('LOW_CREDITS finally has a producer', () => {
  assert.match(unlock, /type: 'LOW_CREDITS'/);
  // Only when the customer genuinely cannot afford another unlock at the price
  // they just paid — not on every unlock.
  assert.match(unlock, /if \(newBalance < price\)/);
});

test('the low-credit warning does not repeat while one is unread', () => {
  const block = unlock.slice(unlock.indexOf('if (newBalance < price)'));
  assert.match(block.slice(0, 900), /\.eq\('type', 'LOW_CREDITS'\)\s*\n?\s*\.eq\('read', false\)/);
  assert.match(block.slice(0, 900), /if \(!pendingWarnings\)/);
});

test('the low-credit warning carries the routing kind and the numbers', () => {
  const block = unlock.slice(unlock.indexOf("type: 'LOW_CREDITS'"));
  assert.match(block.slice(0, 400), /kind: 'LOW_CREDITS'/);
  assert.match(block.slice(0, 400), /balance: newBalance/);
  assert.match(block.slice(0, 400), /last_unlock_price: price/);
});

test('every alert with a producer renders in the viewer language', () => {
  for (const key of [
    'notif_low_credits_title', 'notif_low_credits_body',
    'notif_research_purchased_title', 'notif_research_purchased_body',
  ]) {
    assert.equal(
      (translations.match(new RegExp(`${key}:`, 'g')) ?? []).length, 6,
      `${key} must exist in all six languages`
    );
    assert.ok(page.includes(key), `NotificationsPage must use ${key}`);
  }
});

test('typed alerts have somewhere to go when tapped', () => {
  const handler = page.slice(page.indexOf('const handleNotifClick'));
  for (const t of ['LOW_CREDITS', 'CREDITS_TOPPED_UP', 'RESEARCH_PRODUCT_PURCHASED']) {
    assert.match(handler.slice(0, 1500), new RegExp(`'${t}'`), `${t} must route somewhere`);
  }
});

test('a customer may mark a notification read and nothing else', () => {
  assert.match(grant, /revoke update on public\.notifications from authenticated, anon/);
  assert.match(grant, /grant update \(read\) on public\.notifications to authenticated/);
});

test('marking read reports failure instead of leaving the bell silently lit', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src', 'services', 'api.ts'), 'utf8');
  const fn = api.slice(api.indexOf('export async function markNotificationRead'));
  assert.match(fn.slice(0, 700), /markNotificationRead error/);
  assert.match(fn.slice(0, 700), /markAllNotificationsRead error/);
});
