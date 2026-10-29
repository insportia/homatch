// SUBSCRIPTIONS (owner decision 2026-10-29): the payment adapters, the normalised webhook path,
// the entitlement gate's funding order, the notices, and the source facts that keep the money
// path honest. The SQL itself runs on a real PostgreSQL in tests/sql/saas/realdb.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const pay = await import('../../supabase/functions/_shared/saasPayments/index.ts');
const sandbox = await import('../../supabase/functions/_shared/saasPayments/sandbox.ts');
const banks = await import('../../supabase/functions/_shared/saasPayments/banks.ts');
const ent = await import('../../supabase/functions/_shared/entitlements.ts');
const notice = await import('../../supabase/functions/_shared/saasNotify.ts');

const SECRET = 'test-secret-not-real';
const body = (over = {}) => ({ eventId: 'evt_000001', type: 'PAYMENT_SUCCEEDED', amountTetri: 990, currency: 'GEL', reference: '11111111-1111-1111-1111-111111111111', test: true, ...over });

function fakeRpc(answers) {
  const calls = [];
  return {
    calls,
    rpc(fn, args) {
      calls.push({ fn, args });
      const a = answers[fn];
      return Promise.resolve(typeof a === 'function' ? a(args) : (a ?? { data: null, error: null }));
    },
  };
}

test('sandbox: a signed event verifies and normalises; a tampered one does not', async () => {
  const a = new sandbox.SandboxAdapter(SECRET, true, 'https://homatch.live');
  const s = await sandbox.signSandboxEvent(SECRET, body());
  const ok = await a.verifyWebhook(s.raw, new Headers({ [sandbox.SANDBOX_SIGNATURE_HEADER]: s.signature }));
  assert.equal(ok.ok, true);
  assert.deepEqual({ ...ok.event, summary: undefined }, {
    provider: 'SANDBOX', eventId: 'evt_000001', type: 'PAYMENT_SUCCEEDED', amountTetri: 990, currency: 'GEL',
    reference: '11111111-1111-1111-1111-111111111111', subscriptionRef: null, summary: undefined,
  });
  const tampered = s.raw.replace('990', '9900');
  assert.equal((await a.verifyWebhook(tampered, new Headers({ [sandbox.SANDBOX_SIGNATURE_HEADER]: s.signature }))).reason, 'BAD_SIGNATURE');
  assert.equal((await a.verifyWebhook(s.raw, new Headers())).reason, 'BAD_SIGNATURE');
  const wrongKey = await sandbox.signSandboxEvent('another', body());
  assert.equal((await a.verifyWebhook(wrongKey.raw, new Headers({ [sandbox.SANDBOX_SIGNATURE_HEADER]: wrongKey.signature }))).reason, 'BAD_SIGNATURE');
  const notTest = await sandbox.signSandboxEvent(SECRET, body({ test: false }));
  assert.equal((await a.verifyWebhook(notTest.raw, new Headers({ [sandbox.SANDBOX_SIGNATURE_HEADER]: notTest.signature }))).reason, 'BAD_PAYLOAD');
});

test('sandbox is off without its secret or the admin switch, and is always labelled test', async () => {
  const s = await sandbox.signSandboxEvent(SECRET, body());
  const h = new Headers({ [sandbox.SANDBOX_SIGNATURE_HEADER]: s.signature });
  assert.equal((await new sandbox.SandboxAdapter(undefined, true, 'x').verifyWebhook(s.raw, h)).reason, 'NOT_CONFIGURED');
  assert.equal((await new sandbox.SandboxAdapter(SECRET, false, 'x').verifyWebhook(s.raw, h)).reason, 'DISABLED');
  assert.equal((await new sandbox.SandboxAdapter(SECRET, false, 'x').createSession({ checkoutId: 'c' })).ok, false);
  assert.equal(new sandbox.SandboxAdapter(SECRET, true, 'x').capabilities().test, true);
  assert.equal(new sandbox.SandboxAdapter(SECRET, true, 'x').capabilities().recurring, false);
});

