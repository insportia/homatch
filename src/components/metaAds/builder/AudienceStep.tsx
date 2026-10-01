// WHO SEES THE AD — places, ages, gender, and (when the customer has one) a
// retargeting audience. Saved to the draft's `targeting` (TargetingIntentRow).
//
// Ages and gender are the customer's choice. Broad (18–65+, everyone) is
// HOMATCH's RECOMMENDATION, not a rule: narrowing is allowed and saved as
// chosen, and a small non-blocking note says why broad usually works better.
//
// HOMATCH absorbs the platform rules: a property ad runs to all adults of
// every gender with city radii of at least 25 km (Meta's Housing ad category).
// For those ads the audience is shown as what HOMATCH set up — plain values,
// no disabled controls, no rulebook — and the draft stores exactly what will
// run (masterLogic.housingNormalized = targeting.applyTargeting on the server).
import React from 'react';
import { Lightbulb, MapPin, Sparkles, Users, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  CITY_RADIUS_KM_DEFAULT, CITY_RADIUS_KM_MAX, HOUSING_MIN_RADIUS_KM, MAX_LOCATIONS, META_AGE_MAX, META_AGE_MIN,
} from '@/lib/metaAds/targeting';
import type { LocationChoiceRow, MetaAudienceRow, MetaCampaignRow, MetaStatus, TargetingIntentRow } from '@/services/metaAds';
import { ChoiceCard, StepShell } from './ui';
import { LocationPicker, regionName } from './LocationPicker';
import { addLocation, effectiveRadiusKm, housingNormalized, isHousingCampaign, isNarrowAudience, locationId } from './masterLogic';

const RADII = [10, CITY_RADIUS_KM_DEFAULT, HOUSING_MIN_RADIUS_KM, 40, 60, CITY_RADIUS_KM_MAX];
const AGES = Array.from({ length: META_AGE_MAX - META_AGE_MIN + 1 }, (_, i) => META_AGE_MIN + i);
const GENDERS: TargetingIntentRow['gender'][] = ['ALL', 'FEMALE', 'MALE'];

