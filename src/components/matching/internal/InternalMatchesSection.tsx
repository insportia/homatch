// HOMATCH MATCHES — members whose stated requirements fit this property.
//
// The owner's matches page shows two kinds of result and they are not the same thing:
// a HOMATCH member (a real account, reachable by private message) and an external lead
// (a person read off a public post). This section is the first kind only, with its own
// heading and its own count; External Leads sits below it under theirs. Nothing here is
// added to the external number and nothing external is added here.
//
// ONE PERSON, ONE CARD. my_native_matches can return a requirements MATCH and an
// interest RELATIONSHIP for the same member; my_native_match_counterparts gives both the
// same opaque key, so they are one card and one count.
//
// THE DEMO BUYER. demo_internal_match_for_property answers an administrator or a listed
// tester with one demo buyer for one property, and everybody else with null — so the
// section never needs to know who may see it. The demo card is badged DEMO everywhere,
// its score is computed here by the native engine against the property's CURRENT facts,
// and its "Message privately" opens a simulated conversation that never touches the
// real messaging tables.

import {
  BadgeCheck, BedDouble, CalendarClock, Coins, Home, Loader2, MapPin, MessageSquare, Phone, Ruler,
  ShieldCheck, Sparkles, UserRound, X,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { placeName } from '@/lib/placeNames';
import { cn } from '@/lib/utils';
import {
  factorLines,
  groupByPerson,
  nativeFitBandFromScore,
  profileFields,
  scoreDemoMatch,
  storedFactorLines,
  type DemoMatchPayload,
  type FactorLine,
  type NativeFitBand,
  type ProfileField,
  type ScoredMatch,
} from '@/matching/internalMatch';
import {
  listNativeMatchCounterparts,
  listNativeMatches,
  openNativeConversation,
  revealNativeContact,
  type NativeContact,
  type NativeMatchRow,
} from '@/services/nativeMatches';
import { getDemoMatch, openDemoConversation, unlockDemoContact } from '@/services/internalMatchDemo';

const INK = 'text-[hsl(218_45%_14%)]';
const MUTED = 'text-[hsl(218_28%_38%)]';
const NAVY = 'bg-[linear-gradient(135deg,hsl(218_52%_11%)_0%,hsl(220_48%_17%)_55%,hsl(224_44%_22%)_100%)]';
const GOLD = 'text-[hsl(40_94%_64%)]';
const DEMO_PARAM = 'demo';

/* ── badges ─────────────────────────────────────────────────────────────── */

export type MatchBadgeKind = 'INTERNAL' | 'EXTERNAL' | 'STRONG' | 'POTENTIAL' | 'DEMO';

const BADGE_STYLE: Record<MatchBadgeKind, string> = {
  INTERNAL: 'bg-[hsl(218_52%_14%)] text-[hsl(40_94%_70%)] ring-[hsl(218_52%_14%)]',
  EXTERNAL: 'bg-white text-[hsl(218_45%_20%)] ring-[hsl(218_30%_75%)]',
  STRONG: 'bg-[hsl(42_100%_92%)] text-[hsl(34_90%_26%)] ring-[hsl(40_80%_70%)]',
  POTENTIAL: 'bg-[hsl(218_30%_95%)] text-[hsl(218_40%_24%)] ring-[hsl(218_30%_82%)]',
  DEMO: 'bg-[hsl(328_70%_95%)] text-[hsl(328_70%_30%)] ring-[hsl(328_60%_70%)]',
};

const BADGE_KEY: Record<MatchBadgeKind, string> = {
  INTERNAL: 'im_badge_internal',
  EXTERNAL: 'im_badge_external',
  STRONG: 'im_badge_strong',
  POTENTIAL: 'im_badge_potential',
  DEMO: 'im_badge_demo',
};

export function MatchBadge({ kind }: { kind: MatchBadgeKind }) {
  const { t } = useLanguage();
  return (
    <span
      data-badge={kind}
      className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-[0.06em] ring-1 ring-inset', BADGE_STYLE[kind])}
    >
      {t(BADGE_KEY[kind])}
    </span>
  );
}

const bandBadge = (band: NativeFitBand): MatchBadgeKind | null =>
  band === 'STRONG' ? 'STRONG' : band === 'POTENTIAL' ? 'POTENTIAL' : null;

/* ── formatting ─────────────────────────────────────────────────────────── */

function money(value: number | null, currency: string | null, lang: string): string | null {
  if (value === null || !Number.isFinite(Number(value))) return null;
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return `${Math.round(Number(value)).toLocaleString(lang)} ${currency ?? ''}`.trim();
  }
}

