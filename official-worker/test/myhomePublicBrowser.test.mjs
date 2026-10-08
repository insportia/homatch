import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicBrowserReader} from '../.tstest-build/marketplace/myhome/browser-page.js';
import {publicPage} from '../.tstest-build/marketplace/myhome/public-page.js';

function fixture({status=200,body=null,deny=false}={}) {
  const data=JSON.parse(readFileSync(new URL('./fixtures/myhome-public-next.json',import.meta.url),'utf8'));
  const calls={launch:[],context:0,goto:[],closedPages:0,closedBrowsers:0};
  let current='';
  const page={url:()=>current,close:async()=>{calls.closedPages++},
    content:async()=>body??'<script id="__NEXT_DATA__">'+JSON.stringify(data.search)+'</script>',
    goto:async(url,options)=>{calls.goto.push({url,options});current=url;return {status:()=>status,allHeaders:async()=>deny?{'server':'cloudflare','cf-mitigated':'challenge'}:{'content-type':'text/html'}}}};
  const reader=createPublicBrowserReader(async options=>{calls.launch.push(options);return {
    newContext:async(...args)=>{assert.equal(args.length,0);calls.context++;return {newPage:async()=>page}},
    close:async()=>{calls.closedBrowsers++}
  }});
  return {reader,calls,data};
}
test('ordinary browser uses no stealth, proxy, credentials or challenge interaction and preserves public Next validation',async()=>{
  const f=fixture();
  try {
    const r=await publicPage(f.data.searchUrl,f.reader.fetcher);
    assert.equal(r.payload.data.data[0].id,25610778);
    assert.deepEqual(f.calls.launch,[{headless:false,timeout:20000}]);
    assert.equal(f.calls.context,1);assert.equal(f.calls.goto.length,1);
    assert.equal(f.calls.closedPages,1);assert.ok(f.reader.browserMs()>=0);
  } finally {await f.reader.close()}
  assert.equal(f.calls.closedBrowsers,1);
});
test('browser denial remains BLOCKED evidence; no retry, challenge solve or data fabrication',async()=>{
  const f=fixture({status:403,body:'<script>cf_chl_SECRET_CHALLENGE_TOKEN</script>',deny:true});
  try {await assert.rejects(publicPage(f.data.searchUrl,f.reader.fetcher),error=>{
    assert.equal(error.status,403);assert.match(error.message,/CHALLENGE_REQUIRED/);
    assert.ok(!error.message.includes('SECRET_CHALLENGE_TOKEN'));return true;
  });assert.equal(f.calls.goto.length,1)}finally{await f.reader.close()}
  assert.equal(f.calls.closedPages,1);assert.equal(f.calls.closedBrowsers,1);
});
test('an aborted or non-public browser request never launches Chromium',async()=>{
  const f=fixture();const controller=new AbortController();controller.abort();
  await assert.rejects(f.reader.fetcher(f.data.searchUrl,{signal:controller.signal}));
  await assert.rejects(f.reader.fetcher('https://example.com/'),/Unexpected public/);
  await f.reader.close();assert.equal(f.calls.launch.length,0);
});
