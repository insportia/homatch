// Lead delivery: Meta → webhook → HOMATCH → the right customer and campaign,
// exactly once. And the signature: no secret, no verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const env = { META_APP_ID: 'app', META_APP_SECRET: 'shh' };
globalThis.Deno = { env: { get: (k) => env[k] } };
const { ingestLead } = await import('../../_shared/metaLeads.ts');
const { verifyWebhookSignature, signOAuthState, verifyOAuthState } = await import('../../_shared/metaAds.ts');

function db(seed) {
  const t = structuredClone(seed);
  const from = (name) => {
    const f = [];
    const api = {
      select() { return api; },
      eq(c, v) { f.push((r) => r[c] === v); return api; },
      async maybeSingle() {
        const hit = (t[name] ?? []).filter((r) => f.every((x) => x(r)))[0] ?? null;
        if (hit && name === 'meta_ad_entities') return { data: { ...hit, meta_campaigns: { user_id: (t.meta_campaigns ?? []).find((c) => c.id === hit.campaign_id)?.user_id } } };
        return { data: hit };
      },
      then(res) { return Promise.resolve({ data: (t[name] ?? []).filter((r) => f.every((x) => x(r))) }).then(res); },
      async insert(row) {
        if (name === 'meta_leads' && (t.meta_leads ?? []).some((l) => l.user_id === row.user_id && l.external_lead_id === row.external_lead_id)) {
          return { error: { message: 'duplicate key value violates unique constraint' } };
        }
        (t[name] ??= []).push(row);
        return { error: null };
      },
    };
    return api;
  };
  return { from, t, rpc: async () => ({}) };
}

const base = () => ({
  meta_assets: [{ user_id: 'u1', kind: 'PAGE', external_id: 'page1' }],
  meta_campaigns: [{ id: 'c1', user_id: 'u1' }],
  meta_ad_entities: [{ campaign_id: 'c1', kind: 'AD', external_id: 'ad9' }],
  meta_connections: [{ id: 'conn1', user_id: 'u1', status: 'CONNECTED' }],
  meta_tokens: [{ connection_id: 'conn1', access_token: 'EAAx' }],
  meta_leads: [],
});

test('a lead reaches the campaign owner through the ad, with its fields, once', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ field_data: [{ name: 'full_name', values: ['Nino'] }, { name: 'phone_number', values: ['+995555000000'] }] }), { status: 200 });
  const d = db(base());
  const first = await ingestLead(d, { leadgen_id: 'L1', page_id: 'page1', ad_id: 'ad9', form_id: 'form1' });
  assert.deepEqual(first, { inserted: true, note: null });
  assert.equal(d.t.meta_leads[0].campaign_id, 'c1');
  assert.equal(d.t.meta_leads[0].fields.full_name, 'Nino');
  const again = await ingestLead(d, { leadgen_id: 'L1', page_id: 'page1', ad_id: 'ad9' });
  assert.deepEqual(again, { inserted: false, note: 'DUPLICATE_LEAD' });
  assert.equal(d.t.meta_leads.length, 1);
});

test('two customers on one Page with no ad to decide is never guessed', async () => {
  const seed = base();
  seed.meta_assets.push({ user_id: 'u2', kind: 'PAGE', external_id: 'page1' });
  await assert.rejects(ingestLead(db(seed), { leadgen_id: 'L2', page_id: 'page1' }), /PAGE_OWNER_AMBIGUOUS/);
  await assert.rejects(ingestLead(db(base()), { leadgen_id: 'L3', page_id: 'unknown' }), /PAGE_OWNER_UNKNOWN/);
});

test('webhook signatures: valid passes, tampered fails, and no secret means no verification', async () => {
  const raw = JSON.stringify({ object: 'page', entry: [] });
  const sig = `sha256=${createHmac('sha256', 'shh').update(raw).digest('hex')}`;
  assert.equal(await verifyWebhookSignature(raw, sig), true);
  assert.equal(await verifyWebhookSignature(`${raw} `, sig), false);
  assert.equal(await verifyWebhookSignature(raw, null), false);
  env.META_APP_SECRET = '';
  const emptyKeySig = `sha256=${createHmac('sha256', '').update(raw).digest('hex')}`;
  assert.equal(await verifyWebhookSignature(raw, emptyKeySig), false, 'an empty key is not a key');
  env.META_APP_SECRET = 'shh';
});

test('OAuth state is signed, bound and expiring', async () => {
  const state = await signOAuthState({ uid: 'u1', nonce: 'n1' });
  assert.deepEqual(await verifyOAuthState(state), { uid: 'u1', nonce: 'n1', ret: null });
  const [body, mac] = state.split('.');
  const forged = `${Buffer.from(JSON.stringify({ uid: 'u2', nonce: 'n1', exp: Date.now() + 1e6 })).toString('base64url')}.${mac}`;
  assert.equal(await verifyOAuthState(forged), null, 'a different user cannot reuse the signature');
  assert.equal(await verifyOAuthState(`${body}.00`), null);
  const expired = Buffer.from(JSON.stringify({ uid: 'u1', nonce: 'n1', exp: Date.now() - 1 })).toString('base64url');
  const expiredMac = createHmac('sha256', 'shh').update(expired).digest('hex');
  assert.equal(await verifyOAuthState(`${expired}.${expiredMac}`), null, 'expired state is refused');
});
