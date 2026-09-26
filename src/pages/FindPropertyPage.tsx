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
        <div className="max-w-2xl mx-auto space-y-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {header}

          {/* ── DESCRIBE ─────────────────────────────────────────────────── */}
          {stage === 'DESCRIBE' && (
            <Card className="bg-card border-border">
              <CardContent className="p-4 space-y-3">
                <label
                  htmlFor="find-property-composer"
                  className="text-sm font-medium text-foreground break-words block"
                >
                  {t('plan_composer_label')}
                </label>
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
                  rows={4}
                  className="w-full min-h-[7rem] resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary break-words"
                  placeholder={t('plan_composer_placeholder')}
                />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[13px] text-muted-foreground/70 break-words min-w-0">
                    {t('plan_composer_hint')}
                  </p>
                  <Button onClick={describe} disabled={!text.trim() || reading} size="sm">
                    {reading
                      ? <Loader2 className="h-4 w-4 me-1.5 animate-spin shrink-0" />
                      : <Sparkles className="h-4 w-4 me-1.5 shrink-0" />}
                    <span className="break-words">{t('plan_composer_cta')}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── PLAN ─────────────────────────────────────────────────────── */}
          {stage === 'PLAN' && plan && (
            <div className="space-y-4">
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-foreground break-words">
                  {t('plan_results_title')}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setStage('DESCRIBE')}>
                  <Search className="h-4 w-4 me-1.5 shrink-0" />
                  <span className="break-words">{t('plan_new_search')}</span>
                </Button>
              </div>

              {loadingResults && (
                <div className="space-y-3">
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
                <Card className="bg-card border-border">
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
                <Card className="bg-card border-border">
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
                  {results.map((result) => <ResultCard key={result.id} result={result} />)}
                </>
              )}
            </div>
          )}
        </div>
      </AppLayout>
    </RouteGuard>
  );
}
