// POTENTIAL BUYER / POTENTIAL TENANT — one person, with the evidence that
// makes them worth reading: why they may match THIS property, their own words
// (original language kept, translation on request), how close the property
// they reacted to is, how strong their intent is, and where it was said.
//
// HOMATCH premium: a navy identity band with a gold strength mark, white
// working surface, gold rings for the two scores, framed actions. Logical
// properties throughout, so Arabic and Hebrew mirror; quotes take their own
// direction.

import React, { useMemo, useState } from 'react';
import {
  CalendarClock, ExternalLink, FileText, Flame, Languages, Loader2, MessageSquareText, Quote, Sparkles, Target, UserRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import { placeName } from '@/lib/placeNames';
import { translateLeadSignal, type LeadEvidence, type PotentialLead, type WhyMatched } from '@/services/findBuyers';
import {
  FRAMED_ACTION, GOLD_FILL, GOLD_TEXT, INK, INK_SOFT, IconChip, NAVY_BAND, PRIMARY_ACTION, RingMeter, SourceBadge,
} from '@/components/findBuyers/brand';

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

const initials = (name: string | null) => (name ?? '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

function Outbound({ href, label, icon: Icon, primary = false }: { href: string | null; label: string; icon: React.ComponentType<{ className?: string }>; primary?: boolean }) {
  const safe = safeExternalUrl(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={primary ? PRIMARY_ACTION : FRAMED_ACTION}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="break-words text-start">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-80 rtl:-scale-x-100" aria-hidden="true" />
    </a>
  );
}

function StrengthPill({ strength, score, label }: { strength: string; score: number; label: string }) {
  const strong = strength === 'STRONG';
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-bold',
      strong ? `${GOLD_FILL} text-[hsl(218_52%_11%)] shadow-[0_4px_14px_-6px_hsl(38_92%_50%/0.8)]`
        : strength === 'GOOD' ? 'bg-white/10 text-[hsl(40_94%_70%)] ring-1 ring-inset ring-[hsl(40_80%_60%/0.6)]'
        : 'bg-white/10 text-white ring-1 ring-inset ring-white/25')}>
      <span>{label}</span>
      <span className="tabular-nums" dir="ltr">{score}</span>
    </span>
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
      className="group/lead min-w-0 overflow-hidden rounded-2xl border border-[hsl(40_70%_80%)] bg-white shadow-[0_10px_30px_-18px_hsl(218_60%_15%/0.45)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[hsl(38_88%_60%)] hover:shadow-[0_22px_44px_-22px_hsl(218_60%_15%/0.55)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
      aria-label={t(tenant ? 'fbx_card_tenant' : 'fbx_card_buyer')}
    >
      {/* ── identity band: who, how strong, where ─────────────────────── */}
      <header className={cn('relative px-4 pb-3.5 pt-3.5', NAVY_BAND)}>
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[hsl(40_94%_60%/0.7)] to-transparent" aria-hidden="true" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={cn('text-2xs font-bold uppercase tracking-[0.16em]', GOLD_TEXT)}>{t(tenant ? 'fbx_card_tenant' : 'fbx_card_buyer')}</p>
          <StrengthPill strength={lead.strength} score={lead.overall_score} label={t(`fbx_strength_${lead.strength}`)} />
        </div>
        <div className="mt-2.5 flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white ring-2 ring-[hsl(40_94%_60%/0.75)]" aria-hidden="true">
            {lead.author_name ? initials(lead.author_name) : <UserRound className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate font-display text-[0.98rem] font-semibold text-white">{lead.author_name ?? t(tenant ? 'fbx_card_tenant' : 'fbx_card_buyer')}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <SourceBadge source={lead.source} onDark />
              {lead.seen_before ? (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-2xs font-semibold text-[hsl(40_94%_72%)] ring-1 ring-inset ring-[hsl(40_80%_60%/0.45)]">{t('fbx_seen_before')}</span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="space-y-3.5 p-4">
        {/* ── why ───────────────────────────────────────────────────── */}
        {why ? (
          <section className="flex gap-3 rounded-xl bg-[linear-gradient(135deg,hsl(43_100%_96%),hsl(40_100%_92%))] p-3 ring-1 ring-inset ring-[hsl(40_80%_80%)]">
            <IconChip icon={Sparkles} />
            <div className="min-w-0">
              <h4 className="text-2xs font-bold uppercase tracking-[0.1em] text-[hsl(34_90%_32%)]">{t('fbx_why_title')}</h4>
              <p className={cn('mt-0.5 text-sm font-medium leading-snug', INK)}>{why}</p>
            </div>
          </section>
        ) : null}

        {/* ── their words ───────────────────────────────────────────── */}
        {best?.text ? (
          <section className="relative rounded-xl bg-[hsl(218_70%_97%)] p-3 ring-1 ring-inset ring-[hsl(218_50%_88%)]">
            <h4 className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-[hsl(220_55%_32%)]">
              <Quote className="h-3.5 w-3.5" aria-hidden="true" />
              {t('fbx_intent_title')}
            </h4>
            <blockquote dir="auto" lang={srcLang ?? undefined} className={cn('mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed', INK)}>
              “{best.text}”
            </blockquote>
            {foreign ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-2xs font-semibold text-[hsl(220_55%_32%)] ring-1 ring-inset ring-[hsl(218_50%_86%)]">
                  {t('fbx_original_lang', { lang: t(`fbx_lang_${srcLang}`) })}
                </span>
                <button
                  type="button"
                  onClick={onTranslate}
                  disabled={busy}
                  aria-expanded={showTranslation}
                  className={cn(FRAMED_ACTION, 'rounded-full disabled:opacity-60')}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin text-[hsl(34_90%_40%)]" aria-hidden="true" /> : <Languages className="h-4 w-4 text-[hsl(34_90%_40%)]" aria-hidden="true" />}
                  {translation && showTranslation ? t('fbx_show_original') : t('fbx_translate_cta')}
                </button>
              </div>
            ) : null}
            {failed ? <p className="mt-1.5 text-2xs font-medium text-[hsl(0_65%_42%)]" role="status">{t('fbx_translate_failed')}</p> : null}
            {translation && showTranslation ? (
              <div className="mt-2.5 rounded-lg border-s-4 border-[hsl(38_92%_56%)] bg-white p-2.5 shadow-sm" role="region" aria-label={t('fbx_translation_label')}>
                <p className="text-2xs font-bold uppercase tracking-[0.08em] text-[hsl(34_90%_34%)]">{t('fbx_translation_label')}</p>
                <p dir="auto" lang={lang} className={cn('mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed', INK)}>{translation}</p>
              </div>
            ) : null}
            {best.parentExcerpt ? (
              <p className={cn('mt-2.5 line-clamp-2 border-t border-[hsl(218_50%_88%)] pt-2 text-2xs', INK_SOFT)}>
                <span className="font-semibold text-[hsl(220_55%_32%)]">{t('fbx_parent_label')}: </span>
                <span dir="auto">{best.parentExcerpt}</span>
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ── evidence numbers ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex min-w-0 flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-center ring-1 ring-inset ring-[hsl(218_45%_90%)]">
            <RingMeter value={lead.similarity} label={t('fbx_similarity')} size={56} />
            <p className="flex items-start justify-center gap-1 text-2xs font-semibold leading-tight text-[hsl(220_55%_32%)]"><Target className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{t('fbx_similarity')}</span></p>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-center ring-1 ring-inset ring-[hsl(218_45%_90%)]">
            <RingMeter value={lead.intent_score} label={t(tenant ? 'fbx_intent_score_tenant' : 'fbx_intent_score')} size={56} />
            <p className="flex items-start justify-center gap-1 text-2xs font-semibold leading-tight text-[hsl(220_55%_32%)]"><Flame className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{t(tenant ? 'fbx_intent_score_tenant' : 'fbx_intent_score')}</span></p>
          </div>
          <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-white p-2.5 ring-1 ring-inset ring-[hsl(218_45%_90%)]">
            <IconChip icon={CalendarClock} tone="navy" />
            <div className="min-w-0">
              <p className="truncate text-2xs font-semibold text-[hsl(220_55%_32%)]">{t('fbx_signal_age')}</p>
              <p className={cn('truncate text-sm font-bold', INK)}>{signalAge ?? '—'}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-white p-2.5 ring-1 ring-inset ring-[hsl(218_45%_90%)]">
            <div className="min-w-0">
              <p className="truncate text-2xs font-semibold text-[hsl(220_55%_32%)]">{t('fbx_source')}</p>
              <SourceBadge source={lead.source} className="mt-1" />
            </div>
          </div>
        </div>

        {more > 0 ? (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(42_100%_94%)] px-2.5 py-1 text-2xs font-semibold text-[hsl(34_90%_32%)] ring-1 ring-inset ring-[hsl(40_80%_78%)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {t('fbx_more_signals', { count: String(more) })}
          </p>
        ) : null}

        {/* ── provenance ─────────────────────────────────────────────── */}
        <footer className="flex flex-wrap gap-2 border-t border-[hsl(40_70%_86%)] pt-3.5">
          <Outbound primary href={best?.url ?? null} icon={best?.kind === 'COMMENT' ? MessageSquareText : FileText}
            label={t(best?.kind === 'COMMENT' ? 'fbx_view_comment' : best?.kind === 'MESSAGE' ? 'fbx_view_message' : 'fbx_view_post')} />
          {best?.kind === 'COMMENT' ? <Outbound href={best?.parentUrl ?? null} icon={FileText} label={t('fbx_view_post')} /> : null}
          <Outbound href={lead.author_profile_url} icon={UserRound} label={t('fbx_view_profile')} />
        </footer>
      </div>
    </article>
  );
}

export default PotentialBuyerCard;
