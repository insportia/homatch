import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * WHAT EACH REAL PRODUCT EVENT ACTUALLY SENDS.
 *
 * The routing tests beside this file hold the plumbing: nothing inserts, no
 * feature calls push-send, everything goes through one door. All true, and
 * all of it can be true while the notifications themselves are wrong.
 *
 * This file is about the notifications. It reads every notify() call in the
 * edge functions, pulls out the decisions each one makes — type, priority,
 * where it goes, what makes it the same event twice, what it collapses with —
 * and holds them against what the product has to do.
 *
 * The failures it is written for are the ones that pass every other gate:
 *
 *   A deep link to a route that does not exist. The notification arrives, the
 *   person taps it, and lands on Not Found — which is worse than no link.
 *
 *   A type outside the enum. The insert fails at the database, the helper
 *   swallows it, and the event is simply never told to anybody.
 *
 *   A dedupe key with no event in it. `low-credits:${userId}` looks careful
 *   and means the second warning that customer ever earns is dropped for the
 *   life of the account.
 *
 *   A group key on a direct message. Four people write to you and you are
 *   told "4 new messages" — the one place collapsing is a loss.
 *
 *   No group key where a burst is certain. A matching run finds twelve buyers
 *   and interrupts somebody twelve times.
 */

const ROOT = 'supabase/functions';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Every notify() call in a file, as its object literal.
 *
 * Read from the source rather than executed: these are Deno modules with URL
 * and jsr: imports that a bare node test cannot load, and the decisions being
 * checked are literals anyway. The first argument may be `sb`, `supabase`,
 * `ctx.supabase` or `sb as never`, so it is matched loosely and ignored.
 */
function notifyCalls(src) {
  const found = [];
  const re = /\b(?:notify|notifyOwner|emitNotification)\s*\(\s*[A-Za-z_$][\w$.]*(?:\s+as\s+\w+)?\s*,\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = re.lastIndex - 1;
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    found.push(src.slice(open + 1, i));
  }
  return found;
}

/** Top-level `key: value` pairs of one object literal, values unparsed. */
function fieldsOf(body) {
  const out = {};
  let depth = 0;
  let key = null;
  let valueStart = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if ('{[('.includes(c)) depth += 1;
    else if ('}])'.includes(c)) depth -= 1;
    else if (depth === 0 && c === ':' && key === null) {
      const k = body.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/);
      if (k) { key = k[1]; valueStart = i + 1; }
    } else if (depth === 0 && c === ',' && key !== null) {
      out[key] = body.slice(valueStart, i).trim();
      key = null;
    }
  }
  if (key !== null) out[key] = body.slice(valueStart).trim();

  /* Shorthand — `userId,` and `type,` — carries no value to check but does
     answer "is this field set", which is what the userId rule needs. */
  for (const part of body.split(',')) {
    const short = part.trim().match(/^([A-Za-z_$][\w$]*)$/);
    if (short && !(short[1] in out)) out[short[1]] = short[1];
  }
  return out;
}

/** Every call in the edge functions, with the file it came from. */
const CALLS = walk(ROOT).flatMap((file) => {
  const path = file.replace(/\\/g, '/');
  if (path.endsWith('_shared/notify.ts')) return [];
  return notifyCalls(readFileSync(file, 'utf8')).map(body => ({
    file: path,
    fields: fieldsOf(body),
  }));
});

/** A single-quoted literal, or null when the value is an expression. */
function literal(value) {
  if (!value) return null;
  const m = value.match(/^'([^']*)'$/);
  return m ? m[1] : null;
}

test('the catalogue was actually found', () => {
  // Guards every test below: an empty list passes all of them.
  assert.ok(CALLS.length >= 15,
    `only ${CALLS.length} notify() calls parsed — the extractor has stopped matching`);
});

/*
 * The production enum, as the migrations define it. A type outside this set is
 * a row the database refuses, and the helper swallows the refusal — so the
 * event is lost in silence, which is the worst way to lose one.
 */
const TYPES = new Set([
  'CALLBACK_REQUESTED', 'CAMPAIGN_COMPLETED', 'CAMPAIGN_NEEDS_REVIEW', 'CAMPAIGN_PAUSED',
  'CREDITS_TOPPED_UP', 'DOCUMENT_ANALYZED', 'IMPORT_COMPLETED', 'IMPORT_FAILED',
  'INCLUDED_USAGE_EXHAUSTED', 'LOW_CREDITS', 'MATCH_AVAILABLE', 'MATCH_FOUND',
  'MATCHING_PAUSED', 'MATCHING_STARTED', 'PROVIDER_RECOVERED', 'PROVIDER_UNAVAILABLE',
  'QUALIFIED_LEAD', 'RESEARCH_PRODUCT_PURCHASED', 'SUBSCRIPTION_ACTIVATED',
  'SUBSCRIPTION_ENDED', 'SUBSCRIPTION_RENEWED', 'VERIFY_COMPLETE',
  'WHATSAPP_QUALITY_WARNING', 'WHATSAPP_TEMPLATE_REJECTED',
]);

