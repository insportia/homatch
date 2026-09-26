// src/pages/property/MyPropertiesPage.tsx — MY PROPERTIES.
//
// Everything an owner has uploaded or imported, and everything they can do with it.
//
// WHY THIS PAGE DID NOT EXIST, WHICH IS WORTH WRITING DOWN
//
// The product could CREATE a property four ways — add, import, private listing, the
// developer product — and could show ONE at /property/:id. There was no route that
// answered "what have I got?". An owner with six listings had six bookmarks. Adding
// a property was a one-way trip.
//
// So the missing thing was never a screen. It was the idea that a property has a life
// after upload: a price that changes, photos that get reordered, a listing that sells
// and should go away without being deleted, a campaign that should pause.
//
// THE SHAPE, AND WHY IT IS CARDS AND NOT A TABLE
//
// The functional reference is a listing manager, and listing managers are tables
// because they were designed for a desk. A property is a photograph, a price and a
// place — three things a card shows at a glance and a table row shows worst. On a
// 320px phone a table is a horizontal scroll with the actions off-screen, which is
// precisely where an owner is when they want to pause a listing.
//
// One column on a phone, two from `sm`, three from `xl`. The cover photo leads, the
// price is the largest text, and the actions are a menu rather than a row of icons —
// six icon buttons at 320px is a grid nobody can hit.
//
// THREE VIEWS, BECAUSE THERE ARE THREE ANSWERS
//
//   ACTIVE    what I am working on
//   ARCHIVED  what I am finished with and did not want to delete
//   (deleted) not a view. Deleted is gone from the product.
//
// Archived is a separate view rather than a dimmed row at the bottom: an owner with
// forty archived listings and three live ones should not scroll past last year.
//
// WHAT THE CARD WILL NOT SAY
//
// A match count it has not got, a campaign state it has not read, or a photo it does
// not have. `matchability_score` and `matching_status` are real columns and are shown
// as themselves; a property with no photo shows an honest placeholder rather than a
// stock image of somebody else's building.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive, ArchiveRestore, Building2, Camera, Eye, ImageOff, MapPin, MoreVertical,
  Pause, Pencil, Play, Plus, Telescope, Trash2, Upload,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { PrivateImage } from '@/components/common/PrivateImage';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Property } from '@/types/types';
import {
  type PortfolioView,
  archiveProperty,
  deleteProperty,
  intelligenceActionFor,
  isImported,
  listPortfolio,
  portfolioCounts,
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
  const unit = currency ?? '';
  return `${unit}${value.toLocaleString()}`;
}

/**
 * AN HONEST PLACEHOLDER. Not a stock photograph of a building that is not theirs,
 * which would be the most literal possible lie on this page.
 *
 * Used for BOTH "there is no photo" and "the photo cannot be shown", because from the
 * owner's side those are the same situation: there is nothing to look at. What they
 * must never be confused with is "the photo is still loading".
 */
function NoPhoto({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground/50">
      <ImageOff className="h-7 w-7" />
      <span className="text-[13px] break-words px-2 text-center">{label}</span>
    </div>
  );
}

type PendingAction =
  | { kind: 'DELETE'; property: Property }
  | { kind: 'ARCHIVE'; property: Property }
  | null;

