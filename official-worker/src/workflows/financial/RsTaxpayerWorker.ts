// RsTaxpayerWorker.ts — RS Taxpayers Registry ('rstax'), rs.ge, as its OWN
// fully independent worker.
import type { Page } from 'playwright';
import { waitForResultSignal, hasNoResultPhrase } from '../../browser/BrowserSession.js';
import { RSTAX_URL, RSTAX_ID_INPUT_SELECTORS, RSTAX_CAPTCHA_BLOCK_PHRASE, RSTAX_SOURCE_META } from './selectors.js';
import type { LegacySourceResult, RsTaxpayerPublicData } from '../WorkflowResult.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import { parseRsTaxpayerFields, hasParsedTaxpayerEvidence } from './RsTaxpayerParsing.js';

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
  opts: { skipGoto?: boolean } = {}
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
      return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after }), status: 'WAITING_HUMAN' };
    }

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

    return buildResult(status, {
      forEntity,
      selector: usedSelector,
      value: idCode,
      resultText: sig.after,
      taxpayerData,
      error: status === 'SUBMITTED_UNPARSED' ? 'search submitted and page changed, but no parseable taxpayer fields were found — not treated as confirmed evidence' : null,
    });
  } catch (e) {
    return buildResult('FAILED', { forEntity, error: String(e) });
  }
}
