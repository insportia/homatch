// GenericWorkflow.ts — NOT part of the mandate's four named FSMs. Kept only
// for the pre-existing 'napr' source and property-mode's primary 'enreg'
// step (a free-text property description, not a discovered-entity lookup) —
// both were already just a generic header/nav-scoped fallback scan in the
// pre-refactor architecture (genericAdapter()), with no source-specific
// selectors ever established. Ported as-is, honestly labeled: this is the
// one place in the new architecture WITHOUT a dedicated FSM, because the
// mandate itself gives no spec for napr.gov.ge (which has no accessible
// public search entry point at all — confirmed in an earlier session) or
// for a free-text property search on ENREG.
import type { Page } from 'playwright';
import { interact, waitForResultSignal, hasNoResultPhrase } from '../../browser/BrowserSession.js';
import type { LegacySourceResult } from '../WorkflowResult.js';

export async function runGenericWorkflow(page: Page, source: string, sourceMeta: { name: string; class: string; url: string }, query: string): Promise<LegacySourceResult> {
  try {
    await (page as any).goto(sourceMeta.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
    const hit = await interact(page as any, query, [], { fallback: true });
    if (!hit.found) {
      return legacy(source, sourceMeta, 'SEARCH_CONTROL_NOT_FOUND', null, null, query, 'no search control found (generic fallback scan)');
    }
    const sig = await waitForResultSignal(hit.frame, hit.before || '', query);
    const status = !sig.changed ? 'SUBMITTED_UNCONFIRMED' : hasNoResultPhrase(sig.after) ? 'NO_RESULT_CONFIRMED' : 'SEARCH_CONFIRMED';
    return legacy(source, sourceMeta, status, hit.selector || null, sig.after, query, null);
  } catch (e) {
    return legacy(source, sourceMeta, 'FAILED', null, null, query, String(e));
  }
}

function legacy(source: string, meta: { name: string; class: string; url: string }, status: string, selector: string | null, resultText: string | null, q: string, error: string | null): LegacySourceResult {
  return {
    source,
    sourceName: meta.name,
    sourceClass: meta.class,
    sourceUrl: meta.url,
    startUrl: meta.url,
    finalUrl: meta.url,
    frameUrls: [],
    searchControlUsed: selector,
    queryEntered: selector ? q : null,
    submitAction: selector ? 'ENTER_KEY' : null,
    resultContext: resultText || error,
    resultConfirmed: status === 'SEARCH_CONFIRMED',
    noResultConfirmed: status === 'NO_RESULT_CONFIRMED',
    resultValidated: status === 'SEARCH_CONFIRMED',
    status,
    traversal: null,
    retrievedAt: new Date().toISOString(),
    documents: [],
    discoveredEntities: [],
    error,
  };
}
