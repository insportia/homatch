// index.ts — Express app entrypoint. This is now a thin HTTP layer over
// ResearchOrchestrator.ts; every endpoint's URL/response SHAPE is kept
// identical to the pre-refactor index.js (mandate Section 27: "preserve
// production API compatibility where practical") so the existing frontend
// and research-agent (Supabase) do not break. What changed is everything
// BEHIND these endpoints — see orchestrator/, workflows/, evidence/,
// entities/, documents/, state/.
import express from 'express';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { ResearchOrchestrator } from './orchestrator/ResearchOrchestrator.js';
import { challenge, scanCandidateInputs, visible } from './browser/BrowserSession.js';

const app = express();
const ALLOWED_ORIGINS = new Set(['https://homatch.live', 'https://www.homatch.live']);
app.use((req: any, res: any, next: any) => {
  const origin = String(req.headers.origin || '');
  if (origin && (ALLOWED_ORIGINS.has(origin) || /^https:\/\/homatch-[a-z0-9-]+-insportia\.vercel\.app$/i.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.WORKER_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';

const orchestrator = new ResearchOrchestrator();
const debugJobs = new Map<string, any>();

async function auth(req: any, res: any, next: any) {
  const h = String(req.headers.authorization || '');
  if (TOKEN && h === `Bearer ${TOKEN}`) return next();
  if (SUPABASE_URL && h.startsWith('Bearer ')) {
    try {
      const k = String(req.headers.apikey || '');
      if (!k) return res.status(401).json({ error: 'apikey required' });
      if ((await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: h, apikey: k } })).ok) return next();
    } catch {
      /* falls through to 401 */
    }
  }
  return res.status(401).json({ error: 'unauthorized' });
}

app.get('/health', (_q: any, r: any) =>
  r.json({
    ok: true,
    service: 'homatch-official-worker',
    version: '2.1.0',
    playwright: true,
    architecture: 'deterministic-fsm-orchestrator-2026-09-05',
    standaloneEntityEnreg: true,
    pdfExtraction: true,
    onlineViewerReading: true,
    documentIntegrity: 'sha256+title+date',
    historicalComparison: true,
    cadastralParentFallback: true,
    entityDiscovery: true,
    navigationStackTraversal: true,
    humanVerificationSkip: true,
    sourceWorkflows: ['msmap:MsMapWorkflow (18-state FSM)', 'tas:TasWorkflow (branch+loop FSM)', 'mygov:MyGovWorkflow (context-gated FSM)', 'enreg:EnregWorkflow (25-state linear FSM)', 'napr/property-enreg:GenericWorkflow (no dedicated FSM — no spec exists for these)'],
    statuses: ['SEARCH_CONFIRMED', 'NO_RESULT_CONFIRMED', 'SUBMITTED_UNCONFIRMED', 'SUBMIT_FAILED', 'AUTH_REQUIRED', 'SEARCH_CONTROL_NOT_FOUND', 'BLOCKED', 'WAITING_HUMAN', 'SKIPPED_HUMAN_VERIFICATION', 'WRONG_SEARCH_CONTEXT', 'FAILED'],
    traversalStatuses: ['NOT_STARTED', 'SEARCH_CONFIRMED', 'RESULTS_DISCOVERED', 'RESULTS_TRAVERSED', 'DOCUMENTS_TRAVERSED', 'SOURCE_EXHAUSTED', 'WAITING_HUMAN', 'SKIPPED_HUMAN_VERIFICATION', 'BLOCKED', 'AUTH_REQUIRED', 'SEARCH_CONTROL_NOT_FOUND', 'SUBMIT_FAILED', 'WRONG_SEARCH_CONTEXT', 'FAILED'],
    structuredTraversal: true,
    humanSessionControls: true,
    humanSessionSkip: true,
    evidenceValidation: true,
    evidenceLedger: true,
    entityQueue: true,
    hardSynthesisGateInvariants: ['canMarkMsmapExhausted', 'canMarkTasExhausted', 'canMarkMygovExhausted', 'canMarkEnregExhausted'],
    evidenceModel: 'v5-deterministic-fsm-architecture-2026-09-05',
  })
);

app.post('/research', auth, (req: any, res: any) => {
  const mode = req.body?.mode === 'property' ? 'property' : 'cadastral';
  const query = mode === 'cadastral' ? String(req.body?.query || '').trim().replace(/\s/g, '') : String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'query required' });
  const job = orchestrator.start(query, mode);
  res.status(202).json({ accepted: true, jobId: job.id, status: job.status });
});