function PropertyCard({
  property, onAct, onConfirm,
}: {
  property: Property;
  onAct: (property: Property, action: 'PUBLISH' | 'PAUSE' | 'UNARCHIVE') => void;
  onConfirm: (pending: PendingAction) => void;
}) {
  const { t } = useLanguage();
  const facts = (Array.isArray(property.facts) ? property.facts[0] : property.facts) as
    Record<string, unknown> | null | undefined;

  const cover = (property.cover_photo_url as string | null)
    ?? (facts?.cover_image as string | null)
    ?? null;
  const price = priceLabel(
    facts?.total_price as number | null, facts?.currency as string | null,
  );
  const perSqm = priceLabel(
    facts?.price_per_sqm as number | null, facts?.currency as string | null,
  );
  const city = (facts?.city as string | null) ?? null;
  const district = (facts?.district as string | null) ?? null;
  const area = facts?.area as number | null;
  const rooms = facts?.rooms as number | null;
  const bedrooms = facts?.bedrooms as number | null;
  const status = String(property.matching_status ?? 'DRAFT');
  const archived = Boolean((property as unknown as { archived_at?: string | null }).archived_at);
  const imported = isImported(property.source_type as string | null);
  const action = intelligenceActionFor(property.transaction_type as string | null);

  return (
    <Card className="bg-card border-border overflow-hidden flex flex-col">
      {/*
        THE COVER, at a fixed aspect so a portfolio of mixed photo sizes does not
        become a ragged column. PrivateImage mints a short-lived signed URL: the
        bucket is private and the column holds a key, not a URL.
      */}
      <div className="relative aspect-[4/3] bg-secondary/40 shrink-0">
        {cover ? (
          <PrivateImage
            src={cover}
            alt={String(property.title ?? t('prop_untitled'))}
            className="h-full w-full object-cover"
            /* Shimmer only while it is genuinely coming. */
            pending={<div className="h-full w-full animate-pulse bg-secondary/60" />}
            /*
             * AND THE HONEST ANSWER WHEN IT IS NOT. The one imported property in
             * production carries an external cover URL from the portal it was read
             * off, and that host does not serve it to us -- so this branch is the
             * common one for imports, not a rare edge. A shimmer here is a photo that
             * is permanently one second away.
             */
            fallback={<NoPhoto label={t('prop_no_photo')} />}
          />
        ) : (
          <NoPhoto label={t('prop_no_photo')} />
        )}

        <div className="absolute top-2 start-2 flex flex-wrap gap-1.5 max-w-[calc(100%-1rem)]">
          {archived ? (
            <Badge variant="secondary" className="gap-1 whitespace-normal">
              <Archive className="h-3 w-3 shrink-0" />
              <span className="break-words">{t('prop_state_archived')}</span>
            </Badge>
          ) : (
            <Badge
              variant={status === 'ACTIVE' ? 'default' : 'secondary'}
              className="whitespace-normal"
            >
              <span className="break-words">{t(`prop_state_${status.toLowerCase()}` as never)}</span>
            </Badge>
          )}
          {/* WHERE IT CAME FROM, stated rather than implied. An imported property is a
              Homatch copy of somebody else's page and the edit screen says so too. */}
          {imported && (
            <Badge variant="outline" className="whitespace-normal bg-background/80">
              <span className="break-words">{t('prop_source_imported')}</span>
            </Badge>
          )}
        </div>
      </div>

      <CardContent className="p-4 space-y-3 flex flex-col flex-1">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground break-words [overflow-wrap:anywhere]">
            {String(property.title ?? t('prop_untitled'))}
          </h3>
          {(city || district) && (
            <div className="flex items-start gap-1 text-xs text-muted-foreground min-w-0">
              <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">
                {[district, city].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
        </div>

        {/* THE PRICE IS THE LARGEST THING, because it is what the owner checks. */}
        <div className="min-w-0">
          {price ? (
            <p className="text-base font-bold text-foreground break-words" dir="ltr">{price}</p>
          ) : (
            <p className="text-sm text-muted-foreground break-words">{t('prop_no_price')}</p>
          )}
          {perSqm && (
            <p className="text-[13px] text-muted-foreground/70 break-words" dir="ltr">
              {perSqm}/m²
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {property.property_type && (
            <span className="text-[13px] bg-secondary px-2 py-0.5 rounded-full text-muted-foreground max-w-full">
              <span className="break-words">
                {t(`prop_type_${String(property.property_type).toLowerCase()}` as never)}
              </span>
            </span>
          )}
          {property.transaction_type && (
            <span className="text-[13px] bg-secondary px-2 py-0.5 rounded-full text-muted-foreground max-w-full">
              <span className="break-words">
                {t(`prop_txn_${String(property.transaction_type).toLowerCase()}` as never)}
              </span>
            </span>
          )}
          {typeof area === 'number' && area > 0 && (
            <span className="text-[13px] bg-secondary px-2 py-0.5 rounded-full text-muted-foreground max-w-full">
              <span className="break-words" dir="ltr">{area} m²</span>
            </span>
          )}
          {typeof rooms === 'number' && rooms > 0 && (
            <span className="text-[13px] bg-secondary px-2 py-0.5 rounded-full text-muted-foreground max-w-full">
              <span className="break-words">{rooms} {t('prop_unit_rooms')}</span>
            </span>
          )}
          {typeof bedrooms === 'number' && bedrooms > 0 && (
            <span className="text-[13px] bg-secondary px-2 py-0.5 rounded-full text-muted-foreground max-w-full">
              <span className="break-words">{bedrooms} {t('prop_unit_bedrooms')}</span>
            </span>
          )}
        </div>

        {/* Pushed to the bottom so cards of different content length line up. */}
        <div className="mt-auto pt-2 border-t border-border/40 space-y-2">
          {/*
            WHAT THIS PROPERTY CAN DO NEXT, and exactly one action rather than a menu.
            A SALE listing finds buyers; a RENT listing finds tenants. Offering both
            means offering one that cannot succeed. Null transaction type shows
            neither, which is the honest answer for a half-finished import.
          */}
          {action && !archived && (
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="w-full justify-start gap-1.5 h-9"
            >
              <Link to={`/property/${property.id}/matches`}>
                <Telescope className="h-4 w-4 shrink-0" />
                <span className="break-words min-w-0">
                  {t(`prop_action_${action.toLowerCase()}` as never)}
                </span>
              </Link>
            </Button>
          )}

          <div className="flex items-center gap-1.5">
            <Button asChild size="sm" variant="outline" className="flex-1 gap-1.5 h-9 min-w-0">
              <Link to={`/property/${property.id}/edit`}>
                <Pencil className="h-3.5 w-3.5 shrink-0" />
                <span className="break-words min-w-0">{t('prop_action_edit')}</span>
              </Link>
            </Button>

            {/*
              A MENU, NOT SIX ICONS. At 320px a row of icon buttons is a target grid
              nobody can hit reliably, and the destructive ones would be next to the
              harmless ones.
            */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 w-9 p-0 shrink-0">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">{t('prop_more_actions')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-[min(18rem,calc(100vw-2rem))]">
                <DropdownMenuItem asChild>
                  <Link to={`/property/${property.id}`} className="gap-2">
                    <Eye className="h-4 w-4 shrink-0" />
                    <span className="break-words">{t('prop_action_view')}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/property/${property.id}/edit#photos`} className="gap-2">
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
      </CardContent>
    </Card>
  );
}

export default function MyPropertiesPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<PortfolioView>('ACTIVE');
  const [properties, setProperties] = useState<Property[]>([]);
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
    } catch (error) {
      /*
       * A PERMISSION FAILURE IS A REAL STATE and is shown as itself. RLS returns an
       * error rather than an empty list when something is wrong, and rendering that
       * as "you have no properties" would tell an owner their portfolio is empty
       * when it is only unreachable.
       */
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [homatchUser?.id, view]);

  useEffect(() => { void load(); }, [load]);

  const act = async (
    property: Property, action: 'PUBLISH' | 'PAUSE' | 'UNARCHIVE',
  ) => {
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
        <div className="max-w-5xl mx-auto space-y-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 space-y-1">
              <h1 className="text-xl font-bold text-foreground break-words">
                {t('prop_page_title')}
              </h1>
              <p className="text-sm text-muted-foreground break-words">
                {t('prop_page_subtitle')}
              </p>
            </div>
            <Button size="sm" onClick={() => navigate('/property/add')} className="shrink-0">
              <Plus className="h-4 w-4 me-1.5 shrink-0" />
              <span className="break-words">{t('prop_add_cta')}</span>
            </Button>
          </div>

          {/* Real counts, from the database, on both tabs. */}
          <Tabs value={view} onValueChange={(next) => setView(next as PortfolioView)}>
            <TabsList className="w-full md:w-auto h-auto flex-wrap">
              <TabsTrigger value="ACTIVE" className="flex-1 md:flex-none whitespace-normal">
                <span className="break-words">{t('prop_tab_active')}</span>
                <Badge variant="secondary" className="ms-1.5 h-4 px-1 text-[13px]">
                  {counts.active}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="ARCHIVED" className="flex-1 md:flex-none whitespace-normal">
                <span className="break-words">{t('prop_tab_archived')}</span>
                <Badge variant="secondary" className="ms-1.5 h-4 px-1 text-[13px]">
                  {counts.archived}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {[0, 1, 2].map((key) => <Skeleton key={key} className="h-80 rounded-xl" />)}
            </div>
          )}

          {failed && (
            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-2 text-center">
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
            product is. An owner who has uploaded nothing needs one fact: matching
            works from a property, so until there is one there is nothing to match.
          */}
          {empty && view === 'ACTIVE' && (
            <Card className="bg-card border-border">
              <CardContent className="p-6 text-center space-y-3">
                <Building2 className="h-10 w-10 mx-auto opacity-30" />
                <p className="text-sm font-medium text-foreground break-words">
                  {t('prop_empty_title')}
                </p>
                <p className="text-sm text-muted-foreground break-words max-w-md mx-auto">
                  {t('prop_empty_body')}
                </p>
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
              <CardContent className="p-6 text-center space-y-2">
                <Archive className="h-9 w-9 mx-auto opacity-30" />
                <p className="text-sm text-muted-foreground break-words">
                  {t('prop_empty_archived')}
                </p>
              </CardContent>
            </Card>
          )}

          {properties.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {properties.map((property) => (
                <PropertyCard
                  key={String(property.id)}
                  property={property}
                  onAct={(p, a) => { void act(p, a); }}
                  onConfirm={setPending}
                />
              ))}
            </div>
          )}
        </div>

        {/*
          BOTH DESTRUCTIVE ACTIONS CONFIRM, and the two dialogs say different things
          because they do different things. Archiving is reversible and the text says
          so; deleting is not offered as reversible, because from the owner's side it
          is not -- the row survives for the ledger's sake and that is not something
          to promise them as a way back.
        */}
        <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
          <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="break-words">
                {pending?.kind === 'DELETE' ? t('prop_confirm_delete_title') : t('prop_confirm_archive_title')}
              </AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                {pending?.kind === 'DELETE' ? t('prop_confirm_delete_body') : t('prop_confirm_archive_body')}
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
                  {pending?.kind === 'DELETE' ? t('prop_action_delete') : t('prop_action_archive')}
                </span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppLayout>
    </RouteGuard>
  );
}
