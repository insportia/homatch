// RsTaxpayerWorker.ts — RS Taxpayers Registry ('rstax'), rs.ge, as its OWN
// fully independent worker.
import type { Page } from 'playwright';
import { waitForResultSignal, hasNoResultPhrase } from '../../browser/BrowserSession.js';
import { RSTAX_URL, RSTAX_ID_INPUT_SELECTORS, RSTAX_CAPTCHA_BLOCK_PHRASE, RSTAX_SOURCE_META } from './selectors.js';
import type { LegacySourceResult, RsTaxpayerPublicData } from '../WorkflowResult.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import { parseRsTaxpayerFields, hasParsedTaxpayerEvidence } from './RsTaxpayerParsing.js';
import type { CaptchaContext, CaptchaResolution } from '../../captcha/captchaService.js';
import { detectChallengeInHtml } from '../../captcha/detect.js';

/** Internal: one automatic verification attempt in flight (never exported). */
interface RsCaptchaAttempt {
  n: number;
  solved: { solveId: string; latencyMs: number } | null;
  log: CaptchaResolution;
}

/** Caller-owned controls that travel through every pass of one rstax step. */
export interface RsRunOptions {
  skipGoto?: boolean;
  captcha?: CaptchaContext;
  /** Heartbeat: called at each genuine phase transition (NAVIGATED, SEARCH1, SOLVING_ATTEMPT_n, SEARCH2_ATTEMPT_n). */
  onProgress?: (phase: string) => void;
  /** How long Search #2 after an automatic solve may take to render anything (tests shorten it). */
  postSolveWaitMs?: number;
  _attempt?: RsCaptchaAttempt;
}

/**
 * Search #2 after a paid solve gets longer than the generic 10 s result wait:
 * production job c80f7237 (2026-10-09) classified every post-solve search as
 * REJECTED after 10 s without a change, possibly on the stale warning left by
 * Search #1. The verdict now needs a FRESH render (see armFreshRenderWatch).
 */
export const RS_POST_SOLVE_WAIT_MS = 20_000;

/** Structured, redacted log line — never a token, cookie, TIN or page text. */
function logRs(event: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ at: new Date().toISOString(), scope: 'rstax_captcha', event, ...fields }));
  } catch {
    /* diagnostics must never break the research flow */
  }
}

function progress(opts: Pick<RsRunOptions, 'onProgress'>, phase: string): void {
  try {
    opts.onProgress?.(phase);
  } catch {
    /* a heartbeat must never break the step */
  }
}

/** What token delivery achieved — booleans and counts only, never the token. */
export interface RsTokenDelivery {
  textareas: number;
  grecaptchaPresent: boolean;
  getResponseOverridden: boolean;
  callbacksInvoked: number;
  callbackErrors: number;
  verified: boolean;
  verifiedVia: 'getResponse' | 'textarea' | null;
}

// In-page scripts below are kept as plain JS source: the worker runs under
// tsx, whose esbuild transform wraps named inner functions in a `__name()`
// helper that does not exist inside the page ("ReferenceError: __name is not
// defined"). A string is shipped to the page untouched.

/**
 * Deliver a solved token everywhere a page can read a human's token from:
 *   1. every g-recaptcha-response textarea (what a form POST carries);
 *   2. grecaptcha.getResponse() (and grecaptcha.enterprise.getResponse()) —
 *      a page that validates in JS asks the widget, not the textarea, and the
 *      real widget answers '' because nobody clicked it;
 *   3. the widget's registered callback(s): data-callback AND any
 *      function-valued `callback` in window.___grecaptcha_cfg.clients (set by
 *      grecaptcha.render({callback}) — invisible to data-callback).
 * Then verify it took: getResponse() === token (textarea when no API).
 */
