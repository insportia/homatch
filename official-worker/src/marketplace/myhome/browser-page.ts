import { chromium } from 'playwright';
import { URL } from 'node:url';

// Ordinary Chromium, only for public MyHome pages when explicitly selected.
// No stealth settings, proxies, challenge interactions or CAPTCHA solving.
// A non-success navigation remains a non-success response for publicPage().
export function createPublicBrowserReader(launch: typeof chromium.launch = options => chromium.launch(options)) {
  let session: Promise<any> | undefined, elapsed = 0;
  async function context() {
    session ??= launch({headless:false,timeout:20000}).then(async browser => {
      try { return {browser,context:await browser.newContext()}; }
      catch (error) { await browser.close(); throw error; }
    });
    return (await session).context;
  }
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : 'url' in input ? input.url : input.href);
    if (url.origin !== 'https://www.myhome.ge' || !url.pathname.startsWith('/udzravi-qoneba/') || init?.method && init.method !== 'GET') throw new Error('Unexpected public browser request');
    init?.signal?.throwIfAborted();
    const started = Date.now();
    let page: any;
    const abort = () => { if (page) void page.close().catch(() => {}); };
    init?.signal?.addEventListener('abort', abort, {once:true});
    try {
      page = await (await context()).newPage();
      init?.signal?.throwIfAborted();
      const response = await page.goto(url.href, {waitUntil:'domcontentloaded',timeout:20000});
      if (!response || new URL(page.url()).origin !== url.origin) throw new Error('Unexpected public browser navigation');
      const headers = await response.allHeaders();
      return new Response(await page.content(), {status:response.status(),headers:{
        'content-type':headers['content-type'] ?? 'text/html',
        'server':headers.server ?? '',
        'cf-mitigated':headers['cf-mitigated'] ?? '',
      }});
    } finally {
      init?.signal?.removeEventListener('abort', abort);
      if (page) await page.close().catch(() => {});
      elapsed += Date.now() - started;
    }
  };
  return {fetcher,browserMs:()=>elapsed,close:async()=>{
    if (session) await session.then(s=>s.browser.close()).catch(()=>{});
  }};
}
