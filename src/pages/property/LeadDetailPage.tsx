// ONE POTENTIALLY INTERESTED PERSON — /property/:id/buyers/lead/:leadId (owner, 2026-10-16).
//
// Everything the compact result card leaves out, from the owner's own RLS-scoped lead
// (find_buyers_current_leads, same columns as the list):
//   * what they are: a qualified buyer / tenant, or an interested person — "needs
//     verification" when match review rated them WEAK or has not reviewed them;
//   * two SEPARATE readings: how clearly they stated their intent, and how well what
//     they want fits THIS property (budget / location / rooms …, limitations, financing);
//   * every piece of evidence: post, comment or message, in its own words, language and
//     direction, with safe links to the original, its parent post and the profile, and
//     translation on request (server-side, cached by content);
//   * open the original, copy its link. HOMATCH never contacts anyone from here.
// A lead that does not exist for this property (expired by the 30-day rule, another
// owner's, a typed id) says so; a failed read says so and offers a retry.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, Check, Copy, ExternalLink, FileText, Flame, Languages, Loader2, MessageSquareText, RefreshCw,
  SearchX, ShieldCheck, Sparkles, Target, UserRound,
} from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE, EmptyState } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import { FRAMED_ACTION, GOLD_TEXT, INK, INK_SOFT, IconChip, NAVY_BAND, PRIMARY_ACTION, SourceBadge } from '@/components/findBuyers/brand';
import { LEAD_LANGS, ageLabel, whyText } from '@/components/findBuyers/leadText';
import { leadKindKey, relevanceCategory } from '@/components/findBuyers/PotentialBuyerCard';
import { classifyLead, ownerFactsOf, placeLead, sourceKindKey, type OwnerFacts, type ResultLead } from '@/findBuyers/externalResults';
import { financingBadges, fitTone } from '@/findBuyers/campaignReport';
import { getLead } from '@/services/findBuyersLeads';
import { translateLeadSignal, type LeadEvidence, type PotentialLead } from '@/services/findBuyers';
import { readProperty } from '@/services/propertyManagement';
import type { PropertyFacts } from '@/types/types';

const CARD = 'min-w-0 rounded-2xl bg-white p-4 ring-1 ring-inset ring-[hsl(40_50%_86%)] sm:p-5';
const H2 = cn('flex items-center gap-2 font-display text-base font-semibold', INK);
const AGREED = ['location', 'propertyType', 'rooms', 'area', 'price', 'transaction'] as const;
const TONES = {
  good: 'bg-[hsl(152_60%_94%)] text-[hsl(152_70%_22%)] ring-[hsl(152_45%_75%)]',
  near: 'bg-[hsl(42_100%_94%)] text-[hsl(34_90%_30%)] ring-[hsl(40_80%_78%)]',
  bad: 'bg-[hsl(350_80%_96%)] text-[hsl(350_65%_35%)] ring-[hsl(350_60%_82%)]',
  unknown: 'bg-white text-[hsl(218_28%_38%)] ring-[hsl(218_40%_85%)] italic',
} as const;
const BADGE = 'rounded-full px-2.5 py-0.5 text-2xs font-semibold ring-1 ring-inset';

function Outbound({ href, label, icon: Icon, primary = false, testid }: { href: string | null | undefined; label: string; icon: React.ComponentType<{ className?: string }>; primary?: boolean; testid?: string }) {
  const safe = safeExternalUrl(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" data-testid={testid} className={primary ? PRIMARY_ACTION : FRAMED_ACTION}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words text-start">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-80 rtl:-scale-x-100" aria-hidden="true" />
    </a>
  );
}

/** A 0–100 reading, with its number and a bar; "—" when the server has none. */
function Meter({ value, label, testid }: { value: number | null | undefined; label: string; testid: string }) {
  const v = value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Math.min(100, Math.round(Number(value))));
  return (
    <div data-testid={testid} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className={cn('text-2xs font-semibold', INK_SOFT)}>{label}</p>
        <p className={cn('font-display text-lg font-semibold tabular-nums', INK)} dir="ltr">{v == null ? '—' : v}<span className={cn('text-2xs', INK_SOFT)}>{v == null ? '' : ' / 100'}</span></p>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(218_50%_93%)]" aria-hidden="true">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,hsl(44_98%_62%),hsl(32_92%_48%))]" style={{ width: `${v ?? 0}%` }} />
      </div>
    </div>
  );
}

