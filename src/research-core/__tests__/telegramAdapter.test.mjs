// TELEGRAM, BUILT BEFORE THE CREDENTIALS ARRIVE.
//
// Homatch has no Telegram credentials and nothing here has ever called
// Telegram. What these tests prove is that the remaining work is
// CONFIGURATION: the adapter, the normalizer, the dedup, the freshness hooks
// and the classification all run today, end to end, against fixtures, and
// stop at exactly one place — an unconfigured client — with exactly one
// reason.
//
// They prove nothing whatsoever about Telegram's actual behaviour. That
// distinction is the point of the readiness model and of the last test in
// this file: fixtures passing is FIXTURE_TESTED, and a provider row must
// never turn green on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../../scripts/lib/stripComments.mjs';
import {
  TelegramAdapter,
  canonicalizeTelegramUrl,
  isTelegramSourceUrl,
  telegramFailureToAdapterFailure,
} from '../adapters/telegram/index.ts';
import {
  capabilitiesFor,
  planRetry,
  readiness,
  TelegramError,
  TELEGRAM_INTEGRATION_MODES,
  UnconfiguredTelegramClient,
  validateTelegramConfig,
} from '../adapters/telegram/client.ts';
import {
  classifySeen,
  isNewerThanCursor,
  messageUrl,
  nextCursor,
  normalizeMessage,
  normalizeMessages,
} from '../adapters/telegram/normalize.ts';
import { judgeFreshness } from '../discovery/freshness.ts';
import { FAILURES, FixtureTelegramClient } from '../adapters/telegram/__fixtures__/client.mjs';
import * as F from '../adapters/telegram/__fixtures__/messages.mjs';

const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const context = { chat: F.CHANNEL, discoveredAt: new Date(F.NOW_MS).toISOString(), languages: LANGUAGES, accessClass: 'PUBLIC' };
const adapterContext = { fetchDocument: async () => { throw new Error('unused'); }, authenticatedSession: false, now: () => F.NOW_MS };

const sourceRecord = (url) => ({
  id: 'src_1', platform: 'TELEGRAM', sourceType: 'TELEGRAM_CHANNEL', canonicalUrl: url,
  externalId: null, name: null, countryCode: 'GE', city: null, region: null, languages: [],
  compatibleProfiles: [], propertyTerms: [], accessState: 'PUBLIC', active: true,
  discoveredAt: new Date(F.NOW_MS).toISOString(), lastScanAt: null, lastSuccessAt: null,
  cursor: null, chronological: true, failureCount: 0, lastFailureReason: null, productivity: [],
});

const scanRequest = (overrides = {}) => ({
  source: sourceRecord(`https://t.me/${F.CHANNEL.username}`),
  direction: 'DEMAND', cursor: null, limit: 50, includeComments: true, ...overrides,
});

/* ── addresses ─────────────────────────────────────────────────────────── */

test('every way of writing a Telegram address reduces to one', () => {
  // The registry must hold ONE row per chat. Five spellings of the same
  // channel is five rows, five cursors, and the same post delivered five
  // times.
  const expected = 'https://t.me/tbilisi_property';
  for (const form of [
    'https://t.me/tbilisi_property',
    'http://telegram.me/Tbilisi_Property',
    'https://t.me/s/tbilisi_property',
    'https://www.t.me/tbilisi_property?single',
    't.me/tbilisi_property',
    '@tbilisi_property',
    'tbilisi_property',
  ]) {
    assert.equal(canonicalizeTelegramUrl(form), expected, `${form} canonicalised wrong`);
  }
});

test('a private invite link is not an address', () => {
  /*
   * t.me/+hash identifies a chat we have not been admitted to and cannot
   * address. Storing it as a source would create a registry row that nothing
   * can ever scan, which then sits there failing forever.
   */
  for (const form of ['https://t.me/+AbCdEfGhIjK', 'https://t.me/joinchat/AbCdEfGhIjK']) {
    assert.equal(canonicalizeTelegramUrl(form), null, `${form} became an address`);
  }
});

