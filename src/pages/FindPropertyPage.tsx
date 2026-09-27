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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Check, Clock, DollarSign, Info, Loader2, MapPin, Search, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type ConstraintStrength,
  type FindPropertyResult,
  type SearchGoal,
  type SearchPlan,
  confirmPlan,
  planFromDescription,
  readResults,
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
  { icon: Sparkles, titleKey: 'plan_step_read_title', bodyKey: 'plan_step_read_body' },
  { icon: Check, titleKey: 'plan_step_check_title', bodyKey: 'plan_step_check_body' },
  { icon: Clock, titleKey: 'plan_step_search_title', bodyKey: 'plan_step_search_body' },
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
      <span className="text-[13px] text-muted-foreground shrink-0 break-words">{label}</span>
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

/** One result, with the broker disclosed for what they are. */
function ResultCard({ result }: { result: FindPropertyResult }) {
  const { t } = useLanguage();
  const listing = result.listing;
  const broker = result.supply?.broker ?? null;
  if (!listing) return null;

  const price = listing.price.amount !== null
    ? `${listing.price.currency ?? ''}${Number(listing.price.amount).toLocaleString()}`
    : null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 space-y-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground break-words">
            {listing.title ?? t('plan_result_untitled')}
          </h3>
          {/* WHY THIS MATCHES, first. The matcher's own rationale, not a percentage. */}
          {result.whyThisMatches && (
            <p className="text-xs text-muted-foreground break-words">{result.whyThisMatches}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {listing.city && (
            <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1 max-w-full">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="break-words min-w-0">
                {listing.district ? `${listing.district}, ${listing.city}` : listing.city}
              </span>
            </span>
          )}
          {price && (
            <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1 max-w-full">
              <DollarSign className="h-3 w-3 shrink-0" />
              <span className="break-words min-w-0" dir="ltr">{price}</span>
            </span>
          )}
          {listing.rooms !== null && (
            <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground max-w-full">
              <span className="break-words min-w-0">{listing.rooms} {t('plan_rooms')}</span>
            </span>
          )}
          {listing.areaSqm !== null && (
            <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground max-w-full">
              <span className="break-words min-w-0" dir="ltr">{listing.areaSqm} m²</span>
            </span>
          )}
          {/* PUBLICATION FRESHNESS -- when the seller spoke, not when we looked. */}
          {result.freshness.publishedAt && (
            <span className="text-xs px-2 py-0.5 rounded-full text-muted-foreground/70 border border-border/60 flex items-center gap-1 max-w-full">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="break-words min-w-0">
                {new Date(result.freshness.publishedAt).toLocaleDateString()}
              </span>
            </span>
          )}
        </div>

        {/* What did not match, named rather than averaged into the score. */}
        {(result.preferenceMisses?.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground/80 break-words">
            {t('plan_result_preference_miss')}: {result.preferenceMisses?.join(', ')}
          </p>
        )}

        {/*
          WHO IS OFFERING, AND WHAT THEY ARE TO HOMATCH.
          Two separate facts, reported separately. `registeredWithHomatch` is false for
          every firm we found by reading a portal, because a registration requires an
          account discovery does not have. The label is a key, translated.
        */}
        {broker && (
          <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2 space-y-1">
            <div className="flex items-start gap-1.5 min-w-0">
              <Info className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-[13px] text-muted-foreground break-words min-w-0">
                {broker.name ?? t('broker_no_name')} · {t(broker.labelKey as never)}
              </span>
            </div>
            <p className="text-[13px] text-muted-foreground/70 break-words">
              {t('broker_provenance_sources', { count: String(broker.provenance.seenOnSources) })}
              {' · '}
              {t('broker_provenance_listings', { count: String(broker.provenance.listingsAttributed) })}
            </p>
          </div>
        )}

        {/* Provenance, last and quietly. Which adapter read it is an operator's fact. */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30 flex-wrap">
          <span className="text-[13px] text-muted-foreground/70 break-words">
            {listing.source ?? ''}
          </span>
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-xs text-primary hover:underline break-words"
            >
              {t('plan_result_open')}
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function FindPropertyPage() {
  const { t } = useLanguage();
  const [stage, setStage] = useState<Stage>('DESCRIBE');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [interpreted, setInterpreted] = useState(true);
  const [plan, setPlan] = useState<SearchPlan | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
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
      setRejected(response.rejected ?? []);
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

  const header = useMemo(() => (
    <div className="min-w-0 space-y-1">
      <h1 className="text-xl font-bold text-foreground break-words">{t('plan_page_title')}</h1>
      <p className="text-sm text-muted-foreground break-words">{t('plan_page_subtitle')}</p>
    </div>
  ), [t]);

  return (
    <RouteGuard>
      <AppLayout>
        {/*
          max-w-2xl WAS 672px OF A 1920px SCREEN, for every stage including the results.
          The composer and the plan editor still want a reading width and get one below —
          a 1440px-wide textarea is nobody's idea of an improvement — but a list of
          properties does not, and it is now a grid inside this wider page.
        */}
        <div className="max-w-[90rem] mx-auto space-y-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {header}

          {/* ── DESCRIBE ─────────────────────────────────────────────────── */}
          {stage === 'DESCRIBE' && (
            /* A reading width, centred. The stage is one paragraph of writing; giving it
               1440px would make it harder to use, not more impressive. */
            <div className="mx-auto w-full max-w-3xl space-y-4">
              <Card className="bg-card border-border">
                <CardContent className="p-4 sm:p-6 space-y-4">
                  <div className="space-y-1.5 min-w-0">
                    <label
                      htmlFor="find-property-composer"
                      className="text-base font-semibold text-foreground break-words block"
                    >
                      {t('plan_composer_label')}
                    </label>
                    <p className="text-sm text-muted-foreground break-words">
                      {t('plan_composer_hint')}
                    </p>
                  </div>

                  {/*
                    A PLAIN GROWING TEXTAREA, and deliberately not a chat.
                    min-h reserves its space so the page does not jump as it grows, dir is
                    inherited so Arabic and Hebrew need no special case, and there is no
                    typing indicator because nothing is typing.
                  */}
                  <textarea
                    id="find-property-composer"
                    ref={composer}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={5}
                    className="w-full min-h-[9rem] resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary break-words"
                    placeholder={t('plan_composer_placeholder')}
                  />

                  {/* ── SOMETHING TO START FROM ──────────────────────────────
                    A chip fills the composer; it does not submit. Nobody should have to
                    guess what a free-text field accepts, and the alternative to showing
                    them is that they type three keywords into the one interface that is
                    worse at keywords than a filter form would be. */}
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-muted-foreground break-words">
                      {t('plan_examples_label')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {EXAMPLE_KEYS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setText(t(key));
                            composer.current?.focus();
                          }}
                          className="rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-start text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-w-full"
                        >
                          <span className="break-words line-clamp-2">{t(key)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border/50 pt-3">
                    {/*
                      A DISABLED BUTTON THAT SAYS WHY IT IS DISABLED.
                      It was disabled on arrival with nothing next to it, which reads as a
                      broken page rather than as a form waiting for input.
                    */}
                    <p className="text-[13px] text-muted-foreground/70 break-words min-w-0">
                      {text.trim() ? t('plan_composer_ready') : t('plan_composer_needs_text')}
                    </p>
                    <Button
                      onClick={describe}
                      disabled={!text.trim() || reading}
                      className="h-auto min-h-10 py-2 gap-1.5 whitespace-normal text-start font-semibold"
                    >
                      {reading
                        ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        : <Sparkles className="h-4 w-4 shrink-0" />}
                      <span className="break-words">{t('plan_composer_cta')}</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* ── WHAT HAPPENS NEXT ────────────────────────────────────────
                The empty state stops being empty. Three steps, and the middle one is the
                argument for this product over a chat box: you see what was understood and
                correct it before anything is spent. */}
              <div className="grid gap-3 sm:grid-cols-3">
                {HOW_IT_WORKS.map(({ icon: StepIcon, titleKey, bodyKey }, index) => (
                  <div
                    key={titleKey}
                    className="rounded-xl border border-border bg-card/60 p-3.5 space-y-1.5 min-w-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
                        {index + 1}
                      </span>
                      <StepIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground break-words">{t(titleKey)}</p>
                    <p className="text-[13px] text-muted-foreground break-words leading-snug">
                      {t(bodyKey)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PLAN ─────────────────────────────────────────────────────── */}
          {stage === 'PLAN' && plan && (
            /* The plan is a form to read and correct, so it keeps a reading width too. */
            <div className="mx-auto w-full max-w-3xl space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-foreground break-words">
                  {t('plan_review_title')}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setStage('DESCRIBE')}>
                  <ArrowLeft className="h-4 w-4 me-1.5 shrink-0" />
                  <span className="break-words">{t('plan_edit_description')}</span>
                </Button>
              </div>

              {/*
                SAID WHEN IT IS TRUE, AND ONLY THEN. A reading that did not happen is
                not presented as one, and the customer is told to fill the form in
                rather than left wondering why every field is empty.
              */}
              {!interpreted && (
                <Card className="bg-card border-border">
                  <CardContent className="p-3">
                    <p className="text-sm text-muted-foreground break-words">
                      {t('plan_not_interpreted')}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* What the server discarded. Never silent. */}
              {rejected.length > 0 && (
                <Card className="bg-card border-border">
                  <CardContent className="p-3 space-y-1">
                    <p className="text-sm font-medium text-foreground break-words">
                      {t('plan_rejected_title')}
                    </p>
                    <ul className="space-y-0.5">
                      {rejected.slice(0, 6).map((reason, index) => (
                        <li key={`${reason}-${index}`} className="text-[13px] text-muted-foreground break-words">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card className="bg-card border-border">
                <CardContent className="p-4 space-y-4">
                  {/* Goal */}
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium text-foreground break-words block">
                      {t('plan_field_goal')}
                    </span>
                    <Select
                      value={plan.goal}
                      onValueChange={(next) => setPlan({ ...plan, goal: next as SearchGoal })}
                    >
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GOALS.map((goal) => (
                          <SelectItem key={goal} value={goal} className="text-sm">
                            {goalLabel(goal)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* City */}
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium text-foreground break-words block">
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
                      className="h-9 text-sm"
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
                    <span className="text-sm font-medium text-foreground break-words block">
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
                      className="h-9 text-sm"
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
                    <span className="text-sm font-medium text-foreground break-words block">
                      {t('plan_field_budget')}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
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
                        placeholder={t('plan_field_budget_min')}
                        className="h-9 text-sm flex-1 min-w-[6rem]"
                      />
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
                        placeholder={t('plan_field_budget_max')}
                        className="h-9 text-sm flex-1 min-w-[6rem]"
                      />
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
                    <span className="text-sm font-medium text-foreground break-words block">
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
                      className="h-9 text-sm"
                    />
                    {plan.bedrooms && (
                      <StrengthPicker
                        label={t('plan_how_firmly')}
                        value={plan.bedrooms.strength}
                        onChange={(strength) => setPlan({ ...plan, bedrooms: { ...plan.bedrooms!, strength } })}
                      />
                    )}
                  </div>

                  {/* What is still needed, by key. */}
                  {missingKeys.length > 0 && (
                    <ul className="space-y-0.5">
                      {missingKeys.map((key) => (
                        <li key={key} className="text-[13px] text-muted-foreground break-words">
                          {t(key as never)}
                        </li>
                      ))}
                    </ul>
                  )}

                  <Button onClick={run} disabled={confirming} className="w-full">
                    {confirming
                      ? <Loader2 className="h-4 w-4 me-1.5 animate-spin shrink-0" />
                      : <Search className="h-4 w-4 me-1.5 shrink-0" />}
                    <span className="break-words">{t('plan_run_cta')}</span>
                  </Button>
                  {/* The absence of a price is a product decision, so it is stated. */}
                  <p className="text-[13px] text-muted-foreground/70 text-center break-words">
                    {t('plan_run_free')}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── RESULTS ──────────────────────────────────────────────────── */}
          {stage === 'RESULTS' && (
            <div className="space-y-4">
              {/* The heading row and the three no-result states keep a reading width: a
                  centred "nothing has matched yet" card stretched across 1440px is the
                  over-correction, not the fix. Only the grid of properties below uses the
                  full page. */}
              <div className="mx-auto w-full max-w-3xl flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-foreground break-words">
                  {t('plan_results_title')}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setStage('DESCRIBE')}>
                  <Search className="h-4 w-4 me-1.5 shrink-0" />
                  <span className="break-words">{t('plan_new_search')}</span>
                </Button>
              </div>

              {loadingResults && (
                <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  <Skeleton className="h-32 rounded-xl" />
                  <Skeleton className="h-32 rounded-xl" />
                  <Skeleton className="h-32 rounded-xl" />
                </div>
              )}

              {/*
                THREE STATES, NOT TWO. "You have no search" and "your search is running
                and has not matched anything yet" are different situations with different
                next actions, and an empty list cannot tell them apart.
              */}
              {!loadingResults && resultState === 'SEARCHING' && (
                <Card className="mx-auto w-full max-w-3xl bg-card border-border">
                  <CardContent className="p-5 text-center space-y-2">
                    <Building2 className="h-9 w-9 mx-auto opacity-30" />
                    <p className="text-sm font-medium text-foreground break-words">
                      {t('plan_state_searching_title')}
                    </p>
                    <p className="text-sm text-muted-foreground break-words">
                      {t('plan_state_searching_body')}
                    </p>
                  </CardContent>
                </Card>
              )}

              {!loadingResults && resultState === 'NO_ACTIVE_SEARCH' && (
                <Card className="mx-auto w-full max-w-3xl bg-card border-border">
                  <CardContent className="p-5 text-center space-y-2">
                    <Search className="h-9 w-9 mx-auto opacity-30" />
                    <p className="text-sm text-muted-foreground break-words">
                      {t('plan_state_none')}
                    </p>
                    <Button size="sm" onClick={() => setStage('DESCRIBE')}>
                      <span className="break-words">{t('plan_composer_cta')}</span>
                    </Button>
                  </CardContent>
                </Card>
              )}

              {!loadingResults && resultState === 'HAS_RESULTS' && (
                <>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="secondary" className="gap-1 whitespace-normal">
                      <Check className="h-3 w-3 shrink-0" />
                      <span className="break-words">{t('plan_results_included')}</span>
                    </Badge>
                  </div>
                  {/* Properties, in columns from lg. One result occupies one column and
                      the rest of the row stays empty, which is what a list with one thing
                      in it should look like. */}
                  <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3 items-start">
                    {results.map((result) => <ResultCard key={result.id} result={result} />)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </AppLayout>
    </RouteGuard>
  );
}
