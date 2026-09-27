// src/pages/FindPropertyPage.tsx — FIND PROPERTY.
//
// DESCRIBE → PLAN → SEARCHING → RESULTS, and the customer can go back a step at any
// point. Four states, each of which is a real situation rather than a loading variant.
//
// WHY THERE IS A PLAN STEP AT ALL
//
// The obvious build is a chat box that returns listings. It is worse, for a reason that
// only shows up once it is wrong: when a chat gives you the wrong flats you cannot tell
// whether it misheard you, or heard you and the market is empty. The plan is the
// difference. It is the model's reading of what you said, shown to you before anything
// runs, with every field editable — so a wrong answer is traceable to a wrong reading
// and correctable in one tap.
//
// It is also where REQUIRED / PREFERRED / FLEXIBLE lives, and that distinction cannot
// survive a chat interface. "Must be in Vake" and "ideally Vake" are different searches
// and the matcher honours the difference; there is no way to show somebody which one
// was heard except to show them.
//
// NOTHING ON THIS PAGE DECIDES ANYTHING
//
// The model proposes; normalisePlan() on the server recognises or discards; the
// customer confirms; supply-matching compares; find-property reads back. This file
// collects input and renders output. There is no scoring here, no re-ranking, and no
// filtering of what came back — the order is the matcher's own.
//
// AND NOTHING HERE PRETENDS
//
// `interpreted: false` comes back when the model is unavailable, and it renders as
// exactly that: the plan editor, empty, with the customer's own text still in place. No
// spinner that never resolves, no keyword guess dressed up as a reading. SEARCHING is a
// real state too — the matcher runs on a schedule, so "your search is active and
// nothing matches it yet" is the truth and is different from "you have no search".
//
// THE COMPOSER
//
// Multiline and growing, keyboard-safe, safe-area aware, RTL by inheritance, and it
// does not move the page when it grows: the textarea has a min-height and the layout
// reserves its space rather than reflowing around it.

import { ArrowLeft, Building2, Check, Loader2, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { DiscoveryState, ListingCard } from '@/components/customer/ListingCard';
import { NativeMatchesPanel } from '@/components/matching/NativeMatchesPanel';
import { HomatchSearchComposer, HowItWorks } from '@/components/customer/SearchComposer';
import {
  type PlanRowData, SearchPlanSummary,
} from '@/components/customer/SearchPlanSummary';
import {
  CardAction, CustomerPageHeader, CustomerSurface, DISCOVERY_SURFACE, QuietAction,
} from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, intlLocaleFor, isolate } from '@/components/workspace/primitives';
import { useLanguage } from '@/contexts/LanguageContext';
import { placeName } from '@/lib/placeNames';
import { dimensionKey, recencyFromDate } from '@/matching/presentation';
import {
  type ConstraintStrength,
  confirmPlan,
  type FindPropertyResult,
  type PlanRejection,
  planFromDescription,
  readResults,
  type SearchGoal,
  type SearchPlan,
} from '@/services/findProperty';

const GOALS: readonly SearchGoal[] = ['BUY', 'RENT', 'SHORT_STAY', 'INVEST', 'COMMERCIAL', 'LAND'];

/*
 * FOUR SENTENCES SOMEBODY CAN START FROM.
 *
 * The page was a heading, a label, an empty box and a button that was already disabled.
 * Nothing on it said what the box accepts, so the first thing a customer had to do was
 * guess the format of a free-text field — and the usual guess is two or three keywords,
 * which is the one input this page is worse at than a filter form.
 *
 * These are i18n KEYS, and the sentences behind them are written per language rather than
 * translated word for word: how a Georgian describes a flat hunt is not an English
 * sentence with Georgian words in it. Each one is a complete, specific request, because a
 * vague example teaches vagueness.
 *
 * They fill the composer rather than submitting: the point is to show the SHAPE of a good
 * description and then let somebody edit it into their own.
 */
const EXAMPLE_KEYS = [
  'plan_example_family',
  'plan_example_rent',
  'plan_example_invest',
  'plan_example_relocate',
] as const;