test('non-Telegram and malformed input is refused rather than guessed at', () => {
  for (const form of ['https://facebook.com/groups/x', 'not a url', '', null, undefined, 'https://t.me/', 'https://t.me/ab']) {
    assert.equal(canonicalizeTelegramUrl(form), null, `${String(form)} was accepted`);
  }
  assert.equal(isTelegramSourceUrl('https://t.me/tbilisi_property'), true);
});

test('a chat with no public username gets no invented message links', () => {
  // A dead link on a piece of evidence is worse than no link: it looks like
  // provenance and cannot be checked.
  assert.equal(messageUrl({ ...F.CHANNEL, username: null }, '101'), null);
  assert.equal(messageUrl(F.CHANNEL, 'not-a-number'), null);
  assert.equal(messageUrl(F.CHANNEL, '101'), 'https://t.me/tbilisi_property/101');
});

/* ── normalization: six languages, both directions ─────────────────────── */

test('a Georgian listing is SUPPLY and a Georgian buyer is DEMAND', () => {
  const seller = normalizeMessage(F.GEORGIAN_SELLER, context);
  const buyer = normalizeMessage(F.GEORGIAN_BUYER, { ...context, parents: new Map([[`${F.CHANNEL.id}:101`, F.GEORGIAN_SELLER]]) });
  assert.equal(seller.signal.direction, 'SUPPLY');
  assert.equal(buyer.signal.direction, 'DEMAND');
});

test('every fixture language classifies without an English word in it', () => {
  /*
   * The requirement this comes from: do not machine-translate one English
   * query into six languages. These six texts share no vocabulary, and each
   * has to be understood by its own lexicon or the language is decorative.
   */
  const cases = [
    ['ka', F.GEORGIAN_TENANT], ['ru', F.RUSSIAN_INVESTOR], ['he', F.HEBREW_INVESTOR],
    ['ar', F.ARABIC_INVESTOR], ['tr', F.TURKISH_BUYER],
  ];
  for (const [language, fixture] of cases) {
    const normalized = normalizeMessage(fixture, context);
    assert.ok(normalized, `${language} produced no signal at all`);
    assert.equal(normalized.signal.direction, 'DEMAND', `${language} was not read as demand`);
    assert.ok(normalized.signal.directionConfidence > 0, `${language} matched with no confidence`);
  }
});

test('the source language is what was written, not what was searched for', () => {
  /*
   * UI language != campaign search language != source language. A Russian
   * post found by a Hebrew query is a Russian post, and recording it as
   * Hebrew makes every later "which language produced this lead" wrong.
   */
  assert.equal(normalizeMessage(F.RUSSIAN_INVESTOR, context).signal.language, 'ru');
  assert.equal(normalizeMessage(F.HEBREW_INVESTOR, context).signal.language, 'he');
  assert.equal(normalizeMessage(F.ARABIC_INVESTOR, context).signal.language, 'ar');
  assert.equal(normalizeMessage(F.GEORGIAN_SELLER, context).signal.language, 'ka');
});

test('the original text survives exactly, and nothing is translated over it', () => {
  const normalized = normalizeMessage(F.HEBREW_INVESTOR, context);
  assert.equal(normalized.signal.originalText, F.HEBREW_INVESTOR.text);
  assert.equal(normalized.signal.translatedText, null);
});

test('an agency posting inventory is supply, not a lead', () => {
  // Not a rejection on its own: an agency with fourteen flats is perfectly
  // good SUPPLY. It is a rejection for DEMAND, where "we have clients
  // looking" is a sales pitch.
  const normalized = normalizeMessage(F.BROKER_INVENTORY, context);
  assert.notEqual(normalized.signal.direction, 'DEMAND');
});

