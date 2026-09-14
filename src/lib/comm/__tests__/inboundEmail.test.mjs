import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SIGNATURE_TOLERANCE_SECONDS, normaliseAddress, normaliseInboundEmail,
  parseAddress, previewOf, stripQuotedReply, svixHeaders, timingSafeEqual,
  v1Signatures, verifyInboundSignature,
} from '../inboundEmail.ts';

/*
 * AN EMAIL REPLY, ON ITS WAY INTO THE INBOX.
 *
 * Homatch could send email and could not receive it: the one moment outreach
 * actually worked — somebody replying — was the moment the product stopped
 * knowing about it.
 *
 * The webhook that fixes that is the most exposed surface in the product. It
 * has no user session, it is reachable by anyone who learns the URL, and what
 * it writes lands in a specific customer's inbox. So the two questions it
 * answers — is this really the provider, and whose mail is this — are the two
 * this file is about.
 *
 * WHY THE SIGNATURE TESTS ARE SPECIFIC RATHER THAN "IT VERIFIES"
 *
 * Every one of them is a way to write a verifier that looks right and accepts
 * forgeries: signing only the body, using the prefixed secret, taking the
 * first signature in the header, skipping the timestamp. A test that only
 * checks a valid request passes all four broken implementations.
 */

const SECRET_BYTES = new Uint8Array([
  0x9a, 0x4d, 0x1f, 0x77, 0x02, 0xbe, 0x35, 0xc8, 0x61, 0x0d, 0x44, 0x99,
  0xa3, 0x52, 0xe7, 0x18, 0x2c, 0xf0, 0x6b, 0x91, 0x85, 0x30, 0xdd, 0x4e,
]);
const SECRET = `whsec_${Buffer.from(SECRET_BYTES).toString('base64')}`;

