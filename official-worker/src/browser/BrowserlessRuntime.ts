import { chromium } from 'playwright';

const DIRECT_TOKEN = String(process.env.BROWSERLESS_TOKEN || '').trim();
const ENDPOINT = String(
  process.env.BROWSERLESS_WS_ENDPOINT ||
  'wss://production-sfo.browserless.io/chromium/stealth'
).trim();

const BRIDGE_URL = String(
  process.env.BROWSERLESS_TOKEN_BRIDGE_URL || ''
).trim();

const BRIDGE_KEY = String(
  process.env.BROWSERLESS_TOKEN_BRIDGE_KEY || ''
).trim();

async function browserlessToken(): Promise<string> {
  if (DIRECT_TOKEN) return DIRECT_TOKEN;

  if (!BRIDGE_URL || !BRIDGE_KEY) {
    throw new Error('remote browser bridge is not configured');
  }

  const response = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BRIDGE_KEY}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `remote browser bridge unavailable (${response.status})`
    );
  }

  const body = (await response.json()) as any;
  const token = String(body?.token || '').trim();

  if (!token) {
    throw new Error('remote browser credential unavailable');
  }

  return token;
}

export function browserlessConfigured(): boolean {
  return !!DIRECT_TOKEN || (!!BRIDGE_URL && !!BRIDGE_KEY);
}

export async function launchResearchBrowser(): Promise<any> {
  /*
   * Production must fail closed if bridge configuration exists but
   * Browserless cannot be reached. We must NOT silently switch a production
   * Verify job to a different local browser/session.
   *
   * Local Chromium remains available only when no Browserless configuration
   * exists at all (developer/local environment).
   */
  if (!browserlessConfigured()) {
    return chromium.launch({
      headless: false,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
  }

  const token = await browserlessToken();
  const sep = ENDPOINT.includes('?') ? '&' : '?';

  const browser = await chromium.connectOverCDP(
    `${ENDPOINT}${sep}token=${encodeURIComponent(token)}`,
    { timeout: 30000 }
  );

  (browser as any).__homatchBrowserless = true;
  return browser;
}

export async function researchContext(browser: any): Promise<any> {
  if ((browser as any).__homatchBrowserless) {
    const existing = browser.contexts?.() || [];

    if (!existing[0]) {
      throw new Error('Browserless CDP session has no default browser context');
    }

    return existing[0];
  }

  return browser.newContext({
    locale: 'ka-GE',
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
}

export async function createHumanLiveURL(
  page: any,
  timeoutMs = 12 * 60 * 1000
): Promise<{ liveURL: string; liveURLId: string | null }> {
  if (!(page?.context?.())) {
    throw new Error('remote live browser session is unavailable');
  }

  const ctx = page.context();
  const cdp = await ctx.newCDPSession(page);

  try {
    const result: any = await cdp.send('Browserless.liveURL', {
      timeout: timeoutMs,
      interactable: true,
      resizable: true,
      showBrowserInterface: false,
      quality: 75,
      type: 'jpeg',
      compressed: true,
      emulateComponents: true,
    });

    if (result?.error || !result?.liveURL) {
      throw new Error(result?.error || 'live browser URL unavailable');
    }

    return {
      liveURL: result.liveURL,
      liveURLId: result.liveURLId || null,
    };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

export async function closeHumanLiveURL(
  page: any,
  liveURLId: string | null | undefined
): Promise<void> {
  if (!liveURLId) return;

  let cdp: any = null;

  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Browserless.closeLiveURL', { liveURLId });
  } catch {
    // Best-effort cleanup only.
  } finally {
    await cdp?.detach?.().catch(() => {});
  }
}
