// HOMATCH — resolving and persisting a campaign's search languages.
//
// The DECISION is in src/research-core/discovery/campaign-languages.ts, which
// is pure and has no database in it. This is the half that reads rows, writes
// rows, and makes sure the two halves cannot disagree.
//
// WHY THE SERVER RESOLVES AGAIN
//
// The launch screen previews the set by calling resolveCampaignLanguages
// itself, so what the customer sees is what will run. But the client sends
// the CHOICE — mode plus ticks — not the conclusion, and this re-runs the
// same function over it. A client that posted `resolved: [all six]` under
// mode EXPLICIT would otherwise widen its own campaign, and the widening is
// exactly the thing the whole feature promises never happens.
//
// WHAT A RESUME MUST NOT DO
//
// Re-decide. A campaign that stopped with Hebrew selected resumes with Hebrew
// selected, whatever today's market defaults or registry evidence would
// suggest — so `searchLanguages` absent from the request means "keep what the
// campaign has", and only an explicit new choice replaces it.
//
// WHAT A RESUME MUST NOT PAY FOR
//
// What it already bought. search_languages_discovered records the languages
// this campaign has completed discovery in; the delta against the resolved
// set is what the run actually schedules. Adding Russian to a Hebrew campaign
// schedules Russian.

import {
  type CampaignLanguageSelection,
  type CampaignSearchLanguage,
  isCampaignSearchLanguage,
  type LanguageEvidence,
  type LanguageMode,
  languageDelta,
  resolveCampaignLanguages,
} from '../../../src/research-core/discovery/campaign-languages.ts';

export type { CampaignSearchLanguage, LanguageMode };

export interface LanguageChoice {
  mode: LanguageMode;
  selected: string[];
}

/** Whatever arrived in the request body, or null when nothing usable did. */
export function readChoice(raw: unknown): LanguageChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const mode = String(value.mode ?? '').toUpperCase();
  if (mode !== 'EXPLICIT' && mode !== 'AUTO' && mode !== 'ALL') return null;
  const selected = Array.isArray(value.selected)
    ? value.selected.map((entry) => String(entry).trim().toLowerCase()).filter(isCampaignSearchLanguage)
    : [];
  return { mode: mode as LanguageMode, selected };
}

/**
 * What the registry knows about which languages pay off in this market.
 *
 * Counted from sources we actually hold and signals that actually survived a
 * filter. An empty result is "no record yet", which the recommender treats as
 * unproven rather than as useless -- a language nothing has been scanned for
 * has not failed, it has not been tried.
 */
export async function loadLanguageEvidence(db: any, countryCode: string): Promise<LanguageEvidence[]> {
  try {
    const { data, error } = await db.rpc('campaign_language_evidence', {
      p_country_code: countryCode,
    });
    if (error || !Array.isArray(data)) return [];
    return data
      .filter((row: any) => isCampaignSearchLanguage(String(row?.language ?? '')))
      .map((row: any) => ({
        language: String(row.language) as CampaignSearchLanguage,
        knownSources: Number(row.known_sources ?? 0),
        usefulSignals: Number(row.useful_signals ?? 0),
      }));
  } catch {
    /*
     * The registry being unreachable is not evidence that a language is
     * unproductive. Falling back to the market default produces a WORSE
     * recommendation and an honest one, which is the right trade.
     */
    return [];
  }
}

export interface ResolvedCampaignLanguages {
  selection: CampaignLanguageSelection;
  /** Languages this run should actually discover in. */
  toDiscover: CampaignSearchLanguage[];
  /** Already bought by an earlier run of this campaign. Not re-scheduled. */
  alreadyDiscovered: CampaignSearchLanguage[];
  /** True when the stored configuration was used rather than a new choice. */
  fromStoredConfiguration: boolean;
}

/**
 * Decide the languages for this run, and say which of them are new work.
 *
 * `stored` is the campaign row. `choice` is what the request carried, or null
 * for a resume that is not re-choosing.
 */
export async function resolveForRun(
  db: any,
  options: {
    countryCode: string;
    choice: LanguageChoice | null;
    stored: {
      search_language_mode?: string | null;
      search_languages_selected?: string[] | null;
      search_languages_resolved?: string[] | null;
      search_languages_discovered?: string[] | null;
    } | null;
  },
): Promise<ResolvedCampaignLanguages> {
  const stored = options.stored ?? {};
  const alreadyDiscovered = (stored.search_languages_discovered ?? []).filter(isCampaignSearchLanguage);

  /*
   * A resume with no new choice keeps exactly what was stored -- including
   * the mode, so an EXPLICIT campaign does not quietly become an AUTO one
   * and pick up two more languages on its second run.
   */
  const effective: LanguageChoice | null = options.choice ?? (
    stored.search_language_mode
      ? {
          mode: stored.search_language_mode as LanguageMode,
          selected: (stored.search_languages_selected ?? []).filter(isCampaignSearchLanguage),
        }
      : null
  );

  const evidence = await loadLanguageEvidence(db, options.countryCode);

  const selection = resolveCampaignLanguages({
    // A campaign that has never had a selection gets the recommendation,
    // which is the same thing it effectively had before this existed.
    mode: effective?.mode ?? 'AUTO',
    selected: effective?.selected ?? [],
    countryCode: options.countryCode,
    evidence,
  });

  const delta = languageDelta(alreadyDiscovered, selection.languages);

  return {
    selection,
    toDiscover: delta.added,
    alreadyDiscovered: delta.unchanged,
    fromStoredConfiguration: options.choice === null && effective !== null,
  };
}