test('every event type is one the database will accept', () => {
  for (const { file, fields } of CALLS) {
    const type = literal(fields.type);
    if (type === null) continue; // a variable; the caller's own concern
    assert.ok(TYPES.has(type), `${file} emits "${type}", which is not a notification_type`);
  }
});

test('every notification says who it is for', () => {
  for (const { file, fields } of CALLS) {
    assert.ok(fields.userId, `${file} sends a notification with no recipient`);
  }
});

test('every notification decides whether it is worth an interruption', () => {
  /*
   * The helper defaults to NORMAL, so omitting this is legal and silent. It
   * is still wrong: NORMAL passes quiet hours checks that CRITICAL does not
   * and LOW does not survive, and "which of those is this" is a decision the
   * feature is the only place able to make.
   */
  const allowed = new Set(["'CRITICAL'", "'HIGH'", "'NORMAL'", "'LOW'"]);
  for (const { file, fields } of CALLS) {
    assert.ok(fields.priority, `${file} leaves priority to the default instead of choosing`);
    assert.ok(allowed.has(fields.priority), `${file} sets priority ${fields.priority}`);
  }
});

/*
 * The routes the application actually has, read from the router. A deep link
 * that matches nothing here delivers a person to Not Found.
 */
const ROUTES = [...readFileSync('src/routes.tsx', 'utf8').matchAll(/path: *'([^']+)'/g)]
  .map(m => m[1]);

function routeExists(link) {
  /* Query string and template holes removed: `/property/${id}/matches` is the
     route `/property/:id/matches`, and `/chat?c=${id}` is `/chat`. */
  const path = link.split('?')[0].replace(/\$\{[^}]*\}/g, ':param');
  return ROUTES.some((route) => {
    const pattern = route.split('/').map(s => (s.startsWith(':') ? ':param' : s));
    const actual = path.split('/');
    if (pattern.length !== actual.length) return false;
    return pattern.every((seg, i) => seg === ':param' || seg === actual[i]);
  });
}

