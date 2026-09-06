// BrowserSession.ts — the shared, causal-proof interaction primitives every
// *Page.ts Page Object is built on. Ported unchanged in behavior from the
// pre-refactor index.js (interact/submitNear/waitForResultSignal/text/
// contexts/challenge/domIframes/pollForIframe/candidateRankedRetry and
// friends) — this code was already the most battle-tested part of the old
// architecture (it is what proved TAS's real DWR network call, MSMAP's
// unified-search POST, and MyGov's naprweb iframe). The mandate's critique
// was never "these primitives are wrong" — it was "a suggestion click alone
// must not equal SOURCE_EXHAUSTED," which is a *Workflow.ts/FSM concern,
// not a browser-primitive concern. So this module is a faithful migration,
// not a rewrite.
//
// Playwright-touching throughout — NOT unit-testable in this sandbox (no
// network path to any of the four government hosts). Local-syntax-checked
// via `tsc --noEmit` only; every *State.ts/transitions.ts/EvidenceLedger/
// EntityQueue/DocumentReader module this session touches for the FSM logic
// itself IS unit-tested (see test/).
import type { Page, Frame, Locator } from 'playwright';

export const contexts = (p: any): Frame[] => [p.mainFrame(), ...p.frames().filter((f: any) => f !== p.mainFrame())];

export async function visible(x: Locator): Promise<boolean> {
  try {
    return (await x.count()) > 0 && (await x.isVisible());
  } catch {
    return false;
  }
}

/** Aggregates innerText across EVERY frame Playwright sees (a real result
 * rendered inside an embedded app — e.g. TAS's docs.tbilisi.gov.ge iframe —
 * is otherwise invisible to a top-level-body-only read). */
export async function text(p: any, n = 120000): Promise<string> {
  const parts: string[] = [];
  for (const f of contexts(p)) {
    try {
      parts.push(await f.locator('body').innerText({ timeout: 8000 }));
    } catch {
      /* frame not readable — skip, never fabricate */
    }
  }
  return parts.join('\n').slice(0, n);
}

export interface ChallengeHit {
  frame: any;
  el: Locator;
  matched: string;
}

/** CAPTCHA/human-verification detector. Never solved or bypassed — its only
 * job is to report whether one is present so the workflow can transition to
 * a WAITING_HUMAN-style state per mandate Section 10. */
export async function challenge(p: any): Promise<ChallengeHit | null> {
  for (const f of p.frames()) {
    for (const s of [
      'iframe[src*="recaptcha" i]',
      'iframe[src*="hcaptcha" i]',
      'iframe[src*="turnstile" i]',
      '.g-recaptcha',
      '.h-captcha',
      '.cf-turnstile',
      '[class*="captcha" i]',
      '[id*="captcha" i]',
      '[role="checkbox"][aria-label*="robot" i]',
    ]) {
      const x = f.locator(s).first();
      if (await visible(x)) return { frame: f, el: x, matched: s };
    }
    const b = ((await f.locator('body').innerText().catch(() => '')) as string).slice(0, 15000).toLowerCase();
    if (/verify you are human|i am not a robot|i'm not a robot|captcha|მე არ ვარ რობოტი|არ ვარ რობოტი/.test(b)) {
      const x = f.locator('iframe,input,button,[role="checkbox"],[role="dialog"]').first();
      if (await visible(x)) return { frame: f, el: x, matched: 'text-fallback' };
    }
  }
  return null;
}

export async function domIframes(p: any): Promise<(string | null)[]> {
  try {
    return await p.evaluate(() => Array.from(document.querySelectorAll('iframe')).map((f: any) => f.getAttribute('src') || null));
  } catch {
    return [];
  }
}

/** Polls for a DOM iframe matching `pattern` over a long window — some
 * embedded apps (mygov's naprweb) don't appear in the DOM until an
 * invisible reCAPTCHA challenge finishes executing, which can take up to
 * 20-30s per Google's own declared readiness window. */