/** Sign exactly the way the provider does, so the test is not the code. */
async function sign(id, timestamp, body, secretBytes = SECRET_BYTES) {
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${Buffer.from(new Uint8Array(mac)).toString('base64')}`;
}

const NOW = 1_789_400_000_000;
const TS = String(Math.floor(NOW / 1000));

function inboundPayload(overrides = {}) {
  return JSON.stringify({
    type: 'email.received',
    id: 'evt_abc123',
    created_at: '2026-09-14T13:00:00.000Z',
    data: {
      from: '"Nino Beridze" <nino@example.ge>',
      to: ['replies@homatch.ge'],
      subject: 'Re: A flat in Vake',
      text: 'Yes, Tuesday works for me.\n\nOn Mon, Homatch wrote:\n> Would Tuesday suit?',
      headers: [
        { name: 'Message-Id', value: '<reply-1@example.ge>' },
        { name: 'In-Reply-To', value: '<out-9@homatch.ge>' },
      ],
      ...overrides,
    },
  });
}

/* ── Is this really the provider ───────────────────────────────────────── */

test('a genuine delivery verifies', async () => {
  const body = inboundPayload();
  const verdict = await verifyInboundSignature({
    rawBody: body, id: 'msg_1', timestamp: TS,
    signature: await sign('msg_1', TS, body), secret: SECRET, nowMs: NOW,
  });
  assert.deepEqual(verdict, { ok: true });
});

test('the signature covers the id and the timestamp, not only the body', async () => {
  /*
   * The first way to get this wrong. Signing the body alone means a captured
   * delivery can be replayed under any id, forever — the dedupe gate then sees
   * a new event key and lets it through.
   */
  const body = inboundPayload();
  const signature = await sign('msg_1', TS, body);

  const otherId = await verifyInboundSignature({
    rawBody: body, id: 'msg_2', timestamp: TS, signature, secret: SECRET, nowMs: NOW,
  });
  assert.deepEqual(otherId, { ok: false, reason: 'MISMATCH' },
    'the id is not part of the signed content, so a delivery can be replayed under a new one');

  const otherTs = await verifyInboundSignature({
    rawBody: body, id: 'msg_1', timestamp: String(Number(TS) - 1), signature,
    secret: SECRET, nowMs: NOW,
  });
  assert.deepEqual(otherTs, { ok: false, reason: 'MISMATCH' },
    'the timestamp is not part of the signed content');
});

test('one changed byte in the body fails', async () => {
  const body = inboundPayload();
  const signature = await sign('msg_1', TS, body);
  const tampered = body.replace('Tuesday works', 'Tuesday does not work');
  const verdict = await verifyInboundSignature({
    rawBody: tampered, id: 'msg_1', timestamp: TS, signature, secret: SECRET, nowMs: NOW,
  });
  assert.deepEqual(verdict, { ok: false, reason: 'MISMATCH' });
});

test('the secret is the bytes after whsec_, not the string with it', async () => {
  /*
   * The second way to get this wrong, and the one everybody debugs for an
   * hour: using the prefixed string as the key rejects every genuine request.
   * Signed with the decoded bytes — which is what the provider does — it must
   * verify against the prefixed secret as configured.
   */
  const body = inboundPayload();
  const verdict = await verifyInboundSignature({
    rawBody: body, id: 'msg_1', timestamp: TS,
    signature: await sign('msg_1', TS, body, SECRET_BYTES),
    secret: SECRET, nowMs: NOW,
  });
  assert.deepEqual(verdict, { ok: true });
});

test('a header carrying several signatures verifies on any of them', async () => {
  /*
   * The third. A secret being rotated means two are valid at once, so a
   * verifier that takes the first and compares it breaks on rotation day —
   * which is the day nobody is expecting a webhook to break.
   */
  const body = inboundPayload();
  const good = await sign('msg_1', TS, body);
  const header = `v1,ZmFrZXNpZ25hdHVyZXZhbHVlaGVyZQ== ${good}`;
  const verdict = await verifyInboundSignature({
    rawBody: body, id: 'msg_1', timestamp: TS, signature: header, secret: SECRET, nowMs: NOW,
  });
  assert.deepEqual(verdict, { ok: true });
});

test('a delivery from too long ago is refused, in both directions', async () => {
  /* The fourth. Without a window, a captured request is valid forever. */
  const body = inboundPayload();
  const signature = await sign('msg_1', TS, body);

  const old = await verifyInboundSignature({
    rawBody: body, id: 'msg_1', timestamp: TS, signature, secret: SECRET,
    nowMs: NOW + (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000,
  });
  assert.deepEqual(old, { ok: false, reason: 'STALE' });

  const future = await verifyInboundSignature({
    rawBody: body, id: 'msg_1', timestamp: TS, signature, secret: SECRET,
    nowMs: NOW - (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000,
  });
  assert.deepEqual(future, { ok: false, reason: 'STALE' },
    'a timestamp from the future is as much a forgery signal as one from last week');
});

test('no secret and no headers are refusals with their own reasons', async () => {
  const body = inboundPayload();
  assert.deepEqual(
    await verifyInboundSignature({ rawBody: body, id: 'a', timestamp: TS, signature: 'v1,x', secret: null }),
    { ok: false, reason: 'NO_SECRET' });
  assert.deepEqual(
    await verifyInboundSignature({ rawBody: body, id: null, timestamp: TS, signature: 'v1,x', secret: SECRET, nowMs: NOW }),
    { ok: false, reason: 'MISSING_HEADERS' });
  assert.deepEqual(
    await verifyInboundSignature({ rawBody: body, id: 'a', timestamp: 'not-a-number', signature: 'v1,x', secret: SECRET, nowMs: NOW }),
    { ok: false, reason: 'BAD_TIMESTAMP' });
  assert.deepEqual(
    await verifyInboundSignature({ rawBody: body, id: 'a', timestamp: TS, signature: 'v9,x', secret: SECRET, nowMs: NOW }),
    { ok: false, reason: 'NO_V1_SIGNATURE' });
});

test('the headers are read under both names the scheme uses', () => {
  const svix = svixHeaders(n => ({ 'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': 'c' })[n] ?? null);
  assert.deepEqual(svix, { id: 'a', timestamp: 'b', signature: 'c' });
  const standard = svixHeaders(n => ({ 'webhook-id': 'a', 'webhook-timestamp': 'b', 'webhook-signature': 'c' })[n] ?? null);
  assert.deepEqual(standard, { id: 'a', timestamp: 'b', signature: 'c' });
});

test('signature comparison does not exit early', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'ab'), false);
  assert.deepEqual(v1Signatures('v1,aaa v0,bbb v1,ccc'), ['aaa', 'ccc']);
  assert.deepEqual(v1Signatures(null), []);
});

/* ── What the payload says ─────────────────────────────────────────────── */

test('a reply is normalised into the shape the inbox already takes', () => {
  const email = normaliseInboundEmail(JSON.parse(inboundPayload()), 'fallback');
  assert.equal(email.eventId, 'evt_abc123');
  assert.equal(email.fromAddress, 'nino@example.ge');
  assert.equal(email.fromName, 'Nino Beridze');
  assert.deepEqual(email.to, ['replies@homatch.ge']);
  assert.equal(email.subject, 'Re: A flat in Vake');
  assert.equal(email.messageId, '<reply-1@example.ge>');
  assert.deepEqual(email.inReplyTo, ['<out-9@homatch.ge>']);
  assert.equal(email.attachmentCount, 0);
});

test('an event that is not an inbound email is ignored rather than refused', () => {
  /*
   * A delivery receipt, a bounce, an event type added next year. Returning
   * null means the webhook answers 200 and moves on; throwing would make the
   * provider retry an event it will never be able to deliver.
   */
  for (const type of ['email.delivered', 'email.bounced', 'email.opened', 'contact.created']) {
    assert.equal(normaliseInboundEmail({ type, data: { from: 'a@b.ge' } }, 'x'), null, type);
  }
});

test('a malformed payload produces null, not a half-built message', () => {
  assert.equal(normaliseInboundEmail(null, 'x'), null);
  assert.equal(normaliseInboundEmail('not an object', 'x'), null);
  assert.equal(normaliseInboundEmail({}, 'x'), null);
  // The right event type and no sender: there is nobody to attribute it to.
  assert.equal(normaliseInboundEmail({ type: 'email.received', data: {} }, 'x'), null);
  assert.equal(normaliseInboundEmail({ type: 'email.received', data: { from: 'not-an-address' } }, 'x'), null);
});

test('the delivery id falls back so an event is never keyed on nothing', () => {
  const email = normaliseInboundEmail(
    { type: 'email.received', data: { from: 'a@b.ge', to: ['c@d.ge'] } }, 'svix-header-id',
  );
  assert.equal(email.eventId, 'svix-header-id',
    'with no id in the payload the dedupe key would otherwise be empty for every delivery');
});

test('addresses are compared the way addresses are written', () => {
  assert.equal(normaliseAddress('  NINO@Example.GE '), 'nino@example.ge');
  assert.equal(normaliseAddress('not an address'), null);
  assert.equal(normaliseAddress(42), null);
  assert.deepEqual(parseAddress('Nino <nino@example.ge>'), { address: 'nino@example.ge', name: 'Nino' });
  assert.deepEqual(parseAddress('nino@example.ge'), { address: 'nino@example.ge', name: null });
});

test('headers are read whether the provider sends a list or an object', () => {
  const asObject = normaliseInboundEmail({
    type: 'email.received',
    data: {
      from: 'a@b.ge', to: ['c@d.ge'],
      headers: { 'Message-ID': '<m1@b.ge>', 'In-Reply-To': '<m0@d.ge>' },
    },
  }, 'x');
  assert.equal(asObject.messageId, '<m1@b.ge>');
  assert.deepEqual(asObject.inReplyTo, ['<m0@d.ge>']);
});

/* ── What the person actually wrote ────────────────────────────────────── */

test('the quoted thread is not the preview', () => {
  const reply = 'Yes, Tuesday works for me.\n\nOn Mon, 14 Sep 2026, Homatch wrote:\n> Would Tuesday suit?';
  assert.equal(stripQuotedReply(reply), 'Yes, Tuesday works for me.');
  assert.equal(previewOf(reply, 'Re: A flat'), 'Yes, Tuesday works for me.');
});

test('a quote-only reply keeps its body rather than becoming blank', () => {
  /* A bare forward, or somebody who wrote above nothing. An empty preview in
     the thread list is worse than a quoted one. */
  const quoted = '> Would Tuesday suit?\n> Let me know.\n> Homatch';
  assert.ok(stripQuotedReply(quoted).length > 0);
});

test('the subject stands in when there is no text at all', () => {
  assert.equal(previewOf(null, 'Re: A flat in Vake'), 'Re: A flat in Vake');
  assert.equal(previewOf('', null), '');
});

test('Outlook and Apple quoting are both cut', () => {
  for (const marker of [
    'Thanks.\n\n-----Original Message-----\nFrom: Homatch',
    'Thanks.\n\n________________________________\nFrom: Homatch\nSent: Monday',
  ]) {
    assert.equal(stripQuotedReply(marker), 'Thanks.');
  }
});

/* ── The webhook uses it, and uses it correctly ────────────────────────── */

const FN = readFileSync('supabase/functions/email-webhook/index.ts', 'utf8');

test('the webhook refuses to run without a secret', () => {
  assert.match(FN, /RESEND_WEBHOOK_SECRET/);
  assert.match(FN, /if \(!secret\)[\s\S]{0,200}status: 503/,
    'an unset secret must be a refusal, not a degraded mode');
});

test('the body is read once, as text, before anything parses it', () => {
  const read = FN.indexOf('await req.text()');
  const parse = FN.indexOf('JSON.parse(rawBody)');
  /* The CALL. The name also appears in the import block, which is above
     everything and would make this test pass whatever the order was. */
  const verify = FN.indexOf('await verifyInboundSignature({');
  assert.ok(read > 0 && verify > read && parse > verify,
    'the signature must be checked on the raw bytes before the body is parsed');
});

test('every delivery passes the dedupe gate before it changes anything', () => {
  /* The CALL, not the comment about it: both names appear in the header
     block that explains why the gate exists. */
  const claim = FN.indexOf("sb.rpc('comm_claim_webhook_event'");
  const record = FN.indexOf("sb.rpc('comm_record_inbound'");
  assert.ok(claim > 0 && record > claim, 'a retried delivery can write a second message');
  assert.match(FN, /if \(!shouldProcess\)[\s\S]{0,160}return;/,
    'the dedupe verdict is read and not acted on');
});

test('an unrecognised address is recorded, never attached to a guess', () => {
  assert.match(FN, /unroutable_address/);
  const resolve = FN.slice(FN.indexOf('async function resolveAccount'));
  assert.match(resolve, /\.eq\('channel', 'EMAIL'\)/);
  assert.match(resolve, /\.in\('provider_account_id', to\)/,
    'the tenant must come from the address it arrived at, not from the sender');
});

test('the webhook notifies through the one door and inserts nothing', () => {
  assert.match(FN, /await notify\(/, 'the owner is not told about a reply at all');
  assert.equal(/from\(\s*['"]notifications['"]\s*\)\s*\.insert/.test(FN), false,
    'it writes a notification row directly, bypassing preferences and quiet hours');
  assert.equal(/invoke\(\s*['"]push-send['"]/.test(FN), false,
    'it decides push for itself');
});

test('the customer email body is not copied into the webhook audit row', () => {
  /*
   * comm_webhook_events is kept for support and is not the tenant's table. The
   * message itself is recorded once, where RLS protects it; a second copy of
   * somebody's correspondence in an audit row is a second place to leak it
   * from.
   */
  const at = FN.indexOf("sb.rpc('comm_claim_webhook_event'");
  const claim = FN.slice(at, FN.indexOf('claimError', at));
  assert.equal(/p_payload:\s*body/.test(claim), false, 'the raw payload is stored');
  assert.match(claim, /p_payload: \{ kind:/);
});