test('an unrelated conversation is not turned into a lead', () => {
  const normalized = normalizeMessage(F.IRRELEVANT, context);
  assert.ok(['UNKNOWN', 'REFERENCE'].includes(normalized.signal.direction),
    `a plumber request was classified ${normalized.signal.direction}`);
});

test('a message with no text produces no signal', () => {
  // A photo with no caption and a "user joined" notice are real messages and
  // are not evidence. Keeping them would inflate every signals-found count.
  for (const empty of F.EMPTY_MESSAGES) assert.equal(normalizeMessage(empty, context), null);
});

test('a malformed payload is survived, not crashed on', () => {
  // Telegram changing a field is a Tuesday. The batch must yield what it can.
  const out = normalizeMessages(F.MALFORMED, context);
  assert.ok(Array.isArray(out));
  for (const item of out) assert.equal(typeof item.signal.originalText, 'string');
});

/* ── provenance ────────────────────────────────────────────────────────── */

test('every signal carries a link somebody can open', () => {
  const normalized = normalizeMessage(F.GEORGIAN_SELLER, context);
  assert.equal(normalized.signal.contentUrl, 'https://t.me/tbilisi_property/101');
  assert.equal(normalized.signal.sourceUrl, 'https://t.me/tbilisi_property');
  assert.equal(normalized.signal.platform, 'TELEGRAM');
  assert.equal(normalized.signal.accessClass, 'PUBLIC');
});

test('when it was posted and when we saw it are different fields', () => {
  const normalized = normalizeMessage(F.GEORGIAN_SELLER, context);
  assert.equal(normalized.signal.publishedAt, new Date((F.NOW_SECONDS - 7200) * 1000).toISOString());
  assert.equal(normalized.signal.discoveredAt, context.discoveredAt);
  assert.notEqual(normalized.signal.publishedAt, normalized.signal.discoveredAt);
});

test('a channel post is attributed to the channel, not to an invented person', () => {
  const normalized = normalizeMessage(F.GEORGIAN_SELLER, context);
  assert.equal(normalized.signal.author.publicName, F.CHANNEL.title);
  assert.equal(normalized.signal.author.publicUrl, null);
});

test('no contact detail is mined out of the text', () => {
  const normalized = normalizeMessage(F.GEORGIAN_BUYER, context);
  const json = JSON.stringify(normalized.signal);
  assert.equal(/phone|email|whatsapp|@gmail/i.test(json), false);
});

/* ── comments carry their parent ───────────────────────────────────────── */

test('a comment is read with the listing it sits under', () => {
  /*
   * The whole reason comments are collected. "ვეძებ საყიდლად ... ბიუჯეტი
   * 150000" under a specific 2BR in Vake is a person asking about THAT flat,
   * which is one of the strongest leads a housing channel produces.
   */
  const parents = new Map([[`${F.CHANNEL.id}:101`, F.GEORGIAN_SELLER]]);
  const normalized = normalizeMessage(F.GEORGIAN_BUYER, { ...context, parents });
  assert.equal(normalized.signal.contentType, 'COMMENT');
  assert.equal(normalized.signal.parentUrl, 'https://t.me/tbilisi_property/101');
  assert.ok(normalized.signal.parentExcerpt.includes('ვაკე'));
});

test('a comment whose parent is missing is weaker, not equal', () => {
  const withParent = normalizeMessage(F.GEORGIAN_BUYER, {
    ...context, parents: new Map([[`${F.CHANNEL.id}:101`, F.GEORGIAN_SELLER]]),
  });
  const without = normalizeMessage(F.GEORGIAN_BUYER, context);
  assert.equal(without.signal.parentExcerpt, null);
  assert.ok(without.signal.directionConfidence < withParent.signal.directionConfidence,
    'a comment read without its context scored the same as one read with it');
});

