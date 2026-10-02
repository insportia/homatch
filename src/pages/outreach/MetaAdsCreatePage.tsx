// META ADS — the campaign builder.
//
// A customer answers a few business questions; HOMATCH does the technical
// setup. Nine steps, each reachable at any time, Back and Continue on every
// one, and nothing is ever lost on the way:
//
//   · ONE draft row. The builder resumes the customer's open draft (from the
//     URL, or their most recent one) instead of inserting a new row on every
//     visit, and the draft id and current step live in the URL — refresh,
//     Back, the Facebook login round-trip and the AI panel all return to the
//     same place.
//   · Edits show instantly and save in the background (useMetaDraft).
//   · The server is the source of truth for money (plan_preview) and for
//     readiness (preflight). Nothing here computes the fee or decides that a
//     campaign may launch.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Building2, FileText, Globe, Home, Loader2, MessageCircle, Plus, ShieldCheck, Target, ThumbsUp, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { PageHero } from '@/components/customer/surface';
import { Button } from '@/components/metaAds/builder/MetaButton';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/db/supabase';
import { recommendedPlacements, type Placement } from '@/lib/metaAds/payload';
import type { MetaGoal } from '@/lib/metaAds/strategy';
import { creativeAdvice } from '@/lib/metaAds/creativeAdvice';
import {
  getMetaStatus, createMetaDraft, getMetaCampaign, latestOpenDraft, listCreatives, planPreview, runPreflight, briefInterpret,
  launchCampaign, listAudiences, trackFunnel, money, EDITABLE_STATUSES, updateMetaDraft,
  type MetaStatus, type MetaCampaignRow, type MetaCreativeRow, type MetaAudienceRow, type PreflightResult, type PlanPreview,
} from '@/services/metaAds';
import { FORMS_ACTIONABLE, formsStateOf } from '@/components/metaAds/builder/instantFormsCopy';
import { useMetaDraft } from '@/components/metaAds/builder/useMetaDraft';
import { ALL_GOALS, STEPS, selectedAsset, stepGap, type StepKey } from '@/components/metaAds/builder/steps';
import { ChoiceCard, SaveIndicator, StepShell, Stepper, SummaryRow } from '@/components/metaAds/builder/ui';
import { useConnectReturn } from '@/components/metaAds/builder/useMetaConnect';
import { ConnectReturnNotice } from '@/components/metaAds/builder/ConnectReturnNotice';
import { AccountPanel } from '@/components/metaAds/builder/AccountPanel';
import { DestinationStep } from '@/components/metaAds/builder/DestinationStep';
import { BudgetStep, FinancialSummary } from '@/components/metaAds/builder/BudgetStep';
import { CreativeStep } from '@/components/metaAds/builder/CreativeStep';
import { AdPreview, type PreviewField } from '@/components/metaAds/builder/AdPreview';
import { PlacementsStep, ReviewStep } from '@/components/metaAds/builder/ReviewStep';
import { AudienceStep } from '@/components/metaAds/builder/AudienceStep';
import { BriefStep } from '@/components/metaAds/builder/BriefStep';
import { ReviewInsights } from '@/components/metaAds/builder/ReviewInsights';
import { briefHash } from '@/lib/metaAds/audienceGuide';
import { Hint } from '@/components/metaAds/builder/FinishKit';
import { classifyDomainScope } from '@/lib/metaAds/domainScope';
import { HelperCard } from '@/components/metaAds/builder/FinishKit';
import { regionName } from '@/components/metaAds/builder/LocationPicker';
import { useStrategyPreview } from '@/components/metaAds/builder/useStrategyPreview';
import { adviceBlocks, defaultCampaignName, destinationForGoal } from '@/components/metaAds/builder/masterLogic';

const DRAFT_KEY = 'homatch_meta_ads_prelogin_draft';

interface LocalDraft {
  goal: MetaGoal;
  offer: { isProperty: boolean; dealKind: string; title: string } | null;
}

const GOAL_ICON: Record<MetaGoal, React.ReactNode> = {
  LEADS_ON_META: <FileText className="h-4 w-4" />, MESSAGES: <MessageCircle className="h-4 w-4" />,
  LEADS_ON_WEBSITE: <Globe className="h-4 w-4" />, SITE_REGISTRATIONS: <UserPlus className="h-4 w-4" />,
  PROMOTE: <Target className="h-4 w-4" />, ENGAGEMENT: <ThumbsUp className="h-4 w-4" />,
};

const DEAL_FROM_TRANSACTION: Record<string, string> = { SALE: 'SALE', RENT: 'RENT_LONG', DAILY_RENT: 'RENT_SHORT', LEASE: 'RENT_LONG' };