/* ── Banks: fake fetch that records requests and answers by URL ── */
function fakeBank(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, ...init });
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    const [status, body] = hit ? (typeof hit[1] === 'function' ? hit[1](url, init) : hit[1]) : [404, {}];
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { calls, fetcher };
}
const secrets = (m) => (k) => m[k];
async function rsaPair() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  const sign = async (raw) => Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(raw))).toString('base64');
  return { pem, sign };
}
const CB = 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/saas-payments-webhook?provider=';
const input = { checkoutId: '22222222-2222-4222-8222-222222222222', amountTetri: 990, currency: 'GEL', planCode: 'STANDARD', description: 'HOMATCH STANDARD',
  returnUrl: 'https://www.homatch.live/subscription/confirm?checkout=x', cancelUrl: 'https://www.homatch.live/subscription/confirm?checkout=x&result=fail' };

test('banks without secrets: NOT_CONFIGURED everywhere, and the missing secret NAMES are reported', async () => {
  const b = new banks.BankOfGeorgiaAdapter(secrets({ BOG_CLIENT_ID: 'id' }), fakeBank({}).fetcher, CB + 'BOG');
  assert.deepEqual(b.capabilities().missingSecrets, ['BOG_CLIENT_SECRET', 'BOG_CALLBACK_PUBLIC_KEY']);
  const t = new banks.TbcAdapter(secrets({}), fakeBank({}).fetcher, CB + 'TBC');
  assert.deepEqual(t.capabilities().missingSecrets, ['TBC_API_KEY', 'TBC_CLIENT_ID', 'TBC_CLIENT_SECRET']);
  for (const a of [b, t]) {
    assert.equal(a.capabilities().configured, false);
    assert.equal((await a.createSession(input)).reason, 'NOT_CONFIGURED');
    assert.equal((await a.verifyWebhook('{}', new Headers())).reason, 'NOT_CONFIGURED');
    assert.equal((await a.lookupTransaction('r', 'c')).reason, 'NOT_CONFIGURED');
    assert.equal((await a.refund('r', 1)).reason, 'NOT_CONFIGURED');
    assert.equal((await a.testConnectivity()).reason, 'NOT_CONFIGURED');
  }
});

test('amounts: tetri <-> GEL', () => {
  assert.equal(banks.toGel(990), 9.9); assert.equal(banks.toGel(9900), 99);
  assert.equal(banks.toTetri(9.9), 990); assert.equal(banks.toTetri('29.00'), 2900); assert.equal(banks.toTetri('x'), null);
});

test('BOG: token, order request, saved card, status mapping', async () => {
  const { pem } = await rsaPair();
  const bank = fakeBank({
    [banks.BOG.token]: [200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }],
    'https://api.bog.ge/payments/v1/orders/': [202, {}],
    [banks.BOG.orders]: [200, { id: 'ord_1', _links: { redirect: { href: 'https://payment.bog.ge/?order_id=ord_1' } } }],
  });
  const a = new banks.BankOfGeorgiaAdapter(secrets({ BOG_CLIENT_ID: 'cid', BOG_CLIENT_SECRET: 'sec', BOG_CALLBACK_PUBLIC_KEY: pem }), bank.fetcher, CB + 'BOG');
  const r = await a.createSession({ ...input, saveCard: true });
  assert.deepEqual(r, { ok: true, sessionRef: 'ord_1', redirectUrl: 'https://payment.bog.ge/?order_id=ord_1' });
  const tok = bank.calls[0];
  assert.equal(tok.headers.Authorization, `Basic ${Buffer.from('cid:sec').toString('base64')}`);
  assert.equal(tok.body, 'grant_type=client_credentials');
  const order = bank.calls[1];
  assert.equal(order.headers.Authorization, 'Bearer tok'); assert.equal(order.headers['Idempotency-Key'], input.checkoutId);
  const ob = JSON.parse(order.body);
  assert.equal(ob.callback_url, CB + 'BOG'); assert.equal(ob.external_order_id, input.checkoutId);
  assert.equal(ob.purchase_units.currency, 'GEL'); assert.equal(ob.purchase_units.total_amount, 9.9);
  assert.equal(ob.purchase_units.basket[0].unit_price, 9.9); assert.equal(ob.redirect_urls.fail, input.cancelUrl);
  assert.equal(bank.calls[2].method, 'PUT'); assert.equal(bank.calls[2].url, banks.BOG.saveCard('ord_1'));
  assert.equal(bank.calls.filter((c) => c.url === banks.BOG.token).length, 1, 'token cached');
  assert.equal(banks.bogEventType('completed'), 'PAYMENT_SUCCEEDED');
  assert.equal(banks.bogEventType('rejected'), 'PAYMENT_FAILED');
  assert.equal(banks.bogEventType('refunded_partially'), 'REFUNDED');
  for (const k of ['created', 'processing', 'blocked', 'auth_requested']) assert.equal(banks.bogEventType(k), 'OTHER');
  assert.equal((await a.testConnectivity()).ok, true);
});