test("a listing's own direction never leaks into the comment under it", () => {
  /*
   * The inversion this guards: the parent of almost every good buyer comment
   * is a SUPPLY listing. If the parent's "იყიდება" counted, every one of
   * those buyers would be filed as a seller.
   */
  const parents = new Map([[`${F.CHANNEL.id}:101`, F.GEORGIAN_SELLER]]);
  const normalized = normalizeMessage(F.GEORGIAN_BUYER, { ...context, parents });
  assert.equal(normalized.signal.direction, 'DEMAND');
});

/* ── dedup, edits and cross-posting ────────────────────────────────────── */

test('the same message scanned twice is the same signal', () => {
  const first = normalizeMessage(F.GEORGIAN_BUYER, context);
  const second = normalizeMessage(F.GEORGIAN_BUYER_AGAIN, context);
  assert.equal(first.signal.id, second.signal.id);
  assert.equal(classifySeen(second, { byId: new Map([[first.signal.id, first.signal]]) }), 'UNCHANGED');
});

test('an edited listing is the same signal saying something new', () => {
  /*
   * Identity is (chat, message); the fingerprint is of the text. Hashing the
   * text into the id would file a seller marking their flat SOLD as a second
   * listing at the same price.
   */
  const before = normalizeMessage(F.GEORGIAN_SELLER, context);
  const after = normalizeMessage(F.GEORGIAN_SELLER_EDITED, context);
  assert.equal(after.signal.id, before.signal.id, 'an edit created a new lead');
  assert.notEqual(after.signal.contentFingerprint, before.signal.contentFingerprint);
  assert.equal(classifySeen(after, { byId: new Map([[before.signal.id, before.signal]]) }), 'EDITED');
});

test('the same listing cross-posted into another channel is one lead', () => {
  // Routine on Telegram, and eight identical results in a customer's list is
  // not a market — it is one listing, counted eight times.
  const original = normalizeMessage(F.GEORGIAN_SELLER, context);
  const crossposted = normalizeMessage(F.CROSSPOSTED_SELLER, { ...context, chat: F.NO_DISCUSSION_CHANNEL });
  assert.notEqual(crossposted.signal.id, original.signal.id, 'two different messages share an id');
  assert.equal(crossposted.signal.contentFingerprint, original.signal.contentFingerprint);
  assert.equal(
    classifySeen(crossposted, { byFingerprint: new Map([[original.signal.contentFingerprint, original.signal]]) }),
    'DUPLICATE_TEXT',
  );
});

test('one person across three messages stays three pieces of evidence', () => {
  /*
   * Three posts from the same handle are three observations, and nothing here
   * merges them into a person. Identity resolution is a decision with
   * consequences, and it is not this layer's to make.
   */
  const ids = new Set(normalizeMessages(F.SAME_ENTITY_THREE_TIMES, context).map((item) => item.signal.id));
  assert.equal(ids.size, 3);
});

/* ── freshness ─────────────────────────────────────────────────────────── */

test('an eleven-month-old post is real evidence and not a live lead', () => {
  const stale = normalizeMessage(F.STALE_BUYER, context);
  const recent = normalizeMessage(F.GEORGIAN_BUYER, context);
  assert.equal(judgeFreshness(stale.signal.publishedAt, { window: 'LAST_30_DAYS' }, F.NOW_MS).inWindow, false);
  assert.equal(judgeFreshness(recent.signal.publishedAt, { window: 'LAST_30_DAYS' }, F.NOW_MS).inWindow, true);
  // Still true, still storable, just not fresh.
  assert.equal(judgeFreshness(stale.signal.publishedAt, { window: 'ANY' }, F.NOW_MS).inWindow, true);
});

/* ── cursors and pagination ────────────────────────────────────────────── */

test('the cursor is a message id, because timestamps collide and ids do not', () => {
  const processed = normalizeMessages([F.GEORGIAN_SELLER, F.GEORGIAN_LANDLORD], context);
  assert.equal(nextCursor(processed, null), '102');
  assert.equal(isNewerThanCursor(F.BROKER_INVENTORY, '102'), true);
  assert.equal(isNewerThanCursor(F.GEORGIAN_SELLER, '102'), false);
});