/*
 * WHAT WILL HAPPEN, BEFORE IT HAPPENS.
 *
 * Three steps, on the first screen, because "type something and press a button" tells a
 * customer nothing about what they are agreeing to. The middle step is the one worth
 * advertising: this product shows you its reading of your words and lets you correct it
 * before it spends anything, which is the whole argument for the plan step existing.
 */
const HOW_IT_WORKS = [
  { titleKey: 'plan_step_read_title', bodyKey: 'plan_step_read_body' },
  { titleKey: 'plan_step_check_title', bodyKey: 'plan_step_check_body' },
  { titleKey: 'plan_step_search_title', bodyKey: 'plan_step_search_body' },
] as const;
const STRENGTHS: readonly ConstraintStrength[] = ['REQUIRED', 'PREFERRED', 'FLEXIBLE'];

type Stage = 'DESCRIBE' | 'PLAN' | 'RESULTS';

/**
 * How firmly one requirement is held, as a control.
 *
 * A select rather than a toggle, because there are three meaningful answers and a
 * two-state control would force one of them to be the absence of the others. The
 * labels say what the matcher will actually do, not how strongly the customer feels.
 */
function StrengthPicker({
  value, onChange, label,
}: { value: ConstraintStrength; onChange: (next: ConstraintStrength) => void; label: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="shrink-0 break-words text-2xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(next) => onChange(next as ConstraintStrength)}>
        <SelectTrigger className="h-8 text-xs w-auto min-w-[8.5rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STRENGTHS.map((strength) => (
            <SelectItem key={strength} value={strength} className="text-xs">
              {t(`plan_strength_${strength.toLowerCase()}` as never)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * One result, formatted for the reader and disclosed for what it is.
 *
 * This component decides NOTHING about the result. It formats: money through
 * formatMoney, places through placeName, age through the same scale Matches uses, and
 * the broker's label through the key the server sent. Every judgement — the order, the
 * rationale, what counts as a preference miss, what a broker is to Homatch — was made
 * before this ran.
 */
function ResultCard({ result }: { result: FindPropertyResult }) {
  const { t, lang } = useLanguage();
  const listing = result.listing;
  const broker = result.supply?.broker ?? null;
  if (!listing) return null;

  const locale = intlLocaleFor(lang);
  const place = [placeName(listing.district, lang), placeName(listing.city, lang)]
    .filter(Boolean).join(', ');
  const price = listing.price.amount !== null
    ? isolate(formatMoney(
      Number(listing.price.amount),
      listing.price.currency ?? 'USD',
      locale,
      { decimals: 0, narrowSymbol: true },
    ))
    : null;

  /*
   * HOW OLD, NOT WHEN. A listing's publication date matters as an age — "4 months ago"
   * is actionable and "18/05/2025" is arithmetic homework — and the scale is the one
   * Matches already uses, so the same gap reads the same on both screens. No date
   * recorded means no line: an absent fact is not a fresh one.
   */
  const age = recencyFromDate(result.freshness.publishedAt);
  const freshness = age ? t(age.key as never, { count: String(age.count) }) : null;

  /*
   * A DIMENSION IS NOT A WORD. `preference_misses` holds MatchDimension enum values, and
   * the card printed them: a Georgian customer read "DISTRICT". They name the same things
   * the search plan asks about, so the plan's labels translate them. An unmapped
   * dimension keeps its raw token rather than disappearing — an English word is a smaller
   * failure than a missing one.
   */
  const misses = (result.preferenceMisses ?? []).map((dimension) => {
    const key = dimensionKey(dimension);
    return key ? t(key as never) : dimension;
  });

  return (
    <ListingCard
      headline={listing.title ?? t('plan_result_untitled')}
      freshness={freshness}
      source={listing.source}
      facts={{
        place: place || null,
        price,
        rooms: listing.rooms !== null ? `${listing.rooms} ${t('plan_rooms')}` : null,
        area: listing.areaSqm !== null ? isolate(`${listing.areaSqm} m²`) : null,
      }}
      whyLine={result.whyThisMatches}
      missesLabel={t('plan_result_preference_miss')}
      misses={misses}
      /*
        TWO FACTS, REPORTED SEPARATELY. `registeredWithHomatch` is false for every firm
        found by reading a portal, because a registration requires an account discovery
        does not have. The label is the server's key, translated here and composed
        nowhere.
      */
      broker={broker ? {
        name: broker.name ?? t('broker_no_name'),
        standing: t(broker.labelKey as never),
        provenance: `${t('broker_provenance_sources', { count: String(broker.provenance.seenOnSources) })} · ${t('broker_provenance_listings', { count: String(broker.provenance.listingsAttributed) })}`,
      } : null}
      actionLabel={t('plan_result_open')}
      href={listing.url}
    />
  );
}

export default function FindPropertyPage() {
  const { t, lang } = useLanguage();
  const [stage, setStage] = useState<Stage>('DESCRIBE');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [interpreted, setInterpreted] = useState(true);
  const [plan, setPlan] = useState<SearchPlan | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  /*
   * THE SAME DISCARDS, TRANSLATABLE. `rejected` is the server's operator sentence —
   * `district "somewhere near a metro" is not a place name` — and putting that in a
   * Georgian page is putting English diagnostics where the product's own copy goes.
   * These carry a key and the customer's own word instead. Empty against a server that
   * has not been redeployed, which is why the sentences are still rendered as a fallback.
   */
  const [rejections, setRejections] = useState<PlanRejection[]>([]);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  /*
   * THE FORM IS CLOSED UNTIL SOMEBODY WANTS IT.
   * Open by default only when there was nothing to read back — a reading that did not
   * happen has no statement to make, so the fields are the honest first screen.
   */
  const [refining, setRefining] = useState(false);
  const [results, setResults] = useState<FindPropertyResult[]>([]);
  const [resultState, setResultState] = useState<'NO_ACTIVE_SEARCH' | 'SEARCHING' | 'HAS_RESULTS'>('NO_ACTIVE_SEARCH');
  const [loadingResults, setLoadingResults] = useState(true);
  const composer = useRef<HTMLTextAreaElement | null>(null);

  /*
   * A CUSTOMER WHO ALREADY HAS A SEARCH SHOULD LAND ON THEIR RESULTS.
   *
   * Read on mount, before anything is typed. Somebody returning to this page has
   * already described what they want; making them describe it again to see what was
   * found would be asking twice for the same thing.
   */
  const load = useCallback(async () => {
    setLoadingResults(true);
    try {
      const response = await readResults(30);
      setResults(response.results ?? []);
      setResultState(response.state ?? 'NO_ACTIVE_SEARCH');
      if (response.state === 'HAS_RESULTS' || response.state === 'SEARCHING') setStage('RESULTS');
    } finally {
      setLoadingResults(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const describe = async () => {
    const description = text.trim();
    if (!description) return;
    setReading(true);
    try {
      const response = await planFromDescription(description);
      setInterpreted(response.interpreted);
      setRefining(!response.interpreted);
      setRejected(response.rejected ?? []);
      setRejections(response.rejections ?? []);
      setMissingKeys(response.readiness?.missingKeys ?? []);
      /*
       * A PLAN EITHER WAY. When the model could not read the text there is no draft, so
       * the editor opens on an empty BUY plan carrying the customer's own words -- which
       * is the honest version of "we did not understand, here is the form".
       */
      setPlan(response.plan ?? {
        goal: 'BUY',
        deal: 'SALE',
        countryCode: 'GE',
        city: null,
        districts: null,
        propertyTypes: null,
        budget: null,
        bedrooms: null,
        areaSqm: null,
        languages: [],
        originalText: description,
        originalLanguage: null,
      });
      setStage('PLAN');
    } finally {
      setReading(false);
    }
  };

  const run = async () => {
    if (!plan) return;
    setConfirming(true);
    try {
      const response = await confirmPlan(plan);
      if (!response.success) {
        setMissingKeys(response.readiness?.missingKeys ?? []);
        setRejected(response.rejected ?? []);
        setRejections(response.rejections ?? []);
        toast.error(t('plan_not_ready'));
        return;
      }
      toast.success(t('plan_search_started'));
      setStage('RESULTS');
      await load();
    } finally {
      setConfirming(false);
    }
  };

  const goalLabel = (goal: SearchGoal) => t(`plan_goal_${goal.toLowerCase()}` as never);

  /*
   * THE PLAN, AS LINES OF A STATEMENT.
   *
   * Every row comes from a field the planner actually returned. A field it did not return
   * produces no row — not "Any city", which would be a claim about the search that nobody
   * made, and not an empty row, which would look like a defect.
   *
   * UNKNOWN strength produces no strength word. It is the matcher's confidence in its own
   * reading, not a promise to the customer, and showing it as one would be a lie about
   * what the search will do.
   */
  const planRows = useMemo<PlanRowData[]>(() => {
    if (!plan) return [];
    const locale = intlLocaleFor(lang);
    /*
     * AN AMOUNT CARRIES ITS OWN DIRECTION — isolate(), beside the money formatter, so
     * this screen and the results below it treat a number the same way. The phrase
     * builders take what they are given.
     */
    const iso = isolate;
    const money = (value: number, currency: string) =>
      iso(formatMoney(value, currency || 'USD', locale, { decimals: 0, narrowSymbol: true }));
    const firmness = (strength: string) => (strength === 'UNKNOWN' ? null : strength);
    /*
     * A RANGE IS A PHRASE, NOT TWO STRINGS. "Up to" is a preposition in English and a
     * suffix in Georgian — `${label} ${amount}` produced "მდე $150,000", which is not a
     * sentence anybody would write. The key carries the placeholder and each language
     * puts it where it belongs.
     */
    const upTo = (value: string) => t('plan_value_upto', { value });
    const from = (value: string) => t('plan_value_from', { value });
    const rows: PlanRowData[] = [
      /* A summary states; the editor below asks. Two different labels for one field. */
      { label: t('plan_row_goal'), value: goalLabel(plan.goal) },
    ];

    if (plan.city?.value) {
      rows.push({
        label: t('plan_field_city'),
        /* In the reader's script, through the same layer the rest of the product uses. */
        value: placeName(plan.city.value, lang),
        strength: firmness(plan.city.strength),
      });
    }
    if (plan.districts?.value.length) {
      rows.push({
        label: t('plan_field_districts'),
        value: plan.districts.value.map((name) => placeName(name, lang)).join(' · '),
        strength: firmness(plan.districts.strength),
      });
    }
    if (plan.propertyTypes?.value.length) {
      rows.push({
        label: t('plan_field_types'),
        value: plan.propertyTypes.value
          .map((type) => t(`prop_type_${type.toLowerCase()}` as never))
          .join(' · '),
        strength: firmness(plan.propertyTypes.strength),
      });
    }
    if (plan.budget) {
      const { min, max, currency } = plan.budget.value;
      /* Three shapes, because a budget with only a ceiling is not the same statement as a
         budget with only a floor, and neither is a range. */
      const value = min !== null && max !== null
        ? `${money(min, currency)} – ${money(max, currency)}`
        : max !== null
          ? upTo(money(max, currency))
          : min !== null
            ? from(money(min, currency))
            : null;
      if (value) {
        rows.push({
          label: t('plan_field_budget'),
          value,
          strength: firmness(plan.budget.strength),
        });
      }
    }
    if (plan.bedrooms) {
      const { min, max } = plan.bedrooms.value;
      const value = min !== null && max !== null && max !== min
        ? iso(`${min}–${max}`)
        : min !== null ? iso(`${min}+`) : max !== null ? upTo(iso(String(max))) : null;
      if (value) {
        rows.push({
          label: t('plan_row_bedrooms'),
          value,
          strength: firmness(plan.bedrooms.strength),
        });
      }
    }
    if (plan.areaSqm) {
      const { min, max } = plan.areaSqm.value;
      const value = min !== null && max !== null && max !== min
        ? iso(`${min}–${max} m²`)
        : min !== null
          ? iso(`${min}+ m²`)
          : max !== null ? upTo(iso(`${max} m²`)) : null;
      if (value) {
        rows.push({
          label: t('plan_field_area'),
          value,
          strength: firmness(plan.areaSqm.strength),
        });
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, lang, t]);

  const header = useMemo(() => (
    <CustomerPageHeader title={t('plan_page_title')} count={t('plan_page_subtitle')} />
  ), [t]);

  return (
    <RouteGuard>
      {/*
        The premium canvas, hosted by the layout so the back control shares it — see
        AppLayout's surfaceClass note. max-w-2xl on the root light palette was the old
        shell: a 672px column of white form inside a 1920px grey page.
      */}
      <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
        <CustomerSurface className="space-y-5">
          {header}

          {/* ── DESCRIBE ─────────────────────────────────────────────────── */}
          {stage === 'DESCRIBE' && (
            /* A reading width, centred. This stage is one paragraph of writing; 1440px of
               textarea would make it harder to use, not more impressive. */
            /* Left-aligned, not centred: the header sits at the start of the canvas and a
               centred composer under a left-aligned title reads as two unrelated blocks.
               The workspace surfaces align everything to one left edge. */
            <div className="w-full max-w-2xl space-y-5">
              <HomatchSearchComposer
                value={text}
                onChange={setText}
                onSubmit={describe}
                busy={reading}
                placeholder={t('plan_composer_placeholder')}
                hint={t('plan_composer_needs_text')}
                readyHint={t('plan_composer_ready')}
                submitLabel={t('plan_composer_cta')}
                suggestionsLabel={t('plan_examples_label')}
                suggestions={EXAMPLE_KEYS.map((key) => ({ key, text: t(key) }))}
                composerRef={composer}
              />

              <div className="hm-discovery-panel p-3.5">
                <p className="mb-2.5 text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                  {t('plan_how_it_works')}
                </p>
                <HowItWorks
                  steps={HOW_IT_WORKS.map(({ titleKey, bodyKey }) => ({
                    key: titleKey,
                    title: t(titleKey),
                    body: t(bodyKey),
                  }))}
                />
              </div>

              {/* Somebody whose requirements were read from a conversation has no plan on
                  this screen yet and still has results — they are shown here too. */}
              <NativeMatchesPanel role="SEEKER" />
            </div>
          )}

          {/* ── PLAN ─────────────────────────────────────────────────────── */}
          {stage === 'PLAN' && plan && (
            /*
              A READING WIDTH, ALIGNED WITH THE COMPOSER IT CAME FROM.
              This stage is a short statement plus a form behind one control. The previous
              build was six stacked cards of labelled Selects and Inputs at 672px — which
              is a filter form, and a filter form is the thing this product exists to
              replace. The plan is now something you READ, and the fields that produced it
              are one tap away for the times the reading was wrong.
            */
            <div className="w-full max-w-5xl space-y-4">
              {/*
                ONE HEADING. The page header says what page this is and the summary below
                names itself; a third title between them ("Your search") pushed the first
                real fact 40px further down a 390px screen and said nothing the next line
                did not. Back to your own words is a different correction from changing a
                field — it re-reads the sentence — so it keeps its own row.
              */}
              <QuietAction
                label={t('plan_edit_description')}
                icon={ArrowLeft}
                onClick={() => setStage('DESCRIBE')}
              />

              {/*
                SAID WHEN IT IS TRUE, AND ONLY THEN. A reading that did not happen is not
                presented as one — the summary below carries only what is really in the
                plan, and the fields open by themselves so nobody is left wondering why.
              */}
              {!interpreted && (
                <div className="hm-discovery-panel px-4 py-3">
                  <p className="break-words text-2xs leading-relaxed text-muted-foreground">
                    {t('plan_not_interpreted')}
                  </p>
                </div>
              )}

              {/*
                THE READING AND THE WORDS IT CAME FROM, SIDE BY SIDE.
                One column on a phone — the answer first, the source under it. From lg
                they are two, because the one thing somebody does on this screen is
                compare them, and a 1440px canvas with 700px of nothing in it was a phone
                layout that had been stretched rather than composed.
              */}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
              <SearchPlanSummary
                title={t('plan_understood_title')}
                rows={planRows}
                languages={plan.languages}
                languagesLabel={t('plan_languages_label')}
                note={
                  /*
                    WHAT WAS DISCARDED AND WHAT IS STILL MISSING, inside the plan rather
                    than beside it. Both are the server's own words about this reading, and
                    neither is ever silent — a constraint that was dropped without saying
                    so is how a customer ends up believing a search covers something it
                    does not.
                  */
                  rejected.length > 0 || missingKeys.length > 0 ? (
                    <div className="space-y-1.5">
                      {rejected.length > 0 && (
                        <>
                          <p className="break-words text-2xs font-semibold text-foreground">
                            {t('plan_rejected_title')}
                          </p>
                          <ul className="space-y-0.5">
                            {/*
                              TRANSLATED WHERE THE SERVER SENT A KEY, and the operator
                              sentence otherwise. The fallback is not defensive habit: a
                              production build that has not been redeployed sends only the
                              English sentence, and showing nothing in that case would
                              hide a discard — which is the one thing this block exists to
                              prevent. dir="auto" so the customer's own quoted word takes
                              its own direction inside either.
                            */}
                            {(rejections.length > 0
                              ? rejections.slice(0, 6).map((entry, index) => ({
                                key: `${entry.key}-${index}`,
                                text: t(entry.key as never, { value: entry.value }),
                              }))
                              : rejected.slice(0, 6).map((reason, index) => ({
                                key: `${reason}-${index}`,
                                text: reason,
                              }))
                            ).map((line) => (
                              <li
                                key={line.key}
                                dir="auto"
                                className="break-words text-2xs text-muted-foreground"
                              >
                                {line.text}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {missingKeys.map((key) => (
                        <p key={key} className="break-words text-2xs text-[hsl(var(--gold-ink))]">
                          {t(key as never)}
                        </p>
                      ))}
                    </div>
                  ) : null
                }
                /* The absence of a price is a product decision, so it is stated —
                   under the control it is about. */
                footnote={t('plan_run_free')}
                actions={
                  <>
                    <CardAction
                      label={t('plan_run_cta')}
                      onClick={run}
                      disabled={confirming}
                      busy={confirming
                        ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        : null}
                    />
                    {/* The form is not gone. The control says what it opens rather than
                        "Edit", because what somebody wants here is to fix one thing. */}
                    <QuietAction
                      label={refining ? t('plan_refine_hide') : t('plan_refine')}
                      icon={SlidersHorizontal}
                      onClick={() => setRefining((open) => !open)}
                    />
                  </>
                }
              />

              <div className="space-y-3">
                {/*
                  WHAT THEY ACTUALLY WROTE, unedited and in their own script. Not a
                  decoration for the empty half of the screen: a reading is only checkable
                  against its source, and `dir="auto"` lets a Latin sentence inside an RTL
                  page keep its own direction.
                */}
                {plan.originalText && (
                  <div className="hm-discovery-panel px-4 py-3.5">
                    <p className="text-2xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {t('plan_your_words')}
                    </p>
                    <p dir="auto" className="mt-1.5 break-words text-2xs leading-relaxed text-foreground/90">
                      {plan.originalText}
                    </p>
                  </div>
                )}

              </div>
              </div>

              {/* ── THE SAME FIELDS, FOR THE TIMES THE READING WAS WRONG ────── */}
              {refining && (
                /* Form fields do not get wider just because the page did: a 1000px text
                   input is harder to fill in than a 500px one. The editor keeps the width
                   of the summary column it corrects. */
                <div className="hm-discovery-panel w-full max-w-2xl space-y-4 p-4">
                  <p className="text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                    {t('plan_refine')}
                  </p>

                  {/* Goal */}
                  <div className="space-y-1.5">
                    <span className="block break-words text-2xs text-muted-foreground">
                      {t('plan_field_goal')}
                    </span>
                    <Select
                      value={plan.goal}
                      onValueChange={(next) => setPlan({ ...plan, goal: next as SearchGoal })}
                    >
                      <SelectTrigger className="h-9 text-2xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GOALS.map((goal) => (
                          <SelectItem key={goal} value={goal} className="text-2xs">
                            {goalLabel(goal)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* City */}
                  <div className="space-y-1.5">
                    <span className="block break-words text-2xs text-muted-foreground">
                      {t('plan_field_city')}
                    </span>
                    <Input
                      value={plan.city?.value ?? ''}
                      onChange={(event) => setPlan({
                        ...plan,
                        city: event.target.value
                          ? { value: event.target.value, strength: plan.city?.strength ?? 'REQUIRED' }
                          : null,
                      })}
                      placeholder={t('plan_field_city_placeholder')}
                      className="h-9 text-2xs"
                    />
                    {plan.city && (
                      <StrengthPicker
                        label={t('plan_how_firmly')}
                        value={plan.city.strength}
                        onChange={(strength) => setPlan({ ...plan, city: { ...plan.city!, strength } })}
                      />
                    )}
                  </div>

                  {/* Districts */}
                  <div className="space-y-1.5">
                    <span className="block break-words text-2xs text-muted-foreground">
                      {t('plan_field_districts')}
                    </span>
                    <Input
                      value={(plan.districts?.value ?? []).join(', ')}
                      onChange={(event) => {
                        const names = event.target.value
                          .split(',').map((part) => part.trim()).filter(Boolean);
                        setPlan({
                          ...plan,
                          districts: names.length
                            ? { value: names, strength: plan.districts?.strength ?? 'PREFERRED' }
                            : null,
                        });
                      }}
                      placeholder={t('plan_field_districts_placeholder')}
                      className="h-9 text-2xs"
                    />
                    {plan.districts && (
                      <StrengthPicker
                        label={t('plan_how_firmly')}
                        value={plan.districts.strength}
                        onChange={(strength) => setPlan({ ...plan, districts: { ...plan.districts!, strength } })}
                      />
                    )}
                  </div>

                  {/* Budget */}
                  <div className="space-y-1.5">
                    <span className="block break-words text-2xs text-muted-foreground">
                      {t('plan_field_budget')}
                    </span>
                    {/*
                      TWO FIELDS THAT SAY WHICH IS WHICH EVEN WHEN THEY ARE FULL.
                      The floor and the ceiling were two bare inputs carrying "From" and
                      "Up to" as placeholders — so the moment a number was typed the field
                      stopped saying what the number meant, and a plan with only a ceiling
                      showed one filled box beside one empty one with no way to tell which
                      end had been set.
                    */}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="block break-words text-2xs text-muted-foreground/80">
                          {t('plan_field_budget_min')}
                        </span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={plan.budget?.value.min ?? ''}
                        onChange={(event) => {
                          const min = event.target.value ? Number(event.target.value) : null;
                          setPlan({
                            ...plan,
                            budget: {
                              value: {
                                min,
                                max: plan.budget?.value.max ?? null,
                                currency: plan.budget?.value.currency ?? 'USD',
                              },
                              strength: plan.budget?.strength ?? 'REQUIRED',
                            },
                          });
                        }}
                        className="h-9 w-full text-2xs"
                      />
                      </label>
                      <label className="space-y-1">
                        <span className="block break-words text-2xs text-muted-foreground/80">
                          {t('plan_field_budget_max')}
                        </span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={plan.budget?.value.max ?? ''}
                        onChange={(event) => {
                          const max = event.target.value ? Number(event.target.value) : null;
                          setPlan({
                            ...plan,
                            budget: {
                              value: {
                                min: plan.budget?.value.min ?? null,
                                max,
                                currency: plan.budget?.value.currency ?? 'USD',
                              },
                              strength: plan.budget?.strength ?? 'REQUIRED',
                            },
                          });
                        }}
                        className="h-9 w-full text-2xs"
                      />
                      </label>
                    </div>
                    {plan.budget && (
                      <StrengthPicker
                        label={t('plan_how_firmly')}
                        value={plan.budget.strength}
                        onChange={(strength) => setPlan({ ...plan, budget: { ...plan.budget!, strength } })}
                      />
                    )}
                  </div>

                  {/* Bedrooms */}
                  <div className="space-y-1.5">
                    <span className="block break-words text-2xs text-muted-foreground">
                      {t('plan_field_bedrooms')}
                    </span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={plan.bedrooms?.value.min ?? ''}
                      onChange={(event) => {
                        const min = event.target.value ? Number(event.target.value) : null;
                        setPlan({
                          ...plan,
                          bedrooms: min === null ? null : {
                            value: { min, max: plan.bedrooms?.value.max ?? null },
                            strength: plan.bedrooms?.strength ?? 'PREFERRED',
                          },
                        });
                      }}
                      placeholder={t('plan_field_bedrooms_placeholder')}
                      className="h-9 text-2xs"
                    />
                    {plan.bedrooms && (
                      <StrengthPicker
                        label={t('plan_how_firmly')}
                        value={plan.bedrooms.strength}
                        onChange={(strength) => setPlan({ ...plan, bedrooms: { ...plan.bedrooms!, strength } })}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── RESULTS ──────────────────────────────────────────────────── */}
          {stage === 'RESULTS' && (
            <div className="space-y-4">
              {/* The heading row and the no-result states keep a reading width: a
                  "nothing has matched yet" panel stretched across 1440px is the
                  over-correction, not the fix. Only the grid of properties below uses the
                  full page. */}
              <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
                <h2 className="min-w-0 break-words font-display text-base font-semibold tracking-[-0.01em] text-foreground">
                  {t('plan_results_title')}
                </h2>
                <QuietAction
                  label={t('plan_new_search')}
                  icon={Search}
                  onClick={() => setStage('DESCRIBE')}
                />
              </div>

              {/* Properties HOMATCH members listed that fit this person's requirements —
                  from the plan they confirmed or from what they said in a conversation.
                  Renders nothing when there are none. */}
              <NativeMatchesPanel role="SEEKER" className="w-full max-w-3xl" />

              {loadingResults && (
                <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  <Skeleton className="h-32 rounded-2xl" />
                  <Skeleton className="h-32 rounded-2xl" />
                  <Skeleton className="h-32 rounded-2xl" />
                </div>
              )}

              {/*
                THREE STATES, NOT TWO. "You have no search" and "your search is running
                and has not matched anything yet" are different situations with different
                next actions, and an empty list cannot tell them apart.
              */}
              {!loadingResults && resultState === 'SEARCHING' && (
                <div className="w-full max-w-3xl">
                  <DiscoveryState
                    icon={Building2}
                    title={t('plan_state_searching_title')}
                    body={t('plan_state_searching_body')}
                  />
                </div>
              )}

              {!loadingResults && resultState === 'NO_ACTIVE_SEARCH' && (
                <div className="w-full max-w-3xl">
                  <DiscoveryState
                    icon={Search}
                    title={t('plan_state_none')}
                    action={(
                      <QuietAction
                        label={t('plan_composer_cta')}
                        icon={Sparkles}
                        onClick={() => setStage('DESCRIBE')}
                      />
                    )}
                  />
                </div>
              )}

              {!loadingResults && resultState === 'HAS_RESULTS' && (
                <>
                  {/* A line, not a capsule. "Included in your search" is a sentence about
                      what these cost, and a badge is a category. */}
                  <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" />
                    <span className="break-words">{t('plan_results_included')}</span>
                  </p>
                  {/* Properties, in columns from lg. One result occupies one column and
                      the rest of the row stays empty, which is what a list with one thing
                      in it should look like. */}
                  <div className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                    {results.map((result) => <ResultCard key={result.id} result={result} />)}
                  </div>
                </>
              )}
            </div>
          )}
        </CustomerSurface>
      </AppLayout>
    </RouteGuard>
  );
}
