// WHERE — a country / region / city search backed by Meta's own location
// catalogue (geo_search). Countries come from the server's ISO list and work
// without a Meta connection; regions and cities carry the key Meta issued,
// so nothing here invents a location id.
//
// A real combobox: type to search (debounced), ArrowUp/ArrowDown to move,
// Enter to add, Escape to close. Results are announced politely.
import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { geoSearch, type LocationChoiceRow } from '@/services/metaAds';

type LocType = LocationChoiceRow['type'];
type Found = LocationChoiceRow & { region?: string | null; countryName?: string | null };

const TYPES: LocType[] = ['city', 'region', 'country'];

export function regionName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

export function LocationPicker({ scopeCountry, full, onPick, isChosen }: {
  /** Regions and cities are searched inside this country when set. */
  scopeCountry: string | null;
  full: boolean;
  onPick: (loc: LocationChoiceRow) => void;
  isChosen: (loc: LocationChoiceRow) => boolean;
}) {
  const { t, lang } = useLanguage();
  const uid = useId();
  const listId = `${uid}-list`;
  const [type, setType] = useState<LocType>('city');
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
    if (type !== 'country' && needle.length < 2) { setResults([]); setState(needle ? 'short' : 'idle'); return; }
    const id = ++reqId.current;
    setState('loading');
    const h = setTimeout(async () => {
      try {
        const r = await geoSearch(needle, type, lang, type === 'country' ? undefined : scopeCountry ?? undefined);
        if (id !== reqId.current) return;
        setResults((r.results ?? []) as Found[]);
        setActive((r.results ?? []).length ? 0 : -1);
        setState(r.reason === 'MOCK_MODE_NO_META_CATALOGUE' ? 'mock' : 'done');
      } catch (e) {
        if (id !== reqId.current) return;
        setResults([]); setActive(-1);
        const code = String((e as { code?: string; body?: { code?: string } })?.code ?? (e as { body?: { code?: string } })?.body?.code ?? '');
        setState(code === 'NOT_CONNECTED' ? 'not_connected' : 'error');
      }
    }, 300);
    return () => clearTimeout(h);
  }, [q, type, open, lang, scopeCountry]);

  const pick = (r: Found) => {
    onPick({ type: r.type, key: String(r.key), name: r.type === 'country' ? regionName(String(r.key), lang) : r.name, countryCode: String(r.countryCode || '').toUpperCase() });
    setQ(''); setResults([]); setActive(-1);
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { if (open && active >= 0 && results[active]) { e.preventDefault(); pick(results[active]); } }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const statusText = state === 'loading' ? t('mm_b_loc_searching')
    : state === 'short' ? t('mm_b_loc_type_more')
      : state === 'mock' ? t('mm_b_loc_mock')
        : state === 'not_connected' ? t('mm_b_loc_not_connected')
          : state === 'error' ? t('mm_b_loc_error')
            : state === 'done' ? (results.length ? t('mm_b_loc_results', { n: String(results.length) }) : t('mm_b_loc_none')) : '';

  return (
    <div className="space-y-2">
      <div role="group" aria-label={t('mm_b_loc_kind_label')} className="flex flex-wrap gap-1.5">
        {TYPES.map((k) => (
          <button key={k} type="button" aria-pressed={type === k} onClick={() => { setType(k); setResults([]); setActive(-1); inputRef.current?.focus(); }}
            className={cn('rounded-full border px-3 py-1 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
              type === k ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground hover:border-[hsl(var(--gold-border))]')}>
            {t(`mm_b_loc_kind_${k}`)}
          </button>
        ))}
      </div>
      <div className="relative">
        <label htmlFor={`${uid}-input`} className="sr-only">{t('mm_b_loc_search_label')}</label>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input ref={inputRef} id={`${uid}-input`} type="text" role="combobox" autoComplete="off" disabled={full}
          aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${uid}-opt-${active}` : undefined}
          value={q} placeholder={full ? t('mm_b_loc_full') : t(`mm_b_loc_ph_${type}`)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey}
          className="h-11 w-full rounded-xl border border-input bg-background ps-9 pe-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] disabled:cursor-not-allowed disabled:opacity-60" />
        {state === 'loading' && <Loader2 className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
        {open && results.length > 0 && (
          <ul id={listId} role="listbox" aria-label={t('mm_b_loc_search_label')}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-hover">
            {results.map((r, i) => {
              const chosen = isChosen(r);
              const sub = [r.region, r.type !== 'country' ? (r.countryName ?? (r.countryCode ? regionName(r.countryCode, lang) : null)) : null].filter(Boolean).join(', ');
              return (
                <li key={`${r.type}:${r.key}`} id={`${uid}-opt-${i}`} role="option" aria-selected={i === active} aria-disabled={chosen}
                  onMouseDown={(e) => { e.preventDefault(); if (!chosen) pick(r); }} onMouseEnter={() => setActive(i)}
                  className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm',
                    i === active ? 'bg-[hsl(var(--gold-soft))]' : '', chosen && 'cursor-default opacity-55')}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground" dir="auto">{r.type === 'country' ? regionName(String(r.key), lang) : r.name}</span>
                    {sub && <span className="block truncate text-2xs text-muted-foreground" dir="auto">{sub}</span>}
                  </span>
                  {chosen && <span className="shrink-0 text-2xs text-muted-foreground">{t('mm_b_loc_added')}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="min-h-[1rem] text-2xs text-muted-foreground" aria-live="polite">
        {statusText}
        {type !== 'country' && scopeCountry && state !== 'mock' && state !== 'not_connected' ? `${statusText ? ' · ' : ''}${t('mm_b_loc_scope', { country: regionName(scopeCountry, lang) })}` : ''}
      </p>
    </div>
  );
}
