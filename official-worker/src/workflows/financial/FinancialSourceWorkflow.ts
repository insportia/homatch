// FinancialSourceWorkflow.ts — RS Taxpayers Registry ('rstax') and MyGov
// Debtor Registry ('debtor'). Added by the "FINAL PRE-PUSH CONSOLIDATION /
// ADAPTIVE RESEARCH ENGINE" mandate's "FINANCIAL/COMPANY SOURCE EXPANSION"
// section. Both sources share the exact same real shape (one identifier
// field, one real submit button already matched by BrowserSession's
// existing submitNear() role/name patterns, a public no-result phrase or a
// CAPTCHA gate) confirmed by live inspection via the user's own connected
// browser — see selectors.ts's own comments for the exact confirmed
// controls and observed behavior for each.
//
// Deliberately NOT a full per-source FSM like EnregState.ts/MyGovState.ts:
// the mandate gives these two sources a single flat step ("fill the
// identifier, submit, read what the registry actually says"), with no
// further drill-down (no applications list, no nested documents) — a
// dedicated state machine would be complexity with nothing real to
// enumerate. This mirrors GenericWorkflow.ts's shape (also a flat,
// non-FSM source) but, unlike GenericWorkflow, uses REAL confirmed
// selectors (not a blind fallback scan) and explicitly checks for a
// CAPTCHA challenge before ever evaluating result text — RS Taxpayers in
// particular was confirmed live to ALWAYS block an unsolved search behind
// its own client-side check (a permanently-visible, non-invisible
// reCAPTCHA checkbox), which is not itself a "no result" state and must
// never be misread as one.
//
// Both sources only accept a single national/company identifier — neither
// exposes a name-search field (confirmed live) — so a candidate with no
// idCode is a clean precondition skip (mandate: "not every property has a
// ... debtor result ... relevant absence, not a broader guarantee"),
// never a guessed/attempted name search.
import type { Page } from 'playwright';
import { interact, waitForResultSignal, hasNoResultPhrase, challenge } from '../../browser/BrowserSession.js';
import { RSTAX_URL, RSTAX_ID_INPUT_SELECTORS, RSTAX_CAPTCHA_BLOCK_PHRASE, RSTAX_SOURCE_META, DEBTOR_URL, DEBTOR_ID_INPUT_SELECTORS, DEBTOR_SOURCE_META } from './selectors.js';
import type { LegacySourceResult } from '../WorkflowResult.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';

export type FinancialSourceKey = 'rstax' | 'debtor';

const CONFIG: Record<FinancialSourceKey, { url: string; hints: string[]; meta: { name: string; class: string; url: string } }> = {
  rstax: { url: RSTAX_URL, hints: RSTAX_ID_INPUT_SELECTORS, meta: RSTAX_SOURCE_META },
  debtor: { url: DEBTOR_URL, hints: DEBTOR_ID_INPUT_SELECTORS, meta: DEBTOR_SOURCE_META },
};

function buildResult(sourceKey: FinancialSourceKey, status: string, opts: { selector?: string | null; value?: string | null; resultText?: string | null; error?: string | null; forEntity: { name: string; idCode: string | null } | null }): LegacySourceResult {
  const meta = CONFIG[sourceKey].meta;
  return {
    source: sourceKey,
    sourceName: meta.name,
    sourceClass: meta.class,
    sourceUrl: meta.url,
    startUrl: meta.url,
    finalUrl: meta.url,
    frameUrls: [],
    searchControlUsed: opts.selector || null,
    queryEntered: opts.value || null,
    submitAction: opts.selector ? 'CLICK button[name~=ძებნა|ძიება]' : null,
    resultContext: opts.resultText || opts.error || null,
    resultConfirmed: status === 'SEARCH_CONFIRMED',
    noResultConfirmed: status === 'NO_RESULT_CONFIRMED',
    resultValidated: status === 'SEARCH_CONFIRMED',
    status,
    // No dedicated FSM/traversal ladder for these two flat sources (see
    // this file's own header) — left null rather than fabricating a
    // traversal object with no real per-item enumeration behind it.
    traversal: null,
    retrievedAt: new Date().toISOString(),
    documents: [],
    discoveredEntities: [],
    forEntity: opts.forEntity,
    error: opts.error || null,
  };
}

