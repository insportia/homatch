// MY GEORGIA BY HOMI — Places in Georgia.
//
// Fifty destinations grouped by kind, filtered by what you feel like and when
// you are going. Every card says where it is, the best time, how long it takes
// from Tbilisi and how, three things to do, and an official page to read more.
// No hotlinked photos: each kind has its own colour and icon instead.

import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Building2, Bus, CalendarDays, Car, ChevronDown, Clock, ExternalLink, Footprints, Gem, Landmark,
  MapPin, MountainSnow, Plane, Sparkles, TrainFront, TreePine, Droplets, Waves, Wine, type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  PLACES, PLACE_TYPES, SEASONS, filterPlaces, loadPlaceTexts, seasonOf, seasonalPicks,
  type PlaceMeta, type PlaceTexts, type PlaceType, type Season, type Transport,
} from '@/myGeorgia/places';

const TYPE_LOOK: Record<PlaceType, { icon: LucideIcon; band: string }> = {
  MOUNTAINS: { icon: MountainSnow, band: 'from-[#1d3557] via-[#2f5d8a] to-[#8fb3d9]' },
  SEA: { icon: Waves, band: 'from-[#0b4f6c] via-[#1b7f8f] to-[#5cc2c0]' },
  WINE: { icon: Wine, band: 'from-[#4a1426] via-[#7d2943] to-[#c0607a]' },
  HISTORIC: { icon: Landmark, band: 'from-[#3b2c17] via-[#7a5a2b] to-[#c9a227]' },
  CAVES: { icon: Gem, band: 'from-[#221f33] via-[#463d66] to-[#8a7bb8]' },
  LAKES: { icon: Droplets, band: 'from-[#12404f] via-[#2b7a8c] to-[#7cc4cf]' },
  SPA: { icon: Sparkles, band: 'from-[#2c4a3c] via-[#4f7f66] to-[#a7cfae]' },
  PARKS: { icon: TreePine, band: 'from-[#163a22] via-[#2f6a3c] to-[#79b06a]' },
  CITIES: { icon: Building2, band: 'from-[#0C1119] via-[#26324a] to-[#5b6e93]' },
};

const TRANSPORT_ICON: Record<Transport, LucideIcon> = {
  CAR: Car, MINIBUS: Bus, TRAIN: TrainFront, FLIGHT: Plane, JEEP: Car, WALK: Footprints, CITY: Bus,
};

function usePlaceTexts(lang: string) {
  const [texts, setTexts] = React.useState<PlaceTexts | null>(null);
  React.useEffect(() => {
    let live = true;
    void loadPlaceTexts(lang).then((x) => { if (live) setTexts(x); });
    return () => { live = false; };
  }, [lang]);
  return texts;
}

function useTravelTime() {
  const { t, lang } = useLanguage();
  const nf = React.useMemo(() => new Intl.NumberFormat(lang === 'ka' ? 'ka-GE' : lang, { maximumFractionDigits: 1 }), [lang]);
  return (hours: number) => {
    if (hours <= 0) return t('mg_places_in_tbilisi');
    if (hours < 1) return t('mg_places_minutes', { minutes: nf.format(Math.round(hours * 60)) });
    return t('mg_places_hours', { hours: nf.format(hours) });
  };
}

function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-1.5 text-start text-sm font-medium transition-colors motion-reduce:transition-none',
        on ? 'border-[#0C1119] bg-[#0C1119] text-white' : 'border-border bg-card text-foreground hover:border-[hsl(var(--gold-border))]',
      )}
    >
      {children}
      {count !== undefined ? <span className={cn('shrink-0 whitespace-nowrap text-xs tabular-nums', on ? 'text-white/70' : 'text-muted-foreground')}>{count}</span> : null}
    </button>
  );
}

function SeasonLine({ seasons }: { seasons: readonly Season[] }) {
  const { t } = useLanguage();
  if (seasons.length === SEASONS.length) return <>{t('mg_season_all_year')}</>;
  return <>{seasons.map((s) => t(`mg_season_${s.toLowerCase()}`)).join(', ')}</>;
}