test('BOG callback: RSA signature on the raw body, then the receipt is re-queried', async () => {
  const { pem, sign } = await rsaPair();
  const receipt = { order_id: 'ord_9', external_order_id: input.checkoutId, order_status: { key: 'completed' },
    purchase_units: { request_amount: '9.90', transfer_amount: '9.90', currency_code: 'GEL' }, payment_detail: { saved_card_type: 'subscription' } };
  const bank = fakeBank({
    [banks.BOG.token]: [200, { access_token: 'tok', expires_in: 3600 }],
    [banks.BOG.receipt('ord_9')]: [200, receipt],
  });
  const a = new banks.BankOfGeorgiaAdapter(secrets({ BOG_CLIENT_ID: 'c', BOG_CLIENT_SECRET: 's', BOG_CALLBACK_PUBLIC_KEY: pem }), bank.fetcher, CB + 'BOG');
  // The callback CLAIMS 99 GEL; the bank's receipt says 9.90 and wins.
  const raw = JSON.stringify({ event: 'order_payment', zoned_request_time: '2026-10-29T10:00:00.000000Z', body: { ...receipt, purchase_units: { transfer_amount: '99', currency_code: 'GEL' } } });
  const good = await a.verifyWebhook(raw, new Headers({ 'Callback-Signature': await sign(raw) }));
  assert.equal(good.ok, true);
  assert.deepEqual([good.event.type, good.event.amountTetri, good.event.reference, good.event.eventId, good.event.subscriptionRef],
    ['PAYMENT_SUCCEEDED', 990, input.checkoutId, 'ord_9:completed', 'ord_9']);
  assert.ok(bank.calls.some((c) => c.url === banks.BOG.receipt('ord_9')), 're-queried');
  assert.equal((await a.verifyWebhook(raw.replace('ord_9', 'ord_8'), new Headers({ 'Callback-Signature': await sign(raw) }))).reason, 'BAD_SIGNATURE');
  assert.equal((await a.verifyWebhook(raw, new Headers())).reason, 'BAD_SIGNATURE');
  const other = await rsaPair();
  assert.equal((await a.verifyWebhook(raw, new Headers({ 'Callback-Signature': await other.sign(raw) }))).reason, 'BAD_SIGNATURE');
});

