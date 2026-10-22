// RsTaxpayerWorker.ts — RS Taxpayers Registry ('rstax'), rs.ge, as its OWN
// fully independent worker.
import type { Page } from 'playwright';
import { waitForResultSignal, hasNoResultPhrase } from '../../browser/BrowserSession.js';
import { RSTAX_URL, RSTAX_ID_INPUT_SELECTORS, RSTAX_CAPTCHA_BLOCK_PHRASE, RSTAX_SOURCE_META } from './selectors.js';
import type { LegacySourceResult, RsTaxpayerPublicData } from '../WorkflowResult.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import { parseRsTaxpayerFields, hasParsedTaxpayerEvidence } from './RsTaxpayerParsing.js';
import {
  RS_GRID_PATH,
  classifyRsGridResponse,
  buildRsVerificationRecord,
  rsRecordLogFields,
  rsStatusForOutcome,
  rsPageReadDecides,
  pickRsRow,
  mapRsRow,
  type RsGridCapture,
  type RsGridClassification,
  type RsVerificationRecord,
  type RsVerificationStatus,
} from './RsTaxpayerResponse.js';
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

/**
 * Search through the page's own button, past reCAPTCHA's challenge overlay.
 *
 * Search #1 makes RS.ge open reCAPTCHA's image challenge: a full-screen
 * transparent backdrop plus the bframe iframe, attached to <body>. It stays
 * open after a token is delivered, so a pointer click on #btnSearch1
 * lands on the backdrop — Playwright waited its 30 s action timeout and the
 * Enter fallback did nothing (RS has no form). Production job e02d4f16:
 * two solved tokens, zero DOM mutations, waitedMs 51 s = 30 + 1 + 20.
 * The overlay is hidden (it is RS's own pending challenge, now answered)
 * and the button's own handler runs through a DOM click.
 */
const SUBMIT_SEARCH_JS = String.raw`() => {
  var doc = globalThis.document, hidden = 0;
  var frames = doc.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"], iframe[title*="challenge"]');
  for (var i = 0; i < frames.length; i++) {
    var c = frames[i];
    while (c.parentElement && c.parentElement !== doc.body) c = c.parentElement;
    if (c !== doc.body) { c.style.visibility = 'hidden'; c.style.display = 'none'; hidden++; }
  }
  var b = doc.querySelector('#btnSearch1');
  if (!b) return { clicked: false, overlaysHidden: hidden };
  b.click();
  return { clicked: true, overlaysHidden: hidden };
}`;

async function submitSearchInPage(page: Page): Promise<{ clicked: boolean; overlaysHidden: number }> {
  return (page as any).evaluate(`(${SUBMIT_SEARCH_JS})()`).catch(() => ({ clicked: false, overlaysHidden: 0 }));
}

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
  opts: {
    selector?: string | null;
    value?: string | null;
    resultText?: string | null;
    error?: string | null;
    forEntity: { name: string; idCode: string | null } | null;
    taxpayerData?: RsTaxpayerPublicData | null;
    rsVerification?: RsVerificationRecord | null;
  }
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
    rsVerification: opts.rsVerification ?? null,
  };
}

/** A verification record for an outcome that has no server answer behind it. */
function rsRecord(status: RsVerificationStatus, serverOutcome: RsVerificationRecord['serverOutcome'], idCode: string | null, reason: string | null, capture: RsGridCapture | null = null, classification: RsGridClassification | null = null): RsVerificationRecord {
  return buildRsVerificationRecord({ capture, classification, tin: idCode, sourceUrl: RSTAX_URL, status, serverOutcome, reason });
}

/**
 * Watch RS.ge's own search endpoint (GrdSearchTaxPayers) for ONE search:
 * every answer is captured with its status and complete body, every failed
 * request as a network error. Also keeps the path/status list of the other
 * rs.ge XHRs for the diagnostic log (paths only — never a query string,
 * token, TIN or body).
 */