export default function MetaAdsCreatePage() {
  const { homatchUser } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const signedIn = !!homatchUser;

  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [initial, setInitial] = useState<MetaCampaignRow | null>(null);
  const [creatives, setCreatives] = useState<MetaCreativeRow[]>([]);
  const [audiences, setAudiences] = useState<MetaAudienceRow[]>([]);
  const [properties, setProperties] = useState<Array<{ id: string; title: string | null; homatch_id: number | null; transaction_type: string | null }>>([]);
  const [bootError, setBootError] = useState(false);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [pricing, setPricing] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [focusCreative, setFocusCreative] = useState<string | null>(null);
  const launchKey = useRef<string>(crypto.randomUUID());
  const { campaign, setCampaign, patch, flush, saveState } = useMetaDraft(initial);

  const step: StepKey = (STEPS as readonly string[]).includes(params.get('step') ?? '') ? params.get('step') as StepKey : 'account';
  const go = useCallback(async (next: StepKey) => {
    await flush();
    /* Leaving the brief with new words: HOMATCH reads them in the background,
       so the review can already say what it understood. */
    if (campaign && step === 'brief' && next !== 'brief' && (campaign.owner_brief ?? '').trim()
      && campaign.brief_understanding?.hash !== briefHash(campaign.owner_brief)) {
      const id = campaign.id;
      void briefInterpret(id, lang).then((r) => setCampaign((c) => (c && c.id === id ? { ...c, brief_understanding: r.understanding } : c) as never)).catch(() => undefined);
    }
    setParams((prev) => { prev.set('step', next); return prev; }, { replace: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [flush, setParams, campaign, step, lang, setCampaign]);

  const reloadStatus = useCallback(async () => { setStatus(await getMetaStatus()); }, []);
  const navRef = useRef<HTMLDivElement>(null);
  const [navH, setNavH] = useState(0);
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setNavH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!campaign]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Back from Meta's login: ONE shared refresh, then the step the owner came from. */
  const connectReturn = useConnectReturn(reloadStatus);
  const fromStep = params.get('from');
  useEffect(() => {
    if (connectReturn.result === 'ok' && !connectReturn.refreshing && fromStep && (STEPS as readonly string[]).includes(fromStep)) {
      void go(fromStep as StepKey);
    }
  }, [connectReturn.result, connectReturn.refreshing]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── BOOT: everything independent in parallel, one draft, no duplicates ── */
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    (async () => {
      const draftId = params.get('draft');
      const propertyParam = params.get('property');
      let local: LocalDraft | null = null;
      try { local = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { local = null; }

      const resolveDraft = async (): Promise<MetaCampaignRow> => {
        if (draftId) {
          const c = await getMetaCampaign(draftId);
          if (c) return c;
        }
        if (!local && !propertyParam) {
          const open = await latestOpenDraft();
          if (open) return open;
        }
        if (propertyParam) {
          const open = await latestOpenDraft();
          if (open && open.property_id === propertyParam) return open;
        }
        const created = await createMetaDraft(homatchUser!.id, {
          goal: local?.goal ?? 'LEADS_ON_META',
          property_id: propertyParam,
          offer: local?.offer ?? (propertyParam ? { isProperty: true, dealKind: 'SALE' } : null),
          daily_budget_cents: 500, duration_days: 7,
          // Every goal gets the destination it needs (MESSAGES → messaging, not a website).
          destination: destinationForGoal(local?.goal ?? 'LEADS_ON_META', null, false),
          audience_id: params.get('audience'),
        } as never);
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ }
        void trackFunnel('meta_ads_draft_created');
        return created;
      };

      const [st, auds, props, draft] = await Promise.all([
        getMetaStatus().catch(() => null),
        listAudiences().catch(() => []),
        supabase.from('properties').select('id,title,homatch_id,transaction_type')
          .eq('user_id', homatchUser!.id).eq('is_deleted', false).is('archived_at', null)
          .order('updated_at', { ascending: false }).limit(50)
          .then(({ data }) => data ?? []),
        resolveDraft(),
      ]);
      if (!live) return;
      if (!EDITABLE_STATUSES.includes(draft.status)) {
        navigate(`/outreach/meta/campaigns/${draft.id}`, { replace: true });
        return;
      }
      setStatus(st); setAudiences(auds); setProperties(props as never);
      setInitial(draft);
      if (draft.preflight?.status) setPreflight(draft.preflight);
      setParams((prev) => {
        prev.set('draft', draft.id);
        prev.delete('property'); prev.delete('audience');
        if (!prev.get('step')) prev.set('step', st?.connection?.health === 'CONNECTED' ? 'offer' : 'account');
        return prev;
      }, { replace: true });
      setCreatives(await listCreatives(draft.id));
    })().catch(() => { if (live) setBootError(true); });
    return () => { live = false; };
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Server-priced totals, refreshed after the money-shaping fields settle ── */
  useEffect(() => {
    if (!campaign) return;
    setPricing(true);
    const h = setTimeout(async () => {
      await flush();
      const r = await planPreview(campaign.id).catch(() => null);
      if (r) setPreview(r);
      setPricing(false);
    }, 700);
    return () => clearTimeout(h);
  }, [campaign?.id, campaign?.daily_budget_cents, campaign?.duration_days, campaign?.goal, campaign?.placements, creatives.length, status?.assets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Any edit invalidates a previous preflight — the server enforces it too.
  useEffect(() => { if (campaign && !campaign.preflight) setPreflight(null); }, [campaign?.preflight]); // eslint-disable-line react-hooks/exhaustive-deps

  const placements: Placement[] = useMemo(() => {
    if (!campaign) return ['facebook_feed'];
    if (campaign.placements?.mode === 'CUSTOM') return (campaign.placements.list ?? []) as Placement[];
    return (preview?.recommendedPlacements as Placement[] | undefined)
      ?? recommendedPlacements({ hasInstagram: !!selectedAsset(status, 'INSTAGRAM'), hasVideo: creatives.some((c) => c.media[0]?.mime?.startsWith('video')), goal: campaign.goal as MetaGoal });
  }, [campaign, preview, status, creatives]);

  /* ── SMART STRATEGY: the server's plan, funding and advice for this draft ── */
  const strategySignature = campaign ? JSON.stringify([
    campaign.goal, campaign.daily_budget_cents, campaign.duration_days, campaign.placements, campaign.targeting ?? null,
    campaign.offer, campaign.property_id, campaign.audience_id, campaign.destination,
    creatives.map((c) => [c.id, c.media.length, c.media[0]?.width ?? null, !!c.headline.trim(), !!c.primary_text.trim()]),
    (status?.assets ?? []).filter((a) => a.selected).map((a) => a.id),
  ]) : '';
  const strategy = useStrategyPreview(campaign?.id ?? null, strategySignature, flush);

  /* Live creative advice — the same pure function preflight runs, fed the
     server's budget-aware creative count. Only BLOCKING_ERROR stops Continue. */
  const advice = useMemo(() => (campaign ? creativeAdvice(
    creatives.map((c) => ({ id: c.id, media: c.media, headline: c.headline, primaryText: c.primary_text })),
    { goal: campaign.goal as MetaGoal, placements, recommendedCreativeCount: strategy.preview?.strategy?.recommendedCreativeCount ?? null },
  ) : []), [campaign, creatives, placements, strategy.preview]);
  const creativeBlocked = adviceBlocks(advice);

  /* ── PRE-AUTH: a visitor can start; the draft survives the login redirect ── */
  if (!signedIn) return <PreLogin />;

  if (bootError) {
    return (
      <AppLayout noPadding>
        <div className="mx-auto w-full max-w-xl px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t('mads_load_failed')}</p>
          <Button className="mt-3" onClick={() => window.location.reload()}>{t('madsb_retry')}</Button>
        </div>
      </AppLayout>
    );
  }

  if (!campaign) {
    return (
      <AppLayout noPadding>
        <div className="mx-auto grid w-full max-w-[86rem] gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_360px] lg:px-8">
          <Skeleton className="hidden h-80 rounded-2xl lg:block" />
          <div className="space-y-3"><Skeleton className="h-10 rounded-xl" /><Skeleton className="h-72 rounded-2xl" /></div>
          <Skeleton className="hidden h-96 rounded-2xl lg:block" />
        </div>
      </AppLayout>
    );
  }

  const ctx = { status, campaign, creatives };
  const gaps = Object.fromEntries(STEPS.map((s) => [s, stepGap(s, ctx)])) as Record<StepKey, string | null>;
  const idx = STEPS.indexOf(step);
  const page = selectedAsset(status, 'PAGE');
  const ig = selectedAsset(status, 'INSTAGRAM');
  const acct = selectedAsset(status, 'AD_ACCOUNT');
  const formAsset = (status?.assets ?? []).find((a) => a.kind === 'LEAD_FORM' && a.external_id === campaign.destination?.formId) ?? selectedAsset(status, 'LEAD_FORM');
  const previewCreative = creatives.find((c) => c.id === focusCreative && c.media.length) ?? creatives.find((c) => c.media.length) ?? null;
  const canLaunch = preflight?.status === 'READY' && !running;
  /* Why "Launch" is unavailable, in words, wherever the button is. */
  const launchHint: string | null = canLaunch || running ? null
    : !preflight ? 'mm_b_launch_needs_check'
      : preflight.status === 'MANUAL_REVIEW' ? 'mm_b_launch_in_review'
        : preflight.status !== 'READY' ? 'mm_b_launch_needs_fixes' : null;
  /* Where Meta's login returns: this draft, this step (and the step that sent the owner here). */
  const returnTo = `/outreach/meta/create?draft=${campaign.id}&step=account${fromStep && (STEPS as readonly string[]).includes(fromStep) ? `&from=${fromStep}` : ''}`;
  /* The HOMATCH name: a suggestion from what is advertised, the goal and the
     month; an edit is saved as is (not part of the check's fingerprint). */
  const advertised = properties.find((p) => (p.homatch_id ? String(p.homatch_id) : p.id) === campaign.property_id)?.title ?? null;
  const nameSuggestion = defaultCampaignName({ subject: advertised, goalLabel: t(`mads_goal_${String(campaign.goal).toLowerCase()}` as never), lang });
  const saveName = (name: string) => {
    setCampaign({ ...campaign, name } as MetaCampaignRow);
    void updateMetaDraft(campaign.id, { name }).catch(() => toast.error(t('mm_c_name_failed')));
  };

  const doPreflight = async () => {
    setRunning(true);
    try {
      await flush();
      const r = await runPreflight(campaign.id);
      setPreflight(r);
      setCampaign({ ...campaign, status: r.status, preflight: r } as MetaCampaignRow);
      setCreatives(await listCreatives(campaign.id));
      toast[r.status === 'READY' ? 'success' : 'info'](t(r.status === 'READY' ? 'mads_preflight_ok' : r.status === 'MANUAL_REVIEW' ? 'mads_preflight_review' : 'mads_preflight_changes'));
    } catch { toast.error(t('mads_load_failed')); } finally { setRunning(false); }
  };

  const doLaunch = async () => {
    setRunning(true);
    try {
      // An untouched name field launches with the suggestion it showed.
      if (!campaign.name?.trim()) await updateMetaDraft(campaign.id, { name: nameSuggestion }).catch(() => undefined);
      await launchCampaign(campaign.id, launchKey.current);
      toast.success(t('madsb_submitted_to_meta'));
      navigate(`/outreach/meta/campaigns/${campaign.id}`);
    } catch (e: any) {
      const code = e?.code ?? e?.body?.code;
      /* One launch intent = one key. Any attempt that ended (failed, refused,
         refunded) retires its key, so the next press is a new intent with its
         own fee. Only an attempt still in flight keeps the key. */
      if (code !== 'LAUNCH_IN_PROGRESS') launchKey.current = crypto.randomUUID();
      if (code === 'PROPERTY_NOT_OWNED') toast.error(t('madsb_property_not_owned'));
      else if (code === 'IDEMPOTENCY_KEY_USED') toast.info(t('madsb_launch_retry'));
      else if (code === 'INSUFFICIENT_FUNDS') { toast.error(t('mads_funds_needed')); navigate('/outreach/meta?tab=overview'); }
      else if (code === 'PREFLIGHT_STALE') { toast.info(t('madsb_preflight_stale')); setPreflight(null); }
      else if (code === 'OUT_OF_SCOPE') { toast.error(t('mm_m_scope_blocked')); setPreflight(null); }
      else if (code === 'IN_REVIEW') { toast.info(t('mm_m_scope_review')); setPreflight(null); }
      else if (String(e?.message ?? '').startsWith('meta_err')) toast.error(t(e.message as never));
      else toast.error(t('mads_launch_failed'));
    } finally { setRunning(false); setConfirmOpen(false); }
  };

  const onPreviewField = (f: PreviewField) => {
    const target = previewCreative;
    if (step !== 'creative') { void go('creative'); }
    if (target) setTimeout(() => document.getElementById(`madsb-field-${target.id}-${f}`)?.focus(), step === 'creative' ? 0 : 350);
  };

  const previewPanel = (
    <AdPreview campaign={campaign} creative={previewCreative} placements={placements}
      pageName={page?.name ?? null} instagramName={ig?.name ?? null} formName={formAsset?.name ?? null} onField={onPreviewField} />
  );

  return (
    <AppLayout noPadding>
      {/* The builder's own bar replaces the app's bottom nav on phones (see
          data-madsb-nav), so the page only reserves the bar's height plus the
          safe area — the last control always scrolls clear of it. */}
      <div style={{ '--mm-nav-h': navH ? `${navH}px` : undefined } as React.CSSProperties}
        className="mx-auto w-full max-w-[86rem] px-4 py-4 pb-[calc(var(--mm-nav-h,6.5rem)+1rem)] sm:px-6 lg:px-8">
        {/* On a phone the hero is shown once, on the first step; later steps start with the work. */}
        <div className={cn(step !== 'account' && 'hidden md:block')}>
          <PageHero compact eyebrow="Meta Ads" title={t('mads_create_title')} subtitle={t('mm_b_create_sub')} />
        </div>
        {status?.mode === 'MOCK' && (
          <div className="mt-3 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 py-2.5 text-[13px] text-[hsl(var(--gold-ink))]">{t('mads_mock_banner')}</div>
        )}

        <div className="mt-4 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_360px]">
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <Stepper steps={STEPS} current={step} gaps={gaps} onGo={(s) => void go(s)} />
            <div className="mt-3 hidden lg:block"><SaveIndicator state={saveState} /></div>
          </aside>

          <main className="min-w-0 space-y-4">
            {connectReturn.result && (
              <ConnectReturnNotice result={connectReturn.result} refreshing={connectReturn.refreshing} />
            )}
            {/* The HOMATCH check, explained before the disabled button is reached. */}
            {/* Once, at the start; the review step carries the check itself. */}
            {step === 'account' && preflight?.status !== 'READY' && (
              <div data-mm-check-notice="" role="note" className="rounded-2xl border border-border bg-card px-4 py-3 shadow-card">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden />{t('mm_b_check_notice_title')}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs font-medium text-muted-foreground">
                  <span>{t('mm_b_check_flow_setup')}</span>
                  <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
                  <span className="text-foreground">{t('madsb_preflight_title')}</span>
                  <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
                  <span>{t('mads_launch')}</span>
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{t('mm_b_check_notice_body')}</p>
              </div>
            )}
            {step === 'account' && (
              <StepShell eyebrow={t('madsb_step_account')} title={t('madsb_account_title')} lead={t('madsb_account_lead')}>
                <AccountPanel status={status} onChanged={reloadStatus} returnTo={returnTo} />
              </StepShell>
            )}
            {step === 'offer' && (
              <OfferStep campaign={campaign} properties={properties} patch={patch} />
            )}
            {step === 'goal' && (
              <StepShell eyebrow={t('madsb_step_goal')} title={t('madsb_goal_title')} lead={t('madsb_goal_lead')}>
                <Hint k="mm_c_hint_goal" />
                <div className="grid gap-2 sm:grid-cols-2">
                  {ALL_GOALS.map((g) => {
                    const switchedOn = (status?.settings.goalsEnabled ?? []).includes(g);
                    /* Leads on Facebook/Instagram is decided by the server
                       (src/lib/metaAds/instantForms.ts): never a permission name here. */
                    const forms = g === 'LEADS_ON_META' && status?.connection?.status === 'CONNECTED' ? formsStateOf(status) : 'READY';
                    // Selectable whenever the owner can resolve it here (accept Meta's terms, reconnect, check again).
                    const enabled = switchedOn && FORMS_ACTIONABLE.has(forms);
                    return (
                      <ChoiceCard key={g} active={campaign.goal === g} disabled={!enabled} icon={GOAL_ICON[g]}
                        title={t(`mads_goal_${g.toLowerCase()}` as never)} body={t(`madsb_goal_${g.toLowerCase()}_d` as never)}
                        badge={!switchedOn ? t('madsb_goal_not_enabled') : forms === 'PERMISSIONS_MISSING' || forms === 'FORM_ACCESS_UNAVAILABLE' ? t('mm_b_goal_reconnect')
                          : forms === 'TERMS_REQUIRED' ? t('mm_l_goal_terms') : forms === 'READY' ? undefined : t('mm_c_goal_check')}
                        onClick={() => patch({
                          goal: g,
                          destination: destinationForGoal(g, campaign.destination, !!page),
                        } as never, { immediate: true })} />
                    );
                  })}
                </div>
              </StepShell>
            )}
            {step === 'destination' && (
              <DestinationStep campaign={campaign} status={status} patch={patch} reloadStatus={reloadStatus} propertyUrl={null} />
            )}
            {step === 'audience' && (
              <AudienceStep campaign={campaign} status={status} audiences={audiences} creatives={creatives} patch={patch} />
            )}
            {step === 'budget' && (
              <BudgetStep campaign={campaign} status={status} patch={patch} totals={preview?.totals ?? null} pricing={pricing}
                strategy={strategy.preview} strategyLoading={strategy.loading} strategyFailed={strategy.failed} />
            )}
            {step === 'creative' && (
              <CreativeStep campaign={campaign} creatives={creatives} setCreatives={setCreatives} placements={placements} onFocusCreative={setFocusCreative}
                defaultHeadline={properties.find((p) => (p.homatch_id ? String(p.homatch_id) : p.id) === campaign.property_id)?.title ?? ''}
                advice={advice} strategy={strategy.preview?.strategy ?? null} strategyLoading={strategy.loading}
                aiCreativeEnabled={!!status?.settings?.aiCreativeEnabled} />
            )}
            {step === 'placements' && (
              <PlacementsStep campaign={campaign} status={status} creatives={creatives} recommended={(preview?.recommendedPlacements as Placement[] | undefined) ?? placements} patch={patch} />
            )}
            {step === 'brief' && (
              <BriefStep campaign={campaign} patch={patch} setCampaign={(c) => setCampaign(c)} flush={flush} />
            )}
            {step === 'review' && (
              <ReviewStep campaign={campaign} status={status} creatives={creatives} totals={preview?.totals ?? null} pricing={pricing}
                recommended={(preview?.recommendedPlacements as Placement[] | undefined) ?? placements}
                preflight={preflight} running={running} onPreflight={doPreflight} canLaunch={canLaunch} launchHint={launchHint}
                onLaunch={() => setConfirmOpen(true)} onEdit={(s) => void go(s as StepKey)}
                strategy={strategy.preview} strategyLoading={strategy.loading} strategyFailed={strategy.failed}
                nameSuggestion={nameSuggestion} onName={saveName}
                insights={<ReviewInsights campaign={campaign} status={status} creatives={creatives} patch={patch} onEdit={(s) => void go(s as StepKey)} />} />
            )}

            {/* Preview inline on narrower screens, where there is no side rail. */}
            {(step === 'creative' || step === 'placements' || step === 'review') && (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-card xl:hidden">
                <p className="mb-2 text-sm font-semibold text-foreground">{t('mads_step_preview')}</p>
                {previewPanel}
              </div>
            )}
          </main>

          <aside className="hidden space-y-4 xl:sticky xl:top-4 xl:block xl:self-start">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <p className="mb-2 text-sm font-semibold text-foreground">{t('mads_step_preview')}</p>
              {previewPanel}
            </div>
            <FinancialSummary totals={preview?.totals ?? null} pricing={pricing} compact billing={status?.settings.budgetBilling} />
          </aside>
        </div>
      </div>

      {/* Back / Continue — always both, on every step. */}
      {/* On phones it sits over the app's bottom nav (z-50) instead of stacking
          above it — one bar, never two fighting; Exit/Back leaves the flow. */}
      {/* Its real height (hint line, two-line labels, the safe area) is measured,
          and the page reserves exactly that — content never hides under it. */}
      <div ref={navRef} data-madsb-nav="" className="fixed inset-x-0 bottom-0 z-[60] md:z-30 lg:start-[18rem] border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
        <div className="mx-auto flex w-full max-w-[86rem] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] sm:flex-nowrap sm:px-6 lg:px-8">
          <Button variant="outline" onClick={() => void (idx > 0 ? go(STEPS[idx - 1]) : navigate('/outreach/meta'))} className="min-h-11 shrink-0 gap-1.5">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t(idx > 0 ? 'madsb_back' : 'madsb_exit')}
          </Button>
          {/* Phones: the hint is its own line above the buttons (two lines at most), never a squeezed column that grows the bar. */}
          <div className={cn('order-first line-clamp-2 basis-full text-center text-2xs text-muted-foreground sm:order-none sm:line-clamp-none sm:min-w-0 sm:flex-1 sm:basis-auto sm:text-[13px]', step === 'review' && launchHint ? 'block' : 'hidden sm:block')}>
            {step === 'review' && launchHint ? <span id="mm-b-launch-hint-nav">{t(launchHint as never)}</span>
              : step === 'creative' && creativeBlocked ? <span className="text-destructive">{t('mm_b_blocking_continue')}</span>
                : gaps[step] ? t(gaps[step] as never) : <SaveIndicator state={saveState} />}
          </div>
          {idx < STEPS.length - 1 ? (
            /* Only a BLOCKING_ERROR creative advice holds Continue; every other step is advisory. */
            <Button onClick={() => void go(STEPS[idx + 1])} className="min-h-11 shrink-0 gap-1.5" disabled={step === 'creative' && creativeBlocked}
              aria-describedby={step === 'creative' && creativeBlocked ? 'mm-b-blocking-hint' : undefined}>
              {t('madsb_continue')}<ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button onClick={() => setConfirmOpen(true)} disabled={!canLaunch}
              aria-describedby={launchHint ? 'mm-b-launch-hint-nav' : undefined}
              className="min-h-11 shrink-0 bg-[hsl(var(--gold))] font-bold text-[#161309] hover:bg-[hsl(var(--gold-hover))]">{t('mads_launch')}</Button>
          )}
        </div>
      </div>

      {/* THE MONEY MOMENT — everything that will be submitted, spelled out. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto md:max-w-md">
          <DialogHeader><DialogTitle>{t('mads_confirm_title')}</DialogTitle></DialogHeader>
          <dl className="space-y-1.5 text-sm">
            {[
              [t('mads_conn_page'), page?.name ?? '—'],
              [t('mads_conn_ad_account'), acct?.name ?? '—'],
              [t('madsb_review_objective'), t(`mads_goal_${campaign.goal.toLowerCase()}` as never)],
              [t('madsb_review_destination'), campaign.destination?.url ?? formAsset?.name
                ?? (campaign.destination?.messagingApp ? t(`madsb_msg_${campaign.destination.messagingApp.toLowerCase().replace('instagram_direct', 'instagram')}`) : '—')],
              [t('madsb_review_location'), (campaign.targeting?.locations?.length ? campaign.targeting.locations.map((l) => (l.type === 'country' ? regionName(l.key, lang) : l.name)) : [t('mm_c_loc_none_chosen')]).join(', ')],
              [t('madsb_review_audience'), campaign.audience_id ? t('madsb_audience_retarget') : t('mads_audience_broad')],
              [t('madsb_step_placements'), placements.map((p) => t(`mads_pl_${p}` as never)).join(', ')],
              [t('mads_budget_daily'), money(Number(campaign.daily_budget_cents ?? 0))],
              [t('mads_budget_days'), String(campaign.duration_days ?? 0)],
            ].map(([k, v]) => (
              <SummaryRow key={k} label={k} value={v} editLabel={t('madsb_edit')} dense />
            ))}
          </dl>
          {preview?.totals && (
            <dl className="space-y-1 rounded-xl border border-border p-3 text-sm tabular-nums">
              <div className="flex justify-between gap-3"><dt className="min-w-0">{t('madsb_money_media')}</dt><dd className="shrink-0 whitespace-nowrap" dir="ltr">{money(preview.totals.mediaCents)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="min-w-0">{t('madsb_money_fee', { pct: String(preview.totals.feePercent) })}</dt><dd className="shrink-0 whitespace-nowrap" dir="ltr">{money(preview.totals.feeCents)}</dd></div>
              <div className="flex justify-between gap-3 text-muted-foreground"><dt className="min-w-0">{t('madsb_money_total_max')}</dt><dd className="shrink-0 whitespace-nowrap" dir="ltr">{money(preview.totals.totalCents)}</dd></div>
              {/* What HOMATCH itself takes from the balance now. With the customer's own
                  ad account that is the fee alone -- Meta bills the budget directly. */}
              <div className="flex justify-between gap-3 border-t border-border pt-1 text-base font-bold"><dt className="min-w-0">{t('madsb_charged_now')}</dt><dd className="shrink-0 whitespace-nowrap" dir="ltr" data-charged-now="">{money(status?.settings.budgetBilling === 'HOMATCH_WALLET' ? preview.totals.totalCents : preview.totals.feeCents)}</dd></div>
              <div className="flex justify-between text-muted-foreground"><dt>{t('mads_confirm_balance')}</dt><dd dir="ltr">{money(status?.wallet?.available_cents ?? 0)}</dd></div>
            </dl>
          )}
          <p className="text-[13px] leading-relaxed text-muted-foreground">{t(status?.mode === 'MOCK' ? 'madsb_confirm_mock'
            : status?.settings.budgetBilling === 'HOMATCH_WALLET' ? 'madsb_confirm_note' : 'madsb_confirm_note_customer')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('general_cancel')}</Button>
            <Button onClick={doLaunch} disabled={running} className="bg-[hsl(var(--gold))] font-bold text-[#161309] hover:bg-[hsl(var(--gold-hover))]">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mads_confirm_go')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

/* ── WHAT ARE YOU ADVERTISING ────────────────────────────────────────── */

function OfferStep({ campaign, properties, patch }: {
  campaign: MetaCampaignRow;
  properties: Array<{ id: string; title: string | null; homatch_id: number | null; transaction_type: string | null }>;
  patch: (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean }) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const offer = campaign.offer as { isProperty?: boolean; dealKind?: string; title?: string } | null;
  const otherActive = !campaign.property_id && !!offer;
  const [title, setTitle] = useState(offer?.title ?? '');
  useEffect(() => { setTitle((campaign.offer as { title?: string } | null)?.title ?? ''); }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <StepShell eyebrow={t('madsb_step_offer')} title={t('mads_step_what')} lead={t('madsb_offer_lead')}>
      {properties.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">{t('madsb_offer_your_properties')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {properties.map((p) => {
              // meta_campaigns.property_id is the permanent six-digit HOMATCH id,
              // the same one AI routing passes in ?property=.
              const ref = p.homatch_id ? String(p.homatch_id) : p.id;
              const active = campaign.property_id === ref;
              return (
                <ChoiceCard key={p.id} active={active} icon={<Home className="h-4 w-4" />}
                  title={p.title || `#${p.homatch_id ?? ''}`} body={p.homatch_id ? `ID ${p.homatch_id}` : undefined}
                  // Clicking the selected property again clears the choice.
                  onClick={() => patch(active
                    ? { property_id: null, offer: null }
                    : { property_id: ref, offer: { isProperty: true, dealKind: DEAL_FROM_TRANSACTION[String(p.transaction_type ?? '').toUpperCase()] ?? 'SALE' } } as never,
                  { immediate: true })} />
              );
            })}
          </div>
        </div>
      )}
      {properties.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-[hsl(var(--secondary))]/40 px-3.5 py-2.5 text-[13px] text-muted-foreground">
          {t('madsb_offer_no_properties')}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/property/add')}><Plus className="h-3.5 w-3.5" />{t('madsb_offer_add_property')}</Button>
        </div>
      )}
      <ChoiceCard active={otherActive} icon={<Building2 className="h-4 w-4" />} title={t('mads_offer_other')} body={t('madsb_offer_other_d')}
        onClick={() => patch(otherActive ? { offer: null } : { property_id: null, offer: { isProperty: false, dealKind: 'OTHER', title } } as never, { immediate: true })} />
      {otherActive && (
        <div className="space-y-3 rounded-xl border border-border p-3.5">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('madsb_offer_title_label')}</span>
            <Input data-mm-offer-title="" placeholder={t('mads_offer_title_ph')} value={title} maxLength={120}
              onChange={(e) => { setTitle(e.target.value); patch({ offer: { ...(offer ?? { isProperty: false, dealKind: 'OTHER' }), title: e.target.value } } as never); }} />
          </label>
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">{t('madsb_offer_kind')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceCard active={offer?.isProperty === true} title={t('madsb_offer_kind_property')} body={t('madsb_offer_kind_property_d')}
                onClick={() => patch({ offer: { ...(offer ?? {}), title, isProperty: true, dealKind: 'SALE' } } as never, { immediate: true })} />
              <ChoiceCard active={offer?.isProperty === false} title={t('madsb_offer_kind_other')} body={t('madsb_offer_kind_other_d')}
                onClick={() => patch({ offer: { ...(offer ?? {}), title, isProperty: false, dealKind: 'OTHER' } } as never, { immediate: true })} />
            </div>
          </div>
          {/* Real-estate scope, said early and kindly; preflight and launch decide (domainScope.ts). */}
          {(() => {
            const scope = title.trim().length >= 3 ? classifyDomainScope({ hasProperty: false, offer: { ...(offer ?? {}), title }, texts: [] }) : null;
            if (!scope || scope.decision === 'ALLOWED') return null;
            return (
              <HelperCard emoji={scope.decision === 'BLOCKED_OUT_OF_SCOPE' ? '🏠' : '🔍'} tone={scope.decision === 'BLOCKED_OUT_OF_SCOPE' ? 'amber' : 'calm'}
                data-mm-scope={scope.decision} title={t(scope.decision === 'BLOCKED_OUT_OF_SCOPE' ? 'mm_m_scope_blocked_title' : 'mm_m_scope_review_title')}>
                {t(scope.decision === 'BLOCKED_OUT_OF_SCOPE' ? 'mm_m_scope_blocked' : 'mm_m_scope_review')}
              </HelperCard>
            );
          })()}
        </div>
      )}
    </StepShell>
  );
}

