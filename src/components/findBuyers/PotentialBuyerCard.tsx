// POTENTIAL BUYER / POTENTIAL TENANT — one person, with the evidence that
// makes them worth reading: why they may match THIS property, their own words
// (original language kept, translation on request), how close the property
// they reacted to is, how strong their intent is, and where it was said.
//
// Built on the discovery module grammar (hm-discovery-panel, one gold accent,
// StrengthMark) rather than a new card style. Logical properties throughout,
// so Arabic and Hebrew mirror; quoted text takes its own direction.

import React, { useMemo, useState } from 'react';
import { ExternalLink, Languages, Loader2, MessageSquareQuote, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { StrengthMark } from '@/components/customer/surface';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import { placeName } from '@/lib/placeNames';
import { translateLeadSignal, type LeadEvidence, type PotentialLead, type WhyMatched } from '@/services/findBuyers';

const SOURCE_LABEL: Record<string, string> = {
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', TIKTOK: 'TikTok', VK: 'VK', TELEGRAM: 'Telegram', LINKEDIN: 'LinkedIn', FORUM: 'Forum',
};
const LANGS = new Set(['ka', 'ru', 'en', 'ar', 'he', 'tr']);

export function whyText(why: WhyMatched | null | undefined, t: (k: string, v?: Record<string, string>) => string, lang: string): string | null {
  if (!why) return null;
  const what = why.bedrooms != null && why.bedrooms > 0
    ? t('fbx_what_bedrooms', { n: String(why.bedrooms) })
    : why.propertyType === 'HOUSE' ? t('fbx_what_house') : why.propertyType ? t('fbx_what_apartment') : t('fbx_what_property');
  const rawPlace = why.district ?? why.city ?? null;
  const place = rawPlace ? placeName(rawPlace.replace(/\b\w/g, (c) => c.toUpperCase()), lang) : null;
  const base = why.kind === 'REQUEST_POST'
    ? (place ? t('fbx_why_request', { what, place }) : t('fbx_why_request_noplace', { what }))
    : (place ? t('fbx_why_comment', { what, place }) : t('fbx_why_comment_noplace', { what }));
  const size = why.agreed.includes('area'); const price = why.agreed.includes('price');
  const agreed = size && price ? t('fbx_why_agreed_both') : size ? t('fbx_why_agreed_size') : price ? t('fbx_why_agreed_price') : '';
  return agreed ? `${base} ${agreed}` : base;
}

function ageLabel(iso: string | null, t: (k: string, v?: Record<string, string>) => string): string | null {
  if (!iso) return null;
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  if (!Number.isFinite(days)) return null;
  return days === 0 ? t('fbx_today') : days === 1 ? t('fbx_one_day') : t('fbx_days', { count: String(days) });
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const v = value == null ? null : Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-2xs text-muted-foreground">{label}</span>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground" dir="ltr">{v == null ? '—' : `${v}%`}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
        <div className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width] duration-500" style={{ width: `${v ?? 0}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-2xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{value ?? '—'}</p>
    </div>
  );
}

function Outbound({ href, label }: { href: string | null; label: string }) {
  const safe = safeExternalUrl(href);
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-2xs font-semibold text-foreground transition-colors hover:border-[hsl(var(--ring))]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
    >
      <span className="break-words text-start">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
    </a>
  );
}