export function PlaceCard({ place, text }: { place: PlaceMeta; text: PlaceTexts[string] }) {
  const { t } = useLanguage();
  const travel = useTravelTime();
  const look = TYPE_LOOK[place.types[0]];
  const Icon = look.icon;
  const detailsId = `place-${place.id}-details`;
  const [open, setOpen] = React.useState(false);
  return (
    <article data-place={place.id} className="flex min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-card">
      <div className={cn('relative isolate flex min-h-[7.5rem] flex-col justify-end overflow-hidden bg-gradient-to-br p-5 text-white', look.band)}>
        {/* Soft ridges: two blurred shapes give the band depth without an image. */}
        <span aria-hidden="true" className="absolute -end-10 -top-16 -z-10 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
        <span aria-hidden="true" className="absolute -bottom-20 -start-8 -z-10 h-40 w-56 rotate-12 rounded-[40%] bg-black/20 blur-xl" />
        <span aria-hidden="true" className="absolute end-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/15 backdrop-blur">
          <Icon className="h-5 w-5" />
        </span>
        <p className="flex items-center gap-1.5 text-xs font-medium text-white/85">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {text.region}
        </p>
        <h3 className="mt-1 pe-14 font-display text-xl font-semibold leading-snug">{text.name}</h3>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <ul className="flex flex-wrap gap-2 text-xs">
          <li className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-foreground">
            <Clock className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" /> {travel(place.hours)}
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-foreground">
            <CalendarDays className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
            <span className="sr-only">{t('mg_places_best')}: </span><SeasonLine seasons={place.seasons} />
          </li>
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-foreground">{text.blurb}</p>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((o) => !o)}
          className="mt-4 inline-flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border px-4 text-start text-sm font-semibold text-foreground hover:border-[hsl(var(--gold-border))]"
        >
          {t('mg_places_details')}
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
        </button>
        <div id={detailsId} hidden={!open} className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t('mg_places_how')}</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{text.getThere}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('mg_places_how')}>
              {place.transport.map((tr) => {
                const TIcon = TRANSPORT_ICON[tr];
                return (
                  <li key={tr} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-foreground">
                    <TIcon className="h-3.5 w-3.5" aria-hidden="true" /> {t(`mg_transport_${tr.toLowerCase()}`)}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t('mg_places_todo')}</p>
            <ul className="mt-1 space-y-1.5">
              {text.todo.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-relaxed text-foreground">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--gold))]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <a
          href={place.source.url}
          target="_blank"
          rel="noopener noreferrer"
          data-place-source
          className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-4 text-sm font-medium text-[hsl(var(--gold-ink))] underline-offset-4 hover:underline"
        >
          {t('mg_places_source', { publisher: place.source.publisher })}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

function Skeleton() {
  const { t } = useLanguage();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      <span className="sr-only">{t('mg_places_loading')}</span>
      {[0, 1, 2].map((i) => <div key={i} aria-hidden="true" className="h-72 animate-pulse rounded-3xl bg-muted motion-reduce:animate-none" />)}
    </div>
  );
}

/** The full section: filters, groups and cards. */
export function PlacesInGeorgia() {
  const { t, lang } = useLanguage();
  const texts = usePlaceTexts(lang);
  const [type, setType] = React.useState<PlaceType | null>(null);
  const [season, setSeason] = React.useState<Season | null>(null);

  const shown = filterPlaces(PLACES, type, season);
  const countFor = (k: PlaceType) => filterPlaces(PLACES, k, season).length;
  /* All kinds: each place once, under its main kind. One kind: every place that is that kind. */
  const groups = type
    ? [{ key: type, items: shown }]
    : PLACE_TYPES.map((k) => ({ key: k, items: shown.filter((p) => p.types[0] === k) })).filter((g) => g.items.length > 0);

  return (
    <section data-places aria-labelledby="mg-places-h" className="space-y-6">
      <div className="overflow-hidden rounded-3xl bg-[#0C1119] p-6 text-white sm:p-8">
        <p className="text-sm font-semibold text-[hsl(var(--gold))]">{t('mg_places_count', { count: String(PLACES.length) })}</p>
        <h2 id="mg-places-h" className="mt-1 font-display text-2xl font-semibold sm:text-3xl">{t('mg_places_title')}</h2>
        <p className="mt-2 max-w-[56ch] text-white/75">{t('mg_places_sub')}</p>
      </div>

      <div className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div role="group" aria-labelledby="mg-places-type">
          <p id="mg-places-type" className="mb-2 text-sm font-semibold text-foreground">{t('mg_places_filter_type')}</p>
          <div className="flex flex-wrap gap-2">
            <Chip on={type === null} onClick={() => setType(null)} count={filterPlaces(PLACES, null, season).length}>{t('mg_places_all')}</Chip>
            {PLACE_TYPES.map((k) => {
              const Icon = TYPE_LOOK[k].icon;
              return (
                <Chip key={k} on={type === k} onClick={() => setType(type === k ? null : k)} count={countFor(k)}>
                  <Icon className="h-4 w-4" aria-hidden="true" /> {t(`mg_ptype_${k.toLowerCase()}`)}
                </Chip>
              );
            })}
          </div>
        </div>
        <div role="group" aria-labelledby="mg-places-season">
          <p id="mg-places-season" className="mb-2 text-sm font-semibold text-foreground">{t('mg_places_filter_season')}</p>
          <div className="flex flex-wrap gap-2">
            <Chip on={season === null} onClick={() => setSeason(null)}>{t('mg_places_any_season')}</Chip>
            {SEASONS.map((s) => (
              <Chip key={s} on={season === s} onClick={() => setSeason(season === s ? null : s)}>{t(`mg_season_${s.toLowerCase()}`)}</Chip>
            ))}
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('mg_places_note')}</p>
      </div>

      {!texts ? <Skeleton /> : shown.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-foreground">{t('mg_places_empty')}</p>
          <button type="button" onClick={() => { setType(null); setSeason(null); }}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-[#0C1119] px-5 text-sm font-semibold text-white">
            {t('mg_places_reset')}
          </button>
        </div>
      ) : (
        <div className="space-y-10" aria-live="polite">
          {groups.map((g) => {
            const Icon = TYPE_LOOK[g.key].icon;
            return (
              <section key={g.key} data-place-group={g.key} aria-labelledby={`mg-pg-${g.key}`}>
                <h3 id={`mg-pg-${g.key}`} className="mb-4 flex items-center gap-2 font-display text-xl font-semibold text-foreground">
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-white', TYPE_LOOK[g.key].band)}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {t(`mg_ptype_${g.key.toLowerCase()}`)}
                  <span className="text-sm font-normal text-muted-foreground">{g.items.length}</span>
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((p) => (texts[p.id] ? <PlaceCard key={p.id} place={p} text={texts[p.id]} /> : null))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Three good trips for this season, for the plan tab, with a way into the full list. */
export function SeasonalPlaces({ placesHref }: { placesHref: string }) {
  const { t, lang } = useLanguage();
  const texts = usePlaceTexts(lang);
  const travel = useTravelTime();
  const picks = seasonalPicks(seasonOf(new Date()));
  return (
    <div data-places-teaser>
      {!texts ? <div aria-hidden="true" className="h-40 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" /> : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {picks.map((p) => {
            const look = TYPE_LOOK[p.types[0]];
            const Icon = look.icon;
            const text = texts[p.id];
            if (!text) return null;
            return (
              <li key={p.id} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
                <div className={cn('flex items-center gap-3 bg-gradient-to-br p-4 text-white', look.band)}>
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 font-display text-base font-semibold leading-snug">{text.name}</span>
                </div>
                <p className="px-4 pt-3 text-xs text-muted-foreground">{text.region} · {travel(p.hours)}</p>
                <p className="px-4 pb-4 pt-1.5 text-sm leading-relaxed text-foreground">{text.blurb}</p>
              </li>
            );
          })}
        </ul>
      )}
      <Link to={placesHref} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0C1119] px-5 text-sm font-semibold text-white">
        {t('mg_places_see_all', { count: String(PLACES.length) })} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </Link>
    </div>
  );
}

export default PlacesInGeorgia;