test('every deep link lands somewhere that exists', () => {
  for (const { file, fields } of CALLS) {
    if (!fields.deepLink) continue;
    const link = fields.deepLink.replace(/^[`']|[`']$/g, '');
    if (fields.deepLink.startsWith("'") || fields.deepLink.startsWith('`')) {
      assert.ok(!link.startsWith('http'),
        `${file} deep-links to an absolute URL; the column refuses one`);
      assert.ok(routeExists(link),
        `${file} deep-links to ${link}, which is not a route this application has`);
    }
  }
});

test('a notification worth interrupting somebody for has somewhere to go', () => {
  for (const { file, fields } of CALLS) {
    if (fields.priority !== "'HIGH'" && fields.priority !== "'CRITICAL'") continue;
    assert.ok(fields.deepLink,
      `${file} interrupts somebody and then gives them nowhere to go`);
  }
});

test('a dedupe key identifies the event, not the customer', () => {
  for (const { file, fields } of CALLS) {
    if (!fields.dedupeKey) continue;
    /*
     * `low-credits:${userId}` would drop every warning after the first one
     * that account ever earns. What makes a key safe is that it names the
     * occurrence — a message id, a call id, a date — so it can only ever
     * collapse the SAME event arriving twice.
     */
    assert.ok(/\$\{/.test(fields.dedupeKey),
      `${file} has a constant dedupe key, so the event can only ever happen once: ${fields.dedupeKey}`);
  }
});

test('a group title counts the things it collapsed', () => {
  for (const { file, fields } of CALLS) {
    if (!fields.groupKey) continue;
    assert.ok(fields.groupTitle,
      `${file} collapses a burst and then shows the first event's title, so the rest are invisible`);
    assert.ok(/\{n\}/.test(fields.groupTitle),
      `${file} has a group title with no count in it: ${fields.groupTitle}`);
    assert.ok(/\$\{/.test(fields.groupKey),
      `${file} groups on a constant, so two unrelated bursts collapse together: ${fields.groupKey}`);
  }
});

test('a message from a person is never collapsed into a count', () => {
  /*
   * The one place grouping is a loss rather than a mercy. Four people writing
   * to you about four properties is four things to know about, and "4 new
   * messages" hides every one of them. Viewing requests are the same: each is
   * a person asking to come to a specific property at a specific time.
   */
  for (const { file, fields } of CALLS) {
    if (!/send-message|viewing-request/.test(file)) continue;
    assert.ok(!fields.groupKey,
      `${file} groups a direct human approach into a count`);
  }
});

test('the domains that arrive in bursts are grouped', () => {
  /*
   * The inverse, and the reason the aggregation exists. A matching run
   * produces ten matches at once; a saved search fires on every new listing;
   * a WhatsApp conversation arrives as five messages in a minute. Each of
   * those is one interruption or it is the reason somebody turns push off.
   */
  const bursty = ['active-search-notify', 'run-matching', 'whatsapp-webhook'];
  for (const dir of bursty) {
    const calls = CALLS.filter(c => c.file.includes(`/${dir}/`));
    assert.ok(calls.length > 0, `${dir} no longer notifies at all`);
    for (const { file, fields } of calls) {
      assert.ok(fields.groupKey,
        `${file} sends one notification per event in a domain that arrives in bursts`);
    }
  }
});

test('every producer that can be retried says what makes it the same event', () => {
  /*
   * Webhooks are retried by the people who send them. Meta re-delivers,
   * Vapi re-delivers, a payment provider re-delivers until it gets a 200 —
   * so without a dedupe key on the natural identity of the event, one
   * callback request becomes three notifications.
   */
  const retried = ['voice-webhook', 'payment-webhook', 'whatsapp-sync'];
  for (const dir of retried) {
    const calls = CALLS.filter(c => c.file.includes(`/${dir}/`));
    assert.ok(calls.length > 0, `${dir} no longer notifies at all`);
    for (const { file, fields } of calls) {
      assert.ok(fields.dedupeKey,
        `${file} is a retried webhook and tells somebody again on every retry`);
    }
  }
});

/*
 * The category is the switch a person is shown. It is decided in push-send
 * from the type and the metadata, and the two have to agree about what
 * exists — a category the settings screen does not offer cannot be turned
 * off, and a switch that governs nothing is a control that does nothing.
 */
const PUSH_SEND = readFileSync('supabase/functions/push-send/index.ts', 'utf8');
const CATEGORIES = [...readFileSync('src/services/notificationPreferences.ts', 'utf8')
  .match(/export const NOTIFICATION_CATEGORIES = \[([\s\S]*?)\] as const;/)[1]
  .matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

test('every category push-send can return is one a person can switch off', () => {
  const returned = [...PUSH_SEND
    .match(/function categoryOf\([\s\S]*?\n}/)[0]
    .matchAll(/return '([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(returned.length > 0, 'categoryOf no longer returns anything');
  for (const category of new Set(returned)) {
    assert.ok(CATEGORIES.includes(category),
      `push-send files events under "${category}", which the settings screen does not offer`);
  }
});

test('a direct message is not filed under matches', () => {
  /*
   * It was. A message and a viewing request are both stored as MATCH_FOUND —
   * the enum has no value for either — so the category came out as "matches"
   * and turning off automated matching also silenced a human being trying to
   * reach you about your property. The producers say which is which in
   * metadata.kind; categoryOf now reads it.
   */
  const fn = PUSH_SEND.match(/function categoryOf\([\s\S]*?\n}/)[0];
  assert.ok(/metadata/.test(fn), 'categoryOf decides from the type alone again');
  assert.ok(/NEW_MESSAGE/.test(fn) && /'messages'/.test(fn),
    'a direct message no longer has a category of its own');
  assert.ok(/VIEWING_REQUEST/.test(fn) && /'viewings'/.test(fn),
    'a viewing request no longer has a category of its own');

  const message = CALLS.find(c => c.file.includes('/send-message/'));
  assert.ok(/NEW_MESSAGE/.test(message.fields.metadata ?? ''),
    'send-message stopped saying what kind of event it is, so its category falls back to matches');
});

test('the in-app list goes where the producer said, not where it guesses', () => {
  /*
   * The deep link was being set carefully by every producer and read by
   * nobody except push. In the app, the list re-derived a destination from
   * the type and property_id — and notify_emit does not write property_id, so
   * every match that went through the canonical path became a notification
   * that opened, was tapped, and did nothing.
   */
  const page = readFileSync('src/pages/NotificationsPage.tsx', 'utf8');
  assert.ok(/notif\.deep_link/.test(page),
    'the notifications list ignores deep_link again and guesses from the type');
  /* And only a path. An absolute URL cannot reach the column, but a restored
     row could carry one, and navigate() with an off-site address is an open
     redirect out of a list of things the platform told you. */
  assert.ok(/startsWith\('\/'\)/.test(page) && /startsWith\('\/\/'\)/.test(page),
    'the list follows a deep link without checking it is a path on this site');
});