export async function pollForIframe(p: any, pattern: RegExp, { timeoutMs = 15000, pollMs = 1000 }: { timeoutMs?: number; pollMs?: number } = {}) {
  const start = Date.now();
  let srcs: (string | null)[] = [];
  while (Date.now() - start < timeoutMs) {
    srcs = await domIframes(p);
    const hit = srcs.find((s) => s && pattern.test(s));
    if (hit) return { found: true, src: hit, srcs, waitedMs: Date.now() - start };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { found: false, srcs, waitedMs: Date.now() - start };
}

/** Polls every frame (contexts(p)) for any of `selectors` to become visible,
 * over a bounded window — used right after a real link click that reloads a
 * page embedding a cross-origin ExtJS/JS-framework app (TAS's
 * docs.tbilisi.gov.ge iframe): the iframe element itself can be present in
 * the DOM immediately while its own JS-rendered form fields are not, and a
 * fixed sleep is either too short (this sandbox's own environment) or
 * wastefully long (nothing to wait for). Never a substitute for interact()'s
 * own real matching — just gives the FIRST search attempt a fair chance to
 * find a control that genuinely exists, rather than racing page load. */
export async function pollForSelectorVisible(p: any, selectors: string[], { timeoutMs = 12000, pollMs = 400 }: { timeoutMs?: number; pollMs?: number } = {}): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const f of contexts(p)) {
      for (const s of selectors) {
        try {
          if (await visible(f.locator(s).first())) return true;
        } catch {
          /* frame mid-navigation or selector invalid in this frame — try the next one */
        }
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

const NO_RESULT_PATTERNS = [
  /ჩანაწერი\s*ვერ\s*მოიძებნა/i,
  /ვერ\s*მოიძებნა/i,
  /არ\s*მოიძებნა/i,
  /შედეგი\s*ვერ\s*მოიძებნა/i,
  /no\s*results?\s*(were\s*)?found/i,
  /nothing\s*found/i,
  /0\s*results?\b/i,
  /not\s*found/i,
  /не\s*найдено/i,
  /ничего\s*не\s*найдено/i,
  /სულ\s*მოიძებნა[:\s]*0\b/i,
  /no\s*data\s*to\s*display/i,
];
export function hasNoResultPhrase(t: string | null | undefined): boolean {
  return NO_RESULT_PATTERNS.some((re) => re.test(t || ''));
}
export function totalFoundCount(t: string | null | undefined): number | null {
  const m = /სულ\s*მოიძებნა\D{0,12}(\d+)/i.exec(t || '');
  return m ? parseInt(m[1], 10) : null;
}

function extractSignal(t: string): { kind: 'NO_RESULT' } | { kind: 'TOTAL_COUNT'; value: number } | null {
  if (hasNoResultPhrase(t)) return { kind: 'NO_RESULT' };
  const tf = totalFoundCount(t);
  if (tf !== null) return { kind: 'TOTAL_COUNT', value: tf };
  return null;
}

export interface ResultSignal {
  changed: boolean;
  after: string;
  signal: ReturnType<typeof extractSignal>;
  queryEchoed: boolean;
  waitedMs: number;
}

/** Polls the SPECIFIC frame the search control lives in (never the whole
 * page — a portal's own live clock/ads would make a naive whole-page
 * text-diff always report "changed") until a recognizable evidence signal
 * appears that was NOT already present before the submit, or the query
 * string itself newly appears. This is the actual proof a click/Enter
 * CAUSED the result, not merely that some result-shaped text exists. */
export async function waitForResultSignal(f: any, beforeText: string, qRaw: string, { timeoutMs = 10000, pollMs = 500 }: { timeoutMs?: number; pollMs?: number } = {}): Promise<ResultSignal> {
  const qn = qRaw.replace(/\s/g, '');
  const beforeSignal = extractSignal(beforeText);
  const beforeHasQuery = beforeText.replace(/\s/g, '').includes(qn);
  const start = Date.now();
  let last = beforeText;
  while (Date.now() - start < timeoutMs) {
    const cur = await f.locator('body').innerText({ timeout: 3000 }).catch(() => last);
    last = cur;
    const curSignal = extractSignal(cur);
    const curHasQuery = !!qn && cur.replace(/\s/g, '').includes(qn);
    const signalIsNew = curSignal && (!beforeSignal || JSON.stringify(curSignal) !== JSON.stringify(beforeSignal));
    const queryIsNew = curHasQuery && !beforeHasQuery;
    if (signalIsNew || queryIsNew) return { changed: true, after: cur, signal: curSignal, queryEchoed: curHasQuery, waitedMs: Date.now() - start };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { changed: false, after: last, signal: extractSignal(last), queryEchoed: !!qn && last.replace(/\s/g, '').includes(qn), waitedMs: Date.now() - start };
}

export async function submitNear(p: any, hit: { frame: any; el: Locator } | null): Promise<{ ok: boolean; method: string | null }> {
  if (!hit) return { ok: false, method: null };
  // /ძებნა/i is its own pattern, not covered by /მოძებნა/i: TAS's own
  // search button is labeled plainly "ძებნა" ("mo-ZEBna" vs "ZEBna" —
  // different word, not a substring of one another), so without it a
  // button matching only this exact label fell through to Enter-key
  // submission instead of a real click (confirmed by reading TAS's search
  // form UI text, which uses "ძებნა" specifically).
  for (const re of [/მოძებნა/i, /ძებნა/i, /ძიება/i, /search/i, /შემდეგ/i, /დადასტურება/i]) {
    for (const role of ['button', 'link']) {
      const x = hit.frame.getByRole(role, { name: re }).first();
      try {
        if (await visible(x)) {
          await x.click();
          await p.waitForTimeout(1000);
          return { ok: true, method: `CLICK ${role}[name~=${re.source}]` };
        }
      } catch {
        /* try the next role/label */
      }
    }
  }
  try {
    await hit.el.press('Enter');
    await p.waitForTimeout(1000);
    return { ok: true, method: 'ENTER_KEY' };
  } catch {
    return { ok: false, method: null };
  }
}

export type ContextConfidence = 'HINT_MATCH' | 'CADASTRAL_FIELD_MATCH' | 'SEARCH_FIELD_MATCH' | 'GENERIC_FIELD_MATCH' | 'FILTER_FIELD_MATCH' | 'GENERIC_KEYWORD_MATCH';

export interface InteractHit {
  found: boolean;
  frame?: any;
  el?: Locator;
  selector?: string;
  scope?: 'HINT' | 'FALLBACK';
  contextConfidence?: ContextConfidence | null;
  before?: string;
  sub?: { ok: boolean; method: string | null };
  net?: { matched: boolean; url?: string; status?: number } | null;
  trace: any[];
  candidates?: any[];
}

/** The shared "operate the form like a human" primitive. Tries the source's
 * known-good `hints` selectors first (HINT scope, high confidence); only
 * when `opts.fallback` is set does it also scan every visible input on the
 * page (FALLBACK scope, excluding header/nav chrome) — reserved for sources
 * with no known-specific selectors yet. Every step is recorded so a human
 * can audit exactly what the browser did. */
export async function interact(
  p: any,
  q: string,
  hints: string[],
  opts: { fallback?: boolean; exclude?: ((x: Locator) => Promise<boolean>) | null; networkPattern?: RegExp | null; skipSubmit?: boolean } = {}
): Promise<InteractHit> {
  const { fallback = false, exclude = null, networkPattern = null, skipSubmit = false } = opts;
  const trace: any[] = [{ action: 'OPEN', url: p.url() }];
  for (const f of contexts(p)) {
    if (f !== p.mainFrame()) trace.push({ action: 'ENTER_FRAME', frameUrl: f.url() });
    for (const s of hints) {
      const x = f.locator(s).first();
      try {
        if (await visible(x)) {
          if (exclude && (await exclude(x))) {
            trace.push({ action: 'SKIP_EXCLUDED', selector: s });
            continue;
          }
          await x.fill(q);
          const val = ((await x.inputValue().catch(() => '')) as string).replace(/\s/g, '');
          const verified = val === q.replace(/\s/g, '');
          trace.push({ action: 'FILL', selector: s, scope: 'HINT', verified });
          if (verified) {
            const before = await f.locator('body').innerText({ timeout: 5000 }).catch(() => '');
            const netPromise = networkPattern
              ? p
                  .waitForResponse((r: any) => networkPattern.test(r.url()), { timeout: 9000 })
                  .then((r: any) => ({ matched: true, url: r.url(), status: r.status() }))
                  .catch(() => ({ matched: false }))
              : null;
            const sub = skipSubmit ? { ok: false, method: null } : await submitNear(p, { frame: f, el: x });
            const net = netPromise ? await netPromise : null;
            trace.push({ action: skipSubmit ? 'FILL_ONLY' : 'SUBMIT', method: sub.method, clicked: sub.ok, network: net });
            return { found: true, frame: f, el: x, selector: s, scope: 'HINT', contextConfidence: 'HINT_MATCH', before, sub, net, trace };
          }
        }
      } catch {
        /* selector didn't pan out — try the next hint */
      }
    }
  }
  if (fallback) {
    for (const f of contexts(p)) {
      const inputs = f.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea');
      const n = Math.min(await inputs.count().catch(() => 0), 40);
      for (let i = 0; i < n; i++) {
        const x = inputs.nth(i);
        if (!(await visible(x))) continue;
        const inChrome = await x.evaluate((el: any) => !!el.closest('header, nav, [role="banner"], [role="navigation"]')).catch(() => false);
        if (inChrome) continue;
        if (exclude && (await exclude(x))) continue;
        const m = (
          (await x.getAttribute('placeholder')) +
          ' ' +
          (await x.getAttribute('name')) +
          ' ' +
          (await x.getAttribute('id')) +
          ' ' +
          (await x.getAttribute('aria-label'))
        ).toLowerCase();
        if (/საკადასტრო|cadast|cadastr|parcel|უძრავ|ძიება|search/.test(m)) {
          try {
            await x.fill(q);
            const val = ((await x.inputValue()) as string).replace(/\s/g, '');
            if (val === q.replace(/\s/g, '')) {
              trace.push({ action: 'FILL', selector: m, scope: 'FALLBACK', verified: true });
              const before = await f.locator('body').innerText({ timeout: 5000 }).catch(() => '');
              const sub = skipSubmit ? { ok: false, method: null } : await submitNear(p, { frame: f, el: x });
              trace.push({ action: skipSubmit ? 'FILL_ONLY' : 'SUBMIT', method: sub.method, clicked: sub.ok });
              return { found: true, frame: f, el: x, selector: m, scope: 'FALLBACK', contextConfidence: 'GENERIC_KEYWORD_MATCH', before, sub, trace };
            }
          } catch {
            /* this candidate didn't verify — keep scanning */
          }
        }
      }
    }
  }
  return { found: false, trace };
}

// ── Ranked-candidate fallback (used when NO known-good hint selector works
// at all) — shared by MSMAP/MyGov/ENREG Page Objects. Deliberately
// deterministic/regex-based (no AI involved anywhere in this file, matching
// mandate Section 3's "AI is never authoritative for a deterministic
// workflow decision"). Every candidate is tagged with the confidence tier
// it came from so collect()/EvidenceLedger can refuse to trust a
// low-confidence guess as real confirm/deny evidence (mandate Section 9's
// MyGov WRONG_SEARCH_CONTEXT rule). ─────────────────────────────────────
export interface InputCandidate {
  frameUrl: string;
  placeholder: string | null;
  ariaLabel: string | null;
  name: string | null;
  id: string | null;
  isLayersPanel: boolean;
}

export async function looksLikeLayersPanel(x: Locator): Promise<boolean> {
  try {
    return await x.evaluate((el: any) => {
      const panel = el.closest('div,section,aside') || el.parentElement;
      if (!panel) return false;
      const t = (panel.innerText || '').slice(0, 4000);
      const hits = (t.match(/გენერალური\s*გეგმა|მუნიციპალიტეტი/g) || []).length;
      return hits >= 3;
    });
  } catch {
    return false;
  }
}

export async function scanCandidateInputs(p: any): Promise<InputCandidate[]> {
  const out: InputCandidate[] = [];
  for (const f of contexts(p)) {
    const inputs = f.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea');
    const n = Math.min(await inputs.count().catch(() => 0), 25);
    for (let i = 0; i < n; i++) {
      const x = inputs.nth(i);
      if (!(await visible(x))) continue;
      out.push({
        frameUrl: f.url(),
        placeholder: await x.getAttribute('placeholder').catch(() => null),
        ariaLabel: await x.getAttribute('aria-label').catch(() => null),
        name: await x.getAttribute('name').catch(() => null),
        id: await x.getAttribute('id').catch(() => null),
        isLayersPanel: await looksLikeLayersPanel(x),
      });
    }
  }
  return out;
}

function looksLikeCadastralField(c: InputCandidate): boolean {
  return /cad|საკადასტრო|parcel|ნაკვეთ/i.test(c.name || '') || /cad|საკადასტრო|parcel|ნაკვეთ/i.test(c.ariaLabel || '') || /საკადასტრო|cad|ნაკვეთ/i.test(c.placeholder || '');
}
function looksLikeSearchField(c: InputCandidate): boolean {
  return /search/i.test(c.name || '') || /search/i.test(c.ariaLabel || '');
}
function looksLikeFilterField(c: InputCandidate): boolean {
  return /filter/i.test(c.name || '') || /filter/i.test(c.ariaLabel || '');
}
function candidateTier(c: InputCandidate): ContextConfidence {
  if (looksLikeCadastralField(c)) return 'CADASTRAL_FIELD_MATCH';
  if (looksLikeSearchField(c)) return 'SEARCH_FIELD_MATCH';
  if (looksLikeFilterField(c)) return 'FILTER_FIELD_MATCH';
  return 'GENERIC_FIELD_MATCH';
}
function candidateSelector(c: InputCandidate): string | null {
  return c.name ? `input[name="${c.name}"]` : c.id ? `#${c.id}` : c.placeholder ? `input[placeholder="${c.placeholder}"]` : null;
}
function dedupe<T>(a: T[], k: (x: T) => string): T[] {
  return [...new Map(a.map((x) => [k(x), x])).values()];
}

export async function candidateRankedRetry(page: any, q: string, opts: { excludeLayers?: boolean } = {}): Promise<InteractHit & { candidates: InputCandidate[] }> {
  const candidates = await scanCandidateInputs(page);
  const usable = opts.excludeLayers ? candidates.filter((c) => !c.isLayersPanel) : candidates;
  const ranked = [
    ...usable.filter(looksLikeCadastralField),
    ...usable.filter((c) => !looksLikeCadastralField(c) && looksLikeSearchField(c)),
    ...usable.filter((c) => !looksLikeCadastralField(c) && !looksLikeSearchField(c) && !looksLikeFilterField(c)),
    ...usable.filter((c) => !looksLikeCadastralField(c) && !looksLikeSearchField(c) && looksLikeFilterField(c)),
  ];
  const tierBySelector = new Map<string, ContextConfidence>();
  for (const c of ranked) {
    const sel = candidateSelector(c);
    if (sel && !tierBySelector.has(sel)) tierBySelector.set(sel, candidateTier(c));
  }
  const guessSels = dedupe(ranked.map(candidateSelector).filter((x): x is string => !!x), (x) => x);
  if (!guessSels.length) return { found: false, trace: [], candidates };
  const hit = await interact(page, q, guessSels);
  const contextConfidence = hit.found ? tierBySelector.get(hit.selector!) || 'GENERIC_FIELD_MATCH' : null;
  return { ...hit, contextConfidence, candidates };
}
