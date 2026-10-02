// WHO SEES THE AD — where (with HOMATCH's map), who (ages, gender), which
// languages, an international / expat mode, and (when the customer has one)
// a retargeting audience. Saved to the draft's `targeting` (TargetingIntentRow).
//
// THREE KINDS OF SETTING, never confused:
//   · USER CHOICE         places, radius, ages, gender, languages, intent.
//   · HOMATCH RECOMMENDS   broad ages/gender, a balanced area — shown as a
//                          friendly note next to the choice, never a block.
//   · META RESTRICTION     only where Meta's housing rule really applies (a
//                          property ad reaching the US, Canada or the European
//                          list — targeting.housingRule). The card names the
//                          countries that cause it and offers the fix; no
//                          disabled controls. For Georgia it does not apply.
//
// The draft stores exactly what will run: where the rule applies,
// housingNormalized() = targeting.applyTargeting() on the server.
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Home, Loader2, MapPin, Plus, Users, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CITY_RADIUS_KM_DEFAULT, CITY_RADIUS_KM_MAX, MAX_LANGUAGES, MAX_LOCATIONS, MAX_MARKETS, META_AGE_MAX, META_AGE_MIN, PIN_RADIUS_KM_MIN, pinKey,
} from '@/lib/metaAds/targeting';
import { COUNTRY_CODES, LANGUAGE_CODES, copyLanguages, locationBreadth, type LanguageCode } from '@/lib/metaAds/audienceGuide';
import {
  localeSearch, propertyPoint,
  type LocationChoiceRow, type MetaAudienceRow, type MetaCampaignRow, type MetaCreativeRow, type MetaStatus, type TargetingIntentRow,
} from '@/services/metaAds';
import { ChoiceCard, StepShell } from './ui';
import { countryLabel, LocationPicker, regionName } from './LocationPicker';
import { IntelligenceCard } from './IntelligenceCard';
import { BreadthGuide, Fold, HelperCard, Hint, LearningCard, More, Pill, Section } from './FinishKit';
import { addLocation, advertiserCountryOf, effectiveRadiusKm, geographyGroups, housingNormalized, housingRuleFor, isNarrowAudience, locationId, refinedCountries } from './masterLogic';

const GeoMap = React.lazy(() => import('./GeoMap'));
const AGES = Array.from({ length: META_AGE_MAX - META_AGE_MIN + 1 }, (_, i) => META_AGE_MIN + i);
const GENDERS: TargetingIntentRow['gender'][] = ['ALL', 'FEMALE', 'MALE'];
const INTENTS = ['FOREIGNERS_IN_COUNTRY', 'MOVING_HERE', 'INVESTORS_ABROAD', 'LANGUAGE_SPEAKERS', 'COUNTRY_CONNECTED'] as const;
const QUICK_LANGS: LanguageCode[] = ['ka', 'en', 'ru', 'tr', 'ar', 'he', 'uk', 'hy', 'az'];

export function languageName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang], { type: 'language' }).of(code) ?? code; } catch { return code; }
}

