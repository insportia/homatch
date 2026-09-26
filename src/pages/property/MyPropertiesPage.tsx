// src/pages/property/MyPropertiesPage.tsx — MY PROPERTIES.
//
// A PROPERTY PORTFOLIO WORKSPACE, not a grid of marketplace cards.
//
// THE FIRST VERSION OF THIS PAGE WAS REJECTED ON SIGHT, AND CORRECTLY.
//
// It was `max-w-5xl` with `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`, so an owner with
// ONE property — which is what production actually holds — got a 250px card marooned in
// a 1920px canvas with the rest of the screen empty. That is a mobile layout rendered on
// a desktop, and no amount of shadow, radius or font size fixes it: the information
// architecture was wrong. A portfolio manager is not a shop window.
//
// WHAT CHANGED, AND WHY EACH ONE
//
//   THE CANVAS. max-w-[100rem] with the same px-4 / sm:px-6 / lg:px-8 rhythm the
//   Investment workspace uses, because that is the approved composition language in this
//   product and the point of a benchmark is to be used.
//
//   THE UNIT IS A ROW, NOT A TILE. On desktop each property is a full-width panel in
//   three deliberate columns — imagery, identity, intelligence-and-actions. One property
//   fills the content width and looks intentional; ten look like a portfolio. A tile
//   grid cannot do the first of those, which is why it was the wrong unit.
//
//   DESKTOP AND MOBILE ARE DIFFERENT COMPOSITIONS, not one layout at two widths. Below
//   `lg` the panel stacks into a touch-first card: image on top at 16:9, content, then a
//   compact action row with the secondary actions behind a menu.
//
//   THE HEADER IS A HEADER. Title, the one sentence that says what the page is for, the
//   primary action, and a filter strip built as real segmented tiles carrying real
//   counts — not three small pills dropped under a heading.
//
//   AND THE INTELLIGENCE IS THE POINT. This is the column that makes the page not a
//   marketplace: what Homatch is doing for this property and what it has found. The one
//   property in production has 55 matches, 40 of them new and 10 strong, against a
//   PAUSED campaign — all real columns, none of them previously visible anywhere on a
//   portfolio screen.
//
// WHAT IS STILL REFUSED
//
// A number that is not in the database. matchability_score is null on the production
// row, so it renders nowhere. A property with no matches says it has none rather than
// showing three zeros dressed as metrics, and a property with no photo shows an honest
// placeholder rather than a stock image of a building that is not theirs.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive, ArchiveRestore, Building2, Camera, Eye, ImageOff, MapPin, MoreVertical,
  Pause, Pencil, Play, Plus, Sparkles, Telescope, Trash2, Upload,
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
 * which would be the most literal possible lie on this page.
 *
 * Used for both "there is no photo" and "the photo cannot be shown", because from the
 * owner's side those are the same situation. What they must never be confused with is
 * "the photo is still loading" — see PrivateImage's `pending`.
 */
function NoPhoto({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/45">
      <ImageOff className="h-8 w-8" />
      <span className="text-[13px] break-words px-3 text-center">{label}</span>
    </div>
  );
}

type PendingAction =
  | { kind: 'DELETE'; property: Property }
  | { kind: 'ARCHIVE'; property: Property }
  | null;

/** One number in the intelligence rail. Muted when it is zero, never hidden. */
function IntelStat({ value, label, accent }: {
  value: number; label: string; accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          'text-lg font-semibold leading-tight tabular-nums',
          value === 0 ? 'text-muted-foreground/50' : accent ? 'text-primary' : 'text-foreground',
        )}
        dir="ltr"
      >
        {value}
      </p>
      <p className="text-[13px] text-muted-foreground break-words leading-tight">{label}</p>
    </div>
  );
}

