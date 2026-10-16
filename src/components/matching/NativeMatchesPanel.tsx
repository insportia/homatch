// PEOPLE ON HOMATCH, NOT POSTS ABOUT PEOPLE.
//
// An external match is intelligence about a stranger — a post, a listing, a signal read
// off a forum — and the product may only ever show evidence about it. A native match is
// two real Homatch accounts whose stated requirements and property fit, or a member who
// asked about or asked to see a property. That is the one kind of result where "Message"
// and "Call" are honest actions, so this is the one place they appear.
//
// WHAT THIS NEVER SAYS: "buyer found", "tenant found". Somebody's requirements fitting a
// flat is potential interest; the copy says so in every language.
//
// PRIVACY. The list carries the name the other person chose to show and nothing else —
// no email, no number, nothing they wrote. Message opens (or reuses) the one conversation
// for this pair and property. Call asks the server for a number, which it gives only to a
// counterparty of a genuine relationship, and records that it did.

import { BedDouble, Check, Coins, Copy, Loader2, MapPin, MessageSquare, Phone, Ruler, UserRound } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fact } from '@/components/customer/surface';
import { placeName } from '@/lib/placeNames';
import { useLanguage } from '@/contexts/LanguageContext';
import { dimensionKey } from '@/matching/presentation';
import {
  listNativeMatches,
  openNativeConversation,
  revealNativeContact,
  type NativeContact,
  type NativeMatchRow,
} from '@/services/nativeMatches';
import { cn } from '@/lib/utils';

export function NativeMatchesPanel({
  propertyId,
  role,
  className,
}: {
  /** Owner view of one property; omit for the seeker's view of their searches. */
  propertyId?: string | null;
  role: 'OWNER' | 'SEEKER';
  className?: string;
}) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<NativeMatchRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await listNativeMatches(propertyId ?? null);
      setRows(all.filter((row) => row.role === role));
      setFailed(false);
    } catch {
      setFailed(true);
      setRows([]);
    }
  }, [propertyId, role]);

  useEffect(() => { void load(); }, [load]);

  /* Nothing to show is a real answer and it is shown as nothing: no empty promo box, no
     invented "0 buyers". The section appears when there is somebody in it. */
  if (rows === null || (rows.length === 0 && !failed)) return null;

  return (
    <section
      aria-labelledby="native-matches-title"
      className={cn('rounded-xl border border-border bg-[hsl(var(--card))] p-4 sm:p-5', className)}
    >
      <header className="mb-3 min-w-0">
        <h2 id="native-matches-title" className="text-sm font-semibold text-foreground">
          {role === 'OWNER' ? t('native_section_owner_title') : t('native_section_seeker_title')}
        </h2>
        <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
          {role === 'OWNER' ? t('native_section_owner_hint') : t('native_section_seeker_hint')}
        </p>
      </header>
      {failed ? (
        <p role="status" className="text-2xs text-muted-foreground">{t('native_error_load')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => <NativeRow key={`${row.kind}:${row.id}`} row={row} />)}
        </ul>
      )}
    </section>
  );
}

function money(value: number | null, currency: string | null, lang: string): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  try {
    return new Intl.NumberFormat(lang, {
      style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0,
    }).format(Number(value));
  } catch {
    return `${Math.round(Number(value)).toLocaleString(lang)} ${currency ?? ''}`.trim();
  }
}

function NativeRow({ row }: { row: NativeMatchRow }) {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [calling, setCalling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [contact, setContact] = useState<NativeContact | null>(null);
  const [error, setError] = useState(false);

  const kindLabel = row.viewing_requested
    ? t('native_kind_viewing')
    : row.kind === 'RELATIONSHIP' ? t('native_kind_interest') : t('native_kind_match');

  const who = row.role === 'OWNER'
    ? (row.counterparty_name || t('native_member_fallback'))
    : (row.property_title || t('native_property_fallback'));

  const fits = row.agreed
    .filter((dimension) => !['PARTICIPANTS', 'TRANSACTION'].includes(dimension))
    .map((dimension) => dimensionKey(dimension))
    .filter((key): key is string => Boolean(key))
    .map((key) => t(key))
    .slice(0, 4);

  const message = async () => {
    setOpening(true);
    setError(false);
    try {
      const conversationId = await openNativeConversation(row.kind, row.id);
      navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`);
    } catch {
      setError(true);
    } finally {
      setOpening(false);
    }
  };

  const call = async () => {
    setCalling(true);
    setError(false);
    try {
      setContact(await revealNativeContact(row.kind, row.id));
    } catch {
      setError(true);
    } finally {
      setCalling(false);
    }
  };

  return (
    <li className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 text-2xs font-semibold text-foreground">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
          <span className="truncate" dir="auto">{who}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
          <span>{kindLabel}</span>
          {row.homatch_id ? (
            <span>
              {t('native_property_ref')}{' '}
              <span dir="ltr" className="font-medium text-foreground/90">{row.homatch_id}</span>
            </span>
          ) : null}
        </p>
        {row.role === 'SEEKER' ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {row.city ? (
              <Fact icon={MapPin}>
                {[placeName(row.district, language), placeName(row.city, language)].filter(Boolean).join(', ')}
              </Fact>
            ) : null}
            {money(row.price, row.currency, language) ? (
              <Fact icon={Coins}><span dir="ltr">{money(row.price, row.currency, language)}</span></Fact>
            ) : null}
            {row.bedrooms ? <Fact icon={BedDouble}>{t('native_fact_bedrooms', { n: row.bedrooms })}</Fact> : null}
            {!row.bedrooms && row.rooms ? <Fact icon={BedDouble}>{t('native_fact_rooms', { n: row.rooms })}</Fact> : null}
            {row.area ? <Fact icon={Ruler}><span dir="ltr">{Math.round(Number(row.area))} m²</span></Fact> : null}
          </p>
        ) : null}
        {fits.length > 0 ? (
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {t('native_fits_on', { list: fits.join(', ') })}
          </p>
        ) : null}
        {contact ? (
          contact.phone ? (
            /* The number this match entitles the caller to: the property's own listing
               contact, resolved and recorded by the server. tel: dials on a phone; the
               copy button serves a desktop. */
            <div role="status" className="mt-2 flex flex-wrap items-center gap-2" data-native-phone>
              <a
                href={`tel:${contact.phone}`}
                dir="ltr"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-sm font-semibold text-[hsl(var(--primary-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />{contact.phone}
              </a>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(contact.phone ?? '').then(() => setCopied(true)).catch(() => undefined); }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? t('fpw_number_copied') : t('fpw_copy_number')}
              </button>
            </div>
          ) : (
            <p role="status" className="mt-1.5 text-2xs text-foreground">
              {contact.reason === 'NOT_SHARED' ? t('native_call_not_shared') : t('native_call_no_number')}
            </p>
          )
        ) : null}
        {error ? <p role="alert" className="mt-1.5 text-2xs text-destructive">{t('native_error_action')}</p> : null}
      </div>
      {/* The two honest actions of a member match, as real 44px buttons. */}
      <div className="flex shrink-0 flex-wrap gap-2" data-native-actions>
        <button
          type="button"
          onClick={() => void message()}
          disabled={opening}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"
        >
          {opening ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
          {t('native_action_message')}
        </button>
        <button
          type="button"
          onClick={() => void call()}
          disabled={calling || Boolean(contact)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.1)] px-4 text-sm font-semibold text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          {calling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
          {t('native_action_call')}
        </button>
      </div>
    </li>
  );
}
