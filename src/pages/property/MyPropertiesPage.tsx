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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive, ArchiveRestore, Building2, Camera, Eye, ImageOff, MapPin, MoreVertical,
  Pause, Pencil, Play, Plus, Trash2, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { PrivateImage } from '@/components/common/PrivateImage';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { Property } from '@/types/types';
import {
  type PortfolioIntelligence,
  type PortfolioView,
  archiveProperty,
  deleteProperty,
  intelligenceActionFor,
  isImported,
  listPortfolio,
  portfolioCounts,
  portfolioIntelligence,
  setPublication,
  unarchiveProperty,
} from '@/services/propertyManagement';

/** A price, or nothing. Never a zero standing in for "not priced yet". */
function priceLabel(
  amount: number | null | undefined, currency: string | null | undefined,
): string | null {
  if (amount === null || amount === undefined) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${currency ?? ''}${value.toLocaleString()}`;
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

function PropertyRow({
  property, intel, onAct, onConfirm,
}: {
  property: Property;
  intel: PortfolioIntelligence | undefined;
  onAct: (property: Property, action: 'PUBLISH' | 'PAUSE' | 'UNARCHIVE') => void;
  onConfirm: (pending: PendingAction) => void;
}) {
  const { t } = useLanguage();
  const facts = (Array.isArray(property.facts) ? property.facts[0] : property.facts) as
    Record<string, unknown> | null | undefined;

  const id = String(property.id);
  const cover = (property.cover_photo_url as string | null)
    ?? (facts?.cover_image as string | null) ?? null;
  const price = priceLabel(facts?.total_price as number | null, facts?.currency as string | null);
  const perSqm = priceLabel(facts?.price_per_sqm as number | null, facts?.currency as string | null);
  const city = (facts?.city as string | null) ?? null;
  const district = (facts?.district as string | null) ?? null;
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

  const media = (
    <>
      {cover ? (
        <PrivateImage
          src={cover}
          alt={String(property.title ?? t('prop_untitled'))}
          className="absolute inset-0 h-full w-full object-cover"
          pending={<div className="absolute inset-0 animate-pulse bg-secondary/60" />}
          fallback={<NoPhoto compact />}
        />
      ) : (
        <NoPhoto compact />
      )}
      {imported && (
        <span className="absolute bottom-1.5 start-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[13px] text-muted-foreground shadow-sm max-w-[calc(100%-0.75rem)]">
          <span className="break-words">{t('prop_source_imported')}</span>
        </span>
      )}
    </>
  );

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

  /* The primary action, and there is exactly one. Matches when there are matches; the
     contextual find when there are not; nothing at all once archived. */
  const primary = archived ? null : (
    /*
     * h-auto with a MINIMUM, not a fixed h-8. Georgian wraps "მატჩების ნახვა" onto two
     * lines inside this column and a fixed height clipped the second one -- a button
     * whose label is cut in half is worse than a taller button.
     */
    <Button asChild size="sm" className="h-auto min-h-8 py-1.5 px-3 text-xs min-w-0 whitespace-normal">
      <Link to={`/property/${id}/matches`}>
        <span className="break-words min-w-0">
          {matches > 0
            ? t('prop_view_matches')
            : action ? t(`prop_action_${action.toLowerCase()}` as never) : t('prop_view_matches')}
        </span>
      </Link>
    </Button>
  );

  return (
    <Card className="overflow-hidden border-border bg-card transition-colors hover:border-border/80 hover:bg-secondary/20">
      {/* ── DESKTOP: one compact row ──────────────────────────────────── */}
      <div className="hidden lg:grid lg:grid-cols-[13rem_minmax(0,1fr)_16rem] lg:items-stretch">
        {/*
          THE PROPERTY OPENS. A real <Link>, spanning the image and the identity, so it
          is deep-linkable, middle-clickable, refresh-safe and reachable from the
          keyboard -- not a div with an onClick. Edit was the only way into a property
          before this, which made inspecting one indistinguishable from changing it.
          The actions column is deliberately OUTSIDE the link: a menu inside a link is a
          click that does two things.
        */}
        <Link
          to={`/property/${id}`}
          className="relative min-h-[7.5rem] bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          aria-label={String(property.title ?? t('prop_untitled'))}
        >
          {media}
        </Link>

        <Link
          to={`/property/${id}`}
          className="min-w-0 px-4 py-3 flex flex-col justify-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <div className="flex items-start justify-between gap-3 min-w-0">
            <h3 className="text-[15px] font-semibold leading-snug text-foreground break-words [overflow-wrap:anywhere] min-w-0">
              {String(property.title ?? t('prop_untitled'))}
            </h3>
            <div className="shrink-0 text-end">
              {price ? (
                <p className="text-lg font-bold leading-tight text-foreground" dir="ltr">{price}</p>
              ) : (
                <p className="text-[13px] text-muted-foreground">{t('prop_no_price')}</p>
              )}
              {perSqm && (
                <p className="text-[13px] text-muted-foreground/70 leading-tight" dir="ltr">
                  {perSqm}/m²
                </p>
              )}
            </div>
          </div>

          {(city || district) && (
            <div className="flex items-start gap-1 text-[13px] text-muted-foreground min-w-0">
              <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">
                {[district, city].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
          {spec && (
            <p className="text-[13px] text-muted-foreground/80 break-words leading-snug">{spec}</p>
          )}
        </Link>

        <div className="min-w-0 border-s border-border/60 px-4 py-3 flex flex-col justify-center gap-2.5">
          <IntelCluster intel={intel} status={status} archived={archived} dense />
          <div className="flex items-center gap-1.5">
            {primary}
            <Button asChild size="sm" variant="outline" className="h-8 w-8 p-0 shrink-0">
              <Link to={`/property/${id}/edit`}>
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">{t('prop_action_edit')}</span>
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0 shrink-0">
                  <MoreVertical className="h-3.5 w-3.5" />
                  <span className="sr-only">{t('prop_more_actions')}</span>
                </Button>
              </DropdownMenuTrigger>
              {menu}
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* ── MOBILE: a purpose-built card, not the row squeezed ────────── */}
      <div className="lg:hidden">
        <Link to={`/property/${id}`} className="block relative aspect-[16/9] bg-secondary/40">
          {media}
        </Link>
        <CardContent className="p-4 space-y-2.5">
          <Link to={`/property/${id}`} className="block min-w-0 space-y-1">
            <h3 className="text-[15px] font-semibold leading-snug text-foreground break-words [overflow-wrap:anywhere]">
              {String(property.title ?? t('prop_untitled'))}
            </h3>
            {(city || district) && (
              <div className="flex items-start gap-1 text-[13px] text-muted-foreground min-w-0">
                <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                <span className="break-words min-w-0">
                  {[district, city].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </Link>

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              {price ? (
                <p className="text-xl font-bold leading-tight text-foreground break-words" dir="ltr">
                  {price}
                </p>
              ) : (
                <p className="text-[13px] text-muted-foreground break-words">{t('prop_no_price')}</p>
              )}
              {perSqm && (
                <p className="text-[13px] text-muted-foreground/70 break-words" dir="ltr">
                  {perSqm}/m²
                </p>
              )}
            </div>
          </div>

          {spec && (
            <p className="text-[13px] text-muted-foreground/80 break-words leading-snug">{spec}</p>
          )}

          <IntelCluster intel={intel} status={status} archived={archived} />

          <div className="flex items-center gap-1.5 pt-0.5">
            {primary && <div className="flex-1 min-w-0 [&>*]:w-full">{primary}</div>}
            <Button asChild size="sm" variant="outline" className="h-8 w-8 p-0 shrink-0">
              <Link to={`/property/${id}/edit`}>
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">{t('prop_action_edit')}</span>
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0 shrink-0">
                  <MoreVertical className="h-3.5 w-3.5" />
                  <span className="sr-only">{t('prop_more_actions')}</span>
                </Button>
              </DropdownMenuTrigger>
              {menu}
            </DropdownMenu>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

/**
 * The filter, as a compact segmented control with its counts inline.
 *
 * NOT two large statistic tiles. "1 active, 0 archived" is a small fact and a tile
 * apiece spent a third of the first screenful saying it.
 */
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
      setIntel(await portfolioIntelligence(rows.map((row) => String(row.id))));
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
      <AppLayout>
        {/*
          A WIDE, PREMIUM CANVAS THAT DOES NOT STRETCH ITS CONTENTS. max-w-[90rem] and
          the px rhythm the approved workspaces use — wide enough to be a workspace,
          bounded enough that a list row stays a list row.
        */}
        <div className="mx-auto w-full max-w-[90rem] px-4 py-2 sm:px-6 lg:px-8 space-y-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {/*
            HEADER. Stacked until sm, and the actions are NOT shrink-0 — that one class
            overflowed this page at every width in every language, 492px against a 320px
            viewport in Georgian, because two long labels side by side cannot fit a phone
            and shrink-0 forbade the container from narrowing to let them wrap.
          */}
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
            <div className="min-w-0 space-y-1">
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground break-words">
                {t('prop_page_title')}
              </h1>
              <p className="text-[13px] text-muted-foreground break-words max-w-2xl">
                {t('prop_page_subtitle')}
              </p>
            </div>
            <div className="flex w-full items-stretch gap-2 flex-wrap sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/property/import')}
                className="flex-1 min-w-0 sm:flex-none"
              >
                <Upload className="h-4 w-4 me-1.5 shrink-0" />
                <span className="break-words min-w-0">{t('prop_import_cta')}</span>
              </Button>
              <Button
                size="sm"
                onClick={() => navigate('/property/add')}
                className="flex-1 min-w-0 sm:flex-none"
              >
                <Plus className="h-4 w-4 me-1.5 shrink-0" />
                <span className="break-words min-w-0">{t('prop_add_cta')}</span>
              </Button>
            </div>
          </header>

          <ViewSwitch view={view} counts={counts} onChange={setView} />

          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-[7.5rem] rounded-xl" />
              <Skeleton className="h-[7.5rem] rounded-xl" />
              <Skeleton className="h-[7.5rem] rounded-xl" />
            </div>
          )}

          {failed && (
            <Card className="bg-card border-border">
              <CardContent className="p-6 space-y-2 text-center">
                <p className="text-sm font-medium text-foreground break-words">
                  {t('prop_load_failed')}
                </p>
                <p className="text-[13px] text-muted-foreground break-words">{failed}</p>
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  <span className="break-words">{t('prop_retry')}</span>
                </Button>
              </CardContent>
            </Card>
          )}

          {/*
            THE EMPTY STATE SAYS WHAT A PROPERTY IS FOR HERE, not how wonderful the
            product is. An owner who has uploaded nothing needs one fact: matching works
            from a property, so until there is one there is nothing to match.
          */}
          {empty && view === 'ACTIVE' && (
            <Card className="bg-card border-border">
              <CardContent className="px-6 py-12 text-center space-y-4">
                <Building2 className="h-10 w-10 mx-auto opacity-25" />
                <div className="space-y-1.5">
                  <p className="text-base font-semibold text-foreground break-words">
                    {t('prop_empty_title')}
                  </p>
                  <p className="text-sm text-muted-foreground break-words max-w-lg mx-auto">
                    {t('prop_empty_body')}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
                  <Button size="sm" onClick={() => navigate('/property/add')}>
                    <Plus className="h-4 w-4 me-1.5 shrink-0" />
                    <span className="break-words">{t('prop_add_cta')}</span>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate('/property/import')}>
                    <Upload className="h-4 w-4 me-1.5 shrink-0" />
                    <span className="break-words">{t('prop_import_cta')}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {empty && view === 'ARCHIVED' && (
            <Card className="bg-card border-border">
              <CardContent className="px-6 py-12 text-center space-y-2">
                <Archive className="h-9 w-9 mx-auto opacity-25" />
                <p className="text-sm text-muted-foreground break-words max-w-lg mx-auto">
                  {t('prop_empty_archived')}
                </p>
              </CardContent>
            </Card>
          )}

          {properties.length > 0 && (
            <div className="space-y-3">
              {properties.map((property) => (
                <PropertyRow
                  key={String(property.id)}
                  property={property}
                  intel={intel.get(String(property.id))}
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