test('a cursor never moves backwards, and never over unprocessed work', () => {
  /*
   * Advancing a cursor past a batch that failed would skip that window
   * permanently: nothing would ever read those messages again.
   */
  assert.equal(nextCursor([], '500'), '500');
  const processed = normalizeMessages([F.GEORGIAN_SELLER], context);
  assert.equal(nextCursor(processed, '500'), '500');
});

test('pagination reads the second page rather than assuming there is none', async () => {
  const client = new FixtureTelegramClient();
  const adapter = new TelegramAdapter({ client, languages: LANGUAGES });

  const first = await adapter.scan(scanRequest({ includeComments: false }), adapterContext);
  assert.equal(first.ok, true);
  assert.equal(first.value.truncated, true, 'more pages existed and the scan said it was complete');

  const second = await client.readHistory(F.CHANNEL.id, { cursor: '1', limit: 50 });
  assert.equal(second.items.length, F.PAGE_TWO.length);
  assert.equal(second.hasMore, false);
});

/* ── the adapter, end to end ───────────────────────────────────────────── */

test('a scan yields posts and their comments, classified both ways', async () => {
  const adapter = new TelegramAdapter({ client: new FixtureTelegramClient(), languages: LANGUAGES });
  const result = await adapter.scan(scanRequest(), adapterContext);

  assert.equal(result.ok, true);
  const directions = new Set(result.value.signals.map((signal) => signal.direction));
  assert.ok(directions.has('SUPPLY'), 'no supply was found in a channel full of listings');
  assert.ok(directions.has('DEMAND'), 'no demand was found in the comments');
  for (const signal of result.value.signals) {
    assert.equal(signal.platform, 'TELEGRAM');
    assert.ok(signal.sourceUrl, 'a signal arrived with no provenance');
  }
});

test('comments are not fetched for a supply-only job', async () => {
  // One request per post. A job that does not need them must not pay for them.
  const client = new FixtureTelegramClient();
  const adapter = new TelegramAdapter({ client, languages: LANGUAGES });
  await adapter.scan(scanRequest({ includeComments: false }), adapterContext);
  assert.equal(client.calls.filter((call) => call.method === 'readDiscussionReplies').length, 0);
});

test('a channel with no discussion group yields posts and claims nothing more', async () => {
  const client = new FixtureTelegramClient();
  const adapter = new TelegramAdapter({ client, languages: LANGUAGES });
  const result = await adapter.scan(
    scanRequest({ source: sourceRecord(`https://t.me/${F.NO_DISCUSSION_CHANNEL.username}`) }),
    adapterContext,
  );
  assert.equal(result.ok, true);
  assert.equal(client.calls.filter((call) => call.method === 'readDiscussionReplies').length, 0);
  assert.ok(result.value.signals.length > 0);
});

test('a private chat is recorded for a human, never joined', async () => {
  /*
   * The same rule as every other platform. Knowing a private investor group
   * exists is exactly what the access queue needs; nothing automates entry to
   * it, and nothing pretends it was empty.
   */
  const adapter = new TelegramAdapter({ client: new FixtureTelegramClient(), languages: LANGUAGES });
  const result = await adapter.discover(
    { queries: [{ text: `https://t.me/${F.PRIVATE_CHANNEL.username}` }], countryCode: 'GE', languages: LANGUAGES, limit: 10 },
    adapterContext,
  );
  assert.equal(result.ok, true);
  assert.equal(result.value[0].accessState, 'JOIN_REQUIRED');
  assert.match(result.value[0].rationale, /human/i);
});

/* ── what each mode can and cannot do ──────────────────────────────────── */

