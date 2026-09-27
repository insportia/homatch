import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  announcementText, categoryOf, compareFeed, conversationOf, cursorAfter, isAfterCursor,
  isMessageFor, keysetOrFilter, mergeFeed, safeDeepLink, timeKey, NOTIFICATION_CATEGORIES,
} from '../feed.ts';
import { bearerOf, isServiceCaller } from '../../../../supabase/functions/_shared/serviceCaller.ts';

/*
 * THE NOTIFICATION CENTRE, END TO END WHERE IT CAN BE CHECKED WITHOUT A DATABASE.
 *
 * What was found, and what each block below holds shut:
 *
 *   A message notification linked /chat?c=<id>; the chat reads ?conversation=.
 *   Tapping "New message" opened the inbox, not the conversation.
 *
 *   Paging by created_at alone skipped and repeated rows that shared a timestamp,
 *   and aggregated rows have their created_at rewritten.
 *
 *   The centre's unread count was the number of unread rows it had loaded.
 *
 *   push-send's `deliver` had no caller check; the anon key passes the JWT gate.
 *
 *   The schema created an INSERT policy letting a customer write their own
 *   notifications, and no migration put the table in the realtime publication.
 *
 *   Announcements rendered in English whatever the reader's language.
 */

const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').split('\r\n').join('\n');

const SEND_MESSAGE = read('supabase', 'functions', 'send-message', 'index.ts');
const CHAT = read('src', 'pages', 'ChatPage.tsx');
const API = read('src', 'services', 'api.ts');
const PUSH = read('supabase', 'functions', 'push-send', 'index.ts');
const NOTIFY = read('supabase', 'functions', '_shared', 'notify.ts');
const RESEARCH = read('supabase', 'functions', 'research-agent', 'index.ts');
const DOCS = read('supabase', 'functions', 'deal-room-document-analyze', 'index.ts');
const MIGRATIONS = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql')).sort();
const CENTER_SQL = read('supabase', 'migrations', '20260928100000_notification_center.sql');

/* ── Deep links ─────────────────────────────────────────────────────────── */

test('a message notification opens the conversation, by the parameter the chat reads', () => {
  assert.match(SEND_MESSAGE, /deepLink: `\/chat\?conversation=\$\{convId\}`/);
  assert.doesNotMatch(SEND_MESSAGE, /\/chat\?c=/, 'send-message still writes the parameter nobody reads');
  assert.match(CHAT, /get\('conversation'\)/, 'the chat no longer reads ?conversation=');
});

test('rows written with the old /chat?c= link still open their conversation', () => {
  assert.equal(safeDeepLink('/chat?c=abc-123'), '/chat?conversation=abc-123');
  assert.equal(safeDeepLink('/chat?conversation=abc-123'), '/chat?conversation=abc-123');
  /* The chat also accepts the old parameter directly, for a link held anywhere else. */
  assert.match(CHAT, /get\('conversation'\) \?\? new URLSearchParams\(location\.search\)\.get\('c'\)/);
});

test('a deep link is followed only when it is a path on this site', () => {
  assert.equal(safeDeepLink('/verify?job=1'), '/verify?job=1');
  assert.equal(safeDeepLink('//evil.example/x'), null);
  assert.equal(safeDeepLink('https://evil.example/x'), null);
  assert.equal(safeDeepLink('javascript:alert(1)'), null);
  assert.equal(safeDeepLink(null), null);
});

test('the new service-completion producers link to routes that exist', () => {
  assert.match(RESEARCH, /deepLink: `\/verify\?job=\$\{j\.id\}`/);
  assert.match(DOCS, /deepLink: `\/verify\/\$\{doc\.deal_room_id\}\?tab=documents&doc=\$\{documentId\}`/);
  const routes = read('src', 'routes.tsx');
  assert.match(routes, /path: '\/verify',/);
  assert.match(routes, /path: '\/verify\/:id',/);
});

/* ── Idempotency ────────────────────────────────────────────────────────── */