const DELIVER_TOKEN_JS = String.raw`(tok) => {
  var g = globalThis, doc = g.document;
  var r = { textareas: 0, grecaptchaPresent: !!g.grecaptcha, getResponseOverridden: false, callbacksInvoked: 0, callbackErrors: 0, verified: false, verifiedVia: null };
  Array.prototype.forEach.call(doc.querySelectorAll('textarea[name="g-recaptcha-response"]'), function (ta) { ta.value = tok; ta.innerHTML = tok; r.textareas++; });
  // The current token lives on the page (as it does in the textarea); the
  // wrapper is installed once and always answers the latest token.
  g.__homatchRecaptchaToken = tok;
  var wrap = function (api) {
    if (!api || typeof api.getResponse !== 'function') return false;
    if (!api.getResponse.__homatchWrapped) {
      var orig = api.getResponse;
      var w = function () { return typeof g.__homatchRecaptchaToken === 'string' && g.__homatchRecaptchaToken ? g.__homatchRecaptchaToken : orig.apply(this, arguments); };
      w.__homatchWrapped = true;
      api.getResponse = w;
    }
    return true;
  };
  try { var a = wrap(g.grecaptcha); var b = wrap(g.grecaptcha && g.grecaptcha.enterprise); r.getResponseOverridden = a || b; } catch (e) { /* frozen API: verification reports it */ }
  var seen = [], fns = [];
  var add = function (f) {
    if (typeof f === 'string' && f) f = g[f];
    if (typeof f === 'function' && seen.indexOf(f) < 0) { seen.push(f); fns.push(f); }
  };
  var el = doc.querySelector('.g-recaptcha[data-callback]');
  add(el ? el.getAttribute('data-callback') : null);
  // Bounded walk of the widget registry; never into DOM nodes or window.
  var visited = [];
  var walk = function (o, depth) {
    if (!o || typeof o !== 'object' || depth > 6 || visited.indexOf(o) >= 0 || o === g || (g.Node && o instanceof g.Node)) return;
    visited.push(o);
    Object.keys(o).slice(0, 200).forEach(function (k) {
      var v; try { v = o[k]; } catch (e) { return; }
      if (k === 'callback') add(v); else if (v && typeof v === 'object') walk(v, depth + 1);
    });
  };
  try { walk(g.___grecaptcha_cfg && g.___grecaptcha_cfg.clients, 0); } catch (e) { /* unknown registry shape */ }
  fns.forEach(function (f) { try { f(tok); r.callbacksInvoked++; } catch (e) { r.callbackErrors++; } });
  var gr = g.grecaptcha;
  var api = gr && gr.enterprise && typeof gr.enterprise.getResponse === 'function' ? gr.enterprise : gr && typeof gr.getResponse === 'function' ? gr : null;
  if (api) { try { r.verified = api.getResponse() === tok; } catch (e) { r.verified = false; } r.verifiedVia = 'getResponse'; }
  else { var t = doc.querySelector('textarea[name="g-recaptcha-response"]'); r.verified = !!t && t.value === tok; r.verifiedVia = 'textarea'; }
  return r;
}`;

async function deliverRecaptchaToken(page: Page, token: string): Promise<RsTokenDelivery> {
  const empty: RsTokenDelivery = { textareas: 0, grecaptchaPresent: false, getResponseOverridden: false, callbacksInvoked: 0, callbackErrors: 0, verified: false, verifiedVia: null };
  return (page as any).evaluate(`(${DELIVER_TOKEN_JS})(${JSON.stringify(token)})`).catch(() => empty);
}

/**
 * Before Search #2: watch for a FRESH render. A MutationObserver counts DOM
 * mutations after the click and whether the block phrase was (re)rendered —
 * added nodes, changed text, or a shown/hidden element carrying it. Without
 * this, the text left on screen by Search #1 read as a rejection.
 */