app.get('/research/:id', auth, (req: any, res: any) => {
  const j = orchestrator.getJob(req.params.id);
  return j ? res.json(j) : res.status(404).json({ error: 'not found' });
});

// POST /research/enreg-entity — the closed-loop fix for a confirmed gap:
// a legal entity (developer/owner company) discovered by research-agent's
// own web research (Gemini google_search, not this worker's own browser
// session) has no browser-retrieved document text for EntityQueue to scan,
// so the normal "auto-ENREG once every primary source finishes" path never
// sees it. This lets a caller directly request a single, real, deterministic
// ENREG lookup for a name/idCode found some other way — same EnregWorkflow
// FSM, same CAPTCHA WAITING_HUMAN/resume/skip lifecycle, polled the same way
// via GET /research/:id, as any other job.
app.post('/research/enreg-entity', auth, (req: any, res: any) => {
  const name = String(req.body?.name || '').trim();
  const idCode = req.body?.idCode ? String(req.body.idCode).trim() : null;
  if (!name && !idCode) return res.status(400).json({ error: 'name or idCode required' });
  const job = orchestrator.startEntity(name || idCode!, idCode);
  res.status(202).json({ accepted: true, jobId: job.id, status: job.status });
});

app.get('/research/:id/screenshot', auth, async (req: any, res: any) => {
  const s = orchestrator.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'active human session not found' });
  const cap = await challenge(s.page);
  const PAD = 40;
  let clip: any = null;
  let offsetX = 0;
  let offsetY = 0;
  if (cap) {
    try {
      const box = await cap.el.boundingBox();
      if (box) {
        const vp = s.page.viewportSize() || { width: 1440, height: 1000 };
        const x = Math.max(0, Math.floor(box.x - PAD));
        const y = Math.max(0, Math.floor(box.y - PAD));
        const w = Math.min(vp.width - x, Math.ceil(box.width + PAD * 2));
        const h = Math.min(vp.height - y, Math.ceil(box.height + PAD * 2));
        if (w > 0 && h > 0) {
          clip = { x, y, width: w, height: h };
          offsetX = x;
          offsetY = y;
        }
      }
    } catch {
      /* fall back to a full-viewport screenshot below */
    }
  }
  const img = clip ? await s.page.screenshot({ type: 'jpeg', quality: 85, clip }) : await s.page.screenshot({ type: 'jpeg', quality: 80 });
  res.json({ image: `data:image/jpeg;base64,${img.toString('base64')}`, width: clip ? clip.width : 1440, height: clip ? clip.height : 1000, offsetX, offsetY, cropped: !!clip, url: s.page.url(), source: s.step.type === 'entity_enreg' ? 'enreg' : s.step.key, captcha: true });
});

app.post('/research/:id/action', auth, async (req: any, res: any) => {
  const s = orchestrator.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'active human session not found' });
  const x = Number(req.body.x) + Number(req.body.offsetX || 0);
  const y = Number(req.body.y) + Number(req.body.offsetY || 0);
  await s.page.mouse.click(x, y);
  await s.page.waitForTimeout(700);
  s.expires = Date.now() + 15 * 60 * 1000;
  res.json({ ok: true, captcha: !!(await challenge(s.page)), url: s.page.url() });
});