test('every new producer names the event it is, so a retry tells nobody twice', () => {
  assert.match(SEND_MESSAGE, /dedupeKey: `message:\$\{message\.id\}`/);
  assert.match(RESEARCH, /dedupeKey: `verify-complete:\$\{j\.id\}`/);
  assert.match(DOCS, /dedupeKey: `document-analyzed:\$\{documentId\}:\$\{sha\}`/);
});

test('the announcement fan-out is idempotent on the slug and batched', () => {
  const fn = CENTER_SQL.slice(CENTER_SQL.indexOf('CREATE OR REPLACE FUNCTION public.publish_announcement'));
  assert.match(fn, /'announcement:' \|\| a\.slug/);
  assert.match(fn, /ON CONFLICT \(user_id, dedupe_key\) WHERE dedupe_key IS NOT NULL DO NOTHING/);
  assert.match(fn, /LIMIT c_size/);
  assert.match(fn, /WHERE u\.id > v_after/, 'the fan-out is not keyed on users.id, so batches are not index ranges');
  assert.match(fn, /IF NOT is_admin\(\)/, 'a customer could publish an announcement');
});

/* ── Who is told, and who may clear it ──────────────────────────────────── */

test('the sender is never told about their own message', () => {
  assert.match(SEND_MESSAGE, /recipient_id === sender\.id\) return new Response/,
    'send-message accepts a message to yourself');
  const call = SEND_MESSAGE.slice(SEND_MESSAGE.indexOf("type: 'NEW_MESSAGE'") - 200, SEND_MESSAGE.indexOf("type: 'NEW_MESSAGE'"));
  assert.match(call, /userId: recipient_id,/);
  assert.doesNotMatch(call, /userId: sender\.id/);
});

test('no message body reaches a notification', () => {
  const block = SEND_MESSAGE.slice(SEND_MESSAGE.indexOf('await notify(supabase, {'));
  const literal = block.slice(0, block.indexOf('});'));
  assert.doesNotMatch(literal, /\bbody:\s*body\b|\bbody\.trim\(\)|message\.body/);
});

test('only a participant can clear a conversation\'s notifications, and only their own', () => {
  const fn = CENTER_SQL.slice(CENTER_SQL.indexOf('notifications_mark_conversation_read(p_conversation_id uuid)'));
  assert.match(fn, /c\.initiator_id = v_me OR c\.recipient_id = v_me/);
  assert.match(fn, /RAISE EXCEPTION 'not a participant/);
  assert.match(fn, /WHERE n\.user_id = v_me/);
  assert.match(fn, /n\.type = 'NEW_MESSAGE' OR n\.metadata->>'kind' = 'NEW_MESSAGE'/);
  /* It reads notifications only. A message's SEEN receipt is the chat's business. */
  assert.doesNotMatch(fn.slice(0, fn.indexOf('END $$')), /UPDATE public\.messages/);
  assert.match(CENTER_SQL, /GRANT EXECUTE ON FUNCTION public\.notifications_mark_conversation_read\(uuid\) TO authenticated/);
});

test('opening a conversation marks its notifications read and says it is on screen', () => {
  assert.match(CHAT, /markConversationNotificationsRead\(conv\.id, myId\)/);
  assert.match(CHAT, /setActiveConversation\(conv\.id\)/);
  const live = read('src', 'components', 'notifications', 'LiveNotifications.tsx');
  assert.match(live, /getActiveConversation\(\)/);
  assert.match(live, /isMessageFor\(notif, open\)/);
});

test('a message notification belongs to exactly its conversation', () => {
  const typed = { id: '1', type: 'NEW_MESSAGE', title: '', read: false, created_at: '', metadata: { conversation_id: 'c1' } };
  const legacy = { id: '2', type: 'MATCH_FOUND', title: '', read: false, created_at: '', metadata: { kind: 'NEW_MESSAGE', conversation_id: 'c1' } };
  const linkOnly = { id: '3', type: 'NEW_MESSAGE', title: '', read: false, created_at: '', deep_link: '/chat?c=c1' };
  const match = { id: '4', type: 'MATCH_FOUND', title: '', read: false, created_at: '', metadata: { conversation_id: 'c1' } };
  assert.equal(isMessageFor(typed, 'c1'), true);
  assert.equal(isMessageFor(legacy, 'c1'), true);
  assert.equal(conversationOf(linkOnly), 'c1');
  assert.equal(isMessageFor(typed, 'c2'), false);
  assert.equal(isMessageFor(match, 'c1'), false, 'a match is not a message');
  assert.equal(isMessageFor(typed, null), false);
});

/* ── Keyset paging ──────────────────────────────────────────────────────── */

/** What the database does with the keyset filter, applied to an in-memory table. */
function pageOf(table, cursor, limit) {
  return table
    .filter((r) => !cursor || compareFeed(r, cursor) > 0)
    .sort(compareFeed)
    .slice(0, limit);
}

test('paging by (created_at, id) returns every row exactly once, ties included', () => {
  const at = (s) => `2026-09-27T08:00:${s}+00:00`;
  const table = [];
  /* Seven rows sharing ONE timestamp, straddling a page boundary: the case a
     created_at-only cursor loses. */
  for (let i = 0; i < 7; i += 1) table.push({ id: `00000000-0000-0000-0000-00000000000${i}`, type: 'X', title: '', read: false, created_at: at('10.123456') });
  for (let i = 0; i < 6; i += 1) table.push({ id: `10000000-0000-0000-0000-00000000000${i}`, type: 'X', title: '', read: false, created_at: at(`0${i}.5`) });

  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = pageOf(table, cursor, 4);
    seen.push(...page.map((r) => r.id));
    if (page.length < 4) break;
    cursor = cursorAfter(page);
  }
  assert.equal(seen.length, table.length);
  assert.equal(new Set(seen).size, table.length, 'a row was repeated');
});

