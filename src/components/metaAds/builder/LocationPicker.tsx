// WHERE — ONE universal search for every kind of place Meta targets: type
// "საქართველო", "Georgia", "Грузия", "თბილისი", "Vake", "Батуми" and the
// list shows countries (from CLDR names in every script, without Meta),
// regions, cities and districts, each labelled with its kind and parent
// ("City · Georgia", "District · Tbilisi, Georgia"). Places carry the key
// Meta issued — nothing here invents an id. A street is never silently
// turned into a city: its nearest areas are shown as such, and the pin is
// offered for the exact spot. No IP or GPS location is ever used.
//
// A real combobox: type to search (debounced 300 ms, 2+ characters),
// ArrowUp/ArrowDown to move, Enter to add, Escape to close. One request per
// question per session (cache), identical questions in flight share one
// request, a superseded answer is dropped, a failed one retried once.
import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { geoSearch, type LocationChoiceRow } from '@/services/metaAds';

type Found = LocationChoiceRow & { region?: string | null; countryName?: string | null; nearest?: boolean };
type Answer = { results: Found[]; reason?: string; street?: boolean };

/* One answer per question for the session: retyping or reopening never asks Meta twice. */
const CACHE = new Map<string, Answer>();
const INFLIGHT = new Map<string, Promise<Answer>>();
const MIN_CHARS = 2;

/** Ask once; identical questions in flight share the request; one retry after a short pause. */
function ask(key: string, run: () => Promise<Answer>): Promise<Answer> {
  const hit = INFLIGHT.get(key);
  if (hit) return hit;
  const p = run().catch(async (e) => {
    const code = String((e as { code?: string })?.code ?? (e as { body?: { code?: string } })?.body?.code ?? '');
    if (code === 'NOT_CONNECTED') throw e;
    await new Promise((r) => setTimeout(r, 700));
    return run();
  }).finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
  return p;
}

export function regionName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