export function AudienceStep({ campaign, status, audiences, creatives = [], patch }: {
  campaign: MetaCampaignRow; status: MetaStatus | null; audiences: MetaAudienceRow[]; creatives?: MetaCreativeRow[];
  patch: (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean }) => void;
}) {
  const { t, lang } = useLanguage();
  const stored = campaign.targeting ?? null;
  /* Targeting is the owner's own choice: a new campaign starts with NO place.
     Never a default country, the account's country, the browser's or a
     device location — only a saved draft brings places back. */
  const locations: LocationChoiceRow[] = stored?.locations ?? [];
  const rule = housingRuleFor(campaign, locations, advertiserCountryOf(status));
  const ageMin = rule.restricted ? META_AGE_MIN : stored?.ageMin ?? META_AGE_MIN;
  const ageMax = rule.restricted ? META_AGE_MAX : stored?.ageMax ?? META_AGE_MAX;
  const gender = rule.restricted ? 'ALL' : stored?.gender ?? 'ALL';
  const languages = stored?.languages ?? [];
  const intl = stored?.international ?? null;
  const minRadius = rule.minRadiusKm ?? PIN_RADIUS_KM_MIN;
  const [note, setNote] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const [home, setHome] = useState<{ lat: number; lng: number; label: string | null } | null>(null);
  const [langBusy, setLangBusy] = useState<string | null>(null);
  const [langNote, setLangNote] = useState<string | null>(null);

  useEffect(() => { let live = true; propertyPoint(campaign.property_id).then((p) => { if (live) setHome(p); }).catch(() => undefined); return () => { live = false; }; }, [campaign.property_id]);

  const save = (next: Partial<TargetingIntentRow>, immediate = true) => {
    const merged: TargetingIntentRow = {
      locations: stored?.locations ?? [],
      ageMin: stored?.ageMin ?? META_AGE_MIN, ageMax: stored?.ageMax ?? META_AGE_MAX, gender: stored?.gender ?? 'ALL',
      ...(stored?.languages ? { languages: stored.languages } : {}),
      ...(stored?.international ? { international: stored.international } : {}),
      ...next,
    };
    // Meta's housing rule follows the places: decided on the merged result.
    const r = housingRuleFor(campaign, merged.locations, advertiserCountryOf(status));
    patch({ targeting: r.restricted ? housingNormalized(merged, r.minRadiusKm ?? undefined) : merged }, { immediate });
  };

  /* A draft that now reaches a restricted country after narrowing: store what
     will run, once, so the draft, the review and the server agree. */
  const stale = rule.restricted && !!stored && JSON.stringify(housingNormalized(stored, rule.minRadiusKm ?? undefined)) !== JSON.stringify(stored);
  React.useEffect(() => { if (stale) save({}); }, [stale]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = (loc: LocationChoiceRow) => {
    const withRadius = loc.type === 'city' ? { ...loc, radiusKm: Math.max(CITY_RADIUS_KM_DEFAULT, minRadius) } : loc;
    const r = addLocation(locations, withRadius);
    if (r.full) { setNote(t('mm_b_loc_full')); return; }
    setNote(r.replaced.length ? t('mm_b_loc_replaced', { places: r.replaced.join(', '), place: withRadius.name }) : null);
    save({ locations: r.list });
  };
  const addPin = (lat: number, lng: number, name: string) => {
    onPick({ type: 'pin', key: pinKey(lat, lng), name, countryCode: 'GE', lat, lng, radiusKm: Math.max(5, minRadius) });
    setPinMode(false);
  };
  const remove = (id: string) => { setNote(null); save({ locations: locations.filter((l) => locationId(l) !== id) }); };
  const setRadius = (id: string, km: number) => save({ locations: locations.map((l) => (locationId(l) === id ? { ...l, radiusKm: km } : l)) }, false);

  const countries = [...new Set(locations.map((l) => l.countryCode).filter(Boolean))];
  const scope = countries.length === 1 ? countries[0] : null;
  const ageLabel = (a: number) => (a === META_AGE_MAX ? `${a}+` : String(a));
  const breadth = locationBreadth(locations as never, rule.minRadiusKm);
  const copyLangs = useMemo(() => copyLanguages(creatives.filter((c) => c.media.length)), [creatives]);

  /* LANGUAGES: Meta's own locale key, or nothing — never an invented id. */
  const toggleLanguage = async (code: LanguageCode) => {
    setLangNote(null);
    if (languages.some((l) => l.code === code)) { save({ languages: languages.filter((l) => l.code !== code) }); return; }
    if (languages.length >= MAX_LANGUAGES) { setLangNote(t('mm_f_lang_full')); return; }
    setLangBusy(code);
    try {
      const r = await localeSearch(code);
      const hit = r.results?.[0];
      if (!hit) { setLangNote(t(r.reason === 'MOCK_MODE_NO_META_CATALOGUE' ? 'mm_f_lang_mock' : 'mm_f_lang_none')); return; }
      save({ languages: [...languages, { key: hit.key, name: hit.name, code }] });
    } catch (e) {
      const c = String((e as { code?: string })?.code ?? (e as { body?: { code?: string } })?.body?.code ?? '');
      setLangNote(t(c === 'NOT_CONNECTED' ? 'mm_b_loc_not_connected' : 'mm_f_lang_error'));
    } finally { setLangBusy(null); }
  };

  const setIntl = (next: Partial<NonNullable<TargetingIntentRow['international']>>) =>
    save({ international: { enabled: intl?.enabled ?? false, intents: intl?.intents ?? [], markets: intl?.markets ?? [], ...next } });
  const marketsNotReached = (intl?.markets ?? []).filter((m) => !countries.includes(m));
  const addMarketsAsPlaces = () => {
    let list = [...locations];
    for (const m of marketsNotReached) {
      const r = addLocation(list, { type: 'country', key: m, name: regionName(m, lang), countryCode: m });
      if (!r.full) list = r.list;
    }
    save({ locations: list });
  };

  const refined = refinedCountries(locations);
  /* The number the map shows for a place: its position among the drawn targets
     (a country with places inside runs as those places, so it has no number). */
  const shownIds = locations.filter((l) => !(l.type === 'country' && refined.has(l.key))).map(locationId);
  const mapNumber = (idx: number) => shownIds.indexOf(locationId(locations[idx])) + 1;
  // A pin around the property only where HOMATCH knows the point's country (Georgia).
  const homeInGeorgia = !!home && home.lat >= 41 && home.lat <= 43.7 && home.lng >= 39.9 && home.lng <= 46.8;
  const precise = locations.some((l) => l.type !== 'country');
  const narrow = isNarrowAudience({ ageMin, ageMax, gender });
  const readyAudiences = audiences.filter((a) => a.sync_status === 'READY' && (status?.settings.retargetingEnabled !== false || campaign.audience_id === a.id));
  const placeLabel = (l: LocationChoiceRow) => {
    const r = l.type === 'city' || l.type === 'pin' ? effectiveRadiusKm(l.radiusKm, rule.minRadiusKm) : null;
    return r ? `${l.name} · ${r} km` : l.name;
  };
  /* The effective geography in one line — what will run, never a guess. */
  const geoSummary = geographyGroups(locations).map((g) =>
    g.whole || !g.places.length ? regionName(g.countryCode, lang) : `${regionName(g.countryCode, lang)} → ${g.places.map(placeLabel).join(', ')}`).join(' + ');
  const whoSummary = `${t('mm_b_age_range', { min: String(ageMin), max: ageLabel(ageMax) })} · ${t(`mm_b_gender_${gender}`)}`;
  const intlSummary = intl?.enabled ? t('mm_m_intl_on', { n: String(intl.intents.length) }) : t('mm_m_intl_off');
  const langSummary = languages.length ? languages.map((l) => languageName(l.code ?? l.name, lang)).join(', ') : t('mm_f_lang_all');

  return (
    <StepShell eyebrow={t('madsb_step_audience')} title={t('madsb_audience_title')} lead={t('mm_f_audience_lead')}>
      {/* 📍 WHERE — the owner's own choice: empty until a place is picked. The map
          shows exactly the targets and stays in view; on wide screens it sits beside the list. */}
      <Section id="mm-f-where" emoji="📍" title={t('mm_m_where_title')} aside={<span className="text-2xs text-muted-foreground" dir="ltr">{locations.length}/{MAX_LOCATIONS}</span>}>
        <Hint k="mm_c_hint_location" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
          <div className="min-w-0 space-y-3" data-mm-field="locations">
            {locations.length > 0 ? (
              <div data-mm-geo-summary="" className="rounded-xl border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] px-3.5 py-2.5">
                <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--gold-ink))]">{t('mm_m_geo_runs')}</p>
                <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground" dir="auto">{geoSummary}</p>
              </div>
            ) : (
              <div data-mm-geo-empty="" className="rounded-xl border border-dashed border-[hsl(var(--gold-border))]/70 bg-card px-3.5 py-2.5">
                <p className="text-sm font-semibold text-foreground">{t('mm_c_loc_empty_title')}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{t('mm_c_loc_empty_body')}</p>
              </div>
            )}
            <LocationPicker scopeCountry={scope} full={locations.length >= MAX_LOCATIONS} onPick={onPick}
              onStreet={() => setPinMode(true)}
              isChosen={(r) => locations.some((l) => locationId(l) === `${r.type}:${r.key}`)} />
            {/* Areas as removable chips; a city or a pin keeps its radius control. */}
            {locations.some((l) => l.type !== 'city' && l.type !== 'pin') && (
              <ul className="flex flex-wrap gap-1.5" aria-label={t('mm_b_loc_chosen')} data-mm-loc-chips="">
                {locations.map((l, idx) => {
                  if (l.type === 'city' || l.type === 'pin') return null;
                  const id = locationId(l);
                  const name = l.type === 'country' ? countryLabel({ key: l.key, name: l.name }, lang) : l.name;
                  const narrowed = l.type === 'country' && refined.has(l.key);
                  return (
                    <li key={id} data-mm-loc={id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] py-0.5 ps-1 text-[13px]">
                      <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold))] text-2xs font-extrabold text-[#161309]">{narrowed ? '·' : mapNumber(idx)}</span>
                      <span className="min-w-0">
                        <span className="font-semibold text-foreground break-words" dir="auto">{name}</span>
                        <span className="ms-1 text-2xs text-muted-foreground">{narrowed ? t('mm_m_loc_refined') : t(`mm_b_loc_kind_${l.type === 'neighborhood' ? 'neighborhood' : l.type}`)}</span>
                      </span>
                      <button type="button" onClick={() => remove(id)} aria-label={t('mm_b_loc_remove', { place: name })} data-mm-loc-remove={id}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <ul className="grid gap-2" aria-label={t('mm_b_loc_chosen')}>
              {locations.map((l, idx) => {
                if (l.type !== 'city' && l.type !== 'pin') return null;
                const id = locationId(l);
                const name = l.name;
                const radius = effectiveRadiusKm(l.radiusKm, rule.minRadiusKm);
                return (
                  <li key={id} data-mm-loc={id} className="rounded-2xl border border-[hsl(var(--gold-border))]/50 bg-gradient-to-r from-[hsl(var(--gold-soft))] to-card px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold))] text-2xs font-extrabold text-[#161309]">{mapNumber(idx)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-snug text-foreground break-words" dir="auto">{name}</span>
                        <span className="block text-2xs text-muted-foreground">{t(`mm_b_loc_kind_${l.type}`)}</span>
                      </span>
                      <button type="button" onClick={() => remove(id)} aria-label={t('mm_b_loc_remove', { place: name })} data-mm-loc-remove={id}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <label className="mt-1.5 flex items-center gap-3">
                      <span className="sr-only">{t('mm_b_loc_radius_label', { place: name })}</span>
                      <input type="range" min={Math.max(1, minRadius)} max={CITY_RADIUS_KM_MAX} step={1} value={radius} data-mm-radius={id}
                        onChange={(e) => setRadius(id, Number(e.target.value))}
                        className="h-2 min-w-0 flex-1 cursor-pointer accent-[hsl(var(--gold))]" />
                      <span className="w-16 shrink-0 whitespace-nowrap text-end text-[13px] font-semibold tabular-nums text-foreground" dir="ltr">{radius} km</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {locations.some((l) => l.type === 'city' || l.type === 'pin') && <Hint k="mm_c_hint_radius" />}
            {note && <p className="text-[13px] text-muted-foreground" aria-live="polite">{note}</p>}
          </div>
          <div className="min-w-0 space-y-2 lg:sticky lg:top-4">
            <Suspense fallback={<Skeleton className="aspect-[16/10] w-full rounded-2xl" />}>
              <GeoMap locations={locations} minRadiusKm={rule.minRadiusKm} pinMode={pinMode}
                onPin={(lat, lng) => addPin(lat, lng, t('mm_f_pin_name', { n: String(locations.filter((l) => l.type === 'pin').length + 1) }))} />
            </Suspense>
            <div className="flex flex-wrap gap-2">
              <Pill active={pinMode} onClick={() => setPinMode((v) => !v)} data-mm-pin-mode="">
                <MapPin className="h-4 w-4" aria-hidden />{pinMode ? t('mm_f_pin_cancel') : t('mm_f_pin_drop')}
              </Pill>
              {home && homeInGeorgia && (
                <button type="button" data-mm-around-property="" onClick={() => addPin(home.lat, home.lng, home.label ? t('mm_f_around_named', { place: home.label }) : t('mm_f_around_property'))}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-3.5 text-[13px] font-semibold text-foreground hover:bg-[hsl(var(--gold-soft))]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                  <Home className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden />{t('mm_f_around_property')}
                </button>
              )}
            </div>
            {locations.length > 0 && <BreadthGuide breadth={breadth.breadth} areaKm2={breadth.areaKm2} />}
          </div>
        </div>
      </Section>

      {/* 🌍 INTERNATIONAL / EXPAT — an intent, not a place: who the ad is for. */}
      <Fold id="intl" emoji="🌍" title={t('mm_f_intl_title')} summary={intlSummary} defaultOpen={!!intl?.enabled}
        aside={<Pill active={!!intl?.enabled} onClick={() => setIntl({ enabled: !intl?.enabled })} data-mm-intl-toggle="">{intl?.enabled ? t('mm_f_on') : t('mm_f_off')}</Pill>}>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t('mm_f_intl_body')}</p>
        {intl?.enabled && (
          <div className="space-y-3" data-mm-intl="">
            <p className="text-sm font-medium text-foreground">{t('mm_f_intl_who')}</p>
            <div className="flex flex-wrap gap-2">
              {INTENTS.map((i) => (
                <Pill key={i} active={intl.intents.includes(i)} data-mm-intent={i}
                  onClick={() => setIntl({ intents: intl.intents.includes(i) ? intl.intents.filter((x) => x !== i) : [...intl.intents, i] })}>
                  {t(`mm_f_intent_${i}`)}
                </Pill>
              ))}
            </div>
            <MarketPicker markets={intl.markets} onChange={(markets) => setIntl({ markets })} />
            {intl.intents.some((i) => i === 'MOVING_HERE' || i === 'INVESTORS_ABROAD' || i === 'COUNTRY_CONNECTED') && marketsNotReached.length > 0 && (
              <HelperCard emoji="✨" tone="gold" title={t('mm_f_intl_suggest_title')} data-mm-intl-suggest=""
                action={<button type="button" onClick={addMarketsAsPlaces} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[hsl(var(--gold))] px-3.5 text-[13px] font-semibold text-[#161309]"><Plus className="h-4 w-4" />{t('mm_f_intl_add_markets')}</button>}>
                {t('mm_f_intl_suggest_body', { markets: marketsNotReached.map((m) => regionName(m, lang)).join(', ') })}
              </HelperCard>
            )}
            {intl.intents.includes('FOREIGNERS_IN_COUNTRY') && !languages.length && (
              <HelperCard emoji="🗣️" tone="calm" title={t('mm_f_intl_lang_title')}>{t('mm_f_intl_lang_body')}</HelperCard>
            )}
            <p className="text-2xs leading-relaxed text-muted-foreground">{t('mm_f_intl_how')}</p>
          </div>
        )}
      </Fold>

      {/* 🗣️ LANGUAGES — open when the copy is in a language worth matching. */}
      <Fold id="lang" field="languages" emoji="🗣️" title={t('mm_f_lang_title')} summary={langSummary} defaultOpen={languages.length > 0 || !!intl?.enabled}>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t('mm_f_lang_body')}</p>
        <Hint k="mm_c_hint_languages" />
        {copyLangs[0] && (
          <HelperCard emoji="📝" tone="gold" title={t('mm_f_copy_detected', { lang: languageName(copyLangs[0], lang) })} data-mm-copy-lang={copyLangs[0]}>
            {t('mm_f_copy_detected_body', { lang: languageName(copyLangs[0], lang) })}
          </HelperCard>
        )}
        <div className="flex flex-wrap gap-2">
          <Pill active={!languages.length} onClick={() => save({ languages: [] })} data-mm-lang="ALL">{t('mm_f_lang_all')}</Pill>
          {[...new Set([...QUICK_LANGS, ...languages.map((l) => l.code).filter((c): c is LanguageCode => (LANGUAGE_CODES as readonly string[]).includes(String(c)))])].map((code) => (
            <Pill key={code} active={languages.some((l) => l.code === code)} onClick={() => void toggleLanguage(code)} data-mm-lang={code} disabled={langBusy !== null}>
              {langBusy === code && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}{languageName(code, lang)}
            </Pill>
          ))}
        </div>
        {langNote && <p className="text-[13px] text-muted-foreground" aria-live="polite">{langNote}</p>}
        {languages.length > 0 && <p className="text-2xs text-muted-foreground">{t('mm_f_lang_chosen_note')}</p>}
      </Fold>

      {/* 👥 WHO — three kinds of setting, never confused (targeting.audienceAuthority):
          META REQUIRED (named, with the fix) · HOMATCH RECOMMENDED (advice) · USER CHOICE. */}
      <Fold id="who" field="who" emoji="👥" title={t('mm_b_who_title')} summary={rule.restricted ? t('mm_m_who_meta') : whoSummary}
        defaultOpen={rule.restricted || narrow}>
        <Hint k="mm_c_hint_advantage" />
        {rule.restricted ? (
          /* META REQUIRED — named, explained, with the fix. Not a disabled control. */
          <HelperCard emoji="🏛️" tone="amber" title={t('mm_f_meta_rule_title')} data-mm-meta-rule={rule.countries.join(',')} data-mm-authority="META_REQUIRED"
            action={<span className="text-2xs text-muted-foreground">{t('mm_f_meta_rule_fix')}</span>}>
            {t(rule.countries.includes('US_ADVERTISER') ? 'mm_m_meta_rule_us_advertiser' : 'mm_f_meta_rule_body', { countries: rule.countries.filter((c) => c !== 'US_ADVERTISER').map((c) => regionName(c, lang)).join(', '), km: String(rule.minRadiusKm ?? '') })}
            <span className="mt-1.5 block font-medium text-foreground">{t('mm_b_age_range', { min: String(META_AGE_MIN), max: `${META_AGE_MAX}+` })} · {t('mm_b_gender_ALL')}</span>
          </HelperCard>
        ) : (
          <div data-mm-who-choice="" data-mm-authority="USER_CHOICE">
            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset className="min-w-0">
                <legend className="mb-1.5 text-[13px] font-medium text-foreground">{t('mm_b_age_label')}</legend>
                <Hint k="mm_c_hint_age" className="mb-1.5" />
                <div className="flex items-center gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{t('mm_b_age_min')}</span>
                    <select value={ageMin} data-mm-age-min="" onChange={(e) => { const v = Number(e.target.value); save({ ageMin: v, ageMax: Math.max(v, ageMax) }); }}
                      className="h-11 w-full rounded-xl border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                      {AGES.map((a) => <option key={a} value={a}>{ageLabel(a)}</option>)}
                    </select>
                  </label>
                  <span className="text-muted-foreground" aria-hidden>–</span>
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{t('mm_b_age_max')}</span>
                    <select value={ageMax} data-mm-age-max="" onChange={(e) => { const v = Number(e.target.value); save({ ageMax: v, ageMin: Math.min(v, ageMin) }); }}
                      className="h-11 w-full rounded-xl border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                      {AGES.map((a) => <option key={a} value={a}>{ageLabel(a)}</option>)}
                    </select>
                  </label>
                </div>
              </fieldset>
              <div className="min-w-0">
                <p id="mm-b-gender" className="mb-1.5 text-[13px] font-medium text-foreground">{t('mm_b_gender_label')}</p>
                <Hint k="mm_c_hint_gender" className="mb-1.5" />
                <div role="group" aria-labelledby="mm-b-gender" className="flex flex-wrap gap-2">
                  {GENDERS.map((g) => (
                    <Pill key={g} active={gender === g} onClick={() => save({ gender: g })} data-mm-gender={g}>{t(`mm_b_gender_${g}`)}</Pill>
                  ))}
                </div>
              </div>
            </div>
            {/* HOMATCH RECOMMENDATION (HOMATCH_RECOMMENDED) — advice beside the choice, which stays exactly as made. */}
            <HelperCard emoji="✨" tone={narrow ? 'gold' : 'calm'} className="mt-3" data-mm-authority="HOMATCH_RECOMMENDED"
              title={t('mm_f_rec_title')} data-mm-audience-rec={narrow ? 'narrow' : 'broad'}>
              {t(narrow ? 'mm_f_rec_narrow' : 'mm_f_rec_broad')}
            </HelperCard>
          </div>
        )}
      </Fold>

      {/* WHO, BY RELATIONSHIP */}
      {/* Shown only when the customer has a ready audience to choose. */}
      {(readyAudiences.length > 0 || !!campaign.audience_id) && (
        <Section id="mm-f-aud" emoji="🤝" title={t('madsb_review_audience_type')}>
          <div className="grid gap-2 sm:grid-cols-2" data-mm-field="audience_type">
            <ChoiceCard active={!campaign.audience_id} icon={<Users className="h-4 w-4" />} title={t('mads_audience_broad')} body={t('madsb_audience_broad_d')}
              onClick={() => patch({ audience_id: null }, { immediate: true })} />
            {readyAudiences.map((a) => (
              <ChoiceCard key={a.id} active={campaign.audience_id === a.id} title={a.name} body={t('madsb_audience_retarget_d')}
                onClick={() => patch({ audience_id: a.id }, { immediate: true })} />
            ))}
          </div>
        </Section>
      )}

      {/* ✨ HOMATCH INTELLIGENCE — optional; suggests within the owner's limits, never acts alone. */}
      <IntelligenceCard value={campaign.intelligence} housingRestricted={rule.restricted}
        onChange={(next) => patch({ intelligence: next } as Partial<MetaCampaignRow>, { immediate: true })} />

      <More label={t('mm_f_how_learning')}><LearningCard compact /></More>
    </StepShell>
  );
}

/** Countries the people are from or connected to — a short searchable list in the UI language. */
function MarketPicker({ markets, onChange }: { markets: string[]; onChange: (m: string[]) => void }) {
  const { t, lang } = useLanguage();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const options = needle.length < 1 ? [] : COUNTRY_CODES
    .map((c) => ({ c, name: regionName(c, lang), en: regionName(c, 'en') }))
    .filter((o) => !markets.includes(o.c) && (o.name.toLowerCase().includes(needle) || o.en.toLowerCase().includes(needle)))
    .slice(0, 6);
  return (
    <div className="space-y-2" data-mm-markets={markets.join(',')}>
      <p className="text-sm font-medium text-foreground">{t('mm_f_markets_label')}</p>
      <div className="flex flex-wrap gap-2">
        {markets.map((m) => (
          <span key={m} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] ps-3 pe-1 text-[13px] font-medium">
            {regionName(m, lang)}
            <button type="button" aria-label={t('mm_b_loc_remove', { place: regionName(m, lang) })} onClick={() => onChange(markets.filter((x) => x !== m))}
              className="grid h-7 w-7 place-items-center rounded-full hover:bg-background"><X className="h-3.5 w-3.5" /></button>
          </span>
        ))}
      </div>
      {markets.length < MAX_MARKETS && (
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('mm_f_markets_ph')} aria-label={t('mm_f_markets_label')}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]" />
          {options.length > 0 && (
            <ul role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 rounded-xl border border-border bg-popover p-1 shadow-hover">
              {options.map((o) => (
                <li key={o.c} role="option" aria-selected={false}>
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange([...markets, o.c]); setQ(''); }}
                    className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm hover:bg-[hsl(var(--gold-soft))]')}>
                    <span>{o.name}</span><span className="text-2xs text-muted-foreground" dir="ltr">{o.c}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
