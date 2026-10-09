// FIND BUYERS — Telegram source discovery as the first campaign stage.
//
// Drives the real discoverTelegramSources (community-sync/sourceDiscovery.ts)
// with a fake Telegram client and an in-memory community_targets table:
// every query language is recorded, a Tbilisi campaign audits Tbilisi and
// country-wide communities (never Batumi ones), a verified community is read
// in the same call ONLY when Admin allows automatic activation, and the
// scheduled (non-campaign) path keeps its old behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('https://esm.sh/') || spec.startsWith('jsr:')) {
      return { url: 'data:text/javascript,export const createClient = () => { throw new Error("no network in tests"); };', shortCircuit: true };
    }
    return next(spec, ctx);
  }`));

globalThis.Deno = { env: { get: () => undefined } };
const { discoverTelegramSources } = await import('../../community-sync/sourceDiscovery.ts');

const NOW_S = Math.floor(Date.now() / 1000);
const active = (texts) => texts.map((text, i) => ({ text, date: NOW_S - i * 3600 }));
const PROPERTY_POSTS = active([
  'Ищу квартиру в Тбилиси, 2 комнаты, Ваке', 'Продаётся квартира 80 м²', 'Сдаётся квартира в Сабуртало',
  'Куплю квартиру до 150000$', 'Новостройка, квартира 3 комнаты', 'Аренда квартиры на длительный срок',
]);

function fakeDb(rows) {
  const targets = rows.map((r, i) => ({ id: `t${i}`, platform: 'TELEGRAM', lifecycle: 'DISCOVERED', created_at: new Date(Date.now() - i * 1000).toISOString(), metadata: {}, ...r }));
  const log = { updates: [], upserts: [] };
  function from(name) {
    const st = { filters: [], op: 'select', payload: null, limit: null };
    const run = async () => {
      if (name !== 'community_targets') return { data: name === 'source_registry' ? { id: 'src' } : [], error: null };
      if (st.op === 'upsert') {
        const fresh = !targets.some((t) => t.external_id === st.payload.external_id);
        if (fresh) targets.push({ id: `n${targets.length}`, created_at: new Date().toISOString(), ...st.payload });
        log.upserts.push(st.payload);
        return { data: fresh ? [{ id: 'x' }] : [], error: null };
      }
      const hit = targets.filter((t) => st.filters.every(([c, v]) => t[c] === v));
      if (st.op === 'update') { for (const t of hit) Object.assign(t, st.payload); log.updates.push({ ids: hit.map((t) => t.external_id), patch: st.payload }); return { data: null, error: null }; }
      return { data: st.limit ? hit.slice(0, st.limit) : hit, error: null };
    };
    const b = {
      select() { return b; }, order() { return b; }, is() { return b; }, maybeSingle() { st.single = true; return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      limit(n) { st.limit = n; return b; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      then(ok, bad) { return run().then((r) => (st.single && Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r)).then(ok, bad); },
    };
    return b;
  }
  return { db: { from }, targets, log };
}

function fakeClient(searchResults, history) {
  const searched = [];
  return {
    mode: 'MTPROTO_USER', capabilities: { searchPublicChats: true },
    searched,
    async searchPublicChats(query) { searched.push(query); return searchResults[query] ?? []; },
    async readHistory(handle) { return { items: history[handle] ?? [] }; },
  };
}

const SETTINGS = (autoEnable) => ({ freshness: { activeMaxDays: 30, hardMaxDays: 30 }, telegramMinRelevance: 0.3, telegramAutoEnableSources: autoEnable });
const chat = (username, title) => ({ id: username, username, title, kind: 'CHANNEL', participants: 1000 });

test('a Tbilisi campaign records every query language and audits Tbilisi + country-wide communities, never Batumi', async () => {
  const { db, targets } = fakeDb([
    { external_id: 'batumi_re', name: 'Недвижимость Батуми' },
    { external_id: 'tbilisi_arenda2025', name: 'Аренда Квартир Тбилиси' },
    { external_id: 'georgia_realestate', name: 'Грузия недвижимость' },
  ]);
  const client = fakeClient({ 'недвижимость тбилиси': [chat('crescotbilisi', 'Квартиры в Тбилиси')] }, {
    tbilisi_arenda2025: PROPERTY_POSTS, georgia_realestate: PROPERTY_POSTS, crescotbilisi: PROPERTY_POSTS, batumi_re: PROPERTY_POSTS,
  });
  const report = await discoverTelegramSources(db, client, SETTINGS(false), {
    queries: ['ბინების ყიდვა თბილისი', 'apartments for sale tbilisi', 'недвижимость тбилиси', 'شقق للبيع تبليسي', 'דירות למכירה טביליסי', 'satılık daire tiflis'],
    queryLanguages: ['ka', 'en', 'ru', 'ar', 'he', 'tr'], maxQueries: 12, city: 'თბილისი', campaign: true,
    readTarget: async () => { throw new Error('must not read: auto-enable is off'); },
  });
  assert.deepEqual([...report.languagesSearched].sort(), ['ar', 'en', 'he', 'ka', 'ru', 'tr']);
  assert.equal(client.searched.length, 6);
  const found = targets.find((t) => t.external_id === 'crescotbilisi');
  assert.deepEqual(found.languages, ['ru'], 'the query language is stored on the community');
  assert.deepEqual(found.metadata.cities, ['TBILISI']);
  const audited = report.audits.map((a) => a.target).sort();
  assert.deepEqual(audited, ['crescotbilisi', 'georgia_realestate', 'tbilisi_arenda2025']);
  assert.equal(targets.find((t) => t.external_id === 'batumi_re').lifecycle, 'DISCOVERED', 'Batumi is not audited on a Tbilisi campaign');
  assert.equal(report.activated, 0);
  assert.equal(report.readNow, 0);
  assert.ok(targets.filter((t) => audited.includes(t.external_id)).every((t) => t.lifecycle === 'AUDITED' && t.discovery_enabled === false),
    'verified, but switched on only by Admin\'s auto-enable');
});

test('with automatic activation on, the campaign reads what it verified — in the same call', async () => {
  const { db, targets } = fakeDb([{ external_id: 'tbilisi_arenda2025', name: 'Аренда Квартир Тбилиси' }]);
  const client = fakeClient({}, { tbilisi_arenda2025: PROPERTY_POSTS });
  const read = [];
  const report = await discoverTelegramSources(db, client, SETTINGS(true), {
    queries: ['недвижимость тбилиси'], queryLanguages: ['ru'], maxQueries: 12, city: 'Tbilisi', campaign: true,
    readTarget: async (id) => { read.push(id); return { target: id, outcome: 'OK' }; },
  });
  assert.equal(report.activated, 1);
  assert.equal(report.readNow, 1);
  assert.deepEqual(read, [targets[0].id]);
  assert.equal(targets[0].discovery_enabled, true);
});

test('a community that does not qualify is never activated or read', async () => {
  const { db, targets } = fakeDb([{ external_id: 'tbilisi_chat', name: 'Тбилиси чат' }]);
  const client = fakeClient({}, { tbilisi_chat: active(['Привет всем', 'Хорошая погода']) });
  const read = [];
  const report = await discoverTelegramSources(db, client, SETTINGS(true), {
    queries: ['тбилиси'], maxQueries: 12, city: 'Tbilisi', campaign: true, readTarget: async (id) => { read.push(id); return { outcome: 'OK' }; },
  });
  assert.equal(targets[0].lifecycle, 'LOW_SIGNAL');
  assert.equal(report.activated, 0);
  assert.deepEqual(read, []);
});

test('the scheduled path (not a campaign) is unchanged: newest backlog, no city filter, no read', async () => {
  const { db } = fakeDb([{ external_id: 'batumi_re', name: 'Недвижимость Батуми' }]);
  const client = fakeClient({}, { batumi_re: PROPERTY_POSTS });
  const report = await discoverTelegramSources(db, client, SETTINGS(true), { queries: ['x'], maxQueries: 6 });
  assert.deepEqual(report.audits.map((a) => a.target), ['batumi_re']);
  assert.equal(report.readNow, 0);
});

/* The campaign job wrapper (campaignSources.executeSourceJob): what it sends and how it reads the answer. */
const sent = [];
let answer = {};
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
};
const { executeSourceJob } = await import('../campaignSources.ts');
const discoveryJob = (direction, extra = {}) => ({
  id: 'q1', provider: 'TELEGRAM_SOURCES', matching_job_id: 'job-1',
  metadata: { direction, queries: Array.from({ length: 33 }, (_, i) => `q${i}`), queryLanguages: Array.from({ length: 33 }, (_, i) => ['ka', 'ru', 'en', 'ar', 'he', 'tr'][i % 6]), ...extra },
});

test('Find Buyers discovery job: twelve searches, the city, the languages and DEMAND are sent', async () => {
  sent.length = 0;
  answer = { success: true, newlyRegistered: 2, communitiesFound: 9, languagesSearched: ['ka', 'ru', 'en', 'ar', 'he', 'tr'], audits: [{ qualifies: true }, { qualifies: false }], activated: 1, readNow: 1, messagesRead: 40 };
  const out = await executeSourceJob('https://x', 'k', discoveryJob('DEMAND', { city: 'თბილისი', transaction: 'SALE' }));
  const body = sent[0].body;
  assert.equal(body.action, 'discover');
  assert.equal(body.direction, 'DEMAND');
  assert.equal(body.maxQueries, 12);
  assert.equal(body.city, 'თბილისი');
  assert.equal(body.queryLanguages.length, body.queries.length);
  assert.equal(out.outcome, 'DONE');
  assert.deepEqual({ audited: out.metadata.audited, verified: out.metadata.verified, activated: out.metadata.activated, readNow: out.metadata.readNow }, { audited: 2, verified: 1, activated: 1, readNow: 1 });
  sent.length = 0;
  await executeSourceJob('https://x', 'k', discoveryJob('SUPPLY'));
  assert.equal(sent[0].body.maxQueries, 6, 'Find Property keeps six');
});

test('a Telegram stop during discovery is a retry or a failure, never a finished search', async () => {
  answer = { success: true, stoppedBy: { kind: 'RATE_LIMITED', retryAfterSeconds: 900 } };
  let out = await executeSourceJob('https://x', 'k', discoveryJob('DEMAND'));
  assert.equal(out.outcome, 'RETRY');
  assert.equal(out.retrySeconds, 900);
  answer = { success: true, stoppedBy: { kind: 'AUTH_FAILED', retryAfterSeconds: null } };
  out = await executeSourceJob('https://x', 'k', discoveryJob('DEMAND'));
  assert.equal(out.outcome, 'FAILED');
  assert.match(String(out.error), /TELEGRAM_AUTH_FAILED/);
});

test('the campaign read job sends the property city', async () => {
  sent.length = 0;
  answer = { success: true, totals: { newMessages: 3, changedMessages: 0 }, targetsConsidered: 2, synced: 2 };
  await executeSourceJob('https://x', 'k', { id: 'q2', provider: 'TELEGRAM', matching_job_id: 'job-1', metadata: { city: 'Tbilisi' } });
  assert.equal(sent[0].body.action, 'sync');
  assert.equal(sent[0].body.city, 'Tbilisi');
});
