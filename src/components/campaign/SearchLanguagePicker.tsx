// HOMATCH — which languages this campaign searches in.
//
// THE CONFUSION THIS SCREEN EXISTS TO PREVENT
//
// Three different things get called "language" around a campaign, and a
// customer will merge them unless the screen stops them:
//
//   the language they are READING Homatch in — irrelevant here, and the
//     component is given no access to it beyond writing one sentence saying
//     so. A broker working in Georgian running a Hebrew and Russian campaign
//     is the normal case in Tbilisi, not an edge case.
//   the languages Homatch SEARCHES in — this control.
//   whether a person found this way has to SPEAK one of them — a different
//     requirement entirely, set elsewhere, and deliberately not implied by
//     anything on this screen. A Hebrew-speaking investor is an excellent
//     match for a Georgian-language listing.
//
// WHY THE RECOMMENDATION IS ALWAYS VISIBLE
//
// Even under an explicit choice. A set of languages picked on the customer's
// behalf and never shown to them is a charge they cannot check — and a
// customer who chose Hebrew alone is better served by seeing "we would
// suggest Hebrew, Russian, English" than by us quietly adding two.
//
// The widening never happens. resolveCampaignLanguages returns exactly what
// was ticked under EXPLICIT, this component displays the difference, and the
// customer decides.

import { Check, Globe, Info } from 'lucide-react';
import React, { useMemo } from 'react';
import {
  CAMPAIGN_SEARCH_LANGUAGES,
  type CampaignLanguageSelection,
  type CampaignSearchLanguage,
  type LanguageEvidence,
  type LanguageMode,
  resolveCampaignLanguages,
} from '@/campaign/searchLanguages';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { SUPPORTED_LANGUAGES } from '@/types/types';

/**
 * How to write a language's name.
 *
 * The NAMES come from SUPPORTED_LANGUAGES, which is the interface-locale list
 * — but the SET comes from CAMPAIGN_SEARCH_LANGUAGES, which is the discovery
 * list. They happen to hold the same six today and they are not the same
 * thing: `hi` is a research language with no Homatch interface, and the day a
 * seventh discovery language is added this must not silently drop it. Hence
 * the fallback to the bare code rather than a filter.
 */
function languageName(code: CampaignSearchLanguage): string {
  return SUPPORTED_LANGUAGES.find((entry) => entry.code === code)?.nativeLabel ?? code.toUpperCase();
}

export function languageNames(codes: readonly CampaignSearchLanguage[]): string {
  return codes.map(languageName).join(', ');
}

export interface SearchLanguageValue {
  mode: LanguageMode;
  /** Only meaningful under EXPLICIT. Kept across mode switches so a customer
   *  who toggles to Recommended and back does not lose their ticks. */
  selected: CampaignSearchLanguage[];
}

