/*
 * Pieces shared by the Buyer intelligence and Market segmentation admin pages.
 *
 * They sit on top of AdminKit and follow the same Admin visual language —
 * Card, muted 2xs labels, logical (start/end) spacing so AR/HE mirror — and
 * add no look of their own.
 *
 * Place names come from the one Find Buyers gazetteer (CITY_NAMES /
 * DISTRICT_NAMES): an admin can type ვაკე, Ваке or Vake and get the same
 * place. The value sent to the server is the Georgian name where the
 * gazetteer has one — the server folds every script to one key
 * (market_place_key), and Georgian is the spelling the data mostly carries.
 */
import { X } from 'lucide-react';
import React from 'react';
import { Field, inputClass } from '@/components/admin/control/AdminKit';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { CITY_NAMES, DISTRICT_NAMES, normKey } from '@/research-core/findBuyers/places';

type Names = Partial<Record<string, string[]>>;

/* Districts the gazetteer places in Batumi; every other district is Tbilisi's. */
const BATUMI_DISTRICTS = new Set(['old batumi', 'new boulevard']);

/** Markets with a place vocabulary today. Labels are translation keys. */
export const COUNTRIES = [{ value: 'GE', labelKey: 'admin_bi_country_ge' }];

function displayName(names: Names | undefined, key: string, lang: string): string {
  return names?.[lang]?.[0] ?? names?.en?.[0] ?? key;
}

/** The value the server should receive for a gazetteer key. */
function serverName(names: Names | undefined, key: string): string {
  return names?.ka?.[0] ?? names?.en?.[0] ?? key;
}

export interface PlaceOption { key: string; value: string; label: string; aliases: string[] }

export function placeOptions(kind: 'city' | 'district', lang: string, cityValue?: string): PlaceOption[] {
  const table = (kind === 'city' ? CITY_NAMES : DISTRICT_NAMES) as Readonly<Record<string, Names>>;
  const cityKey = cityValue ? resolvePlaceKey('city', cityValue) : null;
  return Object.entries(table)
    .filter(([key]) => kind === 'city' || !cityKey
      || (cityKey === 'batumi' ? BATUMI_DISTRICTS.has(key) : cityKey === 'tbilisi' ? !BATUMI_DISTRICTS.has(key) : false))
    .map(([key, names]) => ({
      key,
      value: serverName(names, key),
      label: displayName(names, key, lang),
      aliases: [key, ...Object.values(names).flat().filter((x): x is string => Boolean(x))],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Any spelling → the gazetteer key, or null when the name is not in it. */
export function resolvePlaceKey(kind: 'city' | 'district', value: string): string | null {
  const needle = normKey(value);
  if (!needle) return null;
  const table = (kind === 'city' ? CITY_NAMES : DISTRICT_NAMES) as Readonly<Record<string, Names>>;
  for (const [key, names] of Object.entries(table)) {
    if (normKey(key) === needle) return key;
    for (const alias of Object.values(names).flat()) if (alias && normKey(alias) === needle) return key;
  }
  return null;
}

/** A label for a stored place key/name in the reader's language. */
export function placeLabel(kind: 'city' | 'district', value: string | null | undefined, lang: string): string {
  if (!value) return '—';
  const key = resolvePlaceKey(kind, value);
  if (!key) return value;
  const table = (kind === 'city' ? CITY_NAMES : DISTRICT_NAMES) as Readonly<Record<string, Names>>;
  return displayName(table[key], key, lang);
}

/**
 * A searchable place box: free text with suggestions in every script. A
 * recognised name is normalised to the gazetteer's server spelling on blur;
 * an unknown name is sent exactly as typed.
 */
export function PlaceInput({ kind, label, value, onChange, city, disabled }: {
  kind: 'city' | 'district'; label: string; value: string; onChange: (v: string) => void;
  city?: string; disabled?: boolean;
}) {
  const { lang } = useLanguage();
  const id = React.useId();
  const options = React.useMemo(() => placeOptions(kind, lang, city), [kind, lang, city]);
  const [text, setText] = React.useState(() => (value ? placeLabel(kind, value, lang) : ''));
  React.useEffect(() => { setText(value ? placeLabel(kind, value, lang) : ''); }, [value, kind, lang]);
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) { onChange(''); return; }
    const key = resolvePlaceKey(kind, trimmed);
    const hit = key ? options.find((o) => o.key === key) ?? placeOptions(kind, lang).find((o) => o.key === key) : null;
    onChange(hit ? hit.value : trimmed);
  };
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        className={inputClass}
        list={`${id}-list`}
        value={text}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          if (resolvePlaceKey(kind, e.target.value)) commit(e.target.value);
          else if (!e.target.value.trim()) onChange('');
        }}
        onBlur={(e) => commit(e.target.value)}
      />
      <datalist id={`${id}-list`}>
        {options.flatMap((o) => [o.label, ...o.aliases.filter((a) => a !== o.label)].map((name) => (
          <option key={`${o.key}:${name}`} value={name}>{o.label}</option>
        )))}
      </datalist>
    </Field>
  );
}

/** A combinable multi-select as toggle buttons — usable by touch, keyboard and screen readers. */
export function MultiToggle({ label, options, value, onChange }: {
  label: string; options: Array<{ value: string; label: string }>; value: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-2xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function NumberFilter({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input className={inputClass} inputMode="decimal" value={value} placeholder={placeholder} dir="ltr"
             onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} />
    </Field>
  );
}

export interface Chip { id: string; label: string; onRemove: () => void }

/** The filters in force, each removable, plus clear-all. */
export function ActiveChips({ chips, onClear }: { chips: Chip[]; onClear: () => void }) {
  const { t } = useLanguage();
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t('admin_bi_active_filters')}>
      {chips.map((c) => (
        <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
          <span className="truncate">{c.label}</span>
          <button type="button" onClick={c.onRemove} className="rounded-full p-0.5 hover:bg-background"
                  aria-label={t('admin_bi_remove_filter', { filter: c.label })}>
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>
        {t('admin_bi_clear_all')}
      </Button>
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: {
  label: string; value: React.ReactNode; hint?: string; tone?: 'default' | 'warn';
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-2xs font-medium text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-xl font-bold tabular-nums', tone === 'warn' ? 'text-destructive' : 'text-foreground')}>{value}</p>
        {hint && <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** A labelled list of counts with proportional bars; the number is always printed. */
export function BarList({ title, rows, empty }: { title: string; rows: Array<{ label: string; value: number }>; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {rows.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.label} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{r.label}</span>
                  <span className="tabular-nums text-muted-foreground">{r.value}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export const usd = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `$${Math.round(Number(v)).toLocaleString('en-US')}`;