test('a bot cannot read history, and says so instead of reporting nothing', () => {
  /*
   * THE FABRICATION THIS PREVENTS. The Bot API has no history call — a bot is
   * told about new messages, it cannot go and look for old ones. An adapter
   * that returned [] here would be stating that a busy Tbilisi channel posted
   * nothing, which is false and unfalsifiable.
   */
  assert.equal(capabilitiesFor('BOT_API').readHistory, false);
  assert.equal(capabilitiesFor('BOT_API').searchPublicChats, false);
});

test('only the user-session mode can search for chats we do not know about', () => {
  assert.equal(capabilitiesFor('MTPROTO_USER').searchPublicChats, true);
  assert.equal(capabilitiesFor('PUBLIC_PREVIEW').searchPublicChats, false);
});

test('the public preview reads posts and has no comments to offer', () => {
  const preview = capabilitiesFor('PUBLIC_PREVIEW');
  assert.equal(preview.readHistory, true);
  assert.equal(preview.readDiscussionReplies, false);
  assert.equal(preview.receiveUpdates, false);
});

test('an unsupported capability is refused by name, with the mode that would fix it', async () => {
  const adapter = new TelegramAdapter({ client: new FixtureTelegramClient({ mode: 'BOT_API' }), languages: LANGUAGES });
  const result = await adapter.scan(scanRequest(), adapterContext);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CAPABILITY_NOT_SUPPORTED');
  assert.match(result.detail, /MTPROTO_USER|PUBLIC_PREVIEW/);
});