test('TBC: token, payment request, callback re-checked through the API, recurring and refund', async () => {
  let status = 'Succeeded';
  const bank = fakeBank({
    [banks.TBC.token]: [200, { access_token: 'ttok', token_type: 'Bearer', expires_in: 86400 }],
    [banks.TBC.execution]: [200, { payId: 'pay_r1', status: 'Succeeded', amount: 9.9, currency: 'GEL', recurringCard: { recId: 'rec_1' } }],
    [banks.TBC.payments + '/pay_1/cancel']: [200, {}],
    [banks.TBC.payment('pay_1')]: () => [200, { payId: 'pay_1', status, amount: 9.9, currency: 'GEL', recurringCard: { recId: 'rec_1' } }],
    [banks.TBC.payments]: [200, { payId: 'pay_1', status: 'Created', links: [{ uri: 'https://ecom.tbcpayments.ge/pay/pay_1', method: 'REDIRECT', rel: 'approval_url' }] }],
  });
  const a = new banks.TbcAdapter(secrets({ TBC_API_KEY: 'key', TBC_CLIENT_ID: 'cid', TBC_CLIENT_SECRET: 'sec' }), bank.fetcher, CB + 'TBC');
  const r = await a.createSession({ ...input, saveCard: true });
  assert.deepEqual(r, { ok: true, sessionRef: 'pay_1', redirectUrl: 'https://ecom.tbcpayments.ge/pay/pay_1' });
  assert.equal(bank.calls[0].headers.apikey, 'key');
  assert.equal(new URLSearchParams(bank.calls[0].body).get('client_secret'), 'sec');
  const pb = JSON.parse(bank.calls[1].body);
  assert.deepEqual(pb.amount, { currency: 'GEL', total: 9.9, subTotal: 0, tax: 0, shipping: 0 });
  assert.equal(pb.callbackUrl, CB + 'TBC'); assert.equal(pb.merchantPaymentId, input.checkoutId); assert.equal(pb.saveCard, true);
  assert.equal(bank.calls[1].headers.Authorization, 'Bearer ttok');
  // Callback: only an id; the API's answer decides.
  const cb = await a.verifyWebhook(JSON.stringify({ PaymentId: 'pay_1' }), new Headers());
  assert.deepEqual([cb.event.type, cb.event.amountTetri, cb.event.reference, cb.event.subscriptionRef], ['PAYMENT_SUCCEEDED', 990, 'pay_1', 'rec_1']);
  status = 'Processing';
  assert.equal((await a.verifyWebhook(JSON.stringify({ PaymentId: 'pay_1' }), new Headers())).ok, false, 'not final: nothing to apply');
  assert.equal((await a.verifyWebhook('{"PaymentId":"../../x"}', new Headers())).reason, 'BAD_PAYLOAD');
  for (const [k, v] of [['Succeeded', 'PAYMENT_SUCCEEDED'], ['Failed', 'PAYMENT_FAILED'], ['Expired', 'PAYMENT_FAILED'], ['Returned', 'REFUNDED'], ['WaitingConfirm', 'OTHER'], ['Created', 'OTHER']]) {
    assert.equal(banks.tbcEventType(k), v);
  }
  const rc = await a.chargeRecurring({ subscriptionRef: 'rec_1', checkoutId: input.checkoutId, amountTetri: 990 });
  assert.equal(rc.ok, true); assert.equal(rc.event.type, 'PAYMENT_SUCCEEDED');
  const eb = JSON.parse(bank.calls.find((c) => c.url === banks.TBC.execution).body);
  assert.deepEqual(eb, { recId: 'rec_1', money: { amount: 9.9, currency: 'GEL' }, initiator: 'merchant', preAuth: false, merchantPaymentId: input.checkoutId });
  assert.equal((await a.refund('pay_1', 990)).ok, true);
  assert.equal(JSON.parse(bank.calls.at(-1).body).amount, 9.9);
  assert.equal((await a.testConnectivity()).ok, true);
});

test('the webhook path: only a verified event reaches saas_payment_event_apply', async () => {
  const a = new sandbox.SandboxAdapter(SECRET, true, 'x');
  const s = await sandbox.signSandboxEvent(SECRET, body());
  const sb = fakeRpc({ saas_payment_event_apply: { data: { ok: true, applied: 'PAYMENT_SUCCEEDED' }, error: null } });
  const bad = await pay.processWebhook(sb, a, s.raw, new Headers({ [sandbox.SANDBOX_SIGNATURE_HEADER]: '00' }));
  assert.equal(bad.status, 401);
  assert.equal(sb.calls.length, 0, 'an unverified request changes nothing');
  const good = await pay.processWebhook(sb, a, s.raw, new Headers({ [sandbox.SANDBOX_SIGNATURE_HEADER]: s.signature }));
  assert.equal(good.status, 200);
  assert.equal(sb.calls[0].fn, 'saas_payment_event_apply');
  assert.equal(sb.calls[0].args.p_event_id, 'evt_000001');
  assert.equal(sb.calls[0].args.p_amount_tetri, 990);
  const notConfigured = await pay.processWebhook(sb, new banks.BankOfGeorgiaAdapter(() => undefined, fakeBank({}).fetcher, 'x'), s.raw, new Headers());
  assert.equal(notConfigured.status, 503);
});