function percent(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(n / 100);
  } catch {
    return `${n}%`;
  }
}

/*
 * A range, each end isolated (<bdi>) so a Hebrew or Arabic currency format — which
 * carries its own direction marks — cannot reorder the two ends around the dash.
 */
function range(min: string | null, max: string | null, t: (k: string, v?: Record<string, string | number>) => string): React.ReactNode | null {
  if (min && max) return min === max ? <bdi>{min}</bdi> : <><bdi>{min}</bdi>{' – '}<bdi>{max}</bdi></>;
  if (min) return t('im_range_from', { min });
  if (max) return t('im_range_upto', { max });
  return null;
}

const DIM_KEY: Record<string, string> = {
  PARTICIPANTS: 'im_dim_participants',
  TRANSACTION: 'im_dim_transaction',
  CITY: 'im_dim_city',
  DISTRICT: 'im_dim_district',
  PROPERTY_TYPE: 'im_dim_property_type',
  PRICE: 'im_dim_price',
  AREA: 'im_dim_area',
  BEDROOMS: 'im_dim_bedrooms',
};

const VERDICT_KEY: Record<string, string> = {
  AGREE: 'im_verdict_agree',
  PREFERENCE_MISS: 'im_verdict_miss',
  UNKNOWN: 'im_verdict_unknown',
  CONFLICT: 'im_verdict_conflict',
};

/* ── the section ────────────────────────────────────────────────────────── */

interface PersonCard {
  key: string;
  rows: NativeMatchRow[];
  primary: NativeMatchRow;
}