async function armFreshRenderWatch(page: Page): Promise<void> {
  await (page as any)
    .evaluate((src: string) => {
      const g = globalThis as any;
      const doc = g.document;
      const re = new RegExp(src, 'i');
      try {
        g.__homatchRsWatch?.obs?.disconnect();
      } catch {
        /* none armed */
      }
      const w = { mutations: 0, warnRendered: 0 };
      const obs = new g.MutationObserver((recs: any[]) => {
        for (const rec of recs) {
          w.mutations++;
          if (rec.type === 'childList') {
            for (const n of Array.from(rec.addedNodes) as any[]) if (re.test(String(n?.textContent || ''))) w.warnRendered++;
          } else if (rec.type === 'characterData') {
            if (re.test(String(rec.target?.data || ''))) w.warnRendered++;
          } else if (rec.type === 'attributes') {
            const t = rec.target;
            const txt = String(t?.textContent || '');
            if (txt.length < 500 && re.test(txt) && t.getClientRects?.().length) w.warnRendered++;
          }
        }
      });
      obs.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      g.__homatchRsWatch = { w, obs };
    }, RSTAX_CAPTCHA_BLOCK_PHRASE.source)
    .catch(() => {});
}

async function readFreshRenderWatch(page: Page): Promise<{ mutations: number; warnRendered: number } | null> {
  return (page as any)
    .evaluate(() => {
      const w = (globalThis as any).__homatchRsWatch?.w;
      return w ? { mutations: Number(w.mutations) || 0, warnRendered: Number(w.warnRendered) || 0 } : null;
    })
    .catch(() => null);
}

/**
 * One-time, read-only evidence of what RS.ge validates (no solving, no
 * typing): the #btnSearch1 / form handlers, inline script excerpts that
 * reference the button or the reCAPTCHA API, and the reCAPTCHA config shape.
 * Collected right after navigation, before the TIN is filled. Exported for
 * the stand-in page test.
 */
const RS_DIAGNOSTIC_JS = String.raw`() => {
  var g = globalThis, doc = g.document;
  var clip = function (v, n) { return v == null ? null : String(v).replace(/\s+/g, ' ').slice(0, n); };
  var o = {};
  var btn = doc.querySelector('#btnSearch1');
  o.btnFound = !!btn;
  if (btn) {
    o.btnType = btn.getAttribute('type');
    o.btnOnclickAttr = clip(btn.getAttribute('onclick'), 300);
    o.btnOnclickProp = typeof btn.onclick === 'function' ? clip(btn.onclick.toString(), 400) : null;
    var form = btn.closest ? btn.closest('form') : null;
    o.formFound = !!form;
    if (form) {
      o.formAction = clip(form.getAttribute('action'), 120);
      o.formMethod = form.getAttribute('method');
      o.formOnsubmitAttr = clip(form.getAttribute('onsubmit'), 200);
      o.formOnsubmitProp = typeof form.onsubmit === 'function' ? clip(form.onsubmit.toString(), 300) : null;
    }
    try {
      var jq = g.jQuery;
      var own = jq && jq._data ? jq._data(btn, 'events') : null;
      if (own) o.jqueryHandlers = Object.keys(own).map(function (t) { return t + ': ' + clip((own[t] || []).map(function (h) { return String(h && h.handler); }).join(' | '), 400); });
      var del = jq && jq._data ? jq._data(doc, 'events') : null;
      if (del && del.click) o.jqueryDelegatedClick = del.click.filter(function (h) { return /btnSearch/i.test(String((h && h.selector) || '')); }).map(function (h) { return clip(String(h && h.handler), 400); });
    } catch (e) { /* no jQuery */ }
  }
  var snippets = [];
  Array.prototype.forEach.call(doc.scripts, function (sc) {
    if (sc.src || snippets.length >= 3) return;
    var t = String(sc.textContent || '');
    var needles = ['btnSearch1', 'getResponse', 'g-recaptcha-response', 'grecaptcha'];
    for (var j = 0; j < needles.length; j++) {
      var i = t.indexOf(needles[j]);
      if (i >= 0) { snippets.push(needles[j] + ': ' + clip(t.slice(Math.max(0, i - 150), i + 250), 400)); break; }
    }
  });
  o.inlineScriptSnippets = snippets;
  o.recaptchaScripts = Array.prototype.map.call(doc.scripts, function (sc) { return String(sc.src || ''); })
    .filter(function (u) { return /recaptcha/i.test(u); }).map(function (u) { return u.split('?')[0]; }).slice(0, 5);
  var wEl = doc.querySelector('.g-recaptcha');
  var paths = [], visited = [];
  var walk = function (x, path, depth) {
    if (!x || typeof x !== 'object' || depth > 6 || visited.indexOf(x) >= 0 || x === g || (g.Node && x instanceof g.Node) || paths.length >= 8) return;
    visited.push(x);
    Object.keys(x).slice(0, 200).forEach(function (k) {
      var v; try { v = x[k]; } catch (e) { return; }
      if (k === 'callback' || k === 'expired-callback' || k === 'error-callback') paths.push(path + '.' + k + '=' + (typeof v === 'function' ? 'fn:' + (v.name || 'anonymous') : typeof v + ':' + clip(v, 40)));
      else if (v && typeof v === 'object') walk(v, path + '.' + k, depth + 1);
    });
  };
  var cfg = g.___grecaptcha_cfg;
  try { walk(cfg && cfg.clients, 'clients', 0); } catch (e) { /* unknown shape */ }
  var gr = g.grecaptcha;
  o.recaptcha = {
    widgetFound: !!wEl,
    sitekeyAttrPresent: !!(wEl && wEl.getAttribute('data-sitekey')),
    dataCallback: wEl ? wEl.getAttribute('data-callback') : null,
    dataExpiredCallback: wEl ? wEl.getAttribute('data-expired-callback') : null,
    dataSize: wEl ? wEl.getAttribute('data-size') : null,
    textareas: doc.querySelectorAll('textarea[name="g-recaptcha-response"]').length,
    grecaptchaPresent: !!gr,
    getResponseIsFunction: !!gr && typeof gr.getResponse === 'function',
    enterprise: !!(gr && gr.enterprise),
    cfgPresent: !!cfg,
    clientCount: cfg && cfg.clients ? Object.keys(cfg.clients).length : 0,
    callbackPaths: paths
  };
  return o;
}`;

