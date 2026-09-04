import express from 'express';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json({ limit: '1mb' }));
const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ptxajsjhobhvsfhmutjn.supabase.co';
// Publishable keys are intentionally safe for public/server use; authorization still requires a real user JWT.
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_YNDd9JGcTLPpcbKxjqstFg_XH3ECIJm';
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const jobs = new Map();
const sessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000;

const SOURCES = {
  tas: { name: 'TAS', class: 'OFFICIAL_GOVERNMENT', url: 'https://tas.ge/?p=searchdocument&menuItemId=7104', modes: ['cadastral'] },
  msmap: { name: 'MS Cadastral Map', class: 'OFFICIAL_GOVERNMENT', url: 'https://ms.gov.ge/msmap/', modes: ['cadastral', 'property'] },
  mygov: { name: 'MY.GOV.GE Property Service', class: 'OFFICIAL_GOVERNMENT', url: 'https://www.my.gov.ge/ka-ge/services/5/service/176', modes: ['cadastral'] },
  enreg: { name: 'Entrepreneur Registry', class: 'OFFICIAL_REGISTRY', url: 'https://enreg.reestri.gov.ge/main.php?m=new_index', modes: ['property'] },
  napr: { name: 'NAPR', class: 'OFFICIAL_REGISTRY', url: 'https://napr.gov.ge/', modes: ['cadastral', 'property'] },
};

const now = () => new Date().toISOString();
const safeText = async (page, limit = 60000) => { try { return (await page.locator('body').innerText({ timeout: 10000 })).slice(0, limit); } catch { return ''; } };
const safeLinks = async page => { try { return await page.locator('a[href]').evaluateAll(as => as.slice(0, 200).map(a => ({ label: (a.textContent || '').trim().slice(0, 240), url: a.href })).filter(x => /^https?:/i.test(x.url))); } catch { return []; } };
const normalizeCad = v => String(v || '').trim().replace(/\s+/g, '');

async function auth(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'authentication required' });
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'invalid user session' });
  req.user = data.user;
  req.accessToken = token;
  next();
}

async function detectCaptcha(page) {
  const body = (await safeText(page, 12000)).toLowerCase();
  const iframe = await page.locator('iframe[src*="captcha" i],iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i]').count();
  return iframe > 0 || /captcha|recaptcha|hcaptcha|i am not a robot|არ ვარ რობოტი|უსაფრთხოების შემოწმება|security check/.test(body);
}

async function visibleFill(page, selectors, value) {
  for (const s of selectors) {
    const l = page.locator(s).first();
    try { if (await l.count() && await l.isVisible()) { await l.fill(value); return s; } } catch {}
  }
  return null;
}

async function clickByNames(page, names) {
  for (const name of names) {
    for (const role of ['button', 'link']) {
      const l = page.getByRole(role, { name }).first();
      try { if (await l.count() && await l.isVisible()) { await l.click(); return true; } } catch {}
    }
  }
  const submit = page.locator('button[type="submit"],input[type="submit"]').first();
  try { if (await submit.count() && await submit.isVisible()) { await submit.click(); return true; } } catch {}
  return false;
}

async function adapterTas(page, query) {
  const selector = await visibleFill(page, [
    'input[placeholder*="საკადასტრო" i]', 'input[name*="cad" i]', 'input[id*="cad" i]',
    'input[name*="number" i]', 'input[type="text"]'
  ], query);
  if (selector) await clickByNames(page, [/სამსახურის პასუხის მოძებნა/i, /მოძებნა/i, /ძებნა/i, /search/i]);
  return { searched: !!selector, adapter: 'TAS_SEARCH_DOCUMENT' };
}

async function adapterEnreg(page, query) {
  const selector = await visibleFill(page, [
    'input[name*="id" i]', 'input[id*="id" i]', 'input[name*="code" i]',
    'input[name*="name" i]', 'input[id*="name" i]', 'input[type="text"]'
  ], query);
  if (selector) await clickByNames(page, [/ძებნა/i, /მოძებნა/i, /search/i]);
  return { searched: !!selector, adapter: 'ENREG_COMPANY_SEARCH' };
}

