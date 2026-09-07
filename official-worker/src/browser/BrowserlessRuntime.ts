import { chromium } from 'playwright';

const TOKEN = String(process.env.BROWSERLESS_TOKEN || '').trim();
const ENDPOINT = String(process.env.BROWSERLESS_WS_ENDPOINT || 'wss://production-sfo.browserless.io').trim();

export function browserlessConfigured(): boolean { return !!TOKEN; }

export async function launchResearchBrowser(): Promise<any> {
  if (!TOKEN) {
    return chromium.launch({ headless: false, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
  }
  const sep = ENDPOINT.includes('?') ? '&' : '?';
  const browser = await chromium.connectOverCDP(`${ENDPOINT}${sep}token=${encodeURIComponent(TOKEN)}`);
  (browser as any).__homatchBrowserless = true;
  return browser;
}

export async function researchContext(browser: any): Promise<any> {
  if ((browser as any).__homatchBrowserless) {
    const existing = browser.contexts?.() || [];
    if (existing[0]) return existing[0];
  }
  return browser.newContext({ locale: 'ka-GE', acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
}

export async function createHumanLiveURL(page: any, timeoutMs = 12 * 60 * 1000): Promise<{liveURL:string;liveURLId:string|null}> {
  if (!TOKEN) throw new Error('remote live browser is not configured');
  const ctx = page.context();
  const cdp = await ctx.newCDPSession(page);
  const r:any = await cdp.send('Browserless.liveURL', {
    timeout: timeoutMs,
    interactable: true,
    resizable: true,
    showBrowserInterface: false,
    quality: 75,
    type: 'jpeg',
    compressed: true,
    emulateComponents: true,
  });
  if (r?.error || !r?.liveURL) throw new Error(r?.error || 'live browser URL unavailable');
  return { liveURL: r.liveURL, liveURLId: r.liveURLId || null };
}

export async function closeHumanLiveURL(page:any, liveURLId:string|null|undefined):Promise<void>{
  if (!liveURLId) return;
  try { const cdp=await page.context().newCDPSession(page); await cdp.send('Browserless.closeLiveURL',{liveURLId}); } catch {}
}