export function LocationPicker({ scopeCountry, full, onPick, isChosen, onStreet }: {
  /** A street was typed: Meta cannot target it by name — offer the pin instead. */
  onStreet?: () => void;
  /** The country already chosen: its places are listed first (never a filter). */
  scopeCountry: string | null;
  full: boolean;
  onPick: (loc: LocationChoiceRow) => void;
  isChosen: (loc: LocationChoiceRow) => boolean;
}) {
  const { t, lang } = useLanguage();
  const uid = useId();
  const listId = `${uid}-list`;
  const [street, setStreet] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Found[]>([]);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'short' | 'mock' | 'not_connected' | 'error'>('idle');
  const reqId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const needle = q.trim();
    if (needle.length < MIN_CHARS) { setResults([]); setState(needle ? 'short' : 'idle'); return; }
    const id = ++reqId.current;
    const cacheKey = `any|${needle.toLowerCase()}|${lang}|${scopeCountry ?? ''}`;
    const show = (r: Answer) => {
      setResults(r.results ?? []);
      setActive((r.results ?? []).length ? 0 : -1);
      setStreet(!!r.street);
      setState(r.reason === 'MOCK_MODE_NO_META_CATALOGUE' ? 'mock' : r.reason === 'NOT_CONNECTED' ? 'not_connected' : 'done');
    };
    const cached = CACHE.get(cacheKey);
    if (cached) { show(cached); return; }
    setState('loading');
    const h = setTimeout(async () => {
      try {
        const entry = await ask(cacheKey, async () => {
          const r = await geoSearch(needle, 'any', lang, undefined, scopeCountry ?? undefined);
          return { results: (r.results ?? []) as Found[], reason: r.reason, street: r.street };
        });
        if (!entry.reason) CACHE.set(cacheKey, entry);
        if (id !== reqId.current) return; // a newer question is already on its way
        show(entry);
      } catch (e) {
        if (id !== reqId.current) return;
        setResults([]); setActive(-1); setStreet(false);
        const code = String((e as { code?: string; body?: { code?: string } })?.code ?? (e as { body?: { code?: string } })?.body?.code ?? '');
        setState(code === 'NOT_CONNECTED' ? 'not_connected' : 'error');
      }
    }, 300);
    return () => clearTimeout(h);
  }, [q, open, lang, scopeCountry]);

  const pick = (r: Found) => {
    onPick({
      type: r.type, key: String(r.key), name: r.type === 'country' ? regionName(String(r.key), lang) : r.name, countryCode: String(r.countryCode || '').toUpperCase(),
      // Coordinates only when Meta gave them (the map never places a guess).
      ...(Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)) && r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : {}),
      ...(r.type === 'neighborhood' ? { metaType: r.metaType === 'subcity' ? 'subcity' : 'neighborhood' } : {}),
    });
    setQ(''); setResults([]); setActive(-1);
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { if (open && active >= 0 && results[active]) { e.preventDefault(); pick(results[active]); } }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const nearest = results.some((r) => r.nearest);
  const statusText = state === 'loading' ? t('mm_b_loc_searching')
    : state === 'short' ? t('mm_b_loc_type_more')
      : state === 'mock' ? t('mm_b_loc_mock')
        : state === 'not_connected' ? t(results.length ? 'mm_g_countries_only' : 'mm_b_loc_not_connected')
          : state === 'error' ? t('mm_b_loc_error')
            : state === 'done' ? (nearest ? t('mm_g_street_nearest') : results.length ? t('mm_b_loc_results', { n: String(results.length) }) : street ? t('mm_c_loc_street') : t('mm_b_loc_none')) : '';

  return (
    <div className="space-y-2">
      <div className="relative">
        <label htmlFor={`${uid}-input`} className="sr-only">{t('mm_b_loc_search_label')}</label>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input ref={inputRef} id={`${uid}-input`} type="search" role="combobox" autoComplete="off" disabled={full} enterKeyHint="search"
          aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list" data-mm-loc-search=""
          aria-activedescendant={open && active >= 0 ? `${uid}-opt-${active}` : undefined}
          value={q} placeholder={full ? t('mm_b_loc_full') : t('mm_g_search_ph')}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey}
          className="h-11 w-full rounded-xl border border-input bg-background ps-9 pe-9 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm" />
        {state === 'loading' && <Loader2 className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
        {open && results.length > 0 && (
          <ul id={listId} role="listbox" aria-label={t('mm_b_loc_search_label')}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-hover">
            {results.map((r, i) => {
              const chosen = isChosen(r);
              return (
                <li key={`${r.type}:${r.key}`} id={`${uid}-opt-${i}`} role="option" aria-selected={i === active} aria-disabled={chosen}
                  data-mm-loc-result={r.type}
                  onMouseDown={(e) => { e.preventDefault(); if (!chosen) pick(r); }} onMouseEnter={() => setActive(i)}
                  className={cn('flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm',
                    i === active ? 'bg-[hsl(var(--gold-soft))]' : '', chosen && 'cursor-default opacity-55')}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground" dir="auto">{r.type === 'country' ? regionName(String(r.key), lang) : r.name}</span>
                    <span className="block truncate text-2xs text-muted-foreground" dir="auto">{placeSubtitle(r, lang, t)}</span>
                  </span>
                  {chosen && <span className="shrink-0 text-2xs text-muted-foreground">{t('mm_b_loc_added')}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {street && state === 'done' && onStreet && (
        <button type="button" onClick={onStreet} data-mm-loc-street=""
          className="inline-flex min-h-11 items-center rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-3.5 text-[13px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
          📍 {t('mm_c_loc_street_cta')}
        </button>
      )}
      <p className="min-h-[1rem] text-2xs text-muted-foreground" aria-live="polite">{statusText}</p>
    </div>
  );
}

/**
 * "Country" · "Region · Georgia" · "City · Adjara, Georgia" · "District · Tbilisi, Georgia".
 * The parent comes from Meta's answer; the country name from CLDR in the UI language.
 */
export function placeSubtitle(r: Pick<Found, 'type' | 'name' | 'region' | 'countryCode' | 'countryName'>, lang: string, t: (k: string) => string): string {
  const kind = t(`mm_b_loc_kind_${r.type === 'neighborhood' ? 'neighborhood' : r.type}`);
  if (r.type === 'country') return kind;
  const country = r.countryCode ? regionName(String(r.countryCode).toUpperCase(), lang) : (r.countryName ?? '');
  const region = r.type !== 'region' && r.region && r.region !== r.name ? r.region : null;
  const parent = [region, country].filter(Boolean).join(', ');
  return parent ? `${kind} · ${parent}` : kind;
}
