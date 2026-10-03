// src/pages/property/MyPropertiesPage.tsx — MY PROPERTIES.
//
// A LISTING-MANAGEMENT LIST. Two references, and they are different references:
//
//   DENSITY AND MECHANICS come from how a working listing manager behaves. Somebody
//   with ten properties has to scan and act on them, so a row is a ROW — a thumbnail,
//   the facts on two lines, a compact status-and-intelligence cluster, three controls.
//   Not a hero component.
//
//   VISUAL LANGUAGE comes from the approved Homatch workspaces — Investment, Verify,
//   Mortgage. The canvas rhythm, the muted-information treatment, the restraint, the
//   surface hierarchy. Nothing here borrows a marketplace's colours or identity.
//
// THIS PAGE HAS BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS, AND BOTH ARE WORTH RECORDING
// BECAUSE THE SECOND WAS A REACTION TO THE FIRST.
//
//   FAILURE A: `max-w-5xl` + `sm:grid-cols-2 xl:grid-cols-3`. One property became a
//   250px tile marooned in a 1920px canvas. A tile grid cannot make a single row look
//   intentional, so widening the tile would not have helped.
//
//   FAILURE B: the correction. A full-width three-column panel 270px tall, one property
//   consuming almost the entire content width. Balanced with one property and useless
//   with ten — which is the state that actually matters, and the state the database
//   does not currently contain. Designing around "production has one row" is what
//   produced it.
//
// So the row is built for the TEN-property case and checked at one and three. A row is
// about 7.5rem tall, which puts four of them on a laptop screen under the header
// without anything being cramped.
//
// WHAT THE ROW REFUSES TO DO
//
// Dedicate a panel to three small numbers. The intelligence is a compact cluster —
// total, new, strong, and the campaign state — sized to be read at a glance and not to
// fill space. Deeper intelligence is a click away on the matches screen, which is what
// progressive disclosure means here.
//
// And it refuses to show a number that is not in the database. matchability_score is
// null on the production row so it renders nowhere; no matches renders a phrase rather
// than three zeros dressed as metrics; no photo renders an honest placeholder rather
// than a stock image of a building that is not theirs.

import {
  Archive, ArchiveRestore, Building2, Camera, Eye, ImageOff, MapPin, MoreVertical,
  Pause, Pencil, Phone, Play, Plus, Trash2, Upload,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PrivateImage } from '@/components/common/PrivateImage';
import { RouteGuard } from '@/components/common/RouteGuard';
import {CustomerSurface, EmptyState, FilterRail,
  OWNER_SURFACE, PageHero, QuietAction,
} from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import {
  FactLine, IntelLine, MediaWell, Money, OWNER_ICON, OWNER_PRIMARY, SourceMark, StatusMark,
} from '@/components/owner/portfolio';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { placeName } from '@/lib/placeNames';
import { hasContactReadiness } from '@/lib/propertyContact';
import { cn } from '@/lib/utils';
import {
  archiveProperty,
  deleteProperty,
  intelligenceActionFor,
  isImported,
  listPortfolio,
  type PortfolioIntelligence,
  type PortfolioView,
  portfolioCounts,
  portfolioIntelligence,
  setPublication,
  unarchiveProperty,
} from '@/services/propertyManagement';
import type { Property } from '@/types/types';
import { FreshnessChip, MediaUnavailable, SourceChip } from '@/components/property/OwnerLifecycle';
import { coverImage } from '@/property/gallery';
import { type PropertyLifecycle, needsAttention, safeExternalUrl } from '@/property/lifecycle';
import { fetchLifecycle } from '@/services/propertyLifecycle';

/** A price, or nothing. Never a zero standing in for "not priced yet". */
/*
 * THE CANONICAL FORMATTER, NOT A TEMPLATE STRING.
 *
 * This glued the currency COLUMN onto a locale-formatted number, so a Georgian page read
 * "USD213,840" while the match cards beside it read "$220,000". formatMoney knows where a
 * symbol goes in each language and narrowSymbol asks for "$" rather than "US$".
 */
