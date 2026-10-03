// THE OWNER'S VIEW OF ONE PROPERTY'S LIFECYCLE: freshness, source, and the free
// renewal. The state is the server's (my_property_lifecycle); these components only
// present it, always as an icon AND words — gold is the brand accent here, never a
// warning colour on its own.

import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, ImageOff, Loader2, Pencil, RefreshCcw, Upload } from 'lucide-react';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  type PropertyLifecycle, type StatusView, freshnessView, mediaUnavailableReason, safeExternalUrl, sourceView,
} from '@/property/lifecycle';
import { renewProperty } from '@/services/propertyLifecycle';

const TONE_ICON = { ok: CheckCircle2, attention: Clock3, blocked: AlertTriangle } as const;
const TONE_CLASS = {
  ok: 'border-emerald-600/25 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200',
  attention: 'border-amber-600/30 bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100',
  blocked: 'border-red-600/30 bg-red-50 text-red-950 dark:bg-red-500/10 dark:text-red-100',
} as const;

/** "აქტიური" / "მალე განაახლე" / "ვადაგასულია": icon + word, for cards and headers. */
export function FreshnessChip({ life, className }: { life: PropertyLifecycle | null | undefined; className?: string }) {
  const { t } = useLanguage();
  const view = freshnessView(life?.freshness_state);
  if (!view || life?.archived) return null;
  const Icon = TONE_ICON[view.tone];
  return (
    <span
      data-testid="pow-freshness-chip"
      data-state={life?.freshness_state}
      className={cn('inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold', TONE_CLASS[view.tone], className)}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="break-words">{t(view.label as never)}</span>
    </span>
  );
}

/** "წყაროზე პრობლემაა": only when the server knows something worth saying. */
export function SourceChip({ life, imported }: { life: PropertyLifecycle | null | undefined; imported: boolean }) {
  const { t } = useLanguage();
  const view = sourceView(life?.source_status, imported);
  if (!view) return null;
  return (
    <span data-testid="pow-source-chip" className={cn('inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold', TONE_CLASS.attention)}>
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="break-words">{t(view.label as never)}</span>
    </span>
  );
}

/**
 * WHERE A PHOTO SHOULD BE AND IS NOT. Never a meaningless grey box: what happened,
 * why (as precisely as we can justify), and what the owner can do — open the exact
 * listing, or manage the photos in HOMATCH so they stop depending on another site.
 */
