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
      return tryAutoVerifyRs(page, forEntity, entities, cap, { n: n + 1, solved: null, log });
    return { result: null, log };
  }
  // Exactly where reCAPTCHA puts a solved token, plus the page's own callback.
  await (page as any)
    .evaluate((token: string) => {
      // Runs in the page; typed through globalThis so the worker needs no DOM lib.
      const doc = (globalThis as any).document;
      for (const ta of Array.from(doc.querySelectorAll('textarea[name="g-recaptcha-response"]')) as any[]) {
        ta.value = token;
        ta.innerHTML = token;
      }
      const cbName = doc.querySelector('.g-recaptcha[data-callback]')?.getAttribute('data-callback');
      const cb = cbName ? (globalThis as any)[cbName] : null;
      if (typeof cb === 'function') cb(token);
    }, solved.token)
    .catch(() => {});
  const result = await runRsTaxpayerWorker(page, forEntity, entities, { skipGoto: true, captcha: cap, _attempt: { n: n + 1, solved: { solveId: solved.solveId, latencyMs: solved.latencyMs }, log } });
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
  opts: { skipGoto?: boolean; captcha?: CaptchaContext; _attempt?: RsCaptchaAttempt } = {}
): Promise<LegacySourceResult> {
  const idCode = forEntity?.idCode ? String(forEntity.idCode).trim() : null;
  if (!forEntity || !idCode) {
    return buildResult('START', { forEntity, error: 'no identifier (TIN) supplied — RS Taxpayers Registry has no name-search field' });
  }

  try {
    if (!opts.skipGoto) {
      await (page as any).goto(RSTAX_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await (page as any).waitForTimeout(1500);
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

    // Exact source-owned submit control. On the initial pass this is Search
    // #1 (which exposes the CAPTCHA gate). On same-session resume after the
    // user solves CAPTCHA, this is Search #2 (which returns the real result).
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
        return buildResult('SUBMIT_FAILED', { forEntity, selector: usedSelector, value: idCode, error: 'submit failed' });
      }
    }

    await (page as any).waitForTimeout(1000);

    const sig = await waitForResultSignal((page as any).mainFrame(), before, idCode);
    const solved = await rsCaptchaSolved(page);

    // Source-specific CAPTCHA gate. The generic challenge() detector cannot
    // be used here because RS keeps the reCAPTCHA widget visible even AFTER
    // it has been solved; doing so caused an endless WAITING_HUMAN loop on
    // resume. A visible widget is pending only when it is not proven solved,
    // or when RS explicitly says the security button must still be checked.
    if (RSTAX_CAPTCHA_BLOCK_PHRASE.test(sig.after) || (!solved && /g-recaptcha|recaptcha/i.test(await (page as any).locator('body').innerHTML().catch(() => '')))) {
      // A token we injected that left the gate in place was refused by RS.
      if (opts._attempt?.solved && opts.captcha) {
        await opts.captcha.service.reportAcceptance({ provider: 'rstax', jobId: opts.captcha.jobId }, opts._attempt.solved, false);
        opts._attempt.log.outcome = 'REJECTED';
      }
      if (opts.captcha) {
        const auto = await tryAutoVerifyRs(page, forEntity, entities, opts.captcha, opts._attempt ? { ...opts._attempt, solved: null } : undefined);
        if (auto.result) return auto.result;
        return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after }), status: 'WAITING_HUMAN', captchaResolution: [auto.log] } as LegacySourceResult;
      }
      return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after }), status: 'WAITING_HUMAN' };
    }
    // Past the gate after an automatic verification: RS accepted the token.
    const verified = opts._attempt?.solved && opts.captcha ? opts._attempt : null;

    if (!sig.changed) {
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