export function AudienceStep({ campaign, status, audiences, patch }: {
  campaign: MetaCampaignRow; status: MetaStatus | null; audiences: MetaAudienceRow[];
  patch: (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean }) => void;
}) {
  const { t, lang } = useLanguage();
  const housing = isHousingCampaign(campaign);
  const stored = campaign.targeting ?? null;
  const defaults: LocationChoiceRow[] = (status?.settings.countries?.length ? status.settings.countries : ['GE'])
    .map((c) => ({ type: 'country', key: c.toUpperCase(), name: regionName(c.toUpperCase(), lang), countryCode: c.toUpperCase() }));
  const usingDefault = !stored?.locations?.length;
  const locations = usingDefault ? defaults : stored!.locations;
  const ageMin = housing ? META_AGE_MIN : stored?.ageMin ?? META_AGE_MIN;
  const ageMax = housing ? META_AGE_MAX : stored?.ageMax ?? META_AGE_MAX;
  const gender = housing ? 'ALL' : stored?.gender ?? 'ALL';
  const minRadius = housing ? HOUSING_MIN_RADIUS_KM : 1;
  const [note, setNote] = React.useState<string | null>(null);

  const save = (next: Partial<TargetingIntentRow>) => {
    const merged: TargetingIntentRow = {
      locations: usingDefault ? defaults : stored!.locations,
      ageMin: stored?.ageMin ?? META_AGE_MIN, ageMax: stored?.ageMax ?? META_AGE_MAX, gender: stored?.gender ?? 'ALL',
      ...next,
    };
    patch({ targeting: housing ? housingNormalized(merged) : merged }, { immediate: true });
  };

  /* A draft that became a property ad after narrowing: store what will run,
     once, so the draft, the review and the server all say the same thing. */
  const staleHousing = housing && !!stored && JSON.stringify(housingNormalized(stored)) !== JSON.stringify(stored);
  React.useEffect(() => { if (staleHousing) save({}); }, [staleHousing]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = (loc: LocationChoiceRow) => {
    const withRadius = loc.type === 'city' ? { ...loc, radiusKm: Math.max(CITY_RADIUS_KM_DEFAULT, minRadius) } : loc;
    const r = addLocation(locations, withRadius);
    if (r.full) { setNote(t('mm_b_loc_full')); return; }
    setNote(r.replaced.length ? t('mm_b_loc_replaced', { places: r.replaced.join(', '), place: withRadius.name }) : null);
    save({ locations: r.list });
  };
  const remove = (id: string) => { setNote(null); save({ locations: locations.filter((l) => locationId(l) !== id) }); };
  const setRadius = (id: string, km: number) => save({ locations: locations.map((l) => (locationId(l) === id ? { ...l, radiusKm: km } : l)) });

  const countries = [...new Set(locations.map((l) => l.countryCode).filter(Boolean))];
  const scope = countries.length === 1 ? countries[0] : null;
  const ageLabel = (a: number) => (a === META_AGE_MAX ? `${a}+` : String(a));

  return (
    <StepShell eyebrow={t('madsb_step_audience')} title={t('madsb_audience_title')} lead={t('madsb_audience_lead')}>
      {/* HOMATCH does the platform work; the customer adjusts what is theirs to choose. */}
      <div data-mm-smart-audience="" className="flex items-start gap-2.5 rounded-xl border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))]/60 px-3.5 py-3 text-[13px] leading-relaxed">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden />
        <span className="min-w-0">
          <span className="block font-semibold text-foreground">{t('mm_b_smart_title')}</span>
          <span className="text-muted-foreground">{t('mm_b_smart_body')}</span>
        </span>
      </div>
      {/* WHERE */}
      <section aria-labelledby="mm-b-where" className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="mm-b-where" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MapPin className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden />{t('mm_b_loc_title')}
          </h3>
          <span className="text-2xs text-muted-foreground" dir="ltr">{locations.length}/{MAX_LOCATIONS}</span>
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label={t('mm_b_loc_chosen')}>
          {locations.map((l) => {
            const id = locationId(l);
            const name = l.type === 'country' ? regionName(l.key, lang) : l.name;
            const radius = effectiveRadiusKm(l.radiusKm, housing);
            const options = [...new Set([...RADII, radius])].filter((r) => r >= minRadius && r <= CITY_RADIUS_KM_MAX).sort((a, b) => a - b);
            return (
              <li key={id} className="flex max-w-full items-center gap-1 rounded-full border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] py-1 ps-3 pe-1 text-[13px]">
                <span className="min-w-0 truncate font-medium text-foreground" dir="auto">{name}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">· {t(`mm_b_loc_kind_${l.type}`)}</span>
                {l.type === 'city' && (
                  <label className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
                    <span className="sr-only">{t('mm_b_loc_radius_label', { place: name })}</span>
                    <select value={radius} onChange={(e) => setRadius(id, Number(e.target.value))}
                      className="rounded-md border border-border bg-background px-1 py-0.5 text-2xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                      {options.map((r) => <option key={r} value={r}>{t('mm_b_loc_radius_km', { km: String(r) })}</option>)}
                    </select>
                  </label>
                )}
                {!usingDefault && (
                  <button type="button" onClick={() => remove(id)} aria-label={t('mm_b_loc_remove', { place: name })}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {usingDefault && <p className="text-2xs text-muted-foreground">{t('mm_b_loc_default_note')}</p>}
        <LocationPicker scopeCountry={scope} full={!usingDefault && locations.length >= MAX_LOCATIONS} onPick={onPick}
          isChosen={(r) => locations.some((l) => locationId(l) === `${r.type}:${r.key}`)} />
        {note && <p className="text-[13px] text-muted-foreground" aria-live="polite">{note}</p>}
      </section>

      {/* AGES + GENDER */}
      <section aria-labelledby="mm-b-who" className="space-y-2.5">
        <h3 id="mm-b-who" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden />{t('mm_b_who_title')}
        </h3>
        {housing ? (
          /* What HOMATCH set up for a property ad: the values, not the rulebook. */
          <div data-mm-housing-rule="" data-mm-smart-fixed="">
            <p className="text-sm font-medium text-foreground">
              {t('mm_b_age_range', { min: String(META_AGE_MIN), max: `${META_AGE_MAX}+` })} · {t('mm_b_gender_ALL')}
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t('mm_b_smart_fixed')}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset className="min-w-0">
                <legend className="mb-1 text-[13px] font-medium text-foreground">{t('mm_b_age_label')}</legend>
                <div className="flex items-center gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{t('mm_b_age_min')}</span>
                    <select value={ageMin} onChange={(e) => { const v = Number(e.target.value); save({ ageMin: v, ageMax: Math.max(v, ageMax) }); }}
                      className="h-10 w-full rounded-xl border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                      {AGES.map((a) => <option key={a} value={a}>{ageLabel(a)}</option>)}
                    </select>
                  </label>
                  <span className="text-muted-foreground" aria-hidden>–</span>
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{t('mm_b_age_max')}</span>
                    <select value={ageMax} onChange={(e) => { const v = Number(e.target.value); save({ ageMax: v, ageMin: Math.min(v, ageMin) }); }}
                      className="h-10 w-full rounded-xl border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                      {AGES.map((a) => <option key={a} value={a}>{ageLabel(a)}</option>)}
                    </select>
                  </label>
                </div>
              </fieldset>
              <div className="min-w-0">
                <p id="mm-b-gender" className="mb-1 text-[13px] font-medium text-foreground">{t('mm_b_gender_label')}</p>
                <div role="group" aria-labelledby="mm-b-gender" className="flex flex-wrap gap-1.5">
                  {GENDERS.map((g) => (
                    <button key={g} type="button" aria-pressed={gender === g} onClick={() => save({ gender: g })}
                      className={cn('h-10 rounded-xl border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
                        gender === g ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
                      {t(`mm_b_gender_${g}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* Advice, never a block: the choice above stays exactly as made. */}
            {isNarrowAudience({ ageMin, ageMax, gender }) && (
              <div data-mm-audience-rec="" role="note" className="flex items-start gap-2.5 rounded-xl border border-[hsl(var(--gold-border))]/50 bg-[hsl(var(--gold-soft))]/50 px-3.5 py-2.5 text-[13px] leading-relaxed">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{t('mm_b_rec_title')}</span>
                  <span className="text-muted-foreground">{t('mm_b_rec_narrow')}</span>
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* WHO, BY RELATIONSHIP */}
      <section aria-labelledby="mm-b-aud" className="space-y-2">
        <h3 id="mm-b-aud" className="text-sm font-semibold text-foreground">{t('madsb_review_audience_type')}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard active={!campaign.audience_id} icon={<Users className="h-4 w-4" />} title={t('mads_audience_broad')} body={t('madsb_audience_broad_d')}
            onClick={() => patch({ audience_id: null }, { immediate: true })} />
          {/* Retargeting audiences only while the admin switch allows them (the chosen one stays visible to switch away). */}
          {audiences.filter((a) => a.sync_status === 'READY' && (status?.settings.retargetingEnabled !== false || campaign.audience_id === a.id)).map((a) => (
            <ChoiceCard key={a.id} active={campaign.audience_id === a.id} title={a.name} body={t('madsb_audience_retarget_d')}
              onClick={() => patch({ audience_id: a.id }, { immediate: true })} />
          ))}
        </div>
      </section>
    </StepShell>
  );
}