export async function runFinancialSourceWorkflow(
  page: Page,
  sourceKey: FinancialSourceKey,
  forEntity: { name: string; idCode: string | null } | null,
  _entities?: EntityQueue,
  opts: { skipGoto?: boolean } = {}
): Promise<LegacySourceResult> {
  const cfg = CONFIG[sourceKey];
  const idCode = forEntity?.idCode ? String(forEntity.idCode).trim() : null;

  // Neither source exposes a name-only search (confirmed live) — a
  // candidate with no company/person identifier is a clean, honest skip,
  // never a guessed name-field attempt.
  if (!forEntity || !idCode) {
    return buildResult(sourceKey, 'START', { forEntity, error: 'no identifier (TIN/ID code) supplied — this source has no name-search field' });
  }

  try {
    if (!opts.skipGoto) {
      await (page as any).goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await (page as any).waitForTimeout(1500);
    }

    const hit = await interact(page as any, idCode, cfg.hints, {});
    if (!hit.found) {
      return buildResult(sourceKey, 'SEARCH_CONTROL_NOT_FOUND', { forEntity, value: idCode, error: 'search field not found' });
    }
    if (!hit.sub?.ok) {
      return buildResult(sourceKey, 'SUBMIT_FAILED', { forEntity, selector: hit.selector, value: idCode, error: 'submit failed' });
    }

    // Checked BEFORE evaluating result text (never lumped in with a
    // no-result phrase) — RS Taxpayers in particular was confirmed live to
    // block every unsolved search behind a permanently-visible reCAPTCHA
    // checkbox; MyGov Debtor's invisible reCAPTCHA usually passes silently
    // but is checked defensively for the rarer challenged case. Never
    // solved or bypassed (mandate: "NEVER automate challenge tiles").
    const cap = await challenge(page as any);
    if (cap) {
      return { ...buildResult(sourceKey, 'WAITING_HUMAN', { forEntity, selector: hit.selector, value: idCode, error: null }), status: 'WAITING_HUMAN' };
    }

    const sig = await waitForResultSignal(hit.frame, hit.before || '', idCode);
    // RS Taxpayers' own client-side captcha-block banner ("გთხოვთ
    // მონიშნოთ უსაფრთხოების ღილაკი!") is a distinct signal from both "no
    // result" and "result found" — checked before hasNoResultPhrase() so
    // an unsolved captcha can never be misread as a confirmed empty
    // registry search (mandate: "TECHNICAL FAILURE ≠ PROPERTY RISK" — and
    // by the same logic, a blocked search is not evidence of anything
    // about the taxpayer).
    if (sourceKey === 'rstax' && RSTAX_CAPTCHA_BLOCK_PHRASE.test(sig.after)) {
      return { ...buildResult(sourceKey, 'WAITING_HUMAN', { forEntity, selector: hit.selector, value: idCode, resultText: sig.after }), status: 'WAITING_HUMAN' };
    }
    if (!sig.changed) {
      return buildResult(sourceKey, 'SUBMITTED_UNCONFIRMED', { forEntity, selector: hit.selector, value: idCode, resultText: sig.after, error: 'search submitted but no new result signal appeared' });
    }
    const status = hasNoResultPhrase(sig.after) ? 'NO_RESULT_CONFIRMED' : 'SEARCH_CONFIRMED';
    return buildResult(sourceKey, status, { forEntity, selector: hit.selector, value: idCode, resultText: sig.after });
  } catch (e) {
    return buildResult(sourceKey, 'FAILED', { forEntity, error: String(e) });
  }
}