test('funding order: trial / plan reserve without touching the wallet', async () => {
  let legacyCalled = 0;
  const legacy = async () => { legacyCalled++; return { ok: true }; };
  for (const funding of ['TRIAL', 'PLAN']) {
    const sb = fakeRpc({ saas_usage_begin: { data: { ok: true, funding }, error: null } });
    const g = await ent.beginEntitled(sb, { userId: 'u', feature: 'VERIFY', key: 'verify:job-1', legacy });
    assert.equal(g.ok, true); assert.equal(g.funding, funding); assert.equal(g.legacy, null);
  }
  assert.equal(legacyCalled, 0);
});

test('funding order: legacy credits only when the server says so, refusal becomes the subscribe prompt', async () => {
  const sb = fakeRpc({ saas_usage_begin: { data: { ok: true, funding: 'LEGACY_CREDITS', fallbackReason: 'ALLOWANCE_EXHAUSTED' }, error: null } });
  const g = await ent.beginEntitled(sb, { userId: 'u', feature: 'CONTRACT_ANALYSIS', key: 'contract:d:sha', legacy: async () => ({ ok: true, reservationId: 'r' }) });
  assert.equal(g.funding, 'LEGACY_CREDITS'); assert.equal(g.legacy.reservationId, 'r');
  const short = await ent.beginEntitled(sb, { userId: 'u', feature: 'CONTRACT_ANALYSIS', key: 'contract:d:sha', legacy: async () => ({ ok: false, reason: 'INSUFFICIENT_CREDITS' }) });
  assert.equal(short.ok, false); assert.equal(short.reason, 'ALLOWANCE_EXHAUSTED');
  const none = await ent.beginEntitled(fakeRpc({ saas_usage_begin: { data: { ok: false, reason: 'SUBSCRIPTION_REQUIRED', trialBlocked: 'ACCOUNT_NOT_VERIFIED' }, error: null } }),
    { userId: 'u', feature: 'VERIFY', key: 'verify:job-2' });
  assert.equal(none.reason, 'SUBSCRIPTION_REQUIRED'); assert.equal(none.trialBlocked, 'ACCOUNT_NOT_VERIFIED');
  const broken = await ent.beginEntitled(fakeRpc({ saas_usage_begin: { data: null, error: { message: 'x' } } }), { userId: 'u', feature: 'VERIFY', key: 'verify:job-3' });
  assert.equal(broken.reason, 'ERROR'); assert.equal(ent.refusalStatus('ERROR'), 503); assert.equal(ent.refusalStatus('SUBSCRIPTION_REQUIRED'), 402);
});

test('commit and release go to the ledger only for trial / plan uses', async () => {
  const sb = fakeRpc({ saas_usage_commit: { data: { ok: true }, error: null } });
  assert.equal(await ent.commitEntitled(sb, { ok: true, funding: 'PLAN', feature: 'VERIFY', userId: 'u', key: 'k-000001' }), true);
  await ent.releaseEntitled(sb, { ok: true, funding: 'TRIAL', feature: 'VERIFY', userId: 'u', key: 'k-000001' }, 'FAILED');
  assert.deepEqual(sb.calls.map((c) => c.fn), ['saas_usage_commit', 'saas_usage_release']);
  await ent.commitEntitled(sb, { ok: true, funding: 'LEGACY_CREDITS', feature: 'VERIFY', userId: 'u', key: 'k' });
  await ent.releaseEntitled(sb, { ok: true, funding: 'LEGACY_CREDITS', feature: 'VERIFY', userId: 'u', key: 'k' }, 'x');
  assert.equal(sb.calls.length, 2, 'legacy uses settle through the wallet, not the ledger');
});