test('the keyset filter is the row comparison the index serves', () => {
  const f = keysetOrFilter({ created_at: '2026-09-27T08:00:44.74538+00:00', id: 'a1b2c3d4-0000-0000-0000-000000000001' });
  assert.equal(f, 'created_at.lt."2026-09-27T08:00:44.74538+00:00",and(created_at.eq."2026-09-27T08:00:44.74538+00:00",id.lt.a1b2c3d4-0000-0000-0000-000000000001)');
  assert.throws(() => keysetOrFilter({ created_at: 'x', id: 'x),or(user_id.neq.0' }), /invalid notification cursor/);
  const fn = API.slice(API.indexOf('export async function getNotifications'));
  assert.match(fn.slice(0, 2000), /\.order\('created_at', \{ ascending: false \}\)\s*\n\s*\.order\('id', \{ ascending: false \}\)/);
  assert.match(fn.slice(0, 2000), /query\.or\(keysetOrFilter\(options\.cursor\)\)/);
  assert.match(CENTER_SQL, /CREATE INDEX IF NOT EXISTS notifications_user_keyset_idx\s+ON public\.notifications \(user_id, created_at DESC, id DESC\)/);
});

test('microseconds order rows that milliseconds would call equal', () => {
  assert.ok(timeKey('2026-09-27T08:00:44.123457+00:00') > timeKey('2026-09-27T08:00:44.123456+00:00'));
  /* The realtime payload format and the PostgREST one name the same instant. */
  assert.equal(timeKey('2026-09-27 08:00:44.74538+00'), timeKey('2026-09-27T08:00:44.74538+00:00'));
  assert.ok(timeKey('2026-09-27T08:00:44.5+00:00') > timeKey('2026-09-27T08:00:44+00:00'));
});

test('a page, a live frame and a refetch merge into one list, each row once', () => {
  const a = { id: 'a', type: 'X', title: 'a', read: false, created_at: '2026-09-27T08:00:01+00:00' };
  const b = { id: 'b', type: 'X', title: 'b', read: false, created_at: '2026-09-27T08:00:02+00:00' };
  /* An aggregate: the same id, its count and time bumped. It moves to the top. */
  const aBumped = { ...a, title: 'a x3', created_at: '2026-09-27T08:05:00+00:00' };
  const merged = mergeFeed([b, a], [aBumped, b]);
  assert.deepEqual(merged.map((r) => r.id), ['a', 'b']);
  assert.equal(merged[0].title, 'a x3');
  assert.equal(isAfterCursor(a, cursorAfter([b])), true);
  assert.equal(isAfterCursor(aBumped, cursorAfter([b])), false);
});