/** One piece of evidence: its own words, its links, and a translation on request. */
function EvidenceItem({ ev, lead, propertyId }: { ev: LeadEvidence; lead: PotentialLead; propertyId: string }) {
  const { t, lang } = useLanguage();
  const srcLang = ev.language && LEAD_LANGS.has(ev.language) ? ev.language : null;
  const foreign = Boolean(srcLang && srcLang !== lang);
  const [translation, setTranslation] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const when = ev.publishedAt ? new Date(ev.publishedAt).toLocaleDateString(intlLocaleFor(lang), { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const kindKey = ev.kind === 'COMMENT' ? 'fbx_ev_kind_comment' : ev.kind === 'MESSAGE' ? 'fbx_ev_kind_message' : 'fbx_ev_kind_post';
  const where = sourceKindKey(ev.sourceKind);

  const onTranslate = async () => {
    if (translation) { setShow((v) => !v); return; }
    setBusy(true); setFailed(false);
    /* Server-side and cached by content + languages: a second request costs nothing. */
    const res = await translateLeadSignal(propertyId, lead.id, ev.signalId, lang);
    setBusy(false);
    if (res.ok && res.translation) { setTranslation(res.translation); setShow(true); } else setFailed(true);
  };

  return (
    <li data-testid="fbld-evidence-item" data-kind={ev.kind} className="min-w-0 space-y-2.5 rounded-xl bg-[hsl(218_70%_98%)] p-3 ring-1 ring-inset ring-[hsl(218_50%_88%)]">
      <p className={cn('flex min-w-0 flex-wrap items-center gap-1.5 text-2xs font-semibold', INK_SOFT)}>
        <span className="rounded-full bg-white px-2 py-0.5 text-[hsl(220_55%_30%)] ring-1 ring-inset ring-[hsl(218_50%_86%)]">{t(kindKey)}</span>
        <SourceBadge source={ev.source || lead.source} />
        {where ? <span>{t(where)}</span> : null}
        {when ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{when}</span> : null}
      </p>
      {ev.text ? (
        <blockquote dir="auto" lang={srcLang ?? undefined} className={cn('whitespace-pre-line break-words text-start text-sm leading-relaxed [unicode-bidi:plaintext]', INK)}>
          <bdi>{ev.text}</bdi>
        </blockquote>
      ) : null}
      {foreign ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-2.5 py-1 text-2xs font-semibold text-[hsl(220_55%_32%)] ring-1 ring-inset ring-[hsl(218_50%_86%)]">
            {t('fbx_original_lang', { lang: t(`fbx_lang_${srcLang}`) })}
          </span>
          <button type="button" onClick={onTranslate} disabled={busy} aria-expanded={show} data-testid="fbld-translate" className={cn(FRAMED_ACTION, 'rounded-full disabled:opacity-60')}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-[hsl(34_90%_40%)]" aria-hidden="true" /> : <Languages className="h-4 w-4 text-[hsl(34_90%_40%)]" aria-hidden="true" />}
            {translation && show ? t('fbx_show_original') : t('fbx_translate_cta')}
          </button>
        </div>
      ) : null}
      {failed ? <p className="text-2xs font-medium text-[hsl(0_65%_42%)]" role="status">{t('fbx_translate_failed')}</p> : null}
      {translation && show ? (
        <div className="rounded-lg border-s-4 border-[hsl(38_92%_56%)] bg-white p-2.5 shadow-sm" role="region" aria-label={t('fbx_translation_label')}>
          <p className="text-2xs font-bold uppercase tracking-[0.08em] text-[hsl(34_90%_34%)]">{t('fbx_translation_label')}</p>
          <p dir="auto" lang={lang} className={cn('mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed', INK)}>{translation}</p>
        </div>
      ) : null}
      {ev.parentExcerpt ? (
        <p className={cn('min-w-0 border-t border-[hsl(218_50%_88%)] pt-2 text-2xs', INK_SOFT)}>
          <span className="font-semibold text-[hsl(220_55%_32%)]">{t('fbx_parent_label')}: </span>
          <span dir="auto" className="break-words">{ev.parentExcerpt}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Outbound href={ev.url} icon={ev.kind === 'COMMENT' ? MessageSquareText : FileText} testid="fbld-open-evidence"
          label={t(ev.kind === 'COMMENT' ? 'fbx_view_comment' : ev.kind === 'MESSAGE' ? 'fbx_view_message' : 'fbx_view_post')} />
        {ev.kind === 'COMMENT' ? <Outbound href={ev.parentUrl} icon={FileText} label={t('fbx_view_post')} testid="fbld-open-parent" /> : null}
      </div>
    </li>
  );
}

function LeadContent() {
  const { t, lang } = useLanguage();
  const { id: propertyId = '', leadId = '' } = useParams<{ id: string; leadId: string }>();
  const [owner, setOwner] = useState<OwnerFacts | null>(null);
  const [state, setState] = useState<{ lead: PotentialLead | null; failed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!propertyId) return;
    readProperty(propertyId)
      .then((p) => setOwner(ownerFactsOf((p as { facts?: PropertyFacts | PropertyFacts[] } | null)?.facts as never, (p as { transaction_type?: string | null } | null)?.transaction_type)))
      .catch(() => setOwner(null));
  }, [propertyId]);
  useEffect(() => {
    if (!propertyId || !leadId) return undefined;
    let alive = true;
    setState(null);
    getLead(propertyId, leadId).then((r) => { if (alive) setState(r); });
    return () => { alive = false; };
  }, [propertyId, leadId, tick]);

  const lead = state?.lead ?? null;
  const classified = useMemo(() => (lead ? classifyLead(lead as unknown as ResultLead, owner?.market ?? null) : null), [lead, owner?.market]);
  const placement = classified ? placeLead(classified) : null;
  const tenant = owner?.market === 'RENT' || lead?.counterpart === 'TENANT';
  const best = lead?.evidence[0];
  const bestUrl = safeExternalUrl(best?.url ?? null);
  const why = lead ? whyText(lead.score_components?.why ?? null, t, lang) : null;
  const agreed = lead?.score_components?.why?.agreed ?? [];
  const limitations = lead?.qualification_limitations ?? (lead?.qualification?.limitations as string[] | null | undefined) ?? null;
  const financing = financingBadges(limitations);
  const rel = lead ? relevanceCategory(lead) : 'UNCATEGORISED';
  const kind = placement ? leadKindKey(placement, tenant) : null;
  const resultsHref = `/property/${encodeURIComponent(propertyId)}/buyers/external`;

  const copy = useCallback(async () => {
    if (!bestUrl) return;
    try { await navigator.clipboard.writeText(bestUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }, [bestUrl]);

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="pb-32">
        {state === null ? (
          <div data-testid="fbld-loading" className="mt-4 space-y-3" aria-busy="true">
            <div className="h-28 rounded-2xl bg-white/70 motion-safe:animate-pulse" />
            <div className="h-48 rounded-2xl bg-white/70 motion-safe:animate-pulse" />
          </div>
        ) : state.failed ? (
          <section role="alert" data-testid="fbld-error" className={cn(CARD, 'mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')}>
            <p className={cn('flex items-start gap-2 text-sm', INK)}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(0_65%_45%)]" aria-hidden="true" />{t('fbx_results_failed')}</p>
            <button type="button" onClick={() => setTick((n) => n + 1)} className={cn(FRAMED_ACTION, 'justify-center')}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('fbx_results_retry')}
            </button>
          </section>
        ) : !lead || !classified ? (
          <div className="mt-4" data-testid="fbld-missing">
            <EmptyState icon={SearchX} title={t('fbx_lead_missing_title')} body={t('fbx_lead_missing_body')}
              actions={<Link to={resultsHref} className={FRAMED_ACTION}>{t('fbx_lead_back_results')}</Link>} />
          </div>
        ) : (
          <div className="mt-4 space-y-3" data-testid="fbld-detail" data-lead={lead.id}>
            {/* ── who, where, when ── */}
            <header className={cn('overflow-hidden rounded-2xl p-4 text-white ring-1 ring-inset ring-[hsl(40_80%_55%/0.35)] sm:p-5', NAVY_BAND)}>
              <p className={cn('text-2xs font-bold uppercase tracking-[0.14em]', GOLD_TEXT)}>{t(tenant ? 'fbx_lead_eyebrow_tenant' : 'fbx_lead_eyebrow_buyer')}</p>
              <div className="mt-2 flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 ring-2 ring-[hsl(40_94%_60%/0.75)]" aria-hidden="true">
                  <UserRound className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h1 dir="auto" className="break-words font-display text-lg font-semibold leading-snug" data-testid="fbld-name">{lead.author_name ?? t(kind?.key ?? 'fbx_kind_interested')}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-[hsl(218_40%_85%)]">
                    <SourceBadge source={lead.source} onDark />
                    {ageLabel(best?.publishedAt ?? lead.signal_at, t) ? <span>{ageLabel(best?.publishedAt ?? lead.signal_at, t)}</span> : null}
                    {lead.seen_before ? <span className="rounded-full bg-white/10 px-2 py-0.5 font-semibold text-[hsl(40_94%_72%)]">{t('fbx_seen_before')}</span> : null}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Outbound primary href={best?.url} icon={ExternalLink} label={t('fbx_lead_open_original')} testid="fbld-open-original" />
                {bestUrl ? (
                  <button type="button" onClick={copy} data-testid="fbld-copy" className={FRAMED_ACTION}>
                    {copied ? <Check className="h-4 w-4 text-[hsl(152_60%_30%)]" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    {t(copied ? 'fbx_lead_copied' : 'fbx_lead_copy_link')}
                  </button>
                ) : null}
                <Outbound href={lead.author_profile_url} icon={UserRound} label={t('fbx_view_profile')} testid="fbld-open-profile" />
              </div>
            </header>

            {/* ── what they are ── */}
            <section className={CARD} data-testid="fbld-classification" data-tab={placement?.tab ?? 'none'} data-verify={placement?.needsVerification ? 'true' : 'false'}>
              <h2 className={H2}><ShieldCheck className="h-4 w-4 text-[hsl(34_90%_40%)]" aria-hidden="true" />{t('fbx_lead_classification')}</h2>
              <p className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={cn(BADGE, 'bg-[hsl(218_70%_96%)] text-[hsl(220_60%_28%)] ring-[hsl(218_50%_84%)]')} data-testid="fbld-kind">
                  {placement ? t(placement.tab === 'direct' ? (tenant ? 'fbx_kind_qualified_tenant' : 'fbx_kind_qualified_buyer') : 'fbx_kind_interested') : t('fbr_set_aside')}
                </span>
                {placement?.needsVerification ? (
                  <span className={cn(BADGE, TONES.near)} data-testid="fbld-needs-verification">{t(placement.reason === 'TRANSACTION_UNCONFIRMED' ? 'fbx_kind_verify_transaction' : 'fbx_kind_needs_verification')}</span>
                ) : null}
                <span className={cn(BADGE, 'bg-white text-[hsl(34_90%_28%)] ring-[hsl(40_80%_62%)]')} data-category={rel}>{t(`fbx_rel_${rel}`)}</span>
              </p>
              <p className={cn('mt-2 text-sm leading-relaxed', INK_SOFT)}>
                {t(!placement ? 'fbx_lead_explain_excluded' : placement.needsVerification ? 'fbx_lead_explain_verify'
                  : placement.tab === 'direct' ? 'fbx_lead_explain_direct' : 'fbx_lead_explain_interest')}
              </p>
              {why ? (
                <div className="mt-3 flex gap-3 rounded-xl bg-[linear-gradient(135deg,hsl(43_100%_96%),hsl(40_100%_92%))] p-3 ring-1 ring-inset ring-[hsl(40_80%_80%)]">
                  <IconChip icon={Sparkles} />
                  <div className="min-w-0">
                    <h3 className="text-2xs font-bold uppercase tracking-[0.1em] text-[hsl(34_90%_32%)]">{t('fbx_why_title')}</h3>
                    <p className={cn('mt-0.5 text-sm font-medium leading-snug', INK)}>{why}</p>
                  </div>
                </div>
              ) : null}
            </section>

            <div className="grid gap-3 md:grid-cols-2">
              {/* ── how clearly they want it ── */}
              <section className={CARD} data-testid="fbld-intent">
                <h2 className={H2}><Flame className="h-4 w-4 text-[hsl(34_90%_40%)]" aria-hidden="true" />{t('fbx_lead_intent_title')}</h2>
                <p className={cn('mt-1 text-2xs', INK_SOFT)}>{t('fbx_lead_intent_body')}</p>
                <div className="mt-3"><Meter value={lead.intent_score} label={t(tenant ? 'fbx_intent_score_tenant' : 'fbx_intent_score')} testid="fbld-intent-score" /></div>
                {lead.evidence.length > 1 ? <p className={cn('mt-2 text-2xs', INK_SOFT)}>{t('fbx_more_signals', { count: String(lead.evidence.length - 1) })}</p> : null}
              </section>

              {/* ── how well it fits THIS property ── */}
              <section className={CARD} data-testid="fbld-compat">
                <h2 className={H2}><Target className="h-4 w-4 text-[hsl(34_90%_40%)]" aria-hidden="true" />{t('fbx_lead_compat_title')}</h2>
                <p className={cn('mt-1 text-2xs', INK_SOFT)}>{t('fbx_lead_compat_body')}</p>
                <div className="mt-3"><Meter value={lead.similarity} label={t('fbx_similarity')} testid="fbld-similarity" /></div>
                <div className="mt-3 flex flex-wrap gap-1.5" data-testid="fbx-fit-badges">
                  {lead.match_category ? [{ kind: 'budget', ...fitTone(lead.budget_fit) }, { kind: 'location', ...fitTone(lead.location_fit) }].map((x) => (
                    <span key={x.kind} data-fit={x.fit} className={cn(BADGE, TONES[x.tone])}>{t(`fbr_fit_${x.kind}_${x.fit}`)}</span>
                  )) : null}
                  {AGREED.filter((d) => agreed.includes(d)).map((d) => (
                    <span key={d} data-agreed={d} className={cn(BADGE, TONES.good)}>{t(`fbo_agree_${d}`)}</span>
                  ))}
                </div>
                <div className="mt-3" data-testid="fbld-limitations">
                  <h3 className={cn('text-2xs font-bold uppercase tracking-[0.1em]', INK_SOFT)}>{t('fbx_lead_limitations')}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {financing.map((x) => (
                      <span key={x.code} data-financing={x.code} className={cn(BADGE, TONES[x.tone])}>{t(x.key)}</span>
                    ))}
                    {placement?.reason === 'TRANSACTION_UNCONFIRMED' ? <span data-limitation="TRANSACTION_UNCONFIRMED" className={cn(BADGE, TONES.near)}>{t('fbx_kind_verify_transaction')}</span> : null}
                    {!lead.match_category ? <span className={cn(BADGE, TONES.unknown)}>{t('fbr_cat_UNCATEGORISED')}</span> : null}
                    {financing.length === 0 && lead.match_category && placement?.reason !== 'TRANSACTION_UNCONFIRMED' ? <span className={cn('text-2xs', INK_SOFT)}>{t('fbx_lead_no_limitations')}</span> : null}
                  </div>
                </div>
              </section>
            </div>

            {/* ── every piece of evidence ── */}
            <section className={CARD}>
              <h2 className={H2}><FileText className="h-4 w-4 text-[hsl(34_90%_40%)]" aria-hidden="true" />{t('fbx_lead_evidence_title', { n: String(lead.evidence.length) })}</h2>
              {lead.evidence.length ? (
                <ul className="mt-3 space-y-2.5" data-testid="fbld-evidence">
                  {lead.evidence.map((ev, i) => <EvidenceItem key={ev.signalId || i} ev={ev} lead={lead} propertyId={propertyId} />)}
                </ul>
              ) : <p className={cn('mt-2 text-sm', INK_SOFT)}>{t('fbx_lead_no_evidence')}</p>}
              <p className={cn('mt-3 text-2xs', INK_SOFT)}>{t('fbx_lead_contact_note')}</p>
            </section>
          </div>
        )}
      </CustomerSurface>
    </AppLayout>
  );
}

export default function LeadDetailPage() {
  return <RouteGuard><LeadContent /></RouteGuard>;
}