app.post('/research/:id/resume', auth, async (req: any, res: any) => {
  const r = await orchestrator.resume(req.params.id);
  if (!r.ok) return res.status(409).json({ error: r.error });
  res.status(202).json({ accepted: true, jobId: req.params.id, status: 'RUNNING' });
});

app.post('/research/:id/skip', auth, async (req: any, res: any) => {
  const r = await orchestrator.skip(req.params.id);
  if (!r.ok) return res.status(404).json({ error: r.error });
  res.status(202).json({ accepted: true, jobId: req.params.id, status: 'RUNNING', skipped: r.source });
});

// ── MSMAP diagnostic capability — kept from the pre-refactor architecture
// for troubleshooting (this sandbox has never been able to reach ms.gov.ge
// itself, so this endpoint run on the DEPLOYED worker remains the only way
// to actually inspect that SPA's real DOM/network behavior when the
// production FSM reports an unexpected stop-state). Not part of the FSM —
// a raw diagnostic dump, unchanged in spirit from the original.
const ASSET_EXT = /\.(png|jpe?g|svg|gif|woff2?|ttf|css|ico|mp4)(\?|$)/i;
app.post('/debug/msmap', auth, async (req: any, res: any) => {
  const q = String(req.body?.query || '01.18.06.019.055.03.01.501').trim();
  let browser: any = null;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    const ctx = await browser.newContext({ locale: 'ka-GE', viewport: { width: 1440, height: 1000 } });
    const p = await ctx.newPage();
    await p.goto('https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(2500);
    try {
      await p.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      /* SPA can take longer than networkidle allows */
    }
    const beforeShot = (await p.screenshot({ type: 'png' })).toString('base64');
    const candidates = await scanCandidateInputs(p);
    let searchAttempt: any = { attempted: false };
    const target = p.locator('input[name="searchText"]').first();
    if (await visible(target)) {
      await target.fill(q);
      await p.waitForTimeout(300);
      const filledVal = ((await target.inputValue().catch(() => '')) as string).trim();
      let clickedSel: string | null = null;
      for (const sel of ['button[class*="search" i]', '[class*="search-icon" i]', 'i[class*="search" i]', '[aria-label*="ძებნა" i]', '[title*="ძებნა" i]', '[aria-label*="search" i]']) {
        const icon = p.locator(sel).first();
        if (await visible(icon)) {
          try {
            await icon.click({ timeout: 3000 });
            clickedSel = sel;
            break;
          } catch {
            /* try the next candidate icon */
          }
        }
      }
      if (!clickedSel) await target.press('Enter').catch(() => {});
      await p.waitForTimeout(3500);
      searchAttempt = { attempted: true, filledValueVerified: filledVal.replace(/\s/g, '') === q.replace(/\s/g, ''), submitMethod: clickedSel ? `CLICK ${clickedSel}` : 'ENTER_KEY' };
    }
    const afterShot = (await p.screenshot({ type: 'png' })).toString('base64');
    await ctx.close();
    const id = randomUUID();
    debugJobs.set(id, { beforeShot, afterShot, createdAt: new Date().toISOString() });
    res.json({ id, query: q, candidates, searchAttempt, screenshotUrls: { before: `/debug/${id}/screenshot?which=before`, after: `/debug/${id}/screenshot?which=after` } });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await browser?.close().catch(() => {});
  }
});

app.get('/debug/:id/screenshot', auth, (req: any, res: any) => {
  const d = debugJobs.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  const which = req.query.which;
  const b64 = which === 'after' ? d.afterShot : d.beforeShot;
  if (!b64) return res.status(404).json({ error: 'no screenshot for that stage on this job' });
  res.setHeader('Content-Type', 'image/png');
  res.send(Buffer.from(b64, 'base64'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`homatch-official-worker 2.0.0 (deterministic FSM architecture) listening on ${PORT}`));