export async function collectRsDiagnostic(page: Page): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = await (page as any)
    .evaluate(`(${RS_DIAGNOSTIC_JS})()`)
    .catch((e: unknown) => ({ error: String(e).slice(0, 120) }));
  // The widget iframe carries the key as ?k= when the attribute is absent; report presence only.
  const sitekeyInFrame = ((page as any).frames?.() ?? []).some((f: any) => /recaptcha/i.test(String(f.url?.() || '')) && /[?&]k=/.test(String(f.url?.() || '')));
  return { ...out, sitekeyInFrame };
}

let rsDiagnosticLogged = false;
async function logRsDiagnosticOnce(page: Page): Promise<void> {
  if (rsDiagnosticLogged) return;
  rsDiagnosticLogged = true;
  try {
    const json = JSON.stringify(await collectRsDiagnostic(page));
    logRs('page_diagnostic', { truncated: json.length > 2048, detail: json.slice(0, 2048) });
  } catch {
    /* evidence is best effort */
  }
}

/**
 * RS keeps a visible reCAPTCHA v2 widget on the registry page. When the gate
 * is pending and the shared CAPTCHA service is allowed for this job, solve it,
 * place the token where the widget puts a human's token, and run the SAME
 * Search #2 the human-resume path runs. Returns null when no automatic attempt
 * can be made (disabled, budget, no/unsupported challenge, solver failure) —
 * the caller then keeps the existing human path.
 */