function watchGrid(page: Page, idCode: string) {
  const captures: RsGridCapture[] = [];
  const pending: Promise<unknown>[] = [];
  const paths: Array<{ path: string; status: number; type: string }> = [];
  const carriesTin = (req: any): boolean | null => {
    try {
      if (String(req?.url?.() || '').includes(idCode)) return true;
      const body = req?.postData?.();
      return typeof body === 'string' ? body.includes(idCode) : null;
    } catch {
      return null;
    }
  };
  const onResponse = (r: any) => {
    try {
      const req = r.request?.();
      const kind = String(req?.resourceType?.() || '');
      const u = new URL(String(r.url?.() || ''));
      if (!/(^|\.)rs\.ge$/i.test(u.hostname)) return;
      if ((kind === 'xhr' || kind === 'fetch' || kind === 'document') && paths.length < 12) paths.push({ path: u.pathname.slice(0, 80), status: Number(r.status?.()) || 0, type: kind });
      if (!RS_GRID_PATH.test(u.pathname)) return;
      let contentType: string | null = null;
      try {
        contentType = String(r.headers?.()['content-type'] ?? '') || null;
      } catch {
        /* no headers */
      }
      const cap: RsGridCapture = { status: Number(r.status?.()) || 0, contentType, body: null, requestHadTin: carriesTin(req) };
      captures.push(cap);
      pending.push(
        Promise.resolve(r.text?.())
          .then((t: unknown) => {
            cap.body = typeof t === 'string' ? t : null;
          })
          .catch(() => {
            /* body unreadable: classified as an empty answer */
          }),
      );
    } catch {
      /* unreadable response */
    }
  };
  const onFailed = (req: any) => {
    try {
      const u = new URL(String(req?.url?.() || ''));
      if (!/(^|\.)rs\.ge$/i.test(u.hostname) || !RS_GRID_PATH.test(u.pathname)) return;
      const why = String(req?.failure?.()?.errorText || 'request failed').replace(/[^\w:. -]/g, '').slice(0, 80);
      captures.push({ status: 0, contentType: null, body: null, networkError: why || 'request failed', requestHadTin: carriesTin(req) });
    } catch {
      /* unreadable request */
    }
  };
  (page as any).on?.('response', onResponse);
  (page as any).on?.('requestfailed', onFailed);
  return {
    captures,
    paths,
    /** Let in-flight body reads finish (bounded). */
    async settle(ms: number): Promise<void> {
      await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, ms))]);
    },
    stop(): void {
      (page as any).off?.('response', onResponse);
      (page as any).off?.('requestfailed', onFailed);
    },
  };
}

/** Taxpayer text for the entity scanner and resultContext: "label: value" lines. */
const rowText = (row: Record<string, string>): string =>
  Object.entries(row)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
    .slice(0, 4000);