function priceLabel(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string | null {
  if (amount === null || amount === undefined) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return formatMoney(value, currency ?? 'USD', locale, { decimals: 0, narrowSymbol: true });
}

/**
 * AN HONEST PLACEHOLDER. Not a stock photograph of a building that is not theirs,
 * which would be the most literal possible lie on this page. Used for both "no photo"
 * and "the photo cannot be shown" — from the owner's side those are the same thing.
 * What they must never be confused with is "still loading"; see PrivateImage `pending`.
 */
function NoPhoto({ compact }: { compact?: boolean }) {
  const { t } = useLanguage();
  return (
    /*
     * The LABEL is still here, for screen readers. On a 208px thumbnail in a list row
     * there is no room for a caption and an icon says it faster, but "this property has
     * no photo" is information and dropping it entirely would have taken it away from
     * the people who most need it stated.
     */
    <div
      className="flex h-full w-full items-center justify-center text-muted-foreground/40"
      role="img"
      aria-label={t('prop_no_photo')}
    >
      <ImageOff className={compact ? 'h-5 w-5' : 'h-7 w-7'} aria-hidden="true" />
    </div>
  );
}

type PendingAction =
  | { kind: 'DELETE'; property: Property }
  | { kind: 'ARCHIVE'; property: Property }
  | null;

/**
 * The intelligence cluster: four facts on one or two lines.
 *
 * Compact on purpose. Three numbers do not earn a panel, and the point of showing them
 * on a list row is that an owner can tell in one pass which property is worth opening.
 */
function IntelCluster({
  intel, status, archived, dense,
}: {
  intel: PortfolioIntelligence | undefined;
  status: string;
  archived: boolean;
  dense?: boolean;
}) {
  const { t } = useLanguage();
  const total = intel?.total ?? 0;

  return (
    <div className={cn('min-w-0 space-y-1', dense && 'space-y-0.5')}>
      <div className="flex flex-wrap items-center gap-1.5">
        {archived ? (
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[13px] whitespace-normal">
            <Archive className="h-3 w-3 shrink-0" />
            <span className="break-words">{t('prop_state_archived')}</span>
          </Badge>
        ) : (
          <Badge
            variant={status === 'ACTIVE' ? 'default' : 'secondary'}
            className="h-5 px-1.5 text-[13px] whitespace-normal"
          >
            <span className="break-words">
              {t(`prop_state_${status.toLowerCase()}` as never)}
            </span>
          </Badge>
        )}
      </div>

      {total > 0 ? (
        /*
         * ONE LINE, NOT THREE STATS. The total carries the weight; new and strong are
         * the qualifiers that decide whether it is worth opening today.
         */
        <p className="text-[13px] text-muted-foreground break-words leading-snug">
          <span className="font-semibold text-foreground tabular-nums" dir="ltr">{total}</span>
          {' '}
          {t('prop_intel_total')}
          {(intel?.fresh ?? 0) > 0 && (
            <>
              {' · '}
              <span className="font-semibold text-primary tabular-nums" dir="ltr">
                {intel?.fresh}
              </span>
              {' '}
              {t('prop_intel_new')}
            </>
          )}
          {(intel?.strong ?? 0) > 0 && (
            <>
              {' · '}
              <span className="font-semibold text-foreground tabular-nums" dir="ltr">
                {intel?.strong}
              </span>
              {' '}
              {t('prop_intel_strong')}
            </>
          )}
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground/70 break-words leading-snug">
          {archived ? t('prop_intel_archived') : t('prop_intel_none')}
        </p>
      )}
    </div>
  );
}

/**
 * The one thing this property cannot do yet, and the tap that fixes it.
 *
 * Gold, because it is the accent this family uses for "act on this", and one line,
 * because an owner with nine other properties does not need a card about it. Absent
 * entirely on a property that has a number — the useful signal is the exception.
 */
function ContactNeeded({ id }: { id: string }) {
  const { t } = useLanguage();
  return (
    <Link
      to={`/property/${id}/edit#contact`}
      className="inline-flex min-h-8 min-w-0 items-center gap-1.5 text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
    >
      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="break-words text-start">{t('contact_phone_add')}</span>
    </Link>
  );
}

function PropertyRow({
  property, intel, life, onAct, onConfirm,
}: {
  property: Property;
  intel: PortfolioIntelligence | undefined;
  /** The server's lifecycle answer; undefined while unknown, never guessed. */
  life?: PropertyLifecycle;
  onAct: (property: Property, action: 'PUBLISH' | 'PAUSE' | 'UNARCHIVE') => void;
  onConfirm: (pending: PendingAction) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const facts = (Array.isArray(property.facts) ? property.facts[0] : property.facts) as
    Record<string, unknown> | null | undefined;

  const id = String(property.id);
  /* The same ordering as the detail page: a HOMATCH-managed photo always leads, so a
     dead link on another site never stands in front of a photo the owner uploaded. */
  const cover = coverImage({
    coverPhotoUrl: (property.cover_photo_url as string | null) ?? (facts?.cover_image as string | null) ?? null,
    photos: (property as unknown as { photos?: Parameters<typeof coverImage>[0]['photos'] }).photos ?? null,
    galleryImages: (facts?.gallery_images as string[] | null) ?? null,
  });
  const [mediaFailed, setMediaFailed] = useState(false);
  const markMediaFailed = useCallback(() => setMediaFailed(true), []);
  const price = priceLabel(facts?.total_price as number | null, facts?.currency as string | null, locale);
  const perSqm = priceLabel(facts?.price_per_sqm as number | null, facts?.currency as string | null, locale);
  /* In the reader's script. "Krtsanisi, Tbilisi" sat on a Georgian page under a Georgian
     property title, beside match cards that had already been fixed to say თბილისი. */
  const city = placeName(facts?.city as string | null, lang) || null;
  const district = placeName(facts?.district as string | null, lang) || null;
  const area = facts?.area as number | null;
  const rooms = facts?.rooms as number | null;
  const bedrooms = facts?.bedrooms as number | null;
  const status = String(property.matching_status ?? 'DRAFT');
  const archived = Boolean((property as unknown as { archived_at?: string | null }).archived_at);
  const imported = isImported(property.source_type as string | null);
  const action = intelligenceActionFor(property.transaction_type as string | null);
  const matches = intel?.total ?? 0;

  /* One muted line rather than a row of chips: chips are bulky and this is a list. */
  const spec = [
    property.property_type
      ? t(`prop_type_${String(property.property_type).toLowerCase()}` as never) : null,
    property.transaction_type
      ? t(`prop_txn_${String(property.transaction_type).toLowerCase()}` as never) : null,
    typeof area === 'number' && area > 0 ? `${area} m²` : null,
    typeof rooms === 'number' && rooms > 0 ? `${rooms} ${t('prop_unit_rooms')}` : null,
    typeof bedrooms === 'number' && bedrooms > 0 ? `${bedrooms} ${t('prop_unit_bedrooms')}` : null,
  ].filter(Boolean).join(' · ');

  /* A photo that cannot be shown SAYS so — never a blank grey box. */
  const media = (
    <MediaWell hasMedia={Boolean(cover)}>
      {cover ? (
        <PrivateImage
          src={cover}
          alt={String(property.title ?? t('prop_untitled'))}
          className="absolute inset-0 h-full w-full object-cover"
          pending={<div className="absolute inset-0 animate-pulse bg-[hsl(var(--secondary))]" />}
          fallback={<MediaUnavailable compact imported={imported} propertyId={id} sourceUrl={safeExternalUrl(facts?.source_url as string | null)} sourceStatus={life?.source_status ?? null} />}
          onUnavailable={markMediaFailed}
        />
      ) : null}
      {imported && <SourceMark label={t('prop_source_imported')} />}
    </MediaWell>
  );
  const attention = !archived && needsAttention(life ?? null, imported, mediaFailed);
  const lifecycleLine = (
    <div className="flex flex-wrap items-center gap-1.5">
      <FreshnessChip life={life} />
      <SourceChip life={life} imported={imported} />
      {attention && (
        <Link to={`/property/${id}`} data-testid="pow-attention" className="text-2xs font-semibold text-[hsl(var(--gold-ink))] underline-offset-2 hover:underline">
          {life?.freshness_state && life.freshness_state !== 'ACTIVE' ? t('pow_renew_free') : t('pow_needs_attention')}
        </Link>
      )}
    </div>
  );

  /* A historical property keeps every action except starting a NEW search; the line
     below says so where the absence has a consequence, and says nothing anywhere else. */
  const contactReady = hasContactReadiness(property);

  /* Labelled values rather than one middot-joined grey sentence. Only what is real. */
  const factItems = [
    /* First, because it is the value somebody scanning for a specific property is
       scanning for. Same label, same column, every row. */
    property.homatch_id
      ? { label: t('prop_reference_label'), value: String(property.homatch_id) }
      : null,
    property.property_type
      ? { label: t('prop_fact_type'), value: t(`prop_type_${String(property.property_type).toLowerCase()}` as never) }
      : null,
    property.transaction_type
      ? { label: t('prop_fact_deal'), value: t(`prop_txn_${String(property.transaction_type).toLowerCase()}` as never) }
      : null,
    typeof area === 'number' && area > 0
      ? { label: t('prop_fact_area'), value: `${area} m²` } : null,
    typeof rooms === 'number' && rooms > 0
      ? { label: t('prop_unit_rooms'), value: String(rooms) } : null,
    typeof bedrooms === 'number' && bedrooms > 0
      ? { label: t('prop_unit_bedrooms'), value: String(bedrooms) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const menu = (
    <DropdownMenuContent align="end" className="max-w-[min(18rem,calc(100vw-2rem))]">
      <DropdownMenuItem asChild>
        <Link to={`/property/${id}`} className="gap-2">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="break-words">{t('prop_action_view')}</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to={`/property/${id}/edit#photos`} className="gap-2">
          <Camera className="h-4 w-4 shrink-0" />
          <span className="break-words">{t('prop_action_photos')}</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {!archived && status !== 'ACTIVE' && (
        <DropdownMenuItem className="gap-2" onClick={() => onAct(property, 'PUBLISH')}>
          <Play className="h-4 w-4 shrink-0" />
          <span className="break-words">{t('prop_action_activate')}</span>
        </DropdownMenuItem>
      )}
      {!archived && status === 'ACTIVE' && (
        <DropdownMenuItem className="gap-2" onClick={() => onAct(property, 'PAUSE')}>
          <Pause className="h-4 w-4 shrink-0" />
          <span className="break-words">{t('prop_action_pause')}</span>
        </DropdownMenuItem>
      )}
      {archived ? (
        <DropdownMenuItem className="gap-2" onClick={() => onAct(property, 'UNARCHIVE')}>
          <ArchiveRestore className="h-4 w-4 shrink-0" />
          <span className="break-words">{t('prop_action_unarchive')}</span>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem className="gap-2" onClick={() => onConfirm({ kind: 'ARCHIVE', property })}>
          <Archive className="h-4 w-4 shrink-0" />
          <span className="break-words">{t('prop_action_archive')}</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="gap-2 text-destructive focus:text-destructive"
        onClick={() => onConfirm({ kind: 'DELETE', property })}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        <span className="break-words">{t('prop_action_delete')}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  /* One contextual primary: matches when there are matches, the contextual discovery
     when there are none, nothing once archived. */
  const primaryLabel = matches > 0
    ? t('prop_view_matches')
    : action ? t(`prop_action_${action.toLowerCase()}` as never) : t('prop_view_matches');

  /*
   * THE PRIMARY GETS ITS OWN LINE.
   *
   * Measured at 1440 in Georgian: "დაინტერესებული ადამიანების პოვნა" beside two 36px icon
   * controls in a 17rem column wrapped to three lines and clipped the last one. A button
   * whose label is cut in half is worse than a taller button, and this product has long
   * labels by design — the workspace is named in full and its actions are named in full.
   */
  const actions = (
    <div className="flex flex-col gap-1.5">
      {!archived && (
        <Link to={`/property/${id}/matches`} className={cn(OWNER_PRIMARY, 'w-full')}>
          <span className="break-words text-center leading-snug">{primaryLabel}</span>
        </Link>
      )}
      <div className="flex items-center gap-1.5">
      <Link to={`/property/${id}/edit`} className={OWNER_ICON} aria-label={t('prop_action_edit')}>
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={OWNER_ICON} aria-label={t('prop_more_actions')}>
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      </div>
    </div>
  );

  const place = [district, city].filter(Boolean).join(', ');

  return (
    /*
     * A ROW, NOT A CARD. `overflow-hidden` so the media meets the frame, and the whole
     * thing lifts on hover rather than tinting — a list of properties should respond like
     * a list.
     */
    <article className="hm-owner-panel overflow-hidden transition-shadow hover:shadow-[var(--shadow-hover)]">
      {/* ── DESKTOP: media · identity · intelligence · actions ────────── */}
      <div className="hidden lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)_17rem] lg:items-stretch">
        {/*
          THE PROPERTY OPENS. A real <Link> spanning the media and the identity, so it is
          deep-linkable, middle-clickable, refresh-safe and reachable from the keyboard.
          The actions column is deliberately outside it: a menu inside a link is a click
          that does two things.
        */}
        <Link
          to={`/property/${id}`}
          className="relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
          aria-label={String(property.title ?? t('prop_untitled'))}
        >
          {media}
        </Link>

        <Link
          to={`/property/${id}`}
          className="flex min-w-0 flex-col justify-center gap-2 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
        >
          <div className="flex items-start justify-between gap-4 min-w-0">
            <div className="min-w-0 space-y-1">
              <h3 className="font-display text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">
                {String(property.title ?? t('prop_untitled'))}
              </h3>
              {place && (
                <p className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                  <span className="truncate">{place}</span>
                </p>
              )}
            </div>
            <div className="shrink-0 text-end">
              <Money price={price} perSqm={perSqm} none={t('prop_no_price')} />
            </div>
          </div>
          <FactLine items={factItems} />
        </Link>

        <div className="flex min-w-0 flex-col justify-center gap-2.5 border-s border-border px-5 py-4">
          <StatusMark status={status} archived={archived} />
          {lifecycleLine}
          <IntelLine
            total={intel?.total ?? 0}
            fresh={intel?.fresh ?? 0}
            strong={intel?.strong ?? 0}
          />
          {!contactReady && <ContactNeeded id={id} />}
          {actions}
        </div>
      </div>

      {/* ── MOBILE: the same parts, stacked ───────────────────────────── */}
      <div className="lg:hidden">
        <Link to={`/property/${id}`} className="block">
          {media}
        </Link>
        <div className="space-y-3 p-4">
          <Link to={`/property/${id}`} className="block min-w-0 space-y-1.5">
            <h3 className="font-display text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">
              {String(property.title ?? t('prop_untitled'))}
            </h3>
            {place && (
              <p className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                <span className="truncate">{place}</span>
              </p>
            )}
          </Link>

          <div className="flex items-end justify-between gap-3">
            <Money price={price} perSqm={perSqm} none={t('prop_no_price')} />
            <StatusMark status={status} archived={archived} />
          </div>

          <FactLine items={factItems} />
          {lifecycleLine}

          <div className="border-t border-border pt-3 space-y-2.5">
            <IntelLine
              total={intel?.total ?? 0}
              fresh={intel?.fresh ?? 0}
              strong={intel?.strong ?? 0}
            />
            {!contactReady && <ContactNeeded id={id} />}
            {actions}
          </div>
        </div>
      </div>
    </article>
  );
}

function ViewSwitch({
  view, counts, onChange,
}: {
  view: PortfolioView;
  counts: { active: number; archived: number };
  onChange: (next: PortfolioView) => void;
}) {
  const { t } = useLanguage();
  const options: { key: PortfolioView; label: string; count: number }[] = [
    { key: 'ACTIVE', label: t('prop_tab_active'), count: counts.active },
    { key: 'ARCHIVED', label: t('prop_tab_archived'), count: counts.archived },
  ];
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
      {options.map((option) => {
        const active = view === option.key;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors min-w-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              active
                ? 'bg-secondary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="break-words min-w-0">{option.label}</span>
            <span
              className={cn(
                'tabular-nums',
                active ? 'text-foreground' : 'text-muted-foreground/70',
              )}
              dir="ltr"
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function MyPropertiesPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<PortfolioView>('ACTIVE');
  const [properties, setProperties] = useState<Property[]>([]);
  const [intel, setIntel] = useState<Map<string, PortfolioIntelligence>>(new Map());
  const [lifecycle, setLifecycle] = useState<Map<string, PropertyLifecycle>>(new Map());
  const [counts, setCounts] = useState({ active: 0, archived: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!homatchUser?.id) return;
    setLoading(true);
    setFailed(null);
    try {
      const [rows, totals] = await Promise.all([
        listPortfolio({ userId: homatchUser.id, view }),
        portfolioCounts(homatchUser.id),
      ]);
      setProperties(rows);
      setCounts(totals);
      /* One query for the whole page, after the list is known. */
      const ids = rows.map((row) => String(row.id));
      const [byIntel, byLife] = await Promise.all([portfolioIntelligence(ids), fetchLifecycle(ids)]);
      setIntel(byIntel);
      setLifecycle(byLife);
    } catch (error) {
      /*
       * A PERMISSION FAILURE IS A REAL STATE. RLS returns an error rather than an empty
       * list when something is wrong, and rendering that as "you have no properties"
       * would tell an owner their portfolio is empty when it is only unreachable.
       */
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [homatchUser?.id, view]);

  useEffect(() => { void load(); }, [load]);

  const act = async (property: Property, action: 'PUBLISH' | 'PAUSE' | 'UNARCHIVE') => {
    setWorking(true);
    try {
      if (action === 'PUBLISH') await setPublication(String(property.id), 'ACTIVE');
      if (action === 'PAUSE') await setPublication(String(property.id), 'PAUSED');
      if (action === 'UNARCHIVE') await unarchiveProperty(String(property.id));
      toast.success(t('prop_saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      if (pending.kind === 'DELETE') await deleteProperty(String(pending.property.id));
      if (pending.kind === 'ARCHIVE') await archiveProperty(String(pending.property.id));
      toast.success(t('prop_saved'));
      setPending(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };

  const empty = useMemo(
    () => !loading && !failed && properties.length === 0,
    [loading, failed, properties.length],
  );

  return (
    <RouteGuard>
      {/*
        `.hm-product`, which is neither the shell's block nor the discovery product's.
        A property-management workspace wants a quiet light ground and no accent of its
        own; what it takes from the shared system is the quality floor — ink that is ink,
        a hairline that reads as a line, tabular figures — and nothing about its palette.
      */}
      <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
        {/*
          A WIDE CANVAS THAT DOES NOT STRETCH ITS CONTENTS. max-w-[90rem] and the px
          rhythm the approved workspaces use — wide enough to be a workspace, bounded
          enough that a list row stays a list row.
        */}
        <div className="mx-auto w-full max-w-[90rem] px-4 py-4 sm:px-6 lg:px-8 space-y-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {/*
            HEADER. Stacked until sm, and the actions are NOT shrink-0 — that one class
            overflowed this page at every width in every language, 492px against a 320px
            viewport in Georgian, because two long labels side by side cannot fit a phone
            and shrink-0 forbade the container from narrowing to let them wrap.
          */}
          {/*
            The approved workspace name is long by design and keeps its two lines; the
            subtitle moves into the header's own count slot so the title block is two
            elements rather than three. The actions are the product's own controls — an
            outlined secondary and a filled primary at control size — not a black shadcn
            rectangle beside a grey one.
          */}
          {/* The workspace's navy identity band. In-frame grammar: ONE gold
              primary (add a property — the action everything else depends
              on), one white secondary beside it. The list below is white. */}
          <PageHero
            compact
            title={t('prop_page_title')}
            subtitle={t('prop_page_subtitle')}
            actions={
              <>
                <button
                  type="button"
                  onClick={() => navigate('/property/import')}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-white/40 bg-white px-3.5 py-1.5 text-2xs font-semibold text-[#0C1119] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
                >
                  <Upload className="h-3.5 w-3.5 shrink-0" />
                  <span className="break-words text-start">{t('prop_import_cta')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/property/add')}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3.5 py-1.5 text-2xs font-bold text-[#161309] transition-colors hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="break-words text-start">{t('prop_add_cta')}</span>
                </button>
              </>
            }
          />

          {/* The shared filter rail rather than this page's own segmented control: two
              controls doing the same job is two places to fix a Georgian label. */}
          <FilterRail<PortfolioView>
            options={[
              { value: 'ACTIVE' as const, label: t('prop_tab_active'), count: counts.active },
              { value: 'ARCHIVED' as const, label: t('prop_tab_archived'), count: counts.archived },
            ]}
            value={view}
            onChange={setView}
            ariaLabel={t('prop_tab_active')}
          />

          {loading && (
            /* Three rows at the height a row actually is, so the page does not resize
               under the reader when the data lands. */
            <div className="space-y-2.5">
              <Skeleton className="h-[8.25rem] rounded-xl" />
              <Skeleton className="h-[8.25rem] rounded-xl" />
              <Skeleton className="h-[8.25rem] rounded-xl" />
            </div>
          )}

          {failed && (
            <div className="hm-owner-panel p-5 text-center">
              <p className="font-display text-base font-semibold text-foreground break-words">
                {t('prop_load_failed')}
              </p>
              <p className="mx-auto mt-1 max-w-[46ch] text-2xs text-muted-foreground break-words">
                {failed}
              </p>
              {/* The way out of a failure is the one control on the screen that has to be
                  unmistakable. */}
              <div className="mt-3 flex justify-center">
                <QuietAction onClick={() => void load()} label={t('prop_retry')} />
              </div>
            </div>
          )}

          {/*
            THE EMPTY STATE SAYS WHAT A PROPERTY IS FOR HERE, not how wonderful the
            product is. An owner who has uploaded nothing needs one fact: matching works
            from a property, so until there is one there is nothing to match.
          */}
          {empty && view === 'ACTIVE' && (
            <EmptyState
              icon={Building2}
              title={t('prop_empty_title')}
              body={t('prop_empty_body')}
              actions={
                <>
                  <Button size="sm" onClick={() => navigate('/property/add')}>
                    <Plus className="h-4 w-4 me-1.5 shrink-0" />
                    <span className="break-words">{t('prop_add_cta')}</span>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate('/property/import')}>
                    <Upload className="h-4 w-4 me-1.5 shrink-0" />
                    <span className="break-words">{t('prop_import_cta')}</span>
                  </Button>
                </>
              }
            />
          )}

          {empty && view === 'ARCHIVED' && (
            <EmptyState icon={Archive} body={t('prop_empty_archived')} />
          )}

          {properties.length > 0 && (
            <div className="space-y-3">
              {properties.map((property) => (
                <PropertyRow
                  key={String(property.id)}
                  property={property}
                  intel={intel.get(String(property.id))}
                  life={lifecycle.get(String(property.id))}
                  onAct={(p, a) => { void act(p, a); }}
                  onConfirm={setPending}
                />
              ))}

              {/*
                THE SHORT-LIST CASE, ANSWERED WITH A CONTROL RATHER THAN PADDING.
                A single 122px row above 600px of nothing is the sparse composition this
                page was rejected for the first time, and inflating the row to fill the
                screen is what it was rejected for the second time. So the list ends with
                the obvious next thing to do, at the same height as a row, and it
                disappears once there are enough properties for the list to carry itself.
              */}
              {view === 'ACTIVE' && properties.length < 4 && (
                <button
                  type="button"
                  onClick={() => navigate('/property/add')}
                  className="w-full rounded-xl border border-dashed border-border bg-card/40 px-4 py-6 lg:min-h-[7.5rem] text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                    <Plus className="h-4 w-4 shrink-0" />
                    <span className="break-words min-w-0">{t('prop_add_another')}</span>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/*
          BOTH DESTRUCTIVE ACTIONS CONFIRM, and the two dialogs say different things
          because they do different things. Archiving is reversible and the text says so;
          deleting is not offered as reversible, because from the owner's side it is not
          — the row survives for the ledger's sake and that is not something to promise
          them as a way back.
        */}
        <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
          <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="break-words">
                {pending?.kind === 'DELETE'
                  ? t('prop_confirm_delete_title') : t('prop_confirm_archive_title')}
              </AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                {pending?.kind === 'DELETE'
                  ? t('prop_confirm_delete_body') : t('prop_confirm_archive_body')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="break-words">{t('general_cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => { event.preventDefault(); void confirmPending(); }}
                disabled={working}
                className={pending?.kind === 'DELETE'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined}
              >
                <span className="break-words">
                  {pending?.kind === 'DELETE'
                    ? t('prop_action_delete') : t('prop_action_archive')}
                </span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppLayout>
    </RouteGuard>
  );
}
