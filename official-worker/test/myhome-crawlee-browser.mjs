import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCrawleeBrowserReader } from '../.tstest-build/marketplace/myhome/crawlee-page.js';
import { publicPage } from '../.tstest-build/marketplace/myhome/public-page.js';
import { MyHomeEngine } from '../.tstest-build/marketplace/myhome/engine.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/myhome-public-next.json', import.meta.url), 'utf8'));
const html = data => '<!doctype html><html><script id="__NEXT_DATA__" type="application/json">'+JSON.stringify(data)+'</script></html>';
function reader(respond) {
  const navigations = [];
  const transport = createCrawleeBrowserReader({ headless: true, beforeNavigation: async page => {
    // Every request is fulfilled locally. This test must never acquire live data.
    await page.route('**/*', async route => {
      navigations.push(route.request().url());
      await route.fulfill(respond(route.request().url()));
    });
  } });
  return { transport, navigations };
}

test('real Crawlee/Chromium preserves Next search/detail identity, photos and repeated requests', {timeout: 90000}, async () => {
  const {transport, navigations} = reader(url => ({status:200,contentType:'text/html',body:html(url === fixture.detailUrl ? fixture.detail : fixture.search)}));
  const start = performance.now();
  try {
    const a = await publicPage(fixture.searchUrl, transport.fetcher);
    assert.equal(a.payload.data.data[0].id,25610778);
    const b = await publicPage(fixture.detailUrl, transport.fetcher, '25610778');
    assert.equal(b.payload.data.statement.id,25610778);
    assert.equal(b.payload.data.statement.price['2'].price_total,165000);
    assert.equal(b.payload.data.statement.area,101);
    assert.ok(b.payload.data.statement.images.length > 1);
    const c = await publicPage(fixture.searchUrl, transport.fetcher);
    assert.equal(c.payload.data.data[0].id,25610778, 'a repeated request is not silently lost to queue deduplication');
    assert.equal(navigations.length,3);
    assert.ok(transport.browserMs() > 0);
    console.log(JSON.stringify({benchmark:'LOCAL_FIXTURE_ONLY',requests:3,elapsedMs:Math.round(performance.now()-start),rssBytes:process.memoryUsage().rss}));
  } finally { await transport.close(); }
});

test('403 stops Crawlee and durable engine before a second navigation; no retry or escalation', {timeout:60000}, async () => {
  const {transport,navigations} = reader(() => ({status:403,headers:{'cf-mitigated':'challenge',server:'cloudflare'},contentType:'text/html',body:'<html>cf_chl_PRIVATE_TOKEN</html>'}));
  let blocked = false;
  const engine = new MyHomeEngine();
  engine.configure({restricted:async()=>blocked,restrict:async()=>{blocked=true;}});
  try {
    await engine.ready();
    await assert.rejects(engine.guard(()=>publicPage(fixture.searchUrl,transport.fetcher)), error => {
      assert.equal(error.status,403); assert.match(error.message,/CHALLENGE_REQUIRED/);
      assert.ok(!error.message.includes('PRIVATE_TOKEN')); return true;
    });
    assert.equal(blocked,true);
    await assert.rejects(transport.fetcher(fixture.detailUrl),/ACCESS_RESTRICTED/);
    const restarted = new MyHomeEngine(); restarted.configure({restricted:async()=>blocked,restrict:async()=>{}});
    await assert.rejects(restarted.ready(),/ACCESS_RESTRICTED/);
    assert.equal(navigations.length,1);
  } finally { await transport.close(); }
});

test('Crawlee exposes transient responses without retrying them and rejects non-public requests', {timeout:60000}, async () => {
  const {transport,navigations} = reader(()=>({status:503,contentType:'text/html',body:'unavailable'}));
  try {
    const response = await transport.fetcher(fixture.searchUrl);
    assert.equal(response.status,503);
    await assert.rejects(transport.fetcher('https://example.com/'),/Unexpected public/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(transport.fetcher(fixture.searchUrl,{signal:controller.signal}));
    assert.equal(navigations.length,1);
  } finally { await transport.close(); }
});