/**
 * RS uses a normal, always-visible reCAPTCHA v2 widget. Merely seeing
 * `.g-recaptcha` therefore does NOT mean the verification step is pending.
 * The live flow:
 *   TIN -> Search #1 ("ძიება") -> RS asks for the security check ->
 *   the shared CAPTCHA service (2Captcha) solves the reCAPTCHA, the token is
 *   delivered where the widget puts a human's token -> "ძიება" is clicked
 *   automatically (Search #2) -> RS.ge's search endpoint answers ->
 *   the answer itself is classified and parsed (RsTaxpayerResponse.ts).
 * When automatic solving is unavailable (disabled, budget, unsupported) the
 * existing human path takes over. This helper only OBSERVES whether a
 * token is in place; it never solves anything itself.
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
    return buildResult('START', { forEntity, error: 'no identifier (TIN) supplied — RS Taxpayers Registry has no name-search field', rsVerification: rsRecord('VERIFICATION_FAILED', 'NOT_SEARCHED', null, 'NO_IDENTIFIER') });
  }
  const jobTag = opts.captcha ? opts.captcha.jobId.slice(0, 8) : null;

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
      return buildResult('SEARCH_CONTROL_NOT_FOUND', { forEntity, value: idCode, error: 'search field not found', rsVerification: rsRecord('VERIFICATION_FAILED', 'NOT_SEARCHED', idCode, 'SEARCH_CONTROL_NOT_FOUND') });
    }

    // THIS attempt's baseline, taken right before its own click.
    const before = await (page as any).mainFrame().locator('body').innerText({ timeout: 5000 }).catch(() => '');

    // Search #2 after an AUTOMATIC solve: its verdict comes from RS.ge's own
    // answer (or a FRESH warning render), never from what Search #1 left on
    // screen.
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
    const grid = watchGrid(page, idCode);
    (page as any).on?.('dialog', onDialog);
    const stopWatching = () => {
      grid.stop();
      (page as any).off?.('dialog', onDialog);
    };
    if (postSolve) {
      progress(opts, `SEARCH2_ATTEMPT_${opts._attempt!.n}`);
      await armFreshRenderWatch(page);
    } else progress(opts, opts.skipGoto ? 'SEARCH2_HUMAN' : 'SEARCH1');

    // Exact source-owned submit control. On the initial pass this is Search
    // #1 (which exposes the CAPTCHA gate). After a solve (or a human resume)
    // this is Search #2 (which returns the real result).
    const clickedAt = Date.now();
    const btn = (page as any).locator('#btnSearch1').first();
    let submitted = false;
    if (postSolve) {
      // After a solve the challenge overlay is still over the page.
      const r = await submitSearchInPage(page);
      logRs('search2_submitted', { jobId: jobTag, attempt: opts._attempt!.n, ...r });
      submitted = r.clicked;
    } else {
      try {
        if (await btn.isVisible()) {
          await btn.click({ timeout: 8000 });
          submitted = true;
        }
      } catch {
        submitted = (await submitSearchInPage(page)).clicked;
      }
    }
    if (!submitted) {
      try {
        await (page as any).locator(usedSelector).first().press('Enter');
        submitted = true;
      } catch {
        stopWatching();
        return buildResult('SUBMIT_FAILED', { forEntity, selector: usedSelector, value: idCode, error: 'submit failed', rsVerification: rsRecord('VERIFICATION_FAILED', 'NOT_SEARCHED', idCode, 'SUBMIT_FAILED') });
      }
    }

    await (page as any).waitForTimeout(1000);

    // Wait for whichever comes first: RS.ge's answer to the search, a fresh
    // render of its warning (post-solve only), or a new result on the page.
    let sig: Awaited<ReturnType<typeof waitForResultSignal>> = { changed: false, after: before, signal: null, queryEchoed: false, waitedMs: 0 };
    let fresh: { mutations: number; warnRendered: number } | null = null;
    const deadline = Date.now() + (postSolve ? (opts.postSolveWaitMs ?? RS_POST_SOLVE_WAIT_MS) : 10_000);
    for (;;) {
      if (grid.captures.length) break;
      sig = await waitForResultSignal((page as any).mainFrame(), before, idCode, { timeoutMs: 1000 });
      if (grid.captures.length) break;
      if (sig.changed) {
        // The page moved; give the search answer a moment to land too.
        const until = Math.min(deadline, Date.now() + 3000);
        while (!grid.captures.length && Date.now() < until) await (page as any).waitForTimeout(250);
        break;
      }
      if (postSolve) {
        fresh = await readFreshRenderWatch(page);
        if ((fresh?.warnRendered ?? 0) > 0 || dialogWarn) break;
      }
      if (Date.now() >= deadline) break;
    }
    await grid.settle(5000);
    if (postSolve) fresh = await readFreshRenderWatch(page);
    // The page as it is NOW (the result may have rendered after the answer).
    if (!sig.changed) sig = await waitForResultSignal((page as any).mainFrame(), before, idCode, { timeoutMs: 500 });
    stopWatching();
    if (postSolve) logRs('search2_network', { jobId: jobTag, attempt: opts._attempt!.n, requests: grid.paths });

    const capture = grid.captures.length ? grid.captures[grid.captures.length - 1] : null;
    const cls = capture ? classifyRsGridResponse(capture) : null;
    if (capture) {
      const probe = buildRsVerificationRecord({ capture, classification: cls, tin: idCode, sourceUrl: RSTAX_URL });
      logRs('search_answer', { jobId: jobTag, attempt: opts._attempt?.n ?? 0, phase: postSolve ? 'SEARCH2' : opts.skipGoto ? 'SEARCH2_HUMAN' : 'SEARCH1', answers: grid.captures.length, waitedMs: Date.now() - clickedAt, ...rsRecordLogFields(probe) });
    }

    const verified = postSolve ? opts._attempt! : null;
    const withCaptcha = (r: LegacySourceResult): LegacySourceResult => (verified ? ({ ...r, captchaResolution: [verified.log] } as LegacySourceResult) : r);
    const accept = async () => {
      if (!verified) return;
      await opts.captcha!.service.reportAcceptance({ provider: 'rstax', jobId: opts.captcha!.jobId }, verified.solved!, true);
      verified.log.outcome = 'ACCEPTED';
      logRs('post_solve_outcome', { jobId: jobTag, attempt: verified.n, outcome: 'ACCEPTED', basis: cls ? 'SERVER_ANSWER' : 'PAGE', waitedMs: Date.now() - clickedAt });
    };
    const noChange = (why: string) => {
      if (!verified) return;
      opts.captcha!.service.reportNoChange({ provider: 'rstax', jobId: opts.captcha!.jobId }, verified.solved!);
      verified.log.outcome = 'NO_CHANGE';
      logRs('post_solve_outcome', { jobId: jobTag, attempt: verified.n, outcome: 'NO_CHANGE', basis: why, gateShown: false, mutations: fresh?.mutations ?? null, warnRendered: fresh?.warnRendered ?? null, viaDialog: dialogWarn, waitedMs: Date.now() - clickedAt });
    };

    // ── 1. RS.ge answered the search: a record, or a valid empty answer. ──
    if (cls && (cls.outcome === 'ACCEPTED' || cls.outcome === 'NO_RESULT')) {
      await accept();
      const rec = buildRsVerificationRecord({ capture, classification: cls, tin: idCode, sourceUrl: RSTAX_URL });
      if (cls.outcome === 'NO_RESULT') {
        return withCaptcha(buildResult('NO_RESULT_CONFIRMED', { forEntity, selector: usedSelector, value: idCode, resultText: 'RS.ge returned no taxpayer record for this identifier.', rsVerification: rec }));
      }
      const row = pickRsRow(cls.rows, idCode)!;
      const taxpayerData = mapRsRow(row, idCode);
      const text = rowText(row);
      if (entities) entities.scanText(text, { source: 'rstax', sourceDocument: RSTAX_SOURCE_META.url, retrievedAt: new Date().toISOString() });
      logRs('taxpayer_parsed', { jobId: jobTag, rows: cls.rows.length, mapped: Object.entries(taxpayerData).filter(([k, v]) => k !== 'otherPublicFields' && v).map(([k]) => k), otherFields: Object.keys(taxpayerData.otherPublicFields) });
      return withCaptcha(buildResult('SEARCH_CONFIRMED', { forEntity, selector: usedSelector, value: idCode, resultText: text, taxpayerData, rsVerification: rec }));
    }

    // ── 2. A transport failure: RS.ge did not answer (network / 5xx). ──
    if (cls && (cls.outcome === 'NETWORK_ERROR' || (cls.outcome === 'HTTP_ERROR' && rsStatusForOutcome('HTTP_ERROR', capture!.status) === 'TEMPORARILY_UNAVAILABLE'))) {
      noChange(cls.outcome);
      const rec = buildRsVerificationRecord({ capture, classification: cls, tin: idCode, sourceUrl: RSTAX_URL });
      return withCaptcha(buildResult('TEMPORARILY_UNAVAILABLE', { forEntity, selector: usedSelector, value: idCode, error: `RS.ge search endpoint unavailable (${cls.reason ?? cls.outcome})`, rsVerification: rec }));
    }

    // A DOM-only reading, for pages whose answer was not captured (or not structured).
    const domRead = (): { status: 'NO_RESULT_CONFIRMED' | 'SEARCH_CONFIRMED'; data: RsTaxpayerPublicData | null } | null => {
      if (!sig.changed) return null;
      if (hasNoResultPhrase(sig.after)) return { status: 'NO_RESULT_CONFIRMED', data: null };
      const d = parseRsTaxpayerFields(sig.after, idCode);
      return hasParsedTaxpayerEvidence(d) ? { status: 'SEARCH_CONFIRMED', data: d } : null;
    };

    if (postSolve) {
      const att = opts._attempt!;
      const cap = opts.captcha!;
      // ── 3. Refused: by the server's own answer, or a FRESH warning render. ──
      const freshWarn = (fresh?.warnRendered ?? 0) > 0 || dialogWarn;
      if (cls?.outcome === 'REJECTED' || (!cls && freshWarn)) {
        logRs('post_solve_outcome', { jobId: jobTag, attempt: att.n, outcome: 'REJECTED', basis: cls ? 'SERVER_ANSWER' : 'FRESH_WARNING', gateShown: true, mutations: fresh?.mutations ?? null, warnRendered: fresh?.warnRendered ?? null, viaDialog: dialogWarn, waitedMs: Date.now() - clickedAt });
        // A fresh token through the same integration would be refused the
        // same way, so no second paid solve.
        await cap.service.reportAcceptance({ provider: 'rstax', jobId: cap.jobId }, att.solved!, false);
        att.log.outcome = 'REJECTED';
        const rec = cls
          ? buildRsVerificationRecord({ capture, classification: cls, tin: idCode, sourceUrl: RSTAX_URL })
          : rsRecord('VERIFICATION_FAILED', 'REJECTED', idCode, freshWarn && dialogWarn ? 'WARNING_DIALOG' : 'WARNING_RENDERED');
        return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, rsVerification: rec }), status: 'WAITING_HUMAN', captchaResolution: [att.log] } as LegacySourceResult;
      }
      const dom = domRead();
      // The page decides only when RS.ge's own answer does not contradict it.
      if (dom && rsPageReadDecides(cls, dom.status)) {
        await accept();
        if (dom.status === 'SEARCH_CONFIRMED' && entities) entities.scanText(sig.after, { source: 'rstax', sourceDocument: RSTAX_SOURCE_META.url, retrievedAt: new Date().toISOString() });
        const rec = rsRecord('VERIFIED', dom.status === 'SEARCH_CONFIRMED' ? 'ACCEPTED' : 'NO_RESULT', idCode, cls ? `PAGE_READ_${cls.outcome}` : 'PAGE_READ', capture, cls);
        return withCaptcha(buildResult(dom.status, { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, taxpayerData: dom.data, rsVerification: rec }));
      }
      // ── 4. RS.ge answered 200 with something we cannot read: never solve
      // again (the token was evidently taken), store the answer for diagnosis.
      if (cls) {
        noChange(`SERVER_${cls.outcome}`);
        const rec = buildRsVerificationRecord({ capture, classification: cls, tin: idCode, sourceUrl: RSTAX_URL });
        return withCaptcha(buildResult('VERIFICATION_FAILED', { forEntity, selector: usedSelector, value: idCode, error: `RS.ge answered but the answer could not be read (${cls.reason ?? cls.outcome})`, rsVerification: rec }));
      }
      // ── 5. No answer, no fresh render at all: a stale screen says nothing
      // about the token. One more attempt within the cap is allowed.
      noChange('NO_ANSWER');
      const auto = await tryAutoVerifyRs(page, forEntity, entities, cap, { ...att, solved: null }, opts);
      if (auto.result) return auto.result;
      return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, rsVerification: rsRecord('TEMPORARILY_UNAVAILABLE', 'NO_RESPONSE', idCode, `CAPTCHA_${auto.log.outcome}`) }), status: 'WAITING_HUMAN', captchaResolution: [auto.log] } as LegacySourceResult;
    }

    // ── Search #1, or a human-resumed search. ──
    const dom = domRead();
    if (dom && rsPageReadDecides(cls, dom.status)) {
      if (dom.status === 'SEARCH_CONFIRMED' && entities) entities.scanText(sig.after, { source: 'rstax', sourceDocument: RSTAX_SOURCE_META.url, retrievedAt: new Date().toISOString() });
      const rec = rsRecord('VERIFIED', dom.status === 'SEARCH_CONFIRMED' ? 'ACCEPTED' : 'NO_RESULT', idCode, cls ? `PAGE_READ_${cls.outcome}` : 'PAGE_READ', capture, cls);
      return buildResult(dom.status, { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, taxpayerData: dom.data, rsVerification: rec });
    }
    const solved = await rsCaptchaSolved(page);

    // Source-specific CAPTCHA gate. The generic challenge() detector cannot
    // be used here because RS keeps the reCAPTCHA widget visible even AFTER
    // it has been solved. On Search #1 the warning on screen is the one this
    // very search rendered (there was no earlier search), so reading it is
    // sound here — unlike after a solve, where only a FRESH render counts.
    const gate =
      cls?.outcome === 'REJECTED' ||
      (!cls || cls.outcome === 'UNPARSEABLE'
        ? RSTAX_CAPTCHA_BLOCK_PHRASE.test(sig.after) || (!solved && /g-recaptcha|recaptcha/i.test(await (page as any).locator('body').innerHTML().catch(() => '')))
        : false);
    if (gate) {
      if (opts.captcha) {
        const auto = await tryAutoVerifyRs(page, forEntity, entities, opts.captcha, undefined, opts);
        if (auto.result) return auto.result;
        return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, rsVerification: rsRecord('PENDING_VERIFICATION', 'NOT_SEARCHED', idCode, `CAPTCHA_${auto.log.outcome}`) }), status: 'WAITING_HUMAN', captchaResolution: [auto.log] } as LegacySourceResult;
      }
      return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, rsVerification: rsRecord('PENDING_VERIFICATION', 'NOT_SEARCHED', idCode, 'HUMAN_VERIFICATION') }), status: 'WAITING_HUMAN' };
    }

    if (cls) {
      // RS.ge answered (no gate shown) with something we cannot read.
      const rec = buildRsVerificationRecord({ capture, classification: cls, tin: idCode, sourceUrl: RSTAX_URL });
      return buildResult('VERIFICATION_FAILED', { forEntity, selector: usedSelector, value: idCode, error: `RS.ge answered but the answer could not be read (${cls.reason ?? cls.outcome})`, rsVerification: rec });
    }
    if (!sig.changed) {
      return buildResult('SUBMITTED_UNCONFIRMED', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, error: 'search submitted but no new result signal appeared', rsVerification: rsRecord('TEMPORARILY_UNAVAILABLE', 'NO_RESPONSE', idCode, 'NO_ANSWER') });
    }
    return buildResult('SUBMITTED_UNPARSED', {
      forEntity,
      selector: usedSelector,
      value: idCode,
      resultText: sig.after,
      error: 'search submitted and page changed, but no parseable taxpayer fields were found — not treated as confirmed evidence',
      rsVerification: rsRecord('VERIFICATION_FAILED', 'NO_RESPONSE', idCode, 'PAGE_UNPARSED'),
    });
  } catch (e) {
    return buildResult('FAILED', { forEntity, error: String(e), rsVerification: rsRecord('TEMPORARILY_UNAVAILABLE', 'NO_RESPONSE', idCode, 'EXCEPTION') });
  }
}