test('the unread count is the database\'s, not the loaded page\'s', () => {
  const page = read('src', 'pages', 'NotificationsPage.tsx');
  assert.match(page, /useNotificationCount\(\)/);
  assert.doesNotMatch(page, /notifications\.filter\(\(n\) => !n\.read\)\.length/);
  const fn = API.slice(API.indexOf('export async function getUnreadNotificationCount'));
  assert.match(fn.slice(0, 600), /count: 'exact', head: true/);
  const hook = read('src', 'hooks', 'useNotificationCount.ts');
  assert.match(hook, /status === 'SUBSCRIBED'/, 'the bell does not recount after a reconnect');
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /'online'/);
});

/* ── Realtime and write access ──────────────────────────────────────────── */

test('a migration puts notifications in the realtime publication, guarded', () => {
  const adding = MIGRATIONS.filter((f) =>
    /ALTER PUBLICATION supabase_realtime ADD TABLE public\.notifications/i.test(read('supabase', 'migrations', f)));
  assert.ok(adding.length >= 1, 'no migration publishes notifications to realtime');
  assert.match(CENTER_SQL, /NOT EXISTS \(\s*SELECT 1 FROM pg_publication_tables\s*WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'/);
});

test('a customer cannot write a notification', () => {
  assert.match(CENTER_SQL, /DROP POLICY IF EXISTS notif_insert_own ON public\.notifications;/);
  assert.match(CENTER_SQL, /REVOKE INSERT, DELETE, TRUNCATE ON public\.notifications FROM anon, authenticated;/);
  assert.match(CENTER_SQL, /GRANT UPDATE \(read, seen_at\) ON public\.notifications TO authenticated;/);
  /* The last migration that touches notif_insert_own must be the one that drops it. */
  const touching = MIGRATIONS.filter((f) => /notif_insert_own/.test(read('supabase', 'migrations', f)));
  assert.equal(touching[touching.length - 1], '20260928100000_notification_center.sql');
});

test('new migrations sit in this workstream\'s version range', () => {
  for (const f of MIGRATIONS.filter((m) => m.startsWith('202609281'))) {
    const v = Number(f.slice(0, 14));
    assert.ok(v >= 20260928100000 && v <= 20260928199999, `${f} is outside 20260928100000–20260928199999`);
  }
});

/* ── push-send ──────────────────────────────────────────────────────────── */

test('only the service key may ask push-send to deliver', () => {
  assert.equal(isServiceCaller('Bearer s3cret', 's3cret'), true);
  assert.equal(isServiceCaller('bearer   s3cret ', 's3cret'), true);
  assert.equal(isServiceCaller('Bearer anon-key', 's3cret'), false);
  assert.equal(isServiceCaller('Bearer s3cre', 's3cret'), false);
  assert.equal(isServiceCaller('s3cret', 's3cret'), false, 'a bare token is not a bearer');
  assert.equal(isServiceCaller(null, 's3cret'), false);
  assert.equal(isServiceCaller('Bearer ', ''), false, 'an unset key must refuse everybody');
  assert.equal(isServiceCaller('Bearer x', undefined), false);
  assert.equal(bearerOf('Bearer abc'), 'abc');
});

test('push-send checks the caller before it reads the notification', () => {
  const deliver = PUSH.slice(PUSH.indexOf('Deliver one existing notification'));
  const guard = deliver.indexOf('isServiceCaller(');
  const lookup = deliver.indexOf(".from('notifications')");
  assert.ok(guard > 0 && lookup > 0 && guard < lookup, 'the deliver guard must run before the row is read');
  assert.match(deliver.slice(guard, lookup), /error: 'FORBIDDEN' \}, 403/);
  /* And the one legitimate caller presents the key. */
  assert.match(NOTIFY, /headers: \{ Authorization: `Bearer \$\{serviceKey\}` \}/);
});

/* ── Categories ─────────────────────────────────────────────────────────── */

test('every notification is filed under a category a reader would recognise', () => {
  const row = (type, kind) => ({ id: 'x', type, title: '', read: false, created_at: '', metadata: kind ? { kind } : {} });
  const cases = [
    [row('NEW_MESSAGE'), 'MESSAGE'],
    [row('MATCH_FOUND', 'NEW_MESSAGE'), 'MESSAGE'],
    [row('MATCH_FOUND', 'VIEWING_REQUEST'), 'PROPERTY'],
    [row('MATCH_AVAILABLE', 'NATIVE_MATCH_SUPPLY'), 'MATCH'],
    [row('MATCH_AVAILABLE', 'NATIVE_MATCH_DEMAND'), 'DISCOVERY'],
    [row('SEARCH_COMPLETE'), 'DISCOVERY'],
    [row('PROPERTY_ACTION_REQUIRED'), 'PROPERTY'],
    [row('IMPORT_FAILED'), 'PROPERTY'],
    [row('VERIFY_COMPLETE'), 'SERVICE'],
    [row('DOCUMENT_ANALYZED'), 'SERVICE'],
    [row('EXPAT_DEADLINE_DUE'), 'SERVICE'],
    [row('LOW_CREDITS'), 'BILLING'],
    [row('SUBSCRIPTION_RENEWED'), 'BILLING'],
    [row('RESEARCH_PRODUCT_PURCHASED'), 'BILLING'],
    [row('PROVIDER_UNAVAILABLE'), 'ACCOUNT'],
    [row('ANNOUNCEMENT'), 'NEWS'],
  ];
  for (const [r, want] of cases) assert.equal(categoryOf(r), want, `${r.type}/${r.metadata.kind ?? ''}`);
});

test('every category has an icon and a label in all six languages', () => {
  const pres = read('src', 'components', 'notifications', 'presentation.tsx');
  const translations = read('src', 'i18n', 'translations.ts');
  for (const c of NOTIFICATION_CATEGORIES) {
    const key = `notif_kind_${c.toLowerCase()}`;
    assert.match(pres, new RegExp(`${c}: \\{ icon: \\w+, labelKey: '${key}' \\}`));
    assert.equal((translations.match(new RegExp(`^  ${key}:`, 'gm')) ?? []).length, 6, `${key} is not in all six bundles`);
  }
});

/* ── Announcements ──────────────────────────────────────────────────────── */

test('an announcement renders in the reader\'s current language, then English, then the row', () => {
  const row = {
    id: 'a', type: 'ANNOUNCEMENT', title: 'Stored', body: 'Stored body', read: false, created_at: '',
    metadata: { kind: 'ANNOUNCEMENT', title_i18n: { en: 'Hello', ka: 'გამარჯობა', ar: 'مرحبا' }, body_i18n: { en: 'Body' } },
  };
  assert.deepEqual(announcementText(row, 'ka'), { title: 'გამარჯობა', body: 'Body' });
  assert.deepEqual(announcementText(row, 'ar'), { title: 'مرحبا', body: 'Body' });
  assert.deepEqual(announcementText(row, 'he'), { title: 'Hello', body: 'Body' });
  const legacy = { ...row, metadata: { kind: 'ANNOUNCEMENT' } };
  assert.deepEqual(announcementText(legacy, 'ru'), { title: 'Stored', body: 'Stored body' });
  /* A blank translation is not a translation. */
  const blank = { ...row, metadata: { title_i18n: { en: 'Hello', ru: '  ' } } };
  assert.equal(announcementText(blank, 'ru').title, 'Hello');
});

test('the fan-out stores the reader\'s language and every written language', () => {
  const fn = CENTER_SQL.slice(CENTER_SQL.indexOf('CREATE OR REPLACE FUNCTION public.publish_announcement'));
  assert.match(fn, /coalesce\(nullif\(a\.title ->> b\.lang, ''\), a\.title ->> 'en', p_slug\)/);
  assert.match(fn, /'title_i18n', a\.title/);
  assert.match(fn, /'body_i18n', coalesce\(a\.body, '\{\}'::jsonb\)/);
  const pres = read('src', 'components', 'notifications', 'presentation.tsx');
  assert.match(pres, /return announcementText\(notif, lang\);/);
});