test('a keyword search under a mode that cannot do it is refused, not emptied', async () => {
  const adapter = new TelegramAdapter({ client: new FixtureTelegramClient({ mode: 'PUBLIC_PREVIEW' }), languages: LANGUAGES });
  const result = await adapter.discover(
    { queries: [{ text: 'ვეძებ ბინას თბილისში' }], countryCode: 'GE', languages: LANGUAGES, limit: 10 },
    adapterContext,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CAPABILITY_NOT_SUPPORTED');
});

/* ── rate limits and retry ─────────────────────────────────────────────── */

test("Telegram's stated wait is honoured exactly, not replaced with our own", () => {
  /*
   * FLOOD_WAIT carries a number of seconds. It is an instruction, and an
   * integration that retries sooner — or backs off on its own schedule
   * because that felt safer — gets the account limited harder.
   */
  const plan = planRetry(FAILURES.rateLimited, 0);
  assert.equal(plan.retry, true);
  assert.equal(plan.delayMs, 37_000);
});

test('a rate limit with no stated delay backs off exponentially', () => {
  const first = planRetry(FAILURES.rateLimitedNoDelay, 0, { baseDelayMs: 1000 });
  const second = planRetry(FAILURES.rateLimitedNoDelay, 1, { baseDelayMs: 1000 });
  assert.ok(second.delayMs > first.delayMs);
});

test('a failure that cannot improve is never retried', () => {
  // Repeating a call with a bad credential is how a rate limit becomes a ban.
  for (const kind of ['AUTH_FAILED', 'CAPABILITY_NOT_SUPPORTED', 'NOT_CONFIGURED', 'CHAT_PRIVATE', 'CHAT_NOT_FOUND']) {
    assert.equal(planRetry(new TelegramError(kind, kind), 0).retry, false, `${kind} was retried`);
  }
});

test('retries are bounded', () => {
  assert.equal(planRetry(FAILURES.network, 3, { maxAttempts: 3 }).retry, false);
});

test('a rate limit mid-scan keeps what was read rather than losing the run', async () => {
  const client = new FixtureTelegramClient({ failures: { readDiscussionReplies: FAILURES.rateLimited } });
  const adapter = new TelegramAdapter({ client, languages: LANGUAGES });
  const result = await adapter.scan(scanRequest(), adapterContext);
  assert.equal(result.ok, true, 'one throttled comment thread lost the whole scan');
  assert.ok(result.value.signals.length > 0);
});

test('every Telegram failure maps to a reason the ladder understands', () => {
  const kinds = ['NOT_CONFIGURED', 'DISABLED', 'CAPABILITY_NOT_SUPPORTED', 'AUTH_FAILED',
    'RATE_LIMITED', 'CHAT_NOT_FOUND', 'CHAT_PRIVATE', 'NETWORK_ERROR', 'MALFORMED_RESPONSE'];
  for (const kind of kinds) {
    const failure = telegramFailureToAdapterFailure(new TelegramError(kind, kind));
    assert.ok(typeof failure === 'string' && failure.length > 0, `${kind} maps to nothing`);
  }
});

/* ── configuration, credentials and the truth about readiness ──────────── */

test('configuration is validated by shape, and credentials are never logged', () => {
  assert.deepEqual(validateTelegramConfig({ mode: 'BOT_API' }).problems, ['BOT_TOKEN_MISSING']);
  assert.deepEqual(validateTelegramConfig({ mode: 'BOT_API', botToken: 'nonsense' }).problems, ['BOT_TOKEN_MALFORMED']);
  assert.deepEqual(
    validateTelegramConfig({ mode: 'MTPROTO_USER' }).problems,
    ['API_ID_MISSING', 'API_HASH_MISSING', 'SESSION_MISSING'],
  );
  assert.equal(validateTelegramConfig({ mode: 'PUBLIC_PREVIEW' }).valid, true);

  // A problem names the FIELD, never the value.
  const problems = validateTelegramConfig({ mode: 'BOT_API', botToken: 'secret-looking-value' }).problems;
  assert.equal(JSON.stringify(problems).includes('secret-looking-value'), false);
});

test('no credential is ever read from the environment inside the core', () => {
  /*
   * The core is runtime-neutral: it is handed a client, and the client is
   * constructed where secrets legitimately live. A process.env or Deno.env
   * read in here would put a credential in a layer that has no business
   * holding one.
   */
  for (const file of ['client.ts', 'index.ts', 'normalize.ts']) {
    const src = readFileSync(`src/research-core/adapters/telegram/${file}`, 'utf8');
    const code = stripComments(src);
    assert.equal(/process\.env|Deno\.env/.test(code), false, `${file} reads a secret directly`);
  }
});

test('with no credentials the pipeline runs and stops in one place, with one reason', async () => {
  /*
   * THE POINT OF THE WHOLE EXERCISE. Today's honest state is not BLOCKED and
   * not NOT_IMPLEMENTED: everything is built, it executes, and it refuses at
   * the client boundary because there is nothing to connect with.
   */
  const adapter = new TelegramAdapter({ client: new UnconfiguredTelegramClient(), languages: LANGUAGES });
  const result = await adapter.scan(scanRequest(), adapterContext);
  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /credential|configur/i);
});

test('readiness reports five separate facts, not one green dot', () => {
  const state = readiness({ config: { mode: 'MTPROTO_USER' } });
  assert.equal(state.implemented, true, 'the code exists and the state denies it');
  assert.equal(state.credentialsPresent, false);
  assert.equal(state.enabled, false);
  assert.equal(state.healthy, false);
  assert.equal(state.summary, 'CREDENTIALS_MISSING');
});

test('credentials do not imply enabled, and enabled does not imply healthy', () => {
  const configured = { mode: 'MTPROTO_USER', apiId: '1', apiHash: 'h', sessionString: 's' };
  assert.equal(readiness({ config: configured }).summary, 'LIVE_CONNECTION_DISABLED');
  assert.equal(readiness({ config: { ...configured, enabled: true } }).summary, 'CONFIGURED_NOT_VERIFIED');
  assert.equal(
    readiness({ config: { ...configured, enabled: true }, lastHealthyAt: new Date(F.NOW_MS).toISOString(), now: F.NOW_MS }).summary,
    'HEALTHY',
  );
});