export function MediaUnavailable({
  imported, sourceUrl, propertyId, sourceStatus, compact,
}: {
  imported: boolean;
  sourceUrl?: string | null;
  propertyId: string;
  sourceStatus?: PropertyLifecycle['source_status'];
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const href = safeExternalUrl(sourceUrl);
  if (compact) {
    return (
      <div data-testid="pow-media-unavailable" className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[hsl(var(--secondary))] px-3 text-center" role="img" aria-label={t('pow_media_unavailable_title')}>
        <ImageOff className="h-5 w-5 text-muted-foreground/60" aria-hidden="true" />
        <span className="text-2xs font-semibold leading-tight text-foreground/80 break-words">{t('pow_media_unavailable_title')}</span>
      </div>
    );
  }
  return (
    <div data-testid="pow-media-unavailable" className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--secondary))] p-4 sm:p-6">
      <div className="max-w-md space-y-2 text-center">
        <ImageOff className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
        <p className="font-display text-base font-semibold text-foreground break-words">{t('pow_media_unavailable_title')}</p>
        <p className="text-2xs leading-relaxed text-muted-foreground break-words">
          {imported ? t(mediaUnavailableReason(sourceStatus) as never) : t('pow_media_unavailable_direct')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {imported && href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="relative z-10 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-2xs font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="break-words">{t('pow_open_listing')}</span>
            </a>
          )}
          <Link to={`/property/${propertyId}/edit#photos`} className="relative z-10 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#0C1119] px-3 text-2xs font-semibold text-white hover:bg-[#151d2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
            <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="break-words">{imported ? t('pow_update_in_homatch') : t('prop_action_photos')}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ view, children, testId }: { view: StatusView; children?: React.ReactNode; testId: string }) {
  const { t } = useLanguage();
  const Icon = TONE_ICON[view.tone];
  return (
    <div data-testid={testId} className={cn('rounded-xl border p-3.5', TONE_CLASS[view.tone])}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold break-words">{t(view.label as never)}</p>
          <p className="text-2xs leading-relaxed opacity-90 break-words">{t(view.body as never)}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * THE OWNER STATUS AREA. Freshness first (it decides discovery), then the source of
 * an imported property, each with the one action that addresses it. Renewal is free
 * and says so; the source action opens the EXACT listing, never a portal homepage,
 * and never claims HOMATCH updated the source.
 */
export function PropertyStatusPanel({
  propertyId, life, imported, sourceUrl, onRenewed,
}: {
  propertyId: string;
  life: PropertyLifecycle | null | undefined;
  imported: boolean;
  sourceUrl?: string | null;
  onRenewed: () => void;
}) {
  const { t } = useLanguage();
  const [renewing, setRenewing] = useState(false);
  const fresh = freshnessView(life?.freshness_state);
  const source = sourceView(life?.source_status, imported);
  const href = safeExternalUrl(sourceUrl);
  if (!life || life.archived || !fresh) return null;

  const renew = async () => {
    if (renewing) return;
    setRenewing(true);
    try {
      const result = await renewProperty(propertyId);
      if (result.ok) {
        toast.success(t('pow_renewed_toast'));
        onRenewed();
      } else {
        toast.error(t('pow_renew_not_available'));
      }
    } catch {
      toast.error(t('pow_renew_failed'));
    } finally {
      setRenewing(false);
    }
  };

  const expiresOn = new Date(life.expires_at);
  return (
    <section aria-labelledby="pow-status-title" className="space-y-2.5">
      <h2 id="pow-status-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('pow_status_title')}</h2>
      <StatusRow view={fresh} testId="pow-freshness-panel">
        {life.freshness_state === 'ACTIVE' ? (
          <p className="text-2xs opacity-80" dir="auto">
            {t('pow_active_until', { date: expiresOn.toLocaleDateString(), days: life.days_left })}
          </p>
        ) : (
          <>
            {life.freshness_state === 'EXPIRED' && (
              <p className="text-2xs font-semibold opacity-90 break-words">{t('pow_discovery_paused_expired')}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1.5">
              <button
                type="button"
                onClick={() => void renew()}
                disabled={renewing}
                data-action="pow-renew"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#0C1119] px-3.5 text-2xs font-bold text-white transition-colors hover:bg-[#151d2a] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                {renewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                <span className="break-words">{t('pow_renew_free')}</span>
              </button>
              <Link to={`/property/${propertyId}/edit`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-current/30 bg-white/70 px-3.5 text-2xs font-semibold text-foreground hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] dark:bg-white/10">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="break-words">{t('pow_edit_info')}</span>
              </Link>
              {imported && href && life.freshness_state === 'EXPIRED' && (
                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-current/30 px-3.5 text-2xs font-semibold hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="break-words">{t('pow_open_listing')}</span>
                </a>
              )}
            </div>
            <p className="text-2xs opacity-80 break-words">{t('pow_renew_is_free')}</p>
          </>
        )}
      </StatusRow>

      {source && (
        <StatusRow view={source} testId="pow-source-panel">
          <p className="text-2xs font-semibold break-words">{t('pow_source_action_title')}</p>
          <p className="text-2xs opacity-90 break-words">{t('pow_source_action_body')}</p>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-current/30 px-3.5 text-2xs font-semibold hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="break-words">{t('pow_open_listing')}</span>
            </a>
          )}
        </StatusRow>
      )}
    </section>
  );
}

/** Direct HOMATCH management for an imported property. */
export function ManageInHomatch({ propertyId }: { propertyId: string }) {
  const { t } = useLanguage();
  return (
    <div data-testid="pow-manage-in-homatch" className="rounded-xl border border-border bg-card p-4 space-y-2">
      <p className="text-sm font-semibold text-foreground break-words">{t('pow_update_in_homatch')}</p>
      <p className="text-2xs leading-relaxed text-muted-foreground break-words">{t('pow_update_in_homatch_body')}</p>
      <div className="flex flex-wrap gap-2 pt-0.5">
        <Link to={`/property/${propertyId}/edit#photos`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-2xs font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="break-words">{t('pow_upload_photos')}</span>
        </Link>
        <Link to={`/property/${propertyId}/edit`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-2xs font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="break-words">{t('pow_edit_info')}</span>
        </Link>
      </div>
    </div>
  );
}