async function tryAutoVerifyRs(
  page: Page,
  forEntity: { name: string; idCode: string | null },
  entities: EntityQueue | undefined,
  cap: CaptchaContext,
  prior: RsCaptchaAttempt | undefined,
  ctl: Pick<RsRunOptions, 'onProgress' | 'postSolveWaitMs'> = {},
): Promise<{ result: LegacySourceResult | null; log: CaptchaResolution }> {
  const log: CaptchaResolution = prior?.log ?? { challengeDetected: true, type: null, attempts: 0, outcome: 'HUMAN_FALLBACK', latencyMs: 0 };
  const n = prior?.n ?? 0;
  if (n >= cap.policy.maxAttemptsPerProvider) {
    if (log.outcome === 'HUMAN_FALLBACK') log.outcome = 'BUDGET_EXHAUSTED';
    return { result: null, log };
  }
  const blocked = cap.service.gate(cap.policy, 'rstax', cap.jobId);
  if (blocked) {
    log.outcome = blocked;
    return { result: null, log };
  }
  const html = await (page as any).content().catch(() => '');
  const found = detectChallengeInHtml(html);
  // The widget's iframe carries the key as ?k= when the attribute is absent.
  let siteKey = found.siteKey;
  if (!siteKey) {
    for (const frame of (page as any).frames?.() ?? []) {
      const k = /[?&]k=([0-9A-Za-z_-]{20,64})/.exec(String(frame.url?.() || ''))?.[1];
      if (k) {
        siteKey = k;
        break;
      }
    }
  }
  log.type = found.type;
  if (!found.present) {
    log.outcome = 'NO_CHALLENGE';
    return { result: null, log };
  }
  if (!siteKey || (!found.supported && found.type !== 'RECAPTCHA_V2' && found.type !== 'RECAPTCHA_V2_INVISIBLE' && found.type !== 'RECAPTCHA_ENTERPRISE')) {
    log.outcome = siteKey ? 'UNSUPPORTED' : 'SITEKEY_NOT_FOUND';
    return { result: null, log };
  }
  progress(ctl, `SOLVING_ATTEMPT_${n + 1}`);
  const solved = await cap.service.solveRecaptchaV2(
    { provider: 'rstax', jobId: cap.jobId, pageUrl: String((page as any).url?.() || RSTAX_URL), siteKey, invisible: found.type === 'RECAPTCHA_V2_INVISIBLE', enterprise: found.type === 'RECAPTCHA_ENTERPRISE' },
    cap.policy,
  );
  log.attempts++;
  log.latencyMs += solved.latencyMs;
  if (!solved.ok) {
    log.outcome = solved.outcome;
    // A slow or unsolvable task may succeed once more within the cap.
    if ((solved.outcome === 'TIMEOUT' || solved.outcome === 'UNSOLVABLE') && n + 1 < cap.policy.maxAttemptsPerProvider)
      return tryAutoVerifyRs(page, forEntity, entities, cap, { n: n + 1, solved: null, log }, ctl);
    return { result: null, log };
  }
  // Textarea + grecaptcha.getResponse() + every registered widget callback.
  const delivery = await deliverRecaptchaToken(page, solved.token);
  // One line per solve: whether the page can now SEE the token is the first
  // thing to rule out when RS.ge answers with its warning again.
  logRs(delivery.verified ? 'token_delivered' : 'token_delivery_unverified', { jobId: cap.jobId.slice(0, 8), attempt: n + 1, ...delivery });
  const result = await runRsTaxpayerWorker(page, forEntity, entities, {
    skipGoto: true,
    captcha: cap,
    onProgress: ctl.onProgress,
    postSolveWaitMs: ctl.postSolveWaitMs,
    _attempt: { n: n + 1, solved: { solveId: solved.solveId, latencyMs: solved.latencyMs }, log },
  });
  return { result, log };
}

function buildResult(
  status: string,
  opts: { selector?: string | null; value?: string | null; resultText?: string | null; error?: string | null; forEntity: { name: string; idCode: string | null } | null; taxpayerData?: RsTaxpayerPublicData | null }
): LegacySourceResult {
  return {
    source: 'rstax',
    sourceName: RSTAX_SOURCE_META.name,
    sourceClass: RSTAX_SOURCE_META.class,
    sourceUrl: RSTAX_SOURCE_META.url,
    startUrl: RSTAX_SOURCE_META.url,
    finalUrl: RSTAX_SOURCE_META.url,
    frameUrls: [],
    searchControlUsed: opts.selector || null,
    queryEntered: opts.value || null,
    submitAction: opts.selector ? 'CLICK #btnSearch1' : null,
    resultContext: opts.resultText || opts.error || null,
    resultConfirmed: status === 'SEARCH_CONFIRMED',
    noResultConfirmed: status === 'NO_RESULT_CONFIRMED',
    resultValidated: status === 'SEARCH_CONFIRMED',
    status,
    traversal: null,
    retrievedAt: new Date().toISOString(),
    documents: [],
    discoveredEntities: [],
    forEntity: opts.forEntity,
    error: opts.error || null,
    taxpayerData: opts.taxpayerData ?? null,
  };
}