export function SearchLanguagePicker({
  value,
  onChange,
  countryCode,
  evidence,
  /** Languages this campaign has already paid to discover in. */
  alreadyDiscovered,
  className,
}: {
  value: SearchLanguageValue;
  onChange: (next: SearchLanguageValue) => void;
  countryCode: string;
  /** What the registry has seen in this market. Absent is "no record yet". */
  evidence?: readonly LanguageEvidence[];
  alreadyDiscovered?: readonly string[];
  className?: string;
}) {
  const { t, lang } = useLanguage();

  /*
   * The resolver is the SAME function the planner and the edge function run.
   * Not a copy of its rules, and not an approximation of them: a preview that
   * disagrees with what gets billed is worse than no preview.
   */
  const resolved: CampaignLanguageSelection = useMemo(
    () => resolveCampaignLanguages({
      mode: value.mode,
      selected: value.selected,
      countryCode,
      evidence,
    }),
    [value.mode, value.selected, countryCode, evidence],
  );

  const newThisRun = useMemo(() => {
    const before = new Set(alreadyDiscovered ?? []);
    return resolved.languages.filter((language) => !before.has(language));
  }, [resolved.languages, alreadyDiscovered]);

  const alreadyRun = useMemo(() => {
    const before = new Set(alreadyDiscovered ?? []);
    return resolved.languages.filter((language) => before.has(language));
  }, [resolved.languages, alreadyDiscovered]);

  const toggle = (code: CampaignSearchLanguage) => {
    const next = value.selected.includes(code)
      ? value.selected.filter((entry) => entry !== code)
      : [...value.selected, code];
    // Ticking a box means the customer is choosing, so the mode follows the
    // action rather than needing a second click on a radio above it.
    onChange({ mode: 'EXPLICIT', selected: next });
  };

  const uiLanguageName = SUPPORTED_LANGUAGES.find((entry) => entry.code === lang)?.nativeLabel ?? lang;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-start gap-2">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{t('campaign_langs_title')}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('campaign_langs_help')}</p>
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="sr-only">{t('campaign_langs_title')}</legend>

        {(
          [
            ['AUTO', 'campaign_langs_mode_auto', 'campaign_langs_mode_auto_desc'],
            ['EXPLICIT', 'campaign_langs_mode_choose', 'campaign_langs_mode_choose_desc'],
            ['ALL', 'campaign_langs_mode_all', 'campaign_langs_mode_all_desc'],
          ] as const
        ).map(([mode, titleKey, descKey]) => (
          <label
            key={mode}
            className={cn(
              // 44px minimum: this is a phone control before it is a desktop one.
              'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
              value.mode === mode
                ? 'border-primary/50 bg-primary/5'
                : 'border-border/60 hover:border-border',
            )}
          >
            <input
              type="radio"
              name="campaign-search-language-mode"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={value.mode === mode}
              onChange={() => onChange({ ...value, mode })}
            />
            <span className="min-w-0">
              <span className="block text-sm text-foreground">{t(titleKey)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(descKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {value.mode === 'EXPLICIT' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {CAMPAIGN_SEARCH_LANGUAGES.map((code) => {
              const on = value.selected.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggle(code)}
                  aria-pressed={on}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                    on
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  {languageName(code)}
                </button>
              );
            })}
          </div>

          {/*
            * An empty selection is refused HERE rather than silently widened
            * downstream. The resolver falls back to the recommendation and
            * says so, but a customer should see the problem while they can
            * still fix it, not discover it in the receipt.
            */}
          {value.selected.length === 0 && (
            <p className="text-xs text-destructive">{t('campaign_langs_pick_one')}</p>
          )}

          {resolved.recommended.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('campaign_langs_suggestion').replace('{{languages}}', languageNames(resolved.recommended))}
            </p>
          )}
        </div>
      )}

      {value.mode !== 'EXPLICIT' && resolved.rationale.length > 0 && (
        <details className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <summary className="cursor-pointer list-none text-xs font-medium text-foreground">
            {t('campaign_langs_why')}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {resolved.rationale.map((entry) => (
              <li key={entry.language} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{languageName(entry.language)}</span>
                {' — '}
                {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/*
        * INCREMENTAL CONTINUATION, SAID BEFORE IT HAPPENS.
        *
        * A customer adding Russian to a Hebrew campaign should be able to see
        * that Hebrew is not being bought again. Showing it only in the
        * receipt is showing it too late to be reassuring.
        */}
      {alreadyRun.length > 0 && (
        <div className="space-y-0.5 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs">
          {newThisRun.length > 0 && (
            <p className="text-foreground">
              {t('campaign_langs_new_this_run').replace('{{languages}}', languageNames(newThisRun))}
            </p>
          )}
          <p className="text-muted-foreground">
            {t('campaign_langs_already_searched').replace('{{languages}}', languageNames(alreadyRun))}
          </p>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          {t('campaign_langs_not_ui')}
          {' '}
          <span className="opacity-70">({uiLanguageName})</span>
        </span>
      </p>

      {resolved.warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber-600 dark:text-amber-500">{warning}</p>
      ))}
    </div>
  );
}

/** The default a campaign starts from: recommended, nothing ticked. */
export const DEFAULT_SEARCH_LANGUAGES: SearchLanguageValue = { mode: 'AUTO', selected: [] };

export default SearchLanguagePicker;
