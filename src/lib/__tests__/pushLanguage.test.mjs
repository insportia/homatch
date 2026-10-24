// pushLanguage.test.mjs — a push reads in the language the site is open in, and the status-bar icon shows the mark
// (owner 2026-10-24: the phone showed "Your verification is ready" in English and a plain white square).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { pushCopyBlock, BEGIN, END, PUSH_TYPES, LANGS } from '../../../scripts/sw-push-copy.mjs';

const file = (p) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const read = (p) => readFileSync(file(p), 'utf8');
const sw = read('src/serviceWorker/sw.source.js');

test('the worker table is the bundle: regenerate with node scripts/sw-push-copy.mjs', async () => {
  const a = sw.indexOf(BEGIN);
  const b = sw.indexOf(END);
  assert.ok(a >= 0 && b > a);
  assert.equal(sw.slice(a, b + END.length), await pushCopyBlock());
  for (const type of Object.keys(PUSH_TYPES)) assert.match(read('src/components/notifications/presentation.tsx'), new RegExp(`'${type}'`), `${type} is a typed notification in-app too`);
});

/** Runs the worker's push handler against a fake service-worker global. */
async function pushWith(lang, payload) {
  const handlers = {};
  const shown = [];
  const store = new Map(lang ? [['/__homatch/lang', lang]] : []);
  const cache = { match: async (k) => (store.has(k) ? new Response(store.get(k)) : undefined), put: async (k, r) => store.set(k, await r.text()) };
  const self = {
    addEventListener: (t, f) => { handlers[t] = f; },
    registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
    location: { origin: 'https://www.homatch.live' },
    clients: { matchAll: async () => [] },
    skipWaiting() {},
  };
  vm.runInNewContext(sw.replaceAll('__BUILD__', 't'), { self, caches: { open: async () => cache, match: async () => undefined, keys: async () => [], delete: async () => true }, Response, URL, fetch: async () => new Response(''), console });
  let done;
  handlers.push({ data: { json: () => payload }, waitUntil: (p) => { done = p; } });
  await done;
  return { shown, handlers, store };
}

test('a typed push reads in the site language; RTL for Arabic and Hebrew; the badge is the monochrome mark', async () => {
  const p = { type: 'VERIFY_COMPLETE', title: 'Your verification is ready', body: 'The report has finished and is ready to read.', deep_link: '/verify?job=x' };
  const ka = (await pushWith('ka', p)).shown[0];
  assert.equal(ka.title, 'თქვენი შემოწმება მზადაა');
  assert.equal(ka.lang, 'ka');
  assert.equal(ka.badge, '/badge-96.png');
  const ar = (await pushWith('ar', p)).shown[0];
  assert.equal(ar.dir, 'rtl');
  assert.notEqual(ar.title, p.title);
  assert.equal((await pushWith(null, p)).shown[0].title, p.title, 'no language known yet: the server text');
  assert.equal((await pushWith('ka', { ...p, type: 'MESSAGE_RECEIVED', title: 'Nino: hi' })).shown[0].title, 'Nino: hi', 'untyped text is never replaced');
});

test('the page tells the worker its language, and the worker keeps it', async () => {
  const { handlers, store } = await pushWith(null, {});
  let kept;
  handlers.message({ data: { type: 'HOMATCH_LANG', lang: 'he' }, waitUntil: (p) => { kept = p; } });
  await kept;
  assert.equal(store.get('/__homatch/lang'), 'he');
  assert.match(read('src/contexts/LanguageContext.tsx'), /useEffect\(\(\) => \{ tellServiceWorkerLanguage\(lang\); \}, \[lang\]\);/);
  assert.match(read('supabase/functions/push-send/index.ts'), /type: notif\.type,\n\s+title: notif\.title,/);
  assert.equal(LANGS.length, 6);
});

test('the badge is a transparent PNG, not the full-colour app icon', () => {
  const png = readFileSync(file('public/badge-96.png'));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 96);
  assert.equal(png[25], 6, 'colour type 6: RGBA, so Android can read the alpha');
});