/**
 * RS uses a normal, always-visible reCAPTCHA widget. Merely seeing
 * `.g-recaptcha` therefore does NOT mean the human step is still pending.
 * The live-verified flow is:
 *   TIN -> Search #1 -> human solves CAPTCHA -> Search #2 -> result.
 *
 * We only observe the solved state; we never solve or bypass the CAPTCHA.
 */
async function rsCaptchaSolved(page: Page): Promise<boolean> {
  try {
    const token = await (page as any).locator('textarea[name="g-recaptcha-response"]').first().inputValue().catch(() => '');
    if (String(token || '').trim()) return true;
  } catch {
    /* continue with the widget API check */
  }

  // The widget's own answer: a page that validates via grecaptcha.getResponse()
  // may have no populated textarea at all.
  try {
    const viaApi = await (page as any)
      .evaluate(() => {
        const g = (globalThis as any).grecaptcha;
        const api = typeof g?.enterprise?.getResponse === 'function' ? g.enterprise : typeof g?.getResponse === 'function' ? g : null;
        return !!(api && String(api.getResponse() || '').trim());
      })
      .catch(() => false);
    if (viaApi) return true;
  } catch {
    /* continue with iframe state check */
  }

  try {
    const frames = (page as any).frames();
    for (const frame of frames) {
      if (!/recaptcha/i.test(String(frame.url?.() || ''))) continue;
      const anchor = frame.locator('#recaptcha-anchor').first();
      if (await anchor.count().catch(() => 0)) {
        const checked = await anchor.getAttribute('aria-checked').catch(() => null);
        if (checked === 'true') return true;
      }
    }
  } catch {
    /* unresolved means not proven solved */
  }

  return false;
}