export function InternalMatchesSection({
  propertyId,
  counterpart,
  onCount,
  className,
}: {
  propertyId: string;
  counterpart: 'BUYER' | 'TENANT' | null;
  /** The number of PEOPLE in this section (demo included when visible). */
  onCount?: (count: number) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const [people, setPeople] = useState<PersonCard[] | null>(null);
  const [demo, setDemo] = useState<DemoMatchPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const openProfile = searchParams.get('profile');

  const load = useCallback(async () => {
    const [rowsResult, keysResult, demoResult] = await Promise.allSettled([
      listNativeMatches(propertyId),
      listNativeMatchCounterparts(propertyId),
      getDemoMatch(propertyId),
    ]);
    const rows = rowsResult.status === 'fulfilled' ? rowsResult.value.filter((row) => row.role === 'OWNER') : [];
    const keys = keysResult.status === 'fulfilled' ? keysResult.value : new Map<string, string>();
    const groups = groupByPerson(rows, keys).map((group) => {
      const primary = group.find((row) => row.kind === 'MATCH') ?? group[0];
      return { key: `${primary.kind}:${primary.id}`, rows: group, primary };
    });
    setFailed(rowsResult.status === 'rejected');
    setPeople(groups);
    setDemo(demoResult.status === 'fulfilled' ? demoResult.value : null);
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  const demoScore = useMemo<ScoredMatch | null>(() => (demo ? scoreDemoMatch(demo) : null), [demo]);
  const count = (people?.length ?? 0) + (demo ? 1 : 0);
  useEffect(() => { if (people !== null) onCount?.(count); }, [count, people, onCount]);

  const setProfile = useCallback((value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('profile', value); else next.delete('profile');
      return next;
    });
  }, [setSearchParams]);

  const openPerson = openProfile && openProfile !== DEMO_PARAM ? people?.find((p) => p.key === openProfile) ?? null : null;

  return (
    <section
      aria-labelledby="internal-matches-title"
      data-section="internal-matches"
      className={cn('mt-5 min-w-0', className)}
    >
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id="internal-matches-title" className={cn('flex flex-wrap items-center gap-2 font-display text-base font-semibold', INK)}>
            <span>{t('im_section_internal_title')}</span>
            <span data-count="internal" className="rounded-full bg-[hsl(218_52%_14%)] px-2 py-0.5 text-2xs font-bold text-[hsl(40_94%_70%)]">
              {people === null ? '…' : count}
            </span>
          </h2>
          <p className={cn('mt-0.5 max-w-[70ch] text-2xs leading-relaxed', MUTED)}>{t('im_section_internal_hint')}</p>
        </div>
      </header>

      <div className="mt-3 space-y-2.5">
        {people === null ? (
          <div className="hm-discovery-panel h-28 animate-pulse" />
        ) : (
          <>
            {demo && demoScore ? (
              <DemoMatchCard
                payload={demo}
                scored={demoScore}
                onViewProfile={() => setProfile(DEMO_PARAM)}
                counterpart={counterpart}
              />
            ) : null}
            {people.map((person) => (
              <NativePersonCard key={person.key} person={person} onViewProfile={() => setProfile(person.key)} />
            ))}
            {count === 0 ? (
              <p role="status" className={cn('rounded-xl bg-white px-3.5 py-3 text-2xs ring-1 ring-inset ring-[hsl(218_30%_88%)]', MUTED)}>
                {failed ? t('im_internal_error') : t('im_internal_empty')}
              </p>
            ) : null}
          </>
        )}
      </div>

      {demo && demoScore ? (
        <ProfileSheet open={openProfile === DEMO_PARAM} onClose={() => setProfile(null)} counterpart={counterpart}>
          <DemoProfileBody payload={demo} scored={demoScore} propertyId={propertyId} onUnlocked={load} />
        </ProfileSheet>
      ) : null}
      {openPerson ? (
        <ProfileSheet open onClose={() => setProfile(null)} counterpart={counterpart}>
          <NativeProfileBody person={openPerson} />
        </ProfileSheet>
      ) : null}
    </section>
  );
}

/* ── cards ──────────────────────────────────────────────────────────────── */

function CardShell({
  badges, name, score, facts, fits, notice, actions, testId,
}: {
  badges: MatchBadgeKind[];
  name: string;
  score: number | null;
  facts: React.ReactNode[];
  fits: string[];
  notice?: string;
  actions: React.ReactNode;
  testId: string;
}) {
  const { t, lang } = useLanguage();
  return (
    <article
      data-testid={testId}
      className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_28px_-18px_hsl(218_60%_15%/0.45)] ring-1 ring-inset ring-[hsl(40_70%_80%)]"
    >
      <div className={cn('flex min-w-0 flex-wrap items-center justify-between gap-2 px-3.5 py-2.5', NAVY)}>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {badges.map((b) => <MatchBadge key={b} kind={b} />)}
        </div>
        {score !== null ? (
          <p className="flex items-baseline gap-1.5 text-white">
            <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-white/70">{t('im_score_label')}</span>
            <span dir="ltr" className={cn('font-display text-lg font-bold', GOLD)}>{percent(score, lang)}</span>
          </p>
        ) : null}
      </div>
      <div className="space-y-2 p-3.5">
        <p className={cn('flex min-w-0 items-center gap-2 text-sm font-semibold', INK)}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(42_100%_94%)] ring-1 ring-inset ring-[hsl(40_80%_78%)]">
            <UserRound className="h-4 w-4 text-[hsl(34_90%_35%)]" aria-hidden="true" />
          </span>
          <span className="min-w-0 truncate" dir="auto">{name}</span>
        </p>
        {facts.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-1.5">{facts}</div>
        ) : null}
        {fits.length > 0 ? (
          <p className={cn('text-2xs leading-relaxed', MUTED)}>
            <BadgeCheck className="me-1 inline h-3.5 w-3.5 align-[-2px] text-[hsl(34_90%_40%)]" aria-hidden="true" />
            {t('native_fits_on', { list: fits.join(', ') })}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-lg bg-[hsl(328_70%_97%)] px-2.5 py-1.5 text-2xs leading-relaxed text-[hsl(328_60%_28%)] ring-1 ring-inset ring-[hsl(328_60%_85%)]">
            {notice}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-0.5">{actions}</div>
      </div>
    </article>
  );
}