/* ── BEFORE SIGN-IN ──────────────────────────────────────────────────── */

function PreLogin() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [local, setLocal] = useState<LocalDraft>(() => {
    try { const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); if (saved?.goal) return saved; } catch { /* fresh */ }
    return { goal: 'LEADS_ON_META', offer: null };
  });
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(local)); } catch { /* fine */ } }, [local]);
  const other = local.offer?.isProperty === false;
  return (
    <AppLayout noPadding>
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 sm:px-6">
        <PageHero compact eyebrow="Meta Ads" title={t('mads_create_title')} subtitle={t('mm_b_create_sub')} />
        <StepShell title={t('mads_step_what')}>
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard active={!other} icon={<Home className="h-4 w-4" />} title={t('mads_offer_property_signin')} onClick={() => setLocal((v) => ({ ...v, offer: null }))} />
            <ChoiceCard active={other} icon={<Building2 className="h-4 w-4" />} title={t('mads_offer_other')}
              onClick={() => setLocal((v) => ({ ...v, offer: other ? null : { isProperty: false, dealKind: 'OTHER', title: v.offer?.title ?? '' } }))} />
          </div>
          {other && (
            <Input placeholder={t('mads_offer_title_ph')} value={local.offer?.title ?? ''}
              onChange={(e) => setLocal((v) => ({ ...v, offer: { ...(v.offer ?? { isProperty: false, dealKind: 'OTHER' }), title: e.target.value } }))} />
          )}
        </StepShell>
        <StepShell title={t('mads_step_goal')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['LEADS_ON_META', 'MESSAGES', 'LEADS_ON_WEBSITE', 'PROMOTE'] as MetaGoal[]).map((g) => (
              <ChoiceCard key={g} active={local.goal === g} icon={GOAL_ICON[g]} title={t(`mads_goal_${g.toLowerCase()}` as never)}
                body={t(`madsb_goal_${g.toLowerCase()}_d` as never)} onClick={() => setLocal((v) => ({ ...v, goal: g }))} />
            ))}
          </div>
        </StepShell>
        <div className="overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover">
          <p className="text-sm leading-relaxed text-white/85">{t('madsb_prelogin_value')}</p>
          <p className="mt-2 text-2xs leading-relaxed text-white/60">{t('madsb_experience_note')}</p>
          <Button className="mt-3 bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]"
            onClick={() => navigate(`/login?redirect=${encodeURIComponent('/outreach/meta/create')}`)}>
            {t('mads_prelogin_continue')}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