function PropertyPanel({
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

  const chips = [
    property.property_type
      ? t(`prop_type_${String(property.property_type).toLowerCase()}` as never) : null,
    property.transaction_type
      ? t(`prop_txn_${String(property.transaction_type).toLowerCase()}` as never) : null,
    typeof area === 'number' && area > 0 ? `${area} m²` : null,
    typeof rooms === 'number' && rooms > 0 ? `${rooms} ${t('prop_unit_rooms')}` : null,
    typeof bedrooms === 'number' && bedrooms > 0 ? `${bedrooms} ${t('prop_unit_bedrooms')}` : null,
  ].filter(Boolean) as string[];

  return (
    <Card className="overflow-hidden border-border bg-card">
      {/*
        THE THREE COLUMNS, and they only exist from `lg`. Below that this collapses to
        one column and the composition genuinely changes rather than shrinking.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)_18rem] xl:grid-cols-[26rem_minmax(0,1fr)_20rem]">
        {/* ── 1. IMAGERY ─────────────────────────────────────────────── */}
        <div className="relative aspect-[16/9] lg:aspect-auto lg:min-h-[15rem] bg-secondary/40">
          {cover ? (
            <PrivateImage
              src={cover}
              alt={String(property.title ?? t('prop_untitled'))}
              className="absolute inset-0 h-full w-full object-cover"
              pending={<div className="absolute inset-0 animate-pulse bg-secondary/60" />}
              fallback={<NoPhoto label={t('prop_no_photo')} />}
            />
          ) : (
            <NoPhoto label={t('prop_no_photo')} />
          )}
          <div className="absolute top-3 start-3 flex flex-wrap gap-1.5 max-w-[calc(100%-1.5rem)]">
            {archived ? (
              <Badge variant="secondary" className="gap-1 whitespace-normal shadow-sm">
                <Archive className="h-3 w-3 shrink-0" />
                <span className="break-words">{t('prop_state_archived')}</span>
              </Badge>
            ) : (
              <Badge
                variant={status === 'ACTIVE' ? 'default' : 'secondary'}
                className="whitespace-normal shadow-sm"
              >
                <span className="break-words">
                  {t(`prop_state_${status.toLowerCase()}` as never)}
                </span>
              </Badge>
            )}
            {imported && (
              <Badge variant="outline" className="whitespace-normal bg-background/85 shadow-sm">
                <span className="break-words">{t('prop_source_imported')}</span>
              </Badge>
            )}
          </div>
        </div>

        {/* ── 2. WHAT PROPERTY IS THIS ───────────────────────────────── */}
        <div className="min-w-0 p-5 lg:p-6 space-y-3">
          <div className="min-w-0 space-y-1">
            <h3 className="text-base lg:text-lg font-semibold leading-snug text-foreground break-words [overflow-wrap:anywhere]">
              {String(property.title ?? t('prop_untitled'))}
            </h3>
            {(city || district) && (
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground min-w-0">
                <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-words min-w-0">
                  {[district, city].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>

          {/* The price is the largest thing in this column, because it is what an owner
              checks first and changes most often. */}
          <div className="min-w-0">
            {price ? (
              <p
                className="text-2xl lg:text-3xl font-bold leading-tight text-foreground break-words"
                dir="ltr"
              >
                {price}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground break-words">{t('prop_no_price')}</p>
            )}
            {perSqm && (
              <p className="text-sm text-muted-foreground break-words" dir="ltr">{perSqm}/m²</p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {chips.map((chip) => (
              <span
                key={chip}
                className="text-[13px] bg-secondary px-2.5 py-1 rounded-full text-muted-foreground max-w-full"
              >
                <span className="break-words">{chip}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ── 3. WHAT HOMATCH IS DOING, AND WHAT TO DO NEXT ──────────── */}
        <div className="min-w-0 border-t lg:border-t-0 lg:border-s border-border/60 bg-background/40 p-5 lg:p-6 flex flex-col gap-4">
          <div className="min-w-0 space-y-2.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground break-words min-w-0">
                {t('prop_intel_heading')}
              </span>
            </div>

            {matches > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <IntelStat value={intel?.total ?? 0} label={t('prop_intel_total')} />
                  <IntelStat value={intel?.fresh ?? 0} label={t('prop_intel_new')} accent />
                  <IntelStat value={intel?.strong ?? 0} label={t('prop_intel_strong')} />
                </div>
                {/* A PAUSED campaign with matches waiting is the one combination an owner
                    most needs told, and it was invisible before this page existed. */}
                {status !== 'ACTIVE' && !archived && (
                  <p className="text-[13px] text-muted-foreground break-words">
                    {t('prop_intel_paused_note')}
                  </p>
                )}
              </>
            ) : (
              /* THE HONEST EMPTY STATE. Not three zeros dressed as metrics. */
              <p className="text-[13px] text-muted-foreground break-words">
                {archived ? t('prop_intel_archived') : t('prop_intel_none')}
              </p>
            )}
          </div>

          {/*
            ACTION HIERARCHY, three tiers rather than a stack of equals. PRIMARY is what
            this property should do next; IMPORTANT is editing it; everything else is
            behind the menu — reachable, not shouting.
          */}
          <div className="mt-auto space-y-2">
            {!archived && matches > 0 && (
              <Button asChild size="sm" className="w-full justify-center gap-1.5">
                <Link to={`/property/${id}/matches`}>
                  <span className="break-words">{t('prop_view_matches')}</span>
                </Link>
              </Button>
            )}
            {!archived && matches === 0 && action && (
              <Button asChild size="sm" className="w-full justify-center gap-1.5">
                <Link to={`/property/${id}/matches`}>
                  <Telescope className="h-4 w-4 shrink-0" />
                  <span className="break-words">
                    {t(`prop_action_${action.toLowerCase()}` as never)}
                  </span>
                </Link>
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="outline" className="flex-1 gap-1.5 min-w-0">
                <Link to={`/property/${id}/edit`}>
                  <Pencil className="h-3.5 w-3.5 shrink-0" />
                  <span className="break-words min-w-0">{t('prop_action_edit')}</span>
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-9 w-9 p-0 shrink-0">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">{t('prop_more_actions')}</span>
                  </Button>
                </DropdownMenuTrigger>
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
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => onAct(property, 'UNARCHIVE')}
                    >
                      <ArchiveRestore className="h-4 w-4 shrink-0" />
                      <span className="break-words">{t('prop_action_unarchive')}</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => onConfirm({ kind: 'ARCHIVE', property })}
                    >
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
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** A filter tile. Part of the page architecture, not a pill under the title. */
function FilterTile({
  active, label, count, onClick,
}: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-w-0 flex-1 rounded-xl border px-4 py-3 text-start transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active
          ? 'border-primary/60 bg-primary/[0.07]'
          : 'border-border bg-card hover:border-border/80 hover:bg-secondary/30',
      )}
    >
      <p
        className={cn(
          'text-xl font-bold leading-tight tabular-nums',
          active ? 'text-primary' : 'text-foreground',
        )}
        dir="ltr"
      >
        {count}
      </p>
      <p className="text-[13px] text-muted-foreground break-words leading-tight mt-0.5">{label}</p>
    </button>
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
          THE CANVAS. The same max-w-[100rem] and px rhythm the Investment workspace
          uses, because that is the approved composition in this product and the point of
          a benchmark is to be used rather than admired.
        */}
        <div className="mx-auto w-full max-w-[100rem] px-4 py-2 sm:px-6 lg:px-8 space-y-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {/* ── PAGE HEADER ─────────────────────────────────────────── */}
          <header className="flex items-end justify-between gap-4 flex-wrap border-b border-border/60 pb-5">
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground break-words">
                {t('prop_page_title')}
              </h1>
              <p className="text-sm text-muted-foreground break-words max-w-2xl">
                {t('prop_page_subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Button variant="outline" onClick={() => navigate('/property/import')}>
                <Upload className="h-4 w-4 me-1.5 shrink-0" />
                <span className="break-words">{t('prop_import_cta')}</span>
              </Button>
              <Button onClick={() => navigate('/property/add')}>
                <Plus className="h-4 w-4 me-1.5 shrink-0" />
                <span className="break-words">{t('prop_add_cta')}</span>
              </Button>
            </div>
          </header>

          {/* Real counts from the database, and the filter at the same time. */}
          <div className="flex items-stretch gap-3 flex-wrap sm:flex-nowrap sm:max-w-lg">
            <FilterTile
              active={view === 'ACTIVE'}
              label={t('prop_tab_active')}
              count={counts.active}
              onClick={() => setView('ACTIVE')}
            />
            <FilterTile
              active={view === 'ARCHIVED'}
              label={t('prop_tab_archived')}
              count={counts.archived}
              onClick={() => setView('ARCHIVED')}
            />
          </div>

          {loading && (
            <div className="space-y-4">
              <Skeleton className="h-64 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
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
              <CardContent className="px-6 py-14 text-center space-y-4">
                <Building2 className="h-12 w-12 mx-auto opacity-25" />
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-foreground break-words">
                    {t('prop_empty_title')}
                  </p>
                  <p className="text-sm text-muted-foreground break-words max-w-lg mx-auto">
                    {t('prop_empty_body')}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
                  <Button onClick={() => navigate('/property/add')}>
                    <Plus className="h-4 w-4 me-1.5 shrink-0" />
                    <span className="break-words">{t('prop_add_cta')}</span>
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/property/import')}>
                    <Upload className="h-4 w-4 me-1.5 shrink-0" />
                    <span className="break-words">{t('prop_import_cta')}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {empty && view === 'ARCHIVED' && (
            <Card className="bg-card border-border">
              <CardContent className="px-6 py-14 text-center space-y-3">
                <Archive className="h-10 w-10 mx-auto opacity-25" />
                <p className="text-sm text-muted-foreground break-words max-w-lg mx-auto">
                  {t('prop_empty_archived')}
                </p>
              </CardContent>
            </Card>
          )}

          {properties.length > 0 && (
            <div className="space-y-4">
              {properties.map((property) => (
                <PropertyPanel
                  key={String(property.id)}
                  property={property}
                  intel={intel.get(String(property.id))}
                  onAct={(p, a) => { void act(p, a); }}
                  onConfirm={setPending}
                />
              ))}
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
