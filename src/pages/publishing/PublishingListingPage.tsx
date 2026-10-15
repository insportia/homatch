// /publishing/:propertyId — ONE LISTING: edit, preview, and its portal publications.
//
// The property is the source; the listing is the portal-ready copy of it (one per
// property, id = property id). Photos are the property's own gallery — uploading here
// adds to that gallery, so nothing is stored twice.
//
// THE PUBLICATION FLOW, PER PORTAL, AND WHY IT IS A HANDOFF. MyHome.ge and SS.ge offer
// no authorized submission API and gate listing creation behind the owner's own login
// and SMS verification. HOMATCH prepares the copy, the owner posts it on the portal,
// pastes the listing URL back, and the server checks the public page. Only that check
// makes a publication PUBLISHED — never a click here.
//
// The tab lives in the URL (?tab=), so refresh, back and forward land where they were.

import {
  AlertTriangle, Archive, ArrowLeft, Check, Copy, ExternalLink, ImagePlus, Loader2, RefreshCw, RotateCcw, Trash2, Upload,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PrivateImage } from '@/components/common/PrivateImage';
import { RouteGuard } from '@/components/common/RouteGuard';
import { OWNER_SURFACE, PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { MediaWell, OWNER_PRIMARY, OWNER_SECONDARY } from '@/components/owner/portfolio';
import { ListingMark, Panel, PublicationMark, dateTime, useErrorText } from '@/components/publishing/parts';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { isImpersonating } from '@/lib/impersonation';
import { placeName } from '@/lib/placeNames';
import { cn } from '@/lib/utils';
import {
  AMENITIES, CONDITIONS, CURRENCIES, DEAL_TYPES, PROPERTY_TYPES,
  type EventRow, type ListingDraft, type PortalId, type PortalInfo, type Problem, type PublicationRow,
  draftFromProperty, handoffText, isOutdated,
} from '@/publishing/model';
import { uploadPropertyPhoto } from '@/services/api';
import { allPhotos, attachPhoto, readProperty } from '@/services/propertyManagement';
import * as api from '@/services/publishing';
import { resolveImageSrc } from '@/services/storage/images';
import type { Property, PropertyPhoto } from '@/types/types';

type Tab = 'listing' | 'preview' | 'portals';
const TABS: Tab[] = ['listing', 'preview', 'portals'];
const INPUT = 'h-10 w-full min-w-0 rounded-lg border border-border bg-[hsl(var(--card))] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[hsl(var(--gold-border))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--gold))]/25 aria-[invalid=true]:border-red-400';
const MAX_UPLOAD = 20 * 1024 * 1024;

function Editor() {
  const { propertyId = '' } = useParams();
  const { homatchUser } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const locale = intlLocaleFor(lang);
  const [params, setParams] = useSearchParams();
  const readOnly = isImpersonating();

  const [property, setProperty] = useState<Property | null>(null);
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);
  const [portals, setPortals] = useState<PortalInfo[]>([]);
  const [detail, setDetail] = useState<api.ListingDetail | null>(null);
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [confirm, setConfirm] = useState<null | { kind: 'archive' | 'delete' } | { kind: 'unpublish'; portal: PortalInfo }>(null);
  const autoChecked = useRef(false);

  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : (detail?.listing.validation.ready ? 'portals' : 'listing');
  const setTab = (next: Tab) => { const p = new URLSearchParams(params); p.set('tab', next); setParams(p); };

  const adopt = useCallback((d: api.ListingDetail | null) => {
    setDetail(d);
    if (d) { setDraft(d.listing.payload); setDirty(false); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [p, gallery, ws, d] = await Promise.all([readProperty(propertyId), allPhotos(propertyId), api.loadWorkspace(), api.loadListing(propertyId)]);
      if (!p || p.user_id !== homatchUser?.id) { setLoadError('OWNED_PROPERTY_REQUIRED'); return; }
      setProperty(p);
      setPhotos(gallery);
      setPortals(ws.portals);
      if (d) adopt(d);
      else { setDetail(null); setDraft(draftFromProperty({ ...p, photos: gallery }, homatchUser?.full_name ?? '')); setDirty(true); }
    } catch (e) {
      setLoadError(e instanceof api.PublishingError ? e.code : 'NETWORK_ERROR');
    } finally {
      setLoading(false);
    }
  }, [propertyId, homatchUser?.id, homatchUser?.full_name, adopt]);
  useEffect(() => { void load(); }, [load]);

  /* Unsaved edits survive an accidental tab close only if the browser is asked. */
  useEffect(() => {
    if (!dirty || !detail) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, detail]);

  /* A verification that is due finishes itself when the owner looks — once per visit. */
  useEffect(() => {
    if (!detail || autoChecked.current || readOnly) return;
    autoChecked.current = true;
    const due = detail.publications.filter((p) => p.status === 'VERIFYING' && (!p.next_check_at || Date.parse(p.next_check_at) <= Date.now()));
    (async () => {
      for (const p of due) {
        try { adopt(await api.checkPublication(propertyId, p.portal_id)); } catch { /* shown on the card */ }
      }
    })();
  }, [detail, readOnly, propertyId, adopt]);

  const update = <K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (!draft || readOnly) return false;
    setSaving(true);
    try {
      const next = await api.saveListing(propertyId, detail?.listing.version ?? 0, draft);
      adopt(next);
      toast.success(next.listing.validation.ready ? t('pubw_saved_ready') : t('pubw_saved_draft'));
      return true;
    } catch (e) {
      toast.error(errorText(e instanceof api.PublishingError ? e.code : 'NETWORK_ERROR'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const act = async (key: string, run: () => Promise<api.ListingDetail>) => {
    setBusy(key);
    try { adopt(await run()); } catch (e) {
      if (e instanceof api.PublishingError && e.code === 'CHECK_TOO_SOON' && e.retryAt) toast.message(t('pubw_err_check_too_soon_at', { when: dateTime(e.retryAt, locale) }));
      else toast.error(errorText(e instanceof api.PublishingError ? e.code : 'NETWORK_ERROR'));
    } finally { setBusy(null); }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files || !homatchUser?.id || !draft || readOnly) return;
    const chosen = [...files].slice(0, 12);
    setUploading(chosen.length);
    const added: string[] = [];
    for (const file of chosen) {
      try {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(t('pubw_err_photo_format'));
        if (file.size > MAX_UPLOAD) throw new Error(t('pubw_err_photo_size'));
        const key = await uploadPropertyPhoto(homatchUser.id, propertyId, file);
        added.push(await attachPhoto({ propertyId, storagePath: key, originalFilename: file.name, fileSize: file.size }));
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    if (added.length) {
      setPhotos(await allPhotos(propertyId));
      update('photos', [...draft.photos, ...added]);
    }
  };

  const problems = detail?.listing.validation;
  const fieldProblem = (field: string): Problem | undefined => problems?.listing.find((p) => p.field === field);
  const pubFor = (id: PortalId) => detail?.publications.find((p) => p.portal_id === id) ?? null;
  const live = (detail?.publications ?? []).some((p) => ['VERIFYING', 'PUBLISHED', 'UNPUBLISH_REQUESTED'].includes(p.status));

  if (loading) return <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-6 sm:px-6"><Skeleton className="h-28 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div>;
  if (loadError || !draft || !property) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorText(loadError || 'NETWORK_ERROR')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} className={OWNER_SECONDARY}>{t('pubw_retry')}</button>
          <Link to="/publishing" className={OWNER_SECONDARY}>{t('pubw_back_to_workspace')}</Link>
        </div>
      </div>
    );
  }

  const ref = property.homatch_id != null ? `#${String(property.homatch_id).padStart(6, '0')}` : null;
  const archived = !!detail?.listing.archived_at;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6">
      <nav aria-label={t('pubw_breadcrumb')} className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <Link to="/publishing" className="inline-flex items-center gap-1 font-semibold hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />{t('nav_publishing')}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="min-w-0 truncate">{draft.title || property.title || t('pubw_untitled')}</span>
      </nav>

      <PageHero
        compact
        eyebrow={[ref, placeName(draft.city, lang)].filter(Boolean).join(' · ') || null}
        title={draft.title || property.title || t('pubw_untitled')}
        subtitle={detail ? null : t('pubw_new_listing_hint')}
        actions={
          <Link to={`/property/${property.id}`} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-white/40 bg-white/10 px-3.5 py-1.5 text-2xs font-semibold text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <span className="break-words text-start">{t('pubw_open_property')}</span>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {detail ? <ListingMark ready={detail.listing.validation.ready} archived={archived} /> : <ListingMark ready={false} archived={false} />}
        {detail ? <span className="text-2xs text-muted-foreground">{t('pubw_version', { n: detail.listing.version })} · {t('pubw_updated', { when: dateTime(detail.listing.updated_at, locale) })}</span> : null}
        {readOnly ? <span className="text-2xs font-semibold text-amber-700">{t('pubw_read_only')}</span> : null}
      </div>

      <div role="tablist" aria-label={t('pubw_sections')} className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-[hsl(var(--card))] p-1">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`pubw-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`pubw-panel-${id}`}
            onClick={() => setTab(id)}
            className={cn('min-h-10 rounded-lg px-2 text-2xs font-semibold transition-colors sm:text-sm',
              tab === id ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}
          >
            {t(`pubw_tab_${id}`)}
          </button>
        ))}
      </div>

      {problems && !problems.ready && tab !== 'preview' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">{t('pubw_missing_title', { n: problems.listing.length })}</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs">
            {problems.listing.map((p) => <li key={`${p.field}-${p.code}`}>{t(`pubw_field_${p.field.replace('.', '_').toLowerCase()}`)}: {t(`pubw_problem_${p.code.toLowerCase()}`)}</li>)}
          </ul>
        </div>
      ) : null}

      <div role="tabpanel" id={`pubw-panel-${tab}`} aria-labelledby={`pubw-tab-${tab}`} className="space-y-4">
        {tab === 'listing' ? (
          <ListingForm draft={draft} update={update} photos={photos} fieldProblem={fieldProblem} portals={portals}
            addPhotos={addPhotos} uploading={uploading} readOnly={readOnly || archived} />
        ) : tab === 'preview' ? (
          <Preview draft={draft} photos={photos} locale={locale} />
        ) : (
          <div className="space-y-4">
            {!detail ? (
              <Panel><p className="text-sm text-muted-foreground">{t('pubw_save_first')}</p></Panel>
            ) : portals.map((portal) => (
              <PortalCard key={portal.id} portal={portal} pub={pubFor(portal.id)} detail={detail} draft={draft} photos={photos}
                dirty={dirty} busy={busy} readOnly={readOnly || archived} locale={locale}
                onPrepare={() => act(`prepare-${portal.id}`, () => api.preparePublication(propertyId, portal.id))}
                onLink={(url) => act(`link-${portal.id}`, () => api.linkPublication(propertyId, portal.id, url))}
                onCheck={() => act(`check-${portal.id}`, () => api.checkPublication(propertyId, portal.id))}
                onRetry={() => act(`retry-${portal.id}`, () => api.retryPublication(propertyId, portal.id))}
                onUnpublish={() => setConfirm({ kind: 'unpublish', portal })}
                onConfirmRemoved={() => act(`removed-${portal.id}`, () => api.confirmRemoved(propertyId, portal.id))}
                onMarkUpdated={() => act(`updated-${portal.id}`, () => api.markPortalUpdated(propertyId, portal.id))}
                onEdit={() => setTab('listing')}
              />
            ))}
            {detail ? <History events={detail.events} portals={portals} locale={locale} /> : null}
            {detail && !readOnly ? (
              <Panel title={t('pubw_manage_listing')}>
                <p className="mb-3 text-2xs text-muted-foreground">{t(live ? 'pubw_manage_live_note' : 'pubw_manage_note')}</p>
                <div className="flex flex-wrap gap-2">
                  {archived ? (
                    <button type="button" className={OWNER_SECONDARY} disabled={busy !== null} onClick={() => act('restore', () => api.restoreListing(propertyId))}>
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('pubw_restore')}
                    </button>
                  ) : (
                    <button type="button" className={OWNER_SECONDARY} disabled={live || busy !== null} onClick={() => setConfirm({ kind: 'archive' })}>
                      <Archive className="h-4 w-4" aria-hidden="true" />{t('pubw_archive')}
                    </button>
                  )}
                  <button type="button" className={cn(OWNER_SECONDARY, 'text-red-700')} disabled={live || busy !== null} onClick={() => setConfirm({ kind: 'delete' })}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />{t('pubw_delete')}
                  </button>
                </div>
              </Panel>
            ) : null}
          </div>
        )}
      </div>

      {!readOnly && !archived ? (
        <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 rounded-xl border border-border bg-[hsl(var(--card))]/95 px-3 py-2.5 shadow-hover backdrop-blur pe-16 md:bottom-3 md:px-4 md:pe-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-2xs text-muted-foreground" aria-live="polite">{dirty ? t('pubw_unsaved') : t('pubw_all_saved')}</span>
            <div className="flex flex-wrap gap-2">
              {tab !== 'preview' ? <button type="button" className={OWNER_SECONDARY} onClick={() => setTab('preview')}>{t('pubw_tab_preview')}</button> : null}
              <button type="button" className={OWNER_PRIMARY} disabled={saving || (!dirty && !!detail)} onClick={() => void save()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                {t('pubw_save_draft')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'unpublish' ? t('pubw_unpublish_title', { portal: confirm.portal.name }) : t(confirm?.kind === 'delete' ? 'pubw_delete_title' : 'pubw_archive_title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'unpublish' ? t('pubw_unpublish_body', { portal: confirm.portal.name }) : t(confirm?.kind === 'delete' ? 'pubw_delete_body' : 'pubw_archive_body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('pubw_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const c = confirm;
                setConfirm(null);
                if (!c) return;
                if (c.kind === 'unpublish') await act(`unpublish-${c.portal.id}`, () => api.unpublishPublication(propertyId, c.portal.id));
                else if (c.kind === 'archive') await act('archive', () => api.archiveListing(propertyId));
                else {
                  try { await api.deleteListing(propertyId); toast.success(t('pubw_deleted')); navigate('/publishing'); } catch (e) { toast.error(errorText(e instanceof api.PublishingError ? e.code : 'NETWORK_ERROR')); }
                }
              }}
            >
              {confirm?.kind === 'unpublish' ? t('pubw_unpublish_confirm') : t(confirm?.kind === 'delete' ? 'pubw_delete' : 'pubw_archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── The form ─────────────────────────────────────────────────────────── */

function Field({ label, problem, children, hint, wide }: { label: string; problem?: Problem; children: React.ReactNode; hint?: string; wide?: boolean }) {
  const { t } = useLanguage();
  return (
    <label className={cn('block min-w-0 space-y-1', wide && 'sm:col-span-2')}>
      <span className="block text-2xs font-semibold text-foreground">{label}</span>
      {children}
      {problem ? <span className="block text-2xs font-medium text-red-700">{t(`pubw_problem_${problem.code.toLowerCase()}`)}</span>
        : hint ? <span className="block text-2xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function ListingForm({ draft, update, photos, fieldProblem, portals, addPhotos, uploading, readOnly }: {
  draft: ListingDraft;
  update: <K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) => void;
  photos: PropertyPhoto[];
  fieldProblem: (field: string) => Problem | undefined;
  portals: PortalInfo[];
  addPhotos: (files: FileList | null) => void;
  uploading: number;
  readOnly: boolean;
}) {
  const { t } = useLanguage();
  const [descLang, setDescLang] = useState<'ka' | 'en' | 'ru'>('ka');
  const numeric = (key: keyof ListingDraft) => ({
    type: 'number' as const,
    inputMode: 'decimal' as const,
    min: key === 'floor' ? -5 : 0,
    value: (draft[key] as number | null) ?? '',
    'aria-invalid': !!fieldProblem(String(key)),
    disabled: readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => update(key, (e.target.value === '' ? null : Number(e.target.value)) as never),
    className: INPUT,
  });
  const textInput = (key: keyof ListingDraft, max = 140) => ({
    value: String(draft[key] ?? ''),
    maxLength: max,
    'aria-invalid': !!fieldProblem(String(key)),
    disabled: readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => update(key, e.target.value as never),
    className: INPUT,
  });
  const byId = new Map(photos.map((p) => [p.id, p]));
  const selected = draft.photos.filter((id) => byId.has(id));
  const unselected = photos.filter((p) => !selected.includes(p.id));
  const move = (i: number, d: -1 | 1) => {
    const next = [...selected];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    update('photos', next);
  };
  const myhomeMax = portals.find((p) => p.id === 'myhome')?.maxPhotos ?? null;

  return (
    <>
      <Panel title={t('pubw_sec_basics')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('pubw_field_title')} problem={fieldProblem('title')} wide><input {...textInput('title', 140)} /></Field>
          <Field label={t('pubw_field_propertytype')} problem={fieldProblem('propertyType')}>
            <select className={INPUT} value={draft.propertyType} disabled={readOnly} aria-invalid={!!fieldProblem('propertyType')} onChange={(e) => update('propertyType', e.target.value)}>
              <option value="">—</option>
              {PROPERTY_TYPES.map((v) => <option key={v} value={v}>{t(`prop_type_${v.toLowerCase()}`)}</option>)}
            </select>
          </Field>
          <Field label={t('pubw_field_dealtype')} problem={fieldProblem('dealType')}>
            <select className={INPUT} value={draft.dealType} disabled={readOnly} aria-invalid={!!fieldProblem('dealType')} onChange={(e) => update('dealType', e.target.value)}>
              <option value="">—</option>
              {DEAL_TYPES.map((v) => <option key={v} value={v}>{t(`pubw_deal_${v.toLowerCase()}`)}</option>)}
            </select>
          </Field>
          <Field label={t('pubw_field_condition')}>
            <select className={INPUT} value={draft.condition} disabled={readOnly} onChange={(e) => update('condition', e.target.value)}>
              <option value="">—</option>
              {CONDITIONS.map((v) => <option key={v} value={v}>{t(`prop_condition_${v.toLowerCase()}`)}</option>)}
            </select>
          </Field>
        </div>
      </Panel>

      <Panel title={t('pubw_sec_price')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t('pubw_field_price')} problem={fieldProblem('price')}><input {...numeric('price')} /></Field>
          <Field label={t('pubw_field_currency')}>
            <select className={INPUT} value={draft.currency} disabled={readOnly} onChange={(e) => update('currency', e.target.value)}>
              {CURRENCIES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label={t('pubw_field_area')} problem={fieldProblem('area')}><input {...numeric('area')} /></Field>
          <Field label={t('pubw_field_rooms')} problem={fieldProblem('rooms')}><input {...numeric('rooms')} /></Field>
          <Field label={t('pubw_field_bedrooms')} problem={fieldProblem('bedrooms')}><input {...numeric('bedrooms')} /></Field>
          <Field label={t('pubw_field_bathrooms')} problem={fieldProblem('bathrooms')}><input {...numeric('bathrooms')} /></Field>
          <Field label={t('pubw_field_floor')} problem={fieldProblem('floor')}><input {...numeric('floor')} /></Field>
          <Field label={t('pubw_field_totalfloors')} problem={fieldProblem('totalFloors')}><input {...numeric('totalFloors')} /></Field>
        </div>
      </Panel>

      <Panel title={t('pubw_sec_location')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('pubw_field_city')} problem={fieldProblem('city')}><input {...textInput('city', 80)} /></Field>
          <Field label={t('pubw_field_district')}><input {...textInput('district', 80)} /></Field>
          <Field label={t('pubw_field_street')} problem={fieldProblem('street')}><input {...textInput('street', 120)} /></Field>
          <Field label={t('pubw_field_streetnumber')}><input {...textInput('streetNumber', 20)} /></Field>
        </div>
      </Panel>

      <Panel
        title={t('pubw_sec_description')}
        aside={
          <div role="tablist" aria-label={t('pubw_sec_description')} className="flex gap-1">
            {(['ka', 'en', 'ru'] as const).map((l) => (
              <button key={l} type="button" role="tab" aria-selected={descLang === l} onClick={() => setDescLang(l)}
                className={cn('min-h-8 whitespace-nowrap rounded-md border px-2.5 text-2xs font-semibold', descLang === l ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]' : 'border-border text-muted-foreground')}>
                {t(`pubw_desc_lang_${l}`)}{draft.description[l] ? ' ✓' : ''}
              </button>
            ))}
          </div>
        }
      >
        <textarea
          value={draft.description[descLang]}
          onChange={(e) => update('description', { ...draft.description, [descLang]: e.target.value })}
          rows={7}
          maxLength={6000}
          disabled={readOnly}
          dir={descLang === 'ka' || descLang === 'en' || descLang === 'ru' ? 'ltr' : undefined}
          aria-label={t('pubw_sec_description')}
          aria-invalid={!!fieldProblem('description')}
          className={cn(INPUT, 'h-auto py-2 leading-relaxed')}
        />
        <p className="mt-1 flex flex-wrap justify-between gap-2 text-2xs text-muted-foreground">
          <span>{fieldProblem('description') ? <span className="font-medium text-red-700">{t('pubw_problem_required')}</span> : t('pubw_desc_hint')}</span>
          <span className="tabular-nums">{draft.description[descLang].length}/6000</span>
        </p>
      </Panel>

      <Panel
        title={t('pubw_sec_photos')}
        aside={<span className="text-2xs text-muted-foreground">{t('pubw_photos_count', { n: selected.length })}{myhomeMax ? ` · ${t('pubw_photos_myhome_max', { n: myhomeMax })}` : ''}</span>}
      >
        {fieldProblem('photos') ? <p className="mb-2 text-2xs font-medium text-red-700">{t('pubw_problem_photo_required')}</p> : null}
        {selected.length ? (
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {selected.map((id, i) => {
              const photo = byId.get(id)!;
              return (
                <li key={id} className="min-w-0 overflow-hidden rounded-lg border border-border">
                  <MediaWell hasMedia>
                    <PrivateImage src={photo.storage_path || photo.public_url} alt="" className="absolute inset-0 h-full w-full object-cover" pending={<div className="absolute inset-0 animate-pulse bg-[hsl(var(--secondary))]" />} />
                    {i === 0 ? <span className="absolute start-1.5 top-1.5 rounded bg-[#0C1119]/85 px-1.5 py-0.5 text-2xs font-semibold text-white">{t('pubw_cover')}</span> : null}
                  </MediaWell>
                  <div className="flex items-center justify-between gap-1 p-1">
                    <span className="flex gap-1">
                      <button type="button" disabled={readOnly || i === 0} onClick={() => move(i, -1)} aria-label={t('pubw_photo_earlier')} className="grid h-8 w-8 place-items-center rounded-md border border-border text-sm disabled:opacity-40"><span aria-hidden="true" className="rtl:-scale-x-100">←</span></button>
                      <button type="button" disabled={readOnly || i === selected.length - 1} onClick={() => move(i, 1)} aria-label={t('pubw_photo_later')} className="grid h-8 w-8 place-items-center rounded-md border border-border text-sm disabled:opacity-40"><span aria-hidden="true" className="rtl:-scale-x-100">→</span></button>
                    </span>
                    <button type="button" disabled={readOnly} onClick={() => update('photos', selected.filter((x) => x !== id))} className="min-h-8 rounded-md px-2 text-2xs font-semibold text-muted-foreground hover:text-red-700">{t('pubw_photo_exclude')}</button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
        {unselected.length ? (
          <div className="mt-3">
            <p className="mb-1.5 text-2xs font-semibold text-muted-foreground">{t('pubw_photos_not_included')}</p>
            <ul className="flex flex-wrap gap-2">
              {unselected.map((p) => (
                <li key={p.id}>
                  <button type="button" disabled={readOnly} onClick={() => update('photos', [...selected, p.id])} className="group relative block h-16 w-24 overflow-hidden rounded-md border border-dashed border-border" aria-label={t('pubw_photo_include')}>
                    <PrivateImage src={p.storage_path || p.public_url} alt="" className="h-full w-full object-cover opacity-60 group-hover:opacity-100" />
                    <span className="absolute inset-0 grid place-items-center text-lg font-bold text-white drop-shadow" aria-hidden="true">+</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <label className={cn(OWNER_SECONDARY, 'mt-3 cursor-pointer', readOnly && 'pointer-events-none opacity-50')}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
          {uploading ? t('pubw_uploading', { n: uploading }) : t('pubw_upload_photos')}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={readOnly || uploading > 0} onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
        </label>
        <p className="mt-1.5 text-2xs text-muted-foreground">{t('pubw_photos_hint')}</p>
      </Panel>

      <Panel title={t('pubw_sec_amenities')}>
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map((a) => {
            const on = draft.amenities.includes(a);
            return (
              <button key={a} type="button" aria-pressed={on} disabled={readOnly}
                onClick={() => update('amenities', on ? draft.amenities.filter((x) => x !== a) : [...draft.amenities, a])}
                className={cn('min-h-9 rounded-full border px-3 text-2xs font-semibold transition-colors', on ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {on ? '✓ ' : ''}{t(`pubw_amenity_${a}`)}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title={t('pubw_sec_contact')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('pubw_field_contactname')} problem={fieldProblem('contactName')}><input {...textInput('contactName', 80)} autoComplete="name" /></Field>
          <Field label={t('pubw_field_contactphone')} problem={fieldProblem('contactPhone')} hint={t('pubw_phone_private')}>
            <input {...textInput('contactPhone', 32)} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" />
          </Field>
        </div>
      </Panel>

      <Panel title={t('pubw_sec_settings')}>
        <div className="space-y-2">
          {portals.map((p) => {
            const on = draft.portalTargets.includes(p.id);
            return (
              <label key={p.id} className="flex min-w-0 items-start gap-3 rounded-lg border border-border p-3">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(38_92%_50%)]" checked={on} disabled={readOnly}
                  onChange={() => update('portalTargets', on ? draft.portalTargets.filter((x) => x !== p.id) : [...draft.portalTargets, p.id])} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{p.name}</span>
                  <span className="block text-2xs text-muted-foreground">{t('pubw_portal_mode_manual')}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Panel>
    </>
  );
}

/* ── Preview ──────────────────────────────────────────────────────────── */

function Preview({ draft, photos, locale }: { draft: ListingDraft; photos: PropertyPhoto[]; locale: string }) {
  const { t, lang } = useLanguage();
  const byId = new Map(photos.map((p) => [p.id, p]));
  const shown = draft.photos.map((id) => byId.get(id)).filter(Boolean) as PropertyPhoto[];
  const [active, setActive] = useState(0);
  const [descLang, setDescLang] = useState<'ka' | 'en' | 'ru'>(draft.description.ka ? 'ka' : draft.description.en ? 'en' : 'ru');
  const facts: Array<[string, string | null]> = [
    [t('pubw_field_area'), draft.area ? `${draft.area} m²` : null],
    [t('pubw_field_rooms'), draft.rooms != null ? String(draft.rooms) : null],
    [t('pubw_field_bedrooms'), draft.bedrooms != null ? String(draft.bedrooms) : null],
    [t('pubw_field_bathrooms'), draft.bathrooms != null ? String(draft.bathrooms) : null],
    [t('pubw_field_floor'), draft.floor != null ? (draft.totalFloors ? `${draft.floor} / ${draft.totalFloors}` : String(draft.floor)) : null],
    [t('pubw_field_condition'), draft.condition ? t(`prop_condition_${draft.condition.toLowerCase()}`) : null],
  ];
  const cover = shown[Math.min(active, Math.max(0, shown.length - 1))];
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--card))] shadow-card" aria-label={t('pubw_tab_preview')}>
      <p className="border-b border-border bg-[hsl(var(--secondary))] px-4 py-2 text-2xs text-muted-foreground">{t('pubw_preview_note')}</p>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <MediaWell hasMedia={!!cover} ratio="tall">
            {cover ? <PrivateImage src={cover.storage_path || cover.public_url} alt={draft.title} className="absolute inset-0 h-full w-full object-cover" pending={<div className="absolute inset-0 animate-pulse bg-[hsl(var(--secondary))]" />} /> : null}
          </MediaWell>
          {shown.length > 1 ? (
            <div className="flex gap-1.5 overflow-x-auto p-2">
              {shown.map((p, i) => (
                <button key={p.id} type="button" onClick={() => setActive(i)} aria-label={t('pubw_photo_n', { n: i + 1 })} aria-current={i === active}
                  className={cn('h-12 w-16 shrink-0 overflow-hidden rounded-md border-2', i === active ? 'border-[hsl(var(--gold))]' : 'border-transparent')}>
                  <PrivateImage src={p.storage_path || p.public_url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="min-w-0 space-y-3 p-4 sm:p-5">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--gold-ink))]">
            {[draft.dealType ? t(`pubw_deal_${draft.dealType.toLowerCase()}`) : null, draft.propertyType ? t(`prop_type_${draft.propertyType.toLowerCase()}`) : null].filter(Boolean).join(' · ')}
          </p>
          <h2 className="font-display text-xl font-bold leading-tight text-foreground break-words">{draft.title || t('pubw_untitled')}</h2>
          <p className="font-display text-2xl font-bold tabular-nums text-foreground">{draft.price ? formatMoney(draft.price, draft.currency, locale) : '—'}</p>
          <p className="text-sm text-muted-foreground break-words">{[draft.street && [draft.street, draft.streetNumber].filter(Boolean).join(' '), draft.district, placeName(draft.city, lang)].filter(Boolean).join(', ') || '—'}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 sm:grid-cols-3">
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-2xs text-muted-foreground">{k}</dt><dd className="text-sm font-semibold text-foreground break-words">{v}</dd></div>
            ))}
          </dl>
          {draft.amenities.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {draft.amenities.map((a) => <li key={a} className="rounded-full border border-border px-2.5 py-1 text-2xs text-foreground">{t(`pubw_amenity_${a}`)}</li>)}
            </ul>
          ) : null}
          <div className="border-t border-border pt-3">
            <p className="text-2xs text-muted-foreground">{t('pubw_sec_contact')}</p>
            <p className="text-sm font-semibold text-foreground">{draft.contactName || '—'} <span dir="ltr" className="font-normal tabular-nums text-muted-foreground">{draft.contactPhone}</span></p>
          </div>
        </div>
      </div>
      <div className="border-t border-border p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap gap-1">
          {(['ka', 'en', 'ru'] as const).filter((l) => draft.description[l]).map((l) => (
            <button key={l} type="button" onClick={() => setDescLang(l)} aria-pressed={descLang === l}
              className={cn('min-h-8 rounded-md border px-2.5 text-2xs font-semibold', descLang === l ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]' : 'border-border text-muted-foreground')}>
              {t(`pubw_desc_lang_${l}`)}
            </button>
          ))}
        </div>
        <p dir="ltr" className="whitespace-pre-line text-sm leading-relaxed text-foreground break-words">{draft.description[descLang] || t('pubw_no_description')}</p>
      </div>
    </article>
  );
}

/* ── One portal ───────────────────────────────────────────────────────── */

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useLanguage();
  const [done, setDone] = useState(false);
  return (
    <button type="button" disabled={!value} className={cn(OWNER_SECONDARY, 'min-h-9')}
      onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); window.setTimeout(() => setDone(false), 1500); } catch { toast.error(t('pubw_copy_failed')); } }}>
      {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      <span className="break-words text-start">{done ? t('pubw_copied') : label}</span>
    </button>
  );
}

function PhotoLinks({ ids, photos }: { ids: string[]; photos: PropertyPhoto[] }) {
  const { t } = useLanguage();
  const byId = new Map(photos.map((p) => [p.id, p]));
  const open = async (p: PropertyPhoto) => {
    const url = await resolveImageSrc(p.storage_path || p.public_url);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else toast.error(t('pubw_photo_unavailable'));
  };
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ids.map((id) => byId.get(id)).filter(Boolean).map((p, i) => (
        <li key={p!.id}>
          <button type="button" onClick={() => void open(p!)} className="group relative block h-14 w-20 overflow-hidden rounded-md border border-border" aria-label={t('pubw_photo_open_n', { n: i + 1 })}>
            <PrivateImage src={p!.storage_path || p!.public_url} alt="" className="h-full w-full object-cover" />
            <span className="absolute bottom-0.5 end-0.5 rounded bg-[#0C1119]/80 px-1 text-2xs font-semibold text-white">{i + 1}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PortalCard(props: {
  portal: PortalInfo; pub: PublicationRow | null; detail: api.ListingDetail; draft: ListingDraft; photos: PropertyPhoto[];
  dirty: boolean; busy: string | null; readOnly: boolean; locale: string;
  onPrepare: () => void; onLink: (url: string) => void; onCheck: () => void; onRetry: () => void; onUnpublish: () => void;
  onConfirmRemoved: () => void; onMarkUpdated: () => void; onEdit: () => void;
}) {
  const { portal, pub, detail, draft, photos, dirty, busy, readOnly, locale } = props;
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [url, setUrl] = useState(pub?.external_url ?? '');
  useEffect(() => { setUrl(pub?.external_url ?? ''); }, [pub?.external_url]);
  const v = detail.listing.validation;
  const blockers = [...v.listing, ...(v.portals[portal.id] ?? [])];
  const status = pub?.status ?? null;
  const working = (k: string) => busy === `${k}-${portal.id}`;
  const canPrepare = !status || ['UNPUBLISHED', 'REMOVED_EXTERNALLY'].includes(status);
  const handoff = status === 'HANDOFF_READY' || status === 'VERIFICATION_FAILED' || status === 'VERIFYING';
  const tooSoon = !!pub?.next_check_at && Date.parse(pub.next_check_at) > Date.now();
  const copyLang: 'ka' | 'en' | 'ru' = draft.description.ka ? 'ka' : draft.description.en ? 'en' : 'ru';
  const address = [draft.street, draft.streetNumber].filter(Boolean).join(' ');
  const selected = draft.portalTargets.includes(portal.id);

  return (
    <Panel
      title={portal.name}
      aside={<span className="flex flex-wrap items-center gap-2">{!selected ? <span className="text-2xs text-muted-foreground">{t('pubw_portal_not_selected')}</span> : null}<PublicationMark status={status} /></span>}
    >
      <p className="-mt-1 mb-3 text-2xs text-muted-foreground">{t('pubw_portal_mode_manual')}</p>

      {pub?.last_error && status !== 'PUBLISHED' ? (
        <p className={cn('mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-2xs', status === 'VERIFICATION_FAILED' || status === 'REMOVED_EXTERNALLY' ? 'bg-red-50 text-red-800' : 'bg-sky-50 text-sky-900')}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{errorText(pub.last_error)}</span>
        </p>
      ) : null}

      {pub && isOutdated(pub, detail.listing) ? (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-2xs text-amber-900">
          <p className="font-semibold">{t('pubw_outdated_title', { portal: portal.name })}</p>
          <p>{t('pubw_outdated_body', { portal: portal.name })}</p>
          {!readOnly ? <button type="button" className={cn(OWNER_SECONDARY, 'mt-2 min-h-9')} disabled={busy !== null} onClick={props.onMarkUpdated}>{working('updated') ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}{t('pubw_mark_updated')}</button> : null}
        </div>
      ) : null}

      {pub?.external_url ? (
        <dl className="mb-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-2xs sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">{t('pubw_publication_url')}</dt>
            <dd><a href={pub.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-semibold text-[hsl(var(--gold-ink))] hover:underline" dir="ltr"><span className="truncate">{pub.external_url}</span><ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /></a></dd></div>
          <div><dt className="text-muted-foreground">{t('pubw_external_id')}</dt><dd className="font-semibold tabular-nums text-foreground">{pub.external_id}</dd></div>
          <div><dt className="text-muted-foreground">{t('pubw_published_at')}</dt><dd className="font-semibold text-foreground">{dateTime(pub.published_at, locale)}</dd></div>
          <div><dt className="text-muted-foreground">{t('pubw_last_sync')}</dt><dd className="font-semibold text-foreground">{dateTime(pub.last_checked_at, locale)}</dd></div>
          <div><dt className="text-muted-foreground">{t('pubw_next_check')}</dt><dd className="font-semibold text-foreground">{dateTime(pub.next_check_at, locale)}</dd></div>
        </dl>
      ) : null}

      {readOnly ? null : canPrepare ? (
        blockers.length || dirty ? (
          <div className="space-y-2">
            <p className="text-2xs text-muted-foreground">{dirty ? t('pubw_save_before_publish') : t('pubw_blocked', { n: blockers.length })}</p>
            {blockers.length ? <ul className="list-inside list-disc text-2xs text-red-700">{blockers.map((p) => <li key={`${p.field}-${p.code}`}>{t(`pubw_field_${p.field.replace('.', '_').toLowerCase()}`)}: {t(`pubw_problem_${p.code.toLowerCase()}`)}</li>)}</ul> : null}
            <button type="button" className={OWNER_SECONDARY} onClick={props.onEdit}>{t('pubw_fix_in_editor')}</button>
          </div>
        ) : (
          <button type="button" className={OWNER_PRIMARY} disabled={busy !== null} onClick={props.onPrepare}>
            {working('prepare') ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
            {t('pubw_prepare', { portal: portal.name })}
          </button>
        )
      ) : null}

      {!readOnly && handoff ? (
        <ol className="space-y-3">
          <li className="rounded-lg border border-border p-3">
            <p className="mb-2 text-2xs font-semibold text-foreground"><span className="me-1.5 text-[hsl(var(--gold-ink))]">1</span>{t('pubw_step_copy')}</p>
            <div className="flex flex-wrap gap-1.5">
              <CopyButton label={t('pubw_copy_title')} value={draft.title} />
              <CopyButton label={t('pubw_copy_description')} value={handoffText(draft, copyLang).split('\n').slice(2).join('\n')} />
              <CopyButton label={t('pubw_copy_price')} value={draft.price ? String(draft.price) : ''} />
              <CopyButton label={t('pubw_copy_address')} value={address} />
              <CopyButton label={t('pubw_copy_phone')} value={draft.contactPhone} />
              <CopyButton label={t('pubw_copy_all')} value={[handoffText(draft, copyLang), '', `${t('pubw_field_price')}: ${draft.price ?? ''} ${draft.currency}`, `${t('pubw_field_area')}: ${draft.area ?? ''} m²`, `${t('pubw_field_city')}: ${draft.city}`, `${t('pubw_field_street')}: ${address}`, `${t('pubw_sec_contact')}: ${draft.contactName} ${draft.contactPhone}`].join('\n')} />
            </div>
          </li>
          <li className="rounded-lg border border-border p-3">
            <p className="mb-2 text-2xs font-semibold text-foreground"><span className="me-1.5 text-[hsl(var(--gold-ink))]">2</span>{t('pubw_step_photos', { n: draft.photos.length })}</p>
            <PhotoLinks ids={draft.photos} photos={photos} />
          </li>
          <li className="rounded-lg border border-border p-3">
            <p className="mb-2 text-2xs font-semibold text-foreground"><span className="me-1.5 text-[hsl(var(--gold-ink))]">3</span>{t('pubw_step_post', { portal: portal.name })}</p>
            <a href={portal.createUrl} target="_blank" rel="noopener noreferrer" className={OWNER_PRIMARY}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('pubw_open_portal', { portal: portal.name })}
            </a>
            <p className="mt-1.5 text-2xs text-muted-foreground">{t('pubw_portal_security_note', { portal: portal.name })}</p>
          </li>
          <li className="rounded-lg border border-border p-3">
            <p className="mb-2 text-2xs font-semibold text-foreground"><span className="me-1.5 text-[hsl(var(--gold-ink))]">4</span>{t('pubw_step_link', { portal: portal.name })}</p>
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) props.onLink(url.trim()); }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" inputMode="url" dir="ltr" placeholder={portal.id === 'myhome' ? 'https://www.myhome.ge/pr/…' : 'https://home.ss.ge/…'} aria-label={t('pubw_publication_url')} className={INPUT} />
              <button type="submit" className={cn(OWNER_PRIMARY, 'shrink-0')} disabled={!url.trim() || busy !== null}>
                {working('link') ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}{t('pubw_verify')}
              </button>
            </form>
            <p className="mt-1.5 text-2xs text-muted-foreground">{t('pubw_verify_hint')}</p>
          </li>
        </ol>
      ) : null}

      {!readOnly && status ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {['VERIFYING', 'PUBLISHED', 'UNPUBLISH_REQUESTED'].includes(status) ? (
            <button type="button" className={OWNER_SECONDARY} disabled={busy !== null || tooSoon} onClick={props.onCheck} title={tooSoon ? t('pubw_err_check_too_soon_at', { when: dateTime(pub?.next_check_at, locale) }) : undefined}>
              {working('check') ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}{t(status === 'PUBLISHED' ? 'pubw_sync' : 'pubw_check_now')}
            </button>
          ) : null}
          {status === 'VERIFICATION_FAILED' ? (
            <button type="button" className={OWNER_SECONDARY} disabled={busy !== null} onClick={props.onRetry}>{working('retry') ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}{t('pubw_retry_verification')}</button>
          ) : null}
          {status === 'PUBLISHED' || status === 'VERIFYING' ? (
            <button type="button" className={cn(OWNER_SECONDARY, 'text-red-700')} disabled={busy !== null} onClick={props.onUnpublish}>{t('pubw_unpublish')}</button>
          ) : null}
          {status === 'UNPUBLISH_REQUESTED' || status === 'REMOVED_EXTERNALLY' ? (
            <button type="button" className={OWNER_SECONDARY} disabled={busy !== null} onClick={props.onConfirmRemoved}>{t('pubw_confirm_removed')}</button>
          ) : null}
        </div>
      ) : null}
      {status === 'UNPUBLISH_REQUESTED' ? <p className="mt-2 text-2xs text-muted-foreground">{t('pubw_unpublish_pending_note', { portal: portal.name })}</p> : null}
    </Panel>
  );
}

function History({ events, portals, locale }: { events: EventRow[]; portals: PortalInfo[]; locale: string }) {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const name = (id: string | null) => portals.find((p) => p.id === id)?.name ?? null;
  return (
    <Panel title={t('pubw_history')}>
      {events.length === 0 ? <p className="text-2xs text-muted-foreground">{t('pubw_history_empty')}</p> : (
        <ol className="space-y-2">
          {events.map((e) => {
            const code = typeof e.detail?.code === 'string' ? e.detail.code : null;
            return (
              <li key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 text-2xs">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--gold))]" />
                <div className="min-w-0">
                  <p className="font-semibold text-foreground break-words">{[name(e.portal_id), t(`pubw_event_${e.kind.toLowerCase()}`)].filter(Boolean).join(' · ')}</p>
                  <p className="text-muted-foreground break-words">{dateTime(e.created_at, locale)}{code ? ` · ${errorText(code)}` : ''}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

export default function PublishingListingPage() {
  return (
    <RouteGuard>
      <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
        <Editor />
      </AppLayout>
    </RouteGuard>
  );
}
