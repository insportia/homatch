// HOMATCH Verify — the official-source payload a research-stage MODEL sees.
//
// research-agent used to hand the OFFICIAL stage
// `JSON.stringify(browserOfficial).slice(0, 24000)`. With TAS API_FIRST that
// is an arbitrary cut through dozens of cases of raw text: whatever happened
// to sit past character 24,000 — often the most recent decisions — was
// silently dropped. Here TAS's raw case text is replaced by its deterministic
// digest (every material fact and decision always present, archived detail
// counted), and the other sources pass through exactly as before.
//
// Pure. No network, no clock beyond the injected `nowIso`.

import { buildTasIntelligence, tasDigest } from './tasIntelligence.ts';

export const TAS_PROMPT_DIGEST_BUDGET = 9000;

export function promptSafeBrowserOfficial(
  browserOfficial: unknown,
  nowIso = new Date().toISOString(),
): { payload: unknown; tasDigest: string | null } {
  const bo = browserOfficial && typeof browserOfficial === 'object' ? (browserOfficial as Record<string, any>) : {};
  const results = Array.isArray(bo.results) ? bo.results : [];
  const hasApiTas = results.some((r: any) => r?.source === 'tas' && r?.tasApi);
  if (!hasApiTas) return { payload: browserOfficial ?? {}, tasDigest: null };
  const intel = buildTasIntelligence({ browserOfficial: bo }, nowIso);
  const digest = intel.available ? tasDigest(intel, () => null, TAS_PROMPT_DIGEST_BUDGET).text : null;
  return {
    payload: {
      ...bo,
      results: results.map((r: any) =>
        r?.source === 'tas' && r?.tasApi
          ? {
              source: 'tas',
              sourceName: r.sourceName,
              status: r.status,
              resultConfirmed: r.resultConfirmed,
              noResultConfirmed: r.noResultConfirmed,
              originalCadastralCode: r.originalCadastralCode,
              resolvedSearchCadastralCode: r.resolvedSearchCadastralCode,
              casesFound: Array.isArray(r.documents) ? r.documents.length : 0,
              note: 'TAS case text is summarised in OFFICIAL TAS HISTORY below.',
            }
          : r,
      ),
    },
    tasDigest: digest,
  };
}