export function PotentialBuyerCard({ lead, propertyId }: { lead: PotentialLead; propertyId: string }) {
  const { t, lang } = useLanguage();
  const best: LeadEvidence | undefined = lead.evidence[0];
  const tenant = lead.counterpart === 'TENANT';
  const why = whyText(lead.score_components?.why ?? null, t, lang);
  const srcLang = best?.language && LANGS.has(best.language) ? best.language : null;
  const foreign = Boolean(srcLang && srcLang !== lang);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const more = Math.max(0, lead.evidence.length - 1);
  const signalAge = useMemo(() => ageLabel(best?.publishedAt ?? lead.signal_at, t), [best?.publishedAt, lead.signal_at, t]);
  const strengthKey = `fbx_strength_${lead.strength}`;

  const onTranslate = async () => {
    if (!best) return;
    if (translation) { setShowTranslation((v) => !v); return; }
    setBusy(true); setFailed(false);
    const res = await translateLeadSignal(propertyId, lead.id, best.signalId, lang);
    setBusy(false);
    if (res.ok && res.translation) { setTranslation(res.translation); setShowTranslation(true); }
    else setFailed(true);
  };

  return (
    <article
      className="hm-discovery-panel min-w-0 p-4 transition-colors hover:border-[hsl(var(--ring))]/35 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
      aria-label={t(tenant ? 'fbx_card_tenant' : 'fbx_card_buyer')}
    >
      {/* who · strength */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t(tenant ? 'fbx_card_tenant' : 'fbx_card_buyer')}
        </p>
        <span className="inline-flex items-center gap-1.5">
          <StrengthMark tier={lead.strength} label={t(strengthKey)} />
          <span className="text-2xs font-semibold tabular-nums text-foreground" dir="ltr">· {lead.overall_score}</span>
        </span>
      </header>

      {lead.author_name ? (
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 font-display text-[0.9375rem] font-semibold text-foreground">
          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span dir="auto" className="truncate">{lead.author_name}</span>
          {lead.seen_before ? (
            <span className="ms-1 shrink-0 rounded-full border border-border px-2 py-0.5 text-2xs font-medium text-muted-foreground">{t('fbx_seen_before')}</span>
          ) : null}
        </p>
      ) : null}

      {/* why */}
      {why ? (
        <section className="mt-3">
          <h4 className="text-2xs font-medium text-muted-foreground">{t('fbx_why_title')}</h4>
          <p className="mt-0.5 text-sm leading-snug text-foreground">{why}</p>
        </section>
      ) : null}

      {/* their words */}
      {best?.text ? (
        <section className="mt-3 border-s-2 border-[hsl(var(--primary))]/60 ps-3">
          <h4 className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden="true" />
            {t('fbx_intent_title')}
          </h4>
          <blockquote dir="auto" lang={srcLang ?? undefined} className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-foreground/95">
            “{best.text}”
          </blockquote>
          {foreign ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-2xs text-muted-foreground">{t('fbx_original_lang', { lang: t(`fbx_lang_${srcLang}`) })}</span>
              <button
                type="button"
                onClick={onTranslate}
                disabled={busy}
                aria-expanded={showTranslation}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-2xs font-semibold text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Languages className="h-3.5 w-3.5" aria-hidden="true" />}
                {translation && showTranslation ? t('fbx_show_original') : t('fbx_translate_cta')}
              </button>
            </div>
          ) : null}
          {failed ? <p className="mt-1 text-2xs text-muted-foreground" role="status">{t('fbx_translate_failed')}</p> : null}
          {translation && showTranslation ? (
            <div className="mt-2 rounded-lg bg-foreground/[0.04] p-2.5" role="region" aria-label={t('fbx_translation_label')}>
              <p className="text-2xs font-medium text-muted-foreground">{t('fbx_translation_label')}</p>
              <p dir="auto" lang={lang} className="mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed text-foreground">{translation}</p>
            </div>
          ) : null}
          {best.parentExcerpt ? (
            <p className="mt-2 line-clamp-2 text-2xs text-muted-foreground">
              <span className="font-medium">{t('fbx_parent_label')}: </span>
              <span dir="auto">{best.parentExcerpt}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* evidence numbers */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3">
        <Meter label={t('fbx_similarity')} value={lead.similarity} />
        <Meter label={t(tenant ? 'fbx_intent_score_tenant' : 'fbx_intent_score')} value={lead.intent_score} />
        <Stat label={t('fbx_signal_age')} value={signalAge} />
        <Stat label={t('fbx_source')} value={SOURCE_LABEL[lead.source] ?? lead.source} />
      </div>

      {more > 0 ? (
        <p className="mt-2.5 text-2xs text-muted-foreground">{t('fbx_more_signals', { count: String(more) })}</p>
      ) : null}

      {/* provenance */}
      <footer className={cn('mt-3 flex flex-wrap gap-2 border-t border-border/50 pt-3')}>
        <Outbound href={best?.url ?? null} label={t(best?.kind === 'COMMENT' ? 'fbx_view_comment' : best?.kind === 'MESSAGE' ? 'fbx_view_message' : 'fbx_view_post')} />
        {best?.kind === 'COMMENT' ? <Outbound href={best?.parentUrl ?? null} label={t('fbx_view_post')} /> : null}
        <Outbound href={lead.author_profile_url} label={t('fbx_view_profile')} />
      </footer>
    </article>
  );
}

export default PotentialBuyerCard;