async function adapterMap(page, query) {
  const selector = await visibleFill(page, [
    'input[placeholder*="საკადასტრო" i]', 'input[placeholder*="ძებნა" i]', 'input[placeholder*="search" i]',
    'input[name*="cad" i]', 'input[id*="cad" i]', 'input[type="search"]', 'input[type="text"]'
  ], query);
  if (selector) { await page.keyboard.press('Enter').catch(() => {}); await page.waitForTimeout(1500); }
  return { searched: !!selector, adapter: 'MSMAP_SEARCH' };
}

async function adapterMyGov(page, query) {
  const selector = await visibleFill(page, [
    'input[placeholder*="საკადასტრო" i]', 'input[name*="cad" i]', 'input[id*="cad" i]', 'input[type="text"]'
  ], query);
  if (selector) await clickByNames(page, [/ძებნა/i, /მოძებნა/i, /search/i, /შემდეგ/i]);
  return { searched: !!selector, adapter: 'MYGOV_PROPERTY_SEARCH' };
}

async function genericAdapter(page, query) {
  const selector = await visibleFill(page, ['input[type="search"]', 'input[placeholder*="ძებნა" i]', 'input[placeholder*="search" i]', 'input[type="text"]'], query);
  if (selector) { await clickByNames(page, [/ძებნა/i, /მოძებნა/i, /search/i]); }
  return { searched: !!selector, adapter: 'GENERIC_OFFICIAL_SEARCH' };
}

const ADAPTERS = { tas: adapterTas, enreg: adapterEnreg, msmap: adapterMap, mygov: adapterMyGov, napr: genericAdapter };

async function collectResult(page, key, src, action) {
  await page.waitForTimeout(1800);
  const captcha = await detectCaptcha(page);
  const pageText = await safeText(page);
  const links = await safeLinks(page);
  const documentLinks = links.filter(x => /\.pdf(?:$|\?)|download|document|extract|ამონაწერ|გადმოწერ/i.test(`${x.label} ${x.url}`));
  return {
    source: key, sourceName: src.name, sourceClass: src.class, sourceUrl: src.url,
    finalUrl: page.url(), retrievalMethod: action.searched ? 'OFFICIAL_FORM_RESULT' : 'DIRECT_PAGE_RETRIEVED',
    adapter: action.adapter, searched: action.searched, status: captcha ? 'WAITING_HUMAN' : (action.searched ? 'RESULT_RETRIEVED' : 'PAGE_RETRIEVED'),
    captcha, retrievedAt: now(), pageText, links, documentLinks
  };
}