/** Write the decision onto the campaign, so a resume reads it back. */
export async function persistCampaignLanguages(
  db: any,
  campaignId: string,
  resolved: ResolvedCampaignLanguages,
): Promise<void> {
  const { selection } = resolved;
  const { error } = await db.from('matching_campaigns').update({
    search_language_mode: selection.mode,
    /*
     * Kept even under AUTO. "They accepted our suggestion" and "they chose
     * this themselves" are different facts, and a year later only this column
     * can tell them apart.
     */
    search_languages_selected: selection.mode === 'EXPLICIT' ? selection.languages : [],
    search_languages_resolved: selection.languages,
    // A snapshot of the reasons AS SHOWN. Recomputing later would answer with
    // today's evidence about a decision made against last month's.
    search_language_rationale: selection.rationale,
    search_language_updated_at: new Date().toISOString(),
  }).eq('id', campaignId);
  if (error) throw error;
}

/**
 * Record that a language's discovery has now been paid for.
 *
 * Called only on a run that actually completed discovery for it. Marking a
 * language discovered after a run that failed would make the next resume skip
 * it, and the customer would have paid for a language that was never searched.
 */
export async function markLanguagesDiscovered(
  db: any,
  campaignId: string,
  languages: readonly CampaignSearchLanguage[],
): Promise<void> {
  if (languages.length === 0) return;
  const { data, error: readError } = await db
    .from('matching_campaigns')
    .select('search_languages_discovered')
    .eq('id', campaignId)
    .maybeSingle();
  if (readError) throw readError;

  const before = new Set((data?.search_languages_discovered ?? []).filter(isCampaignSearchLanguage));
  for (const language of languages) before.add(language);

  const { error } = await db.from('matching_campaigns')
    .update({ search_languages_discovered: [...before] })
    .eq('id', campaignId);
  if (error) throw error;
}

/**
 * Fold one run's per-language counts into the campaign's coverage.
 *
 * Additive, because a campaign is a series of runs and the workspace shows
 * the campaign. The per-job rows sit beside the roll-up so a single run stays
 * answerable too.
 */
export interface LanguageCoverageCounts {
  language: CampaignSearchLanguage;
  attempted?: number;
  reached?: number;
  blocked?: number;
  signalsFound?: number;
  signalsValid?: number;
  signalsUnique?: number;
  signalsDuplicate?: number;
  signalsStale?: number;
  signalsRevalidated?: number;
}

export async function recordLanguageCoverage(
  db: any,
  campaignId: string,
  jobId: string | null,
  rows: readonly LanguageCoverageCounts[],
): Promise<void> {
  if (!rows.length) return;
  const now = new Date().toISOString();

  for (const row of rows) {
    const counts = {
      attempted: int(row.attempted),
      reached: int(row.reached),
      blocked: int(row.blocked),
      signals_found: int(row.signalsFound),
      signals_valid: int(row.signalsValid),
      signals_unique: int(row.signalsUnique),
      signals_duplicate: int(row.signalsDuplicate),
      signals_stale: int(row.signalsStale),
      signals_revalidated: int(row.signalsRevalidated),
    };

    // The per-run row: what THIS job did, kept whole.
    if (jobId) {
      await db.from('campaign_language_coverage').insert({
        campaign_id: campaignId, job_id: jobId, language: row.language,
        ...counts, first_run_at: now, last_run_at: now,
      });
    }

    // The roll-up: read, add, write. Not an upsert with raw SQL because the
    // columns are additive and a plain upsert would REPLACE the totals with
    // one run's numbers, silently discarding every earlier run.
    const { data: existing } = await db
      .from('campaign_language_coverage')
      .select('id, attempted, reached, blocked, signals_found, signals_valid, signals_unique, signals_duplicate, signals_stale, signals_revalidated')
      .eq('campaign_id', campaignId)
      .eq('language', row.language)
      .is('job_id', null)
      .maybeSingle();

    if (existing) {
      await db.from('campaign_language_coverage').update({
        attempted: existing.attempted + counts.attempted,
        reached: existing.reached + counts.reached,
        blocked: existing.blocked + counts.blocked,
        signals_found: existing.signals_found + counts.signals_found,
        signals_valid: existing.signals_valid + counts.signals_valid,
        signals_unique: existing.signals_unique + counts.signals_unique,
        signals_duplicate: existing.signals_duplicate + counts.signals_duplicate,
        signals_stale: existing.signals_stale + counts.signals_stale,
        signals_revalidated: existing.signals_revalidated + counts.signals_revalidated,
        last_run_at: now,
      }).eq('id', existing.id);
    } else {
      await db.from('campaign_language_coverage').insert({
        campaign_id: campaignId, job_id: null, language: row.language,
        ...counts, first_run_at: now, last_run_at: now,
      });
    }
  }
}

function int(value: number | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}