export async function runRsTaxpayerWorker(
  page: Page,
  forEntity: { name: string; idCode: string | null } | null,
  entities?: EntityQueue,
  opts: RsRunOptions = {}
): Promise<LegacySourceResult> {
  const idCode = forEntity?.idCode ? String(forEntity.idCode).trim() : null;
  if (!forEntity || !idCode) {
    return buildResult('START', { forEntity, error: 'no identifier (TIN) supplied — RS Taxpayers Registry has no name-search field' });
  }

  try {
    if (!opts.skipGoto) {
      await (page as any).goto(RSTAX_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await (page as any).waitForTimeout(1500);
      progress(opts, 'NAVIGATED');
      await logRsDiagnosticOnce(page);
    }

    let usedSelector: string | null = null;
    for (const sel of RSTAX_ID_INPUT_SELECTORS) {
      const x = (page as any).locator(sel).first();
      try {
        if (await x.isVisible()) {
          await x.fill(idCode);
          usedSelector = sel;
          break;
        }
      } catch {
        /* try next confirmed selector */
      }
    }
    if (!usedSelector) {
      return buildResult('SEARCH_CONTROL_NOT_FOUND', { forEntity, value: idCode, error: 'search field not found' });
    }

    const before = await (page as any).mainFrame().locator('body').innerText({ timeout: 5000 }).catch(() => '');

    // Search #2 after an AUTOMATIC solve: its verdict must come from a fresh
    // render, never from what Search #1 left on screen.
    const postSolve = !!(opts._attempt?.solved && opts.captcha);
    let dialogWarn = false;
    const onDialog = (d: any) => {
      try {
        if (RSTAX_CAPTCHA_BLOCK_PHRASE.test(String(d.message?.() || ''))) dialogWarn = true;
      } catch {
        /* unreadable dialog */
      }
      Promise.resolve(d.dismiss?.()).catch(() => {});
    };
    if (postSolve) {
      progress(opts, `SEARCH2_ATTEMPT_${opts._attempt!.n}`);
      await armFreshRenderWatch(page);
      (page as any).on?.('dialog', onDialog);
    } else progress(opts, opts.skipGoto ? 'SEARCH2_HUMAN' : 'SEARCH1');

    // Exact source-owned submit control. On the initial pass this is Search
    // #1 (which exposes the CAPTCHA gate). On same-session resume after the
    // user solves CAPTCHA, this is Search #2 (which returns the real result).
    const clickedAt = Date.now();
    const btn = (page as any).locator('#btnSearch1').first();
    let submitted = false;
    try {
      if (await btn.isVisible()) {
        await btn.click();
        submitted = true;
      }
    } catch {
      /* fall through to Enter fallback */
    }
    if (!submitted) {
      try {
        await (page as any).locator(usedSelector).first().press('Enter');
        submitted = true;
      } catch {
        (page as any).off?.('dialog', onDialog);
        return buildResult('SUBMIT_FAILED', { forEntity, selector: usedSelector, value: idCode, error: 'submit failed' });
      }
    }

    await (page as any).waitForTimeout(1000);

    let sig: Awaited<ReturnType<typeof waitForResultSignal>>;
    let fresh: { mutations: number; warnRendered: number } | null = null;
    if (postSolve) {
      // Up to RS_POST_SOLVE_WAIT_MS for EITHER a new result signal OR a fresh
      // render of the warning — whichever comes first.
      const deadline = Date.now() + (opts.postSolveWaitMs ?? RS_POST_SOLVE_WAIT_MS);
      for (;;) {
        sig = await waitForResultSignal((page as any).mainFrame(), before, idCode, { timeoutMs: 1000 });
        if (sig.changed) break;
        fresh = await readFreshRenderWatch(page);
        if ((fresh?.warnRendered ?? 0) > 0 || dialogWarn) {
          const prev = sig.after;
          sig = { ...sig, after: await (page as any).mainFrame().locator('body').innerText({ timeout: 3000 }).catch(() => prev) };
          break;
        }
        if (Date.now() >= deadline) break;
      }
      fresh = await readFreshRenderWatch(page);
      (page as any).off?.('dialog', onDialog);
    } else sig = await waitForResultSignal((page as any).mainFrame(), before, idCode);
    const solved = await rsCaptchaSolved(page);

    // Source-specific CAPTCHA gate. The generic challenge() detector cannot
    // be used here because RS keeps the reCAPTCHA widget visible even AFTER
    // it has been solved; doing so caused an endless WAITING_HUMAN loop on
    // resume. A visible widget is pending only when it is not proven solved,
    // or when RS explicitly says the security button must still be checked.
    if (RSTAX_CAPTCHA_BLOCK_PHRASE.test(sig.after) || (!solved && /g-recaptcha|recaptcha/i.test(await (page as any).locator('body').innerHTML().catch(() => '')))) {
      if (postSolve) {
        const att = opts._attempt!;
        const cap = opts.captcha!;
        const reShown = (fresh?.warnRendered ?? 0) > 0 || dialogWarn;
        logRs('post_solve_outcome', { jobId: cap.jobId.slice(0, 8), attempt: att.n, outcome: reShown ? 'REJECTED' : 'NO_CHANGE', gateShown: true, mutations: fresh?.mutations ?? null, warnRendered: fresh?.warnRendered ?? null, viaDialog: dialogWarn, waitedMs: Date.now() - clickedAt });
        if (reShown) {
          // REJECTED: RS rendered its warning again in answer to Search #2.
          // A fresh token through the same integration would be refused the
          // same way, so no second paid solve — the human path takes over.
          await cap.service.reportAcceptance({ provider: 'rstax', jobId: cap.jobId }, att.solved!, false);
          att.log.outcome = 'REJECTED';
          return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after }), status: 'WAITING_HUMAN', captchaResolution: [att.log] } as LegacySourceResult;
        }
        // NO_CHANGE: Search #2 produced no fresh render at all — a stale
        // screen says nothing about the token. Never a rejection (no bad
        // report); one more attempt within the cap is allowed.
        cap.service.reportNoChange({ provider: 'rstax', jobId: cap.jobId }, att.solved!);
        att.log.outcome = 'NO_CHANGE';
      }
      if (opts.captcha) {
        const auto = await tryAutoVerifyRs(page, forEntity, entities, opts.captcha, opts._attempt ? { ...opts._attempt, solved: null } : undefined, opts);
        if (auto.result) return auto.result;
        return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after }), status: 'WAITING_HUMAN', captchaResolution: [auto.log] } as LegacySourceResult;
      }
      return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after }), status: 'WAITING_HUMAN' };
    }
    // Past the gate after an automatic verification: RS accepted the token.
    const verified = opts._attempt?.solved && opts.captcha ? opts._attempt : null;

    if (!sig.changed) {
      if (verified) {
        // No gate and no result after a solve: also a stale screen, not a rejection.
        opts.captcha!.service.reportNoChange({ provider: 'rstax', jobId: opts.captcha!.jobId }, verified.solved!);
        verified.log.outcome = 'NO_CHANGE';
        logRs('post_solve_outcome', { jobId: opts.captcha!.jobId.slice(0, 8), attempt: verified.n, outcome: 'NO_CHANGE', gateShown: false, mutations: fresh?.mutations ?? null, waitedMs: Date.now() - clickedAt });
        return { ...buildResult('SUBMITTED_UNCONFIRMED', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, error: 'post-solve search produced no fresh result (NO_CHANGE)' }), captchaResolution: [verified.log] } as LegacySourceResult;
      }
      return buildResult('SUBMITTED_UNCONFIRMED', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, error: 'search submitted but no new result signal appeared' });
    }

    const noResult = hasNoResultPhrase(sig.after);
    const candidateData = noResult ? null : parseRsTaxpayerFields(sig.after, idCode);
    let status: string;
    let taxpayerData: RsTaxpayerPublicData | null;

    if (noResult) {
      status = 'NO_RESULT_CONFIRMED';
      taxpayerData = null;
    } else if (hasParsedTaxpayerEvidence(candidateData)) {
      status = 'SEARCH_CONFIRMED';
      taxpayerData = candidateData;
    } else {
      status = 'SUBMITTED_UNPARSED';
      taxpayerData = null;
    }

    if (entities && status === 'SEARCH_CONFIRMED' && sig.after) {
      entities.scanText(sig.after, { source: 'rstax', sourceDocument: RSTAX_SOURCE_META.url, retrievedAt: new Date().toISOString() });
    }

    if (verified) {
      // Acceptance = RS answered the search (a record, or a confirmed no-result).
      if (status === 'SEARCH_CONFIRMED' || status === 'NO_RESULT_CONFIRMED') {
        await opts.captcha!.service.reportAcceptance({ provider: 'rstax', jobId: opts.captcha!.jobId }, verified.solved!, true);
        verified.log.outcome = 'ACCEPTED';
        logRs('post_solve_outcome', { jobId: opts.captcha!.jobId.slice(0, 8), attempt: verified.n, outcome: 'ACCEPTED', waitedMs: Date.now() - clickedAt });
      }
    }
    const finalResult = buildResult(status, {
      forEntity,
      selector: usedSelector,
      value: idCode,
      resultText: sig.after,
      taxpayerData,
      error: status === 'SUBMITTED_UNPARSED' ? 'search submitted and page changed, but no parseable taxpayer fields were found — not treated as confirmed evidence' : null,
    });
    return verified ? ({ ...finalResult, captchaResolution: [verified.log] } as LegacySourceResult) : finalResult;
  } catch (e) {
    return buildResult('FAILED', { forEntity, error: String(e) });
  }
}