function Chip({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-[hsl(42_100%_96%)] px-2.5 py-0.5 text-2xs font-semibold text-[hsl(34_90%_26%)] ring-1 ring-inset ring-[hsl(40_80%_82%)]">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function ActionButton({
  label, icon: Icon, onClick, busy, primary, disabled, testId,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] disabled:opacity-60',
        primary
          ? 'bg-[hsl(38_92%_56%)] text-[hsl(218_52%_11%)] hover:bg-[hsl(38_92%_50%)]'
          : 'bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_70%_78%)] hover:ring-[hsl(38_92%_50%)]',
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="break-words text-start">{label}</span>
    </button>
  );
}

function useDemoMessage(payload: DemoMatchPayload) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const go = async () => {
    setBusy(true);
    setError(false);
    try {
      const id = payload.conversation_id ?? await openDemoConversation(payload.profile.id, payload.property.id);
      navigate(`/property/${payload.property.id}/matches/demo/${encodeURIComponent(id)}`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return { go, busy, error };
}

function demoChips(payload: DemoMatchPayload, lang: string, t: (k: string, v?: Record<string, string | number>) => string): React.ReactNode[] {
  const p = payload.profile;
  const chips: React.ReactNode[] = [];
  const budget = range(money(p.budget_min, p.currency, lang), money(p.budget_max, p.currency, lang), t);
  if (budget) chips.push(<Chip key="budget" icon={Coins}>{budget}</Chip>);
  const places = (p.districts ?? []).map((d) => placeName(d, lang)).filter(Boolean);
  if (places.length) chips.push(<Chip key="places" icon={MapPin}>{places.join(' · ')}</Chip>);
  if (p.bedrooms_min || p.bedrooms_max) {
    chips.push(<Chip key="beds" icon={BedDouble}>{t('native_fact_bedrooms', { n: String(p.bedrooms_min ?? p.bedrooms_max) })}</Chip>);
  }
  const area = range(p.area_min ? `${Math.round(p.area_min)} m²` : null, p.area_max ? `${Math.round(p.area_max)} m²` : null, t);
  if (area) chips.push(<Chip key="area" icon={Ruler}>{area}</Chip>);
  return chips;
}

function DemoMatchCard({ payload, scored, onViewProfile, counterpart: _counterpart }: {
  payload: DemoMatchPayload;
  scored: ScoredMatch;
  onViewProfile: () => void;
  counterpart: 'BUYER' | 'TENANT' | null;
}) {
  const { t, lang } = useLanguage();
  const message = useDemoMessage(payload);
  const band = bandBadge(scored.band);
  const fits = scored.assessment.agreed
    .filter((d) => !['PARTICIPANTS', 'TRANSACTION'].includes(d))
    .map((d) => t(DIM_KEY[d]))
    .slice(0, 5);
  return (
    <CardShell
      testId="internal-match-card-demo"
      badges={['INTERNAL', ...(band ? [band] : []), 'DEMO']}
      name={`${t('im_demo_name')} · ${t('im_badge_demo')}`}
      score={scored.band === 'NONE' ? null : scored.percent}
      facts={demoChips(payload, lang, t)}
      fits={fits}
      notice={t('im_demo_notice')}
      actions={(
        <>
          <ActionButton testId="demo-view-profile" label={t('im_action_view_profile')} icon={UserRound} onClick={onViewProfile} />
          <ActionButton testId="demo-message" label={t('im_action_message')} icon={MessageSquare} onClick={message.go} busy={message.busy} primary />
          {message.error ? <p role="alert" className="w-full text-2xs text-destructive">{t('im_error_action')}</p> : null}
        </>
      )}
    />
  );
}

function useNativeActions(row: NativeMatchRow) {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [calling, setCalling] = useState(false);
  const [contact, setContact] = useState<NativeContact | null>(null);
  const [error, setError] = useState(false);
  /* The existing canonical conversation for this relationship — the same RPC and the
     same /chat route the panel always used. No server rule changes. */
  const message = async () => {
    setOpening(true); setError(false);
    try {
      const conversationId = await openNativeConversation(row.kind, row.id);
      navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`);
    } catch { setError(true); } finally { setOpening(false); }
  };
  const call = async () => {
    setCalling(true); setError(false);
    try { setContact(await revealNativeContact(row.kind, row.id)); } catch { setError(true); } finally { setCalling(false); }
  };
  return { message, call, opening, calling, contact, error };
}

function ContactLine({ contact }: { contact: NativeContact }) {
  const { t } = useLanguage();
  return (
    <p role="status" className={cn('w-full text-2xs', INK)}>
      {contact.phone ? (
        <>
          {t('native_call_number_label')}{' '}
          <a href={`tel:${contact.phone}`} dir="ltr" className="font-semibold text-[hsl(34_90%_35%)] underline-offset-2 hover:underline">{contact.phone}</a>
        </>
      ) : contact.reason === 'NOT_SHARED' ? t('native_call_not_shared') : t('native_call_no_number')}
    </p>
  );
}

function NativePersonCard({ person, onViewProfile }: { person: PersonCard; onViewProfile: () => void }) {
  const { t } = useLanguage();
  const row = person.primary;
  const actions = useNativeActions(row);
  const score = row.match_score !== null && row.match_score !== undefined ? Math.round(Number(row.match_score) * 100) : null;
  const band = bandBadge(nativeFitBandFromScore(row.match_score));
  const interest = person.rows.some((r) => r.kind === 'RELATIONSHIP');
  const viewing = person.rows.some((r) => r.viewing_requested);
  const fits = row.agreed
    .filter((d) => !['PARTICIPANTS', 'TRANSACTION'].includes(d))
    .map((d) => DIM_KEY[d] ? t(DIM_KEY[d]) : null)
    .filter((v): v is string => Boolean(v))
    .slice(0, 5);
  const facts: React.ReactNode[] = [];
  if (viewing) facts.push(<Chip key="viewing" icon={CalendarClock}>{t('native_kind_viewing')}</Chip>);
  else if (interest) facts.push(<Chip key="interest" icon={Sparkles}>{t('native_kind_interest')}</Chip>);
  return (
    <CardShell
      testId="internal-match-card"
      badges={['INTERNAL', ...(row.kind === 'MATCH' && band ? [band] : [])]}
      name={row.counterparty_name || t('im_member_fallback')}
      score={row.kind === 'MATCH' ? score : null}
      facts={facts}
      fits={fits}
      actions={(
        <>
          <ActionButton label={t('im_action_view_profile')} icon={UserRound} onClick={onViewProfile} />
          <ActionButton label={t('im_action_message')} icon={MessageSquare} onClick={actions.message} busy={actions.opening} primary />
          <ActionButton label={t('native_action_call')} icon={Phone} onClick={actions.call} busy={actions.calling} disabled={Boolean(actions.contact)} />
          {actions.contact ? <ContactLine contact={actions.contact} /> : null}
          {actions.error ? <p role="alert" className="w-full text-2xs text-destructive">{t('native_error_action')}</p> : null}
        </>
      )}
    />
  );
}

/* ── the profile view: a drawer on desktop, a full-screen sheet on a phone ── */

function ProfileSheet({ open, onClose, counterpart, children }: {
  open: boolean;
  onClose: () => void;
  counterpart: 'BUYER' | 'TENANT' | null;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[hsl(218_52%_8%/0.55)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid="buyer-profile"
          className={cn(
            'fixed inset-0 z-50 flex flex-col overflow-hidden bg-[hsl(40_33%_98%)] shadow-2xl outline-none',
            'sm:inset-y-0 sm:end-0 sm:start-auto sm:w-[30rem] sm:max-w-[92vw] sm:rounded-s-2xl',
          )}
        >
          <div className={cn('flex min-w-0 items-start justify-between gap-3 px-4 py-4 sm:px-5', NAVY)}>
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-display text-lg font-bold text-white">
                {t(counterpart === 'TENANT' ? 'im_profile_title_tenant' : 'im_profile_title')}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-2xs text-white/75">{t('im_profile_subtitle')}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              data-testid="profile-close"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            >
              <X className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{t('im_profile_close')}</span>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 sm:px-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FieldRow({ field }: { field: ProfileField }) {
  const { t, lang } = useLanguage();
  const confirmed = field.state === 'CONFIRMED';
  const label: Record<ProfileField['key'], string> = {
    intent: 'im_field_intent', budget: 'im_field_budget', locations: 'im_field_locations', bedrooms: 'im_field_bedrooms',
    rooms: 'im_field_rooms', propertyType: 'im_field_property_type', area: 'im_field_area', timeline: 'im_field_timeline',
  };
  const icon: Record<ProfileField['key'], React.ComponentType<{ className?: string }>> = {
    intent: Home, budget: Coins, locations: MapPin, bedrooms: BedDouble, rooms: BedDouble, propertyType: Home, area: Ruler, timeline: CalendarClock,
  };
  const Icon = icon[field.key];
  let value: React.ReactNode = null;
  if (confirmed) {
    switch (field.key) {
      case 'intent':
        value = t(String(field.transaction).toUpperCase() === 'RENT' ? 'im_intent_rent' : 'im_intent_buy');
        break;
      case 'budget':
        value = range(money(field.min, field.currency, lang), money(field.max, field.currency, lang), t);
        break;
      case 'locations':
        value = [...field.districts.map((d) => placeName(d, lang)), field.city ? placeName(field.city, lang) : null].filter(Boolean).join(' · ');
        break;
      case 'bedrooms':
      case 'rooms':
        value = range(field.min !== null ? String(field.min) : null, field.max !== null ? String(field.max) : null, t);
        break;
      case 'propertyType':
        value = field.types.map((type) => t(`prop_type_${type.toLowerCase()}`)).join(', ');
        break;
      case 'area':
        value = range(field.min !== null ? `${Math.round(field.min)} m²` : null, field.max !== null ? `${Math.round(field.max)} m²` : null, t);
        break;
      case 'timeline':
        value = t('im_timeline_months', { n: String(field.months) });
        break;
    }
  }
  return (
    <li data-field={field.key} data-state={field.state} className="flex min-w-0 items-start gap-3 py-2.5">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', confirmed ? 'text-[hsl(34_90%_40%)]' : 'text-[hsl(218_20%_65%)]')} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn('text-2xs font-semibold uppercase tracking-[0.08em]', MUTED)}>{t(label[field.key])}</p>
        <p className={cn('mt-0.5 break-words text-sm', confirmed ? cn('font-semibold', INK) : 'italic text-[hsl(218_15%_55%)]')}>
          {confirmed ? value : t('im_state_not_provided')}
        </p>
      </div>
      <span className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset',
        confirmed ? 'bg-[hsl(42_100%_94%)] text-[hsl(34_90%_28%)] ring-[hsl(40_80%_78%)]' : 'bg-[hsl(218_20%_96%)] text-[hsl(218_15%_45%)] ring-[hsl(218_20%_86%)]',
      )}>
        {confirmed ? t('im_state_confirmed') : t('im_state_not_provided')}
      </span>
    </li>
  );
}

function FactorList({ lines, caption }: { lines: FactorLine[]; caption: string }) {
  const { t } = useLanguage();
  return (
    <section className="mt-4" aria-labelledby="why-title">
      <h3 id="why-title" className={cn('text-sm font-semibold', INK)}>{t('im_why_title')}</h3>
      <p className={cn('mt-0.5 text-2xs', MUTED)}>{caption}</p>
      <ul className="mt-2 divide-y divide-[hsl(40_40%_88%)] rounded-xl bg-white px-3 ring-1 ring-inset ring-[hsl(40_60%_85%)]">
        {lines.map((line) => (
          <li key={line.dimension} data-dimension={line.dimension} data-verdict={line.verdict} className="flex min-w-0 items-center justify-between gap-3 py-2">
            <span className={cn('min-w-0 truncate text-2xs font-semibold', INK)}>{t(DIM_KEY[line.dimension])}</span>
            <span className={cn(
              'shrink-0 text-2xs font-semibold',
              line.verdict === 'AGREE' ? 'text-[hsl(34_90%_32%)]' : line.verdict === 'CONFLICT' ? 'text-destructive' : 'text-[hsl(218_15%_50%)]',
            )}>
              {t(VERDICT_KEY[line.verdict])}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScoreHeader({ badges, name, score }: { badges: MatchBadgeKind[]; name: string; score: number | null }) {
  const { t, lang } = useLanguage();
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap gap-1.5">{badges.map((b) => <MatchBadge key={b} kind={b} />)}</div>
        <p className={cn('mt-2 break-words font-display text-base font-bold', INK)} dir="auto">{name}</p>
      </div>
      {score !== null ? (
        <div data-testid="profile-score" className="shrink-0 rounded-xl bg-[hsl(218_52%_12%)] px-3 py-2 text-center">
          <p className="text-2xs font-semibold uppercase tracking-[0.1em] text-white/70">{t('im_score_label')}</p>
          <p dir="ltr" className={cn('font-display text-2xl font-bold', GOLD)}>{percent(score, lang)}</p>
        </div>
      ) : null}
    </div>
  );
}

function DemoProfileBody({ payload, scored, propertyId: _propertyId, onUnlocked }: {
  payload: DemoMatchPayload;
  scored: ScoredMatch;
  propertyId: string;
  onUnlocked: () => void;
}) {
  const { t } = useLanguage();
  const message = useDemoMessage(payload);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(false);
  const band = bandBadge(scored.band);
  const unlock = async () => {
    setUnlocking(true); setUnlockError(false);
    try {
      const id = payload.conversation_id ?? await openDemoConversation(payload.profile.id, payload.property.id);
      await unlockDemoContact(id);
      onUnlocked();
    } catch { setUnlockError(true); } finally { setUnlocking(false); }
  };
  return (
    <div className="min-w-0">
      <ScoreHeader badges={['INTERNAL', ...(band ? [band] : []), 'DEMO']} name={`${t('im_demo_name')} · ${t('im_badge_demo')}`} score={scored.band === 'NONE' ? null : scored.percent} />
      <p className="mt-3 rounded-lg bg-[hsl(328_70%_97%)] px-3 py-2 text-2xs leading-relaxed text-[hsl(328_60%_28%)] ring-1 ring-inset ring-[hsl(328_60%_85%)]">
        {t('im_demo_notice')}
      </p>
      <section className="mt-4" aria-labelledby="req-title">
        <h3 id="req-title" className={cn('text-sm font-semibold', INK)}>{t('im_profile_requirements')}</h3>
        <ul className="mt-1 divide-y divide-[hsl(40_40%_88%)]">
          {profileFields(payload.profile).map((field) => <FieldRow key={field.key} field={field} />)}
        </ul>
      </section>
      <FactorList lines={factorLines(scored.assessment)} caption={t('im_why_caption')} />
      <p className={cn('mt-4 flex items-start gap-2 text-2xs', MUTED)}>
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('im_privacy_note')}
      </p>
      <div className="sticky bottom-0 -mx-4 mt-4 flex flex-wrap gap-2 border-t border-[hsl(40_40%_88%)] bg-[hsl(40_33%_98%)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-5 sm:px-5">
        <ActionButton testId="profile-message" label={t('im_action_message')} icon={MessageSquare} onClick={message.go} busy={message.busy} primary />
        {payload.demo_unlocked_at ? null : (
          <ActionButton testId="profile-unlock" label={t('im_demo_unlock')} icon={Phone} onClick={unlock} busy={unlocking} />
        )}
        {payload.demo_unlocked_at ? <p role="status" data-testid="demo-unlocked" className={cn('w-full text-2xs', INK)}>{t('im_demo_unlocked')}</p> : null}
        {message.error || unlockError ? <p role="alert" className="w-full text-2xs text-destructive">{t('im_error_action')}</p> : null}
      </div>
    </div>
  );
}

function NativeProfileBody({ person }: { person: PersonCard }) {
  const { t } = useLanguage();
  const row = person.primary;
  const actions = useNativeActions(row);
  const score = row.kind === 'MATCH' && row.match_score !== null ? Math.round(Number(row.match_score) * 100) : null;
  const band = bandBadge(nativeFitBandFromScore(row.match_score));
  return (
    <div className="min-w-0">
      <ScoreHeader badges={['INTERNAL', ...(row.kind === 'MATCH' && band ? [band] : [])]} name={row.counterparty_name || t('im_member_fallback')} score={score} />
      {/* A real member's requirement VALUES stay with them: my_native_matches carries
          only which dimensions the engine found agreeing, so that is what is shown. */}
      <FactorList lines={storedFactorLines(row.agreed, row.preference_misses)} caption={t('im_why_stored_caption')} />
      <p className={cn('mt-4 flex items-start gap-2 text-2xs', MUTED)}>
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('im_privacy_note')}
      </p>
      <div className="sticky bottom-0 -mx-4 mt-4 flex flex-wrap gap-2 border-t border-[hsl(40_40%_88%)] bg-[hsl(40_33%_98%)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-5 sm:px-5">
        <ActionButton label={t('im_action_message')} icon={MessageSquare} onClick={actions.message} busy={actions.opening} primary />
        <ActionButton label={t('native_action_call')} icon={Phone} onClick={actions.call} busy={actions.calling} disabled={Boolean(actions.contact)} />
        {actions.contact ? <ContactLine contact={actions.contact} /> : null}
        {actions.error ? <p role="alert" className="w-full text-2xs text-destructive">{t('native_error_action')}</p> : null}
      </div>
    </div>
  );
}

/* ── the external section's header ──────────────────────────────────────── */

/** "External Leads" with its own count; the leads themselves render unchanged below it. */
export function ExternalLeadsHeader({ count }: { count: number | null }) {
  const { t } = useLanguage();
  return (
    <header data-section="external-leads" className="mt-6 flex min-w-0 flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className={cn('flex flex-wrap items-center gap-2 font-display text-base font-semibold', INK)}>
          <span>{t('im_section_external_title')}</span>
          <span data-count="external" className="rounded-full bg-white px-2 py-0.5 text-2xs font-bold text-[hsl(218_45%_20%)] ring-1 ring-inset ring-[hsl(218_30%_75%)]">
            {count === null ? '…' : count}
          </span>
          <MatchBadge kind="EXTERNAL" />
        </h2>
        <p className={cn('mt-0.5 max-w-[70ch] text-2xs leading-relaxed', MUTED)}>{t('im_section_external_hint')}</p>
      </div>
    </header>
  );
}