test('every notice type the SQL emits has copy and a deep link', () => {
  const sql = read('supabase/migrations/20261207100000_saas_subscriptions_core.sql');
  const emitted = new Set([...sql.matchAll(/'(SUBSCRIPTION_[A-Z_]+|PAYMENT_FAILED|TRIAL_USED)'\)/g)].map((m) => m[1]));
  for (const t of ['SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_ENDED', 'SUBSCRIPTION_PAYMENT_DUE', 'PAYMENT_FAILED', 'TRIAL_USED']) {
    assert.ok(emitted.has(t), `${t} emitted`);
    assert.match(sql, new RegExp(`add value if not exists '${t}'`));
    const n = notice.subscriptionNotice({ id: 'e', user_id: 'u', notify_type: t, event_type: 'X', plan_code: 'VIP', payload: {} });
    assert.ok(n?.title && n.deepLink?.startsWith('/'), t);
  }
});

test('source facts: the owner rules are in the code', () => {
  const core = read('supabase/migrations/20261207100000_saas_subscriptions_core.sql');
  // Sandbox never grants a production subscription; only a superuser-set database switch allows it.
  assert.match(core, /p_provider = 'SANDBOX' and coalesce\(current_setting\('homatch\.saas_sandbox_grants', true\), ''\) <> 'on'/);
  assert.match(core, /'saas_default_payment_provider', '"NONE"'/);
  assert.doesNotMatch(core, /not in \('SANDBOX', 'BOG', 'TBC'\) then raise exception 'INVALID_VALUE'/);
  // Plans and allowances are rows, priced in GEL tetri, VAT inclusive.
  assert.match(core, /\('STANDARD', 'Standard', 990, 10, 1\)/);
  assert.match(core, /\('VIP', 'VIP', 2900, 20, 2\)/);
  assert.match(core, /\('UNLIMITED', 'Unlimited', 9900, 30, 3\)/);
  assert.match(core, /\('STANDARD', 'VERIFY', true, 5, false\)/);
  assert.match(core, /\('VIP', 'CONTRACT_ANALYSIS', true, 30, false\)/);
  // Admin edits are audited with old and new.
  for (const fn of ['admin_saas_set_plan', 'admin_saas_set_entitlement', 'admin_saas_set_trial', 'admin_saas_set_setting', 'admin_saas_support']) {
    const body = core.slice(core.indexOf(`function public.${fn}(`));
    assert.match(body.slice(0, body.indexOf('end $$')), /saas_audit\(|saas_require_reason/, fn);
  }
  const checkout = read('supabase/functions/saas-checkout/index.ts');
  assert.match(checkout, /SANDBOX_ADMIN_ONLY/);
  assert.match(checkout, /PAYMENTS_NOT_CONNECTED/);
  assert.doesNotMatch(checkout, /amountTetri:\s*body/, 'the price never comes from the request');
  const wiring = read('supabase/migrations/20261207100100_saas_entitlement_wiring.sql');
  assert.match(wiring, /rename to verify_billing_open_wallet/);
  assert.match(wiring, /v_free := public\.saas_user_has_feature\(p_user_id, 'INTERNAL_UNLOCK_FREE'\)/);
  assert.match(wiring, /raise exception 'SUBSCRIPTION_REQUIRED'/);
  // Contract Analysis: no more "1 free a month for everyone".
  for (const f of ['deal-room-document-analyze', 'developer-document-extract']) {
    const src = read(`supabase/functions/${f}/index.ts`);
    assert.match(src, /beginEntitled\(svc, \{/, f);
    assert.match(src, /feature: 'CONTRACT_ANALYSIS'/, f);
    assert.match(src, /allowIncluded: false/, f);
  }
  const topup = read('supabase/functions/credits-topup/index.ts');
  assert.match(topup, /CREDIT_SALES_CLOSED/);
  assert.match(read('supabase/config.toml'), /\[functions\.saas-payments-webhook\]\r?\nverify_jwt = false/);
  assert.match(read('.github/workflows/deploy.yml'), /"saas-payments-webhook"/);
});