test('a stale health result is not evidence of health now', () => {
  const configured = { mode: 'MTPROTO_USER', apiId: '1', apiHash: 'h', sessionString: 's', enabled: true };
  const week = new Date(F.NOW_MS - 7 * 86_400_000).toISOString();
  assert.equal(readiness({ config: configured, lastHealthyAt: week, now: F.NOW_MS }).summary, 'CONFIGURED_NOT_VERIFIED');
});

test('passing these tests is FIXTURE_TESTED and never LIVE_TESTED', () => {
  /*
   * Fixtures are evidence about this repository. LIVE_TESTED is a statement
   * about the world and only a run against real credentials may set it.
   * Nothing in the fixtures or the adapter can reach that value, and this
   * asserts that it cannot be reached by accident.
   */
  const state = readiness({ config: { mode: 'PUBLIC_PREVIEW', enabled: true }, verification: 'FIXTURE_TESTED', now: F.NOW_MS });
  assert.equal(state.verification, 'FIXTURE_TESTED');
  assert.notEqual(state.summary, 'HEALTHY');

  /*
   * The adapter and the fixtures may not mention the value at all. client.ts
   * must — it declares the type — so what is checked there is that the only
   * occurrence is the union member, and that nothing ever ASSIGNS it.
   *
   * The first version of this test greped the whole file and failed on the
   * type declaration, which is the same "the guard matched its own
   * definition" mistake as reading a doc comment as code.
   */
  for (const file of ['index.ts', '__fixtures__/client.mjs']) {
    const src = readFileSync(`src/research-core/adapters/telegram/${file}`, 'utf8');
    assert.equal(src.includes('LIVE_TESTED'), false, `${file} mentions live-testing`);
  }

  const client = readFileSync('src/research-core/adapters/telegram/client.ts', 'utf8');
  const code = stripComments(client);
  const occurrences = [...code.matchAll(/'LIVE_TESTED'/g)];
  assert.equal(occurrences.length, 1, 'LIVE_TESTED appears somewhere other than its type');
  assert.match(code, /export type TelegramVerification =[^;]*'LIVE_TESTED'/);
  // Never `= 'LIVE_TESTED'`, never `verification: 'LIVE_TESTED'`.
  assert.equal(/[=:]\s*'LIVE_TESTED'\s*[;,)]/.test(code), false,
    'something assigns LIVE_TESTED without a live run');
});

test('the modes are exactly the three that exist', () => {
  assert.deepEqual([...TELEGRAM_INTEGRATION_MODES], ['BOT_API', 'MTPROTO_USER', 'PUBLIC_PREVIEW']);
});

/* ── no parallel engine ────────────────────────────────────────────────── */

test('Telegram is an adapter, not a second discovery engine', () => {
  /*
   * The instruction was explicit: use the existing architecture. So this is
   * one more implementation of SourceAdapter, and it must not have grown a
   * queue, a worker, a scheduler or a registry of its own.
   */
  const src = readFileSync('src/research-core/adapters/telegram/index.ts', 'utf8');
  assert.match(src, /implements SourceAdapter/);
  const code = stripComments(src);
  for (const forbidden of [/setInterval/, /setTimeout/, /class \w*Queue/, /class \w*Worker/, /class \w*Scheduler/]) {
    assert.equal(forbidden.test(code), false, `a parallel engine is growing here: ${forbidden}`);
  }
});

test('the adapter never reaches the network itself', () => {
  // Everything goes through the client, which is the only thing that will
  // hold a credential and the only thing that has to change when one arrives.
  const src = readFileSync('src/research-core/adapters/telegram/index.ts', 'utf8');
  const code = stripComments(src);
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|axios/.test(code), false);
});

test('nothing here substitutes a retired provider for Telegram', () => {
  // The instruction, asserted: Apify is not a Telegram implementation.
  for (const file of ['index.ts', 'client.ts', 'normalize.ts']) {
    const src = readFileSync(`src/research-core/adapters/telegram/${file}`, 'utf8');
    assert.equal(/apify|dataforseo/i.test(src), false, `${file} reaches for a retired provider`);
  }
});