async function researchSource(browser, job, key) {
  const src = SOURCES[key];
  const context = await browser.newContext({ locale: 'ka-GE', acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(src.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1200);
    if (await detectCaptcha(page)) {
      const result = await collectResult(page, key, src, { searched: false, adapter: 'PRE_SEARCH_CAPTCHA' });
      sessions.set(job.id, { browser, context, page, key, source: src, expiresAt: Date.now() + SESSION_TTL_MS });
      return { result, retained: true };
    }
    const action = await (ADAPTERS[key] || genericAdapter)(page, job.query);
    const result = await collectResult(page, key, src, action);
    if (result.captcha) {
      sessions.set(job.id, { browser, context, page, key, source: src, expiresAt: Date.now() + SESSION_TTL_MS });
      return { result, retained: true };
    }
    await context.close();
    return { result, retained: false };
  } catch (e) {
    await context.close().catch(() => {});
    return { result: { source: key, sourceName: src.name, sourceClass: src.class, sourceUrl: src.url, status: 'FAILED', retrievalMethod: 'BROWSER_RETRIEVAL_FAILED', error: String(e), retrievedAt: now(), pageText: '', links: [], documentLinks: [] }, retained: false };
  }
}

async function run(job, startAt = 0, existingBrowser = null) {
  job.status = 'RUNNING'; job.updatedAt = now();
  const keys = job.mode === 'cadastral' ? ['tas', 'msmap', 'mygov', 'napr'] : ['enreg', 'msmap', 'napr'];
  let browser = existingBrowser;
  try {
    if (!browser) browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    for (let i = startAt; i < keys.length; i++) {
      const key = keys[i]; job.stage = `CHECKING_${key.toUpperCase()}`; job.sourceIndex = i;
      const { result, retained } = await researchSource(browser, job, key);
      job.results = job.results.filter(x => x.source !== key); job.results.push(result); job.updatedAt = now();
      if (retained) {
        job.status = 'WAITING_HUMAN'; job.stage = 'CAPTCHA_REQUIRED';
        job.humanVerification = { source: key, url: result.finalUrl || result.sourceUrl, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(), message: 'საჯარო წყაროს უსაფრთხოების შემოწმებაა საჭირო. დაასრულეთ შემოწმება და კვლევა ავტომატურად გაგრძელდება.' };
        return;
      }
    }
    job.status = 'COMPLETE'; job.stage = 'COMPLETE'; job.completedAt = now();
    if (browser) await browser.close().catch(() => {});
  } catch (e) {
    job.status = 'FAILED'; job.stage = 'FAILED'; job.error = String(e);
    if (browser) await browser.close().catch(() => {});
  } finally { job.updatedAt = now(); }
}

setInterval(async () => {
  for (const [id, s] of sessions) if (Date.now() > s.expiresAt) {
    await s.context.close().catch(() => {}); await s.browser.close().catch(() => {}); sessions.delete(id);
    const j = jobs.get(id); if (j?.status === 'WAITING_HUMAN') { j.status = 'FAILED'; j.stage = 'CAPTCHA_SESSION_EXPIRED'; j.error = 'Human verification session expired'; j.updatedAt = now(); }
  }
}, 30000).unref();

app.get('/health', (_req, res) => res.json({ ok: true, service: 'homatch-official-worker', playwright: true, sources: Object.keys(SOURCES), auth: 'supabase-user-jwt' }));

app.post('/research', auth, (req, res) => {
  const mode = req.body?.mode === 'property' ? 'property' : 'cadastral';
  const query = mode === 'cadastral' ? normalizeCad(req.body?.query) : String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'query required' });
  const id = crypto.randomUUID();
  const job = { id, userId: req.user.id, query, mode, status: 'QUEUED', stage: 'QUEUED', sourceIndex: 0, results: [], createdAt: now(), updatedAt: now() };
  jobs.set(id, job); run(job);
  res.status(202).json({ accepted: true, jobId: id, status: job.status });
});

app.get('/research/:id', auth, (req, res) => {
  const j = jobs.get(req.params.id); if (!j || j.userId !== req.user.id) return res.status(404).json({ error: 'not found' }); res.json(j);
});

app.post('/research/:id/resume', auth, async (req, res) => {
  const j = jobs.get(req.params.id); if (!j || j.userId !== req.user.id) return res.status(404).json({ error: 'not found' });
  if (j.status !== 'WAITING_HUMAN') return res.status(409).json({ error: 'job is not waiting for human verification' });
  const s = sessions.get(j.id); if (!s || Date.now() > s.expiresAt) return res.status(410).json({ error: 'captcha session expired' });
  if (await detectCaptcha(s.page)) return res.status(409).json({ error: 'human verification is not complete', job: j });
  const action = { searched: true, adapter: `${String(j.results.find(x => x.source === s.key)?.adapter || 'OFFICIAL')}_RESUMED` };
  const result = await collectResult(s.page, s.key, s.source, action);
  j.results = j.results.filter(x => x.source !== s.key); j.results.push(result); j.humanVerification = null;
  await s.context.close().catch(() => {}); sessions.delete(j.id);
  const browser = s.browser; const nextIndex = j.sourceIndex + 1; run(j, nextIndex, browser);
  res.status(202).json({ accepted: true, jobId: j.id, status: 'RUNNING', stage: j.stage });
});

app.listen(PORT, '0.0.0.0', () => console.log(`homatch-official-worker listening on ${PORT}`));
