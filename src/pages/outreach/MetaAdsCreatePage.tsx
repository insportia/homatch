// META ADS — the create flow. One page, seven human questions:
// what → result → who sees it → budget → the ad itself → where → check &
// launch. No Ads Manager vocabulary anywhere; the strategy engine and the
// preflight do the technical thinking server-side.
//
// PRE-AUTH: a visitor can choose, type and see the process; the moment an
// action needs identity (saving the draft onward) the auth gate appears
// and the typed draft survives in localStorage.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { PageHero } from '@/components/customer/surface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ImagePlus, Loader2, Trash2, CheckCircle2, XCircle, Sparkles, ShieldCheck, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/db/supabase';
import {
  getMetaStatus, createMetaDraft, updateMetaDraft, getMetaCampaign, listCreatives, addCreative,
  updateCreative, removeCreative, creativeMediaUrl, planPreview, runPreflight, launchCampaign,
  listAudiences, trackFunnel, money,
  type MetaStatus, type MetaCampaignRow, type MetaCreativeRow, type MetaAudienceRow,
} from '@/services/metaAds';

const DRAFT_KEY = 'homatch_meta_ads_prelogin_draft';

type Goal = 'LEADS_ON_META' | 'LEADS_ON_WEBSITE' | 'SITE_REGISTRATIONS' | 'ENGAGEMENT' | 'PROMOTE';
const GOALS: Goal[] = ['LEADS_ON_META', 'LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'ENGAGEMENT', 'PROMOTE'];

interface LocalDraft {
  goal: Goal;
  propertyId: string | null;
  offer: { isProperty: boolean; dealKind: string; title: string; price?: string; location?: string } | null;
  dailyUsd: string;
  days: string;
  destinationUrl: string;
}

export default function MetaAdsCreatePage() {
  const { homatchUser, session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [campaign, setCampaign] = useState<MetaCampaignRow | null>(null);
  const [creatives, setCreatives] = useState<MetaCreativeRow[]>([]);
  const [audiences, setAudiences] = useState<MetaAudienceRow[]>([]);
  const [properties, setProperties] = useState<Array<{ id: string; title: string | null }>>([]);
  const [local, setLocal] = useState<LocalDraft>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
      if (saved) return saved;
    } catch { /* fresh */ }
    return {
      goal: 'LEADS_ON_META', propertyId: params.get('property'),
      offer: null, dailyUsd: '5', days: '7', destinationUrl: '',
    };
  });
  const [totals, setTotals] = useState<{ mediaCents: number; feeCents: number; totalCents: number; feePercent: number } | null>(null);
  const [issues, setIssues] = useState<Array<{ code: string }>>([]);
  const [preflight, setPreflight] = useState<{ status: string; checks: Array<{ key: string; ok: boolean; detail?: string }> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const launchKey = useRef<string>(crypto.randomUUID());

  const signedIn = !!homatchUser;

  /* Boot: status + user properties + audiences; adopt/attach the draft. */
  useEffect(() => {
    if (!signedIn) return;
    (async () => {
      const [st, auds] = await Promise.all([getMetaStatus().catch(() => null), listAudiences().catch(() => [])]);
      setStatus(st); setAudiences(auds);
      const { data: props } = await supabase.from('properties')
        .select('id,title').eq('user_id', homatchUser!.id).is('deleted_at', null).limit(50);
      setProperties((props ?? []) as never);
      // Continue an existing draft, or create one from the local pre-auth
      // draft the visitor built before signing in.
      const existingId = params.get('draft');
      if (existingId) {
        const c = await getMetaCampaign(existingId);
        if (c) { setCampaign(c); setCreatives(await listCreatives(c.id)); return; }
      }
      const draft = await createMetaDraft(homatchUser!.id, {
        goal: local.goal,
        property_id: local.propertyId,
        offer: local.offer ?? (local.propertyId ? { isProperty: true, dealKind: 'SALE' } : null),
        daily_budget_cents: Math.round(parseFloat(local.dailyUsd || '5') * 100),
        duration_days: Math.max(2, parseInt(local.days || '7', 10)),
        destination: local.goal === 'LEADS_ON_META'
          ? { type: 'META_FORM' }
          : { type: 'WEBSITE', url: local.destinationUrl || undefined },
        audience_id: params.get('audience'),
      } as never);
      localStorage.removeItem(DRAFT_KEY);
      setCampaign(draft);
      setCreatives([]);
      trackFunnel('meta_ads_draft_created');
    })().catch(() => toast.error(t('mads_load_failed')));
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Pre-auth: keep the local draft alive across the login redirect. */
  useEffect(() => {
    if (!signedIn) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(local)); } catch { /* fine */ }
    }
  }, [local, signedIn]);

  /* Persist field changes + refresh the honest total. */
  const sync = useCallback(async (patch: Partial<MetaCampaignRow>) => {
    if (!campaign) return;
    await updateMetaDraft(campaign.id, patch).catch(() => toast.error(t('mads_load_failed')));
    const next = { ...campaign, ...patch } as MetaCampaignRow;
    setCampaign(next);
    setPreflight(null); // anything changed → check again before launch
  }, [campaign, t]);

  useEffect(() => {
    if (!campaign) return;
    const h = setTimeout(async () => {
      const r = await planPreview(campaign.id).catch(() => null);
      if (r) { setTotals(r.totals); setIssues(r.issues); }
    }, 400);
    return () => clearTimeout(h);
  }, [campaign?.daily_budget_cents, campaign?.duration_days, campaign?.goal, creatives.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── PRE-AUTH VIEW ─────────────────────────────────────────────────── */
  if (!signedIn) {
    return (
      <AppLayout noPadding>
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 sm:px-6">
          <PageHero compact eyebrow="Meta Ads" title={t('mads_create_title')} subtitle={t('mads_create_sub')} />
          <Section title={t('mads_step_what')}>
            <div className="grid gap-2 sm:grid-cols-2">
              <OfferChip active={!!local.offer && !local.offer.isProperty === false && local.propertyId === null && local.offer !== null}
                label={t('mads_offer_other')} onClick={() => setLocal(v => ({ ...v, propertyId: null, offer: { isProperty: false, dealKind: 'OTHER', title: '' } }))} />
              <OfferChip active={local.offer?.isProperty !== false && local.offer === null}
                label={t('mads_offer_property_signin')} onClick={() => setLocal(v => ({ ...v, offer: null }))} />
            </div>
            {local.offer && !local.offer.isProperty && (
              <Input className="mt-2" placeholder={t('mads_offer_title_ph')} value={local.offer.title}
                onChange={e => setLocal(v => ({ ...v, offer: { ...v.offer!, title: e.target.value } }))} />
            )}
          </Section>
          <Section title={t('mads_step_goal')}>
            <GoalPicker value={local.goal} onChange={g => setLocal(v => ({ ...v, goal: g }))} enabled={GOALS as string[]} />
          </Section>
          <Section title={t('mads_step_budget')}>
            <BudgetRow dailyUsd={local.dailyUsd} days={local.days}
              onDaily={d => setLocal(v => ({ ...v, dailyUsd: d }))} onDays={d => setLocal(v => ({ ...v, days: d }))} />
            <p className="mt-2 text-[13px] text-muted-foreground">{t('mads_minimum_days_note')}</p>
          </Section>
          <div className="overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover">
            <p className="text-sm leading-relaxed text-white/85">{t('mads_prelogin_note')}</p>
            <Button className="mt-3 bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]"
              onClick={() => { navigate(`/login?redirect=${encodeURIComponent('/outreach/meta/create')}`); }}>
              {t('mads_prelogin_continue')}
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!campaign) {
    return (
      <AppLayout noPadding>
        <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6 sm:px-6">
          <Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  /* ── SIGNED-IN WIZARD ─────────────────────────────────────────────── */
  const connected = status?.connection?.status === 'CONNECTED';
  const pageSel = status?.assets.find(a => a.kind === 'PAGE' && a.selected);
  const acctSel = status?.assets.find(a => a.kind === 'AD_ACCOUNT' && a.selected);
  const readyCreatives = creatives.filter(c => c.media.length > 0);
  const wallet = status?.wallet;
  const canLaunch = preflight?.status === 'READY' && campaign.status === 'READY';

  const doPreflight = async () => {
    setBusy('preflight');
    try {
      const r = await runPreflight(campaign.id);
      setPreflight(r);
      setCampaign({ ...campaign, status: r.status } as MetaCampaignRow);
      setCreatives(await listCreatives(campaign.id));
      if (r.status === 'READY') toast.success(t('mads_preflight_ok'));
      else toast.info(t(r.status === 'MANUAL_REVIEW' ? 'mads_preflight_review' : 'mads_preflight_changes'));
    } catch { toast.error(t('mads_load_failed')); }
    finally { setBusy(null); }
  };

  const doLaunch = async () => {
    setBusy('launch');
    try {
      const r = await launchCampaign(campaign.id, launchKey.current);
      toast.success(t('mads_launched'));
      navigate(`/outreach/meta/campaigns/${campaign.id}`);
    } catch (e: any) {
      if (e?.code === 'INSUFFICIENT_FUNDS' || String(e.message).includes('INSUFFICIENT_FUNDS')) {
        toast.error(t('mads_funds_needed'));
        navigate('/outreach/meta?tab=overview');
      } else if (String(e.message).startsWith('meta_err')) {
        toast.error(t(e.message as never));
      } else toast.error(t('mads_launch_failed'));
    } finally { setBusy(null); setConfirmOpen(false); }
  };

  return (
    <AppLayout noPadding>
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6">
        <PageHero compact eyebrow="Meta Ads" title={t('mads_create_title')} subtitle={t('mads_create_sub')} />

        {/* 1 · WHAT */}
        <Section title={t('mads_step_what')} done={!!campaign.property_id || !!campaign.offer}>
          <div className="flex flex-wrap gap-2">
            {properties.map(p => (
              <OfferChip key={p.id} active={campaign.property_id === p.id}
                label={p.title || `#${p.id}`}
                onClick={() => sync({ property_id: p.id, offer: { isProperty: true, dealKind: 'SALE' } as never })} />
            ))}
            <OfferChip active={!campaign.property_id && !!campaign.offer}
              label={t('mads_offer_other')}
              onClick={() => sync({ property_id: null, offer: { isProperty: false, dealKind: 'OTHER', title: '' } as never })} />
          </div>
          {!campaign.property_id && campaign.offer && (
            <Input className="mt-2" placeholder={t('mads_offer_title_ph')}
              defaultValue={(campaign.offer as { title?: string }).title ?? ''}
              onBlur={e => sync({ offer: { ...(campaign.offer as object), title: e.target.value } as never })} />
          )}
        </Section>

        {/* 2 · GOAL */}
        <Section title={t('mads_step_goal')} done>
          <GoalPicker value={campaign.goal as Goal}
            enabled={(status?.settings.goalsEnabled as string[]) ?? GOALS}
            onChange={g => sync({
              goal: g,
              destination: g === 'LEADS_ON_META' ? { type: 'META_FORM' } : { type: 'WEBSITE', url: campaign.destination?.url },
            } as never)} />
          {campaign.goal !== 'LEADS_ON_META' && (
            <Input className="mt-2" dir="ltr" placeholder="https://…"
              defaultValue={campaign.destination?.url ?? ''}
              onBlur={e => sync({ destination: { type: 'WEBSITE', url: e.target.value } as never })} />
          )}
        </Section>

        {/* 3 · CONNECT */}
        <Section title={t('mads_step_connect')} done={connected && !!pageSel && !!acctSel}>
          <div className="space-y-1.5 text-sm">
            <CheckLine ok={connected} label={t('mads_check_facebook')} />
            <CheckLine ok={!!pageSel} label={t('mads_check_page')} />
            <CheckLine ok={!!acctSel} label={t('mads_check_account')} />
          </div>
          {(!connected || !pageSel || !acctSel) && (
            <Button variant="outline" size="sm" className="mt-2"
              onClick={() => navigate('/outreach/meta?tab=connections')}>
              {t('mads_go_connections')}
            </Button>
          )}
        </Section>

        {/* 4 · AUDIENCE (optional retargeting) */}
        <Section title={t('mads_step_audience')} done>
          <div className="flex flex-wrap gap-2">
            <OfferChip active={!campaign.audience_id} label={t('mads_audience_broad')}
              onClick={() => sync({ audience_id: null })} />
            {audiences.filter(a => a.sync_status === 'READY').map(a => (
              <OfferChip key={a.id} active={campaign.audience_id === a.id} label={a.name}
                onClick={() => sync({ audience_id: a.id })} />
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">{t('mads_audience_note')}</p>
        </Section>

        {/* 5 · BUDGET */}
        <Section title={t('mads_step_budget')} done={!!campaign.daily_budget_cents}>
          <BudgetRow
            dailyUsd={String((campaign.daily_budget_cents ?? 500) / 100)}
            days={String(campaign.duration_days ?? 7)}
            onDaily={d => { const c = Math.round(parseFloat(d || '0') * 100); if (c > 0) sync({ daily_budget_cents: c }); }}
            onDays={d => { const n = parseInt(d || '0', 10); if (n > 0) sync({ duration_days: n }); }}
          />
          <p className="mt-2 text-[13px] text-muted-foreground">{t('mads_minimum_days_note')}</p>
          {totals && (
            <dl className="mt-3 max-w-xs space-y-1 rounded-xl border border-border bg-[hsl(var(--secondary))] px-4 py-3 text-sm tabular-nums">
              <div className="flex justify-between"><dt>{t('mads_total_media')}</dt><dd dir="ltr">{money(totals.mediaCents)}</dd></div>
              <div className="flex justify-between"><dt>{t('mads_total_fee', { pct: String(totals.feePercent) })}</dt><dd dir="ltr">{money(totals.feeCents)}</dd></div>
              <div className="flex justify-between border-t border-border pt-1 font-bold"><dt>{t('mads_total_total')}</dt><dd dir="ltr">{money(totals.totalCents)}</dd></div>
            </dl>
          )}
        </Section>

        {/* 6 · CREATIVES */}
        <Section title={t('mads_step_creative')} done={readyCreatives.length > 0}>
          <CreativeStudio campaign={campaign} creatives={creatives}
            onChanged={async () => setCreatives(await listCreatives(campaign.id))}
            aiEnabled={status?.settings.aiAssistEnabled ?? true} />
        </Section>

        {/* 7 · PLACEMENTS */}
        <Section title={t('mads_step_placements')} done>
          <div className="flex gap-2">
            {(['RECOMMENDED', 'CUSTOM'] as const).map(m => (
              <OfferChip key={m} active={(campaign.placements?.mode ?? 'RECOMMENDED') === m}
                label={t(m === 'RECOMMENDED' ? 'mads_placements_reco' : 'mads_placements_custom')}
                onClick={() => sync({ placements: m === 'RECOMMENDED' ? { mode: 'RECOMMENDED' } : { mode: 'CUSTOM', list: ['facebook_feed', 'instagram_feed'] } as never })} />
            ))}
          </div>
          {campaign.placements?.mode === 'CUSTOM' && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['facebook_feed', 'instagram_feed', 'facebook_stories', 'instagram_stories', 'instagram_reels'].map(p => {
                const list = campaign.placements?.list ?? [];
                const on = list.includes(p);
                return (
                  <button key={p} type="button"
                    onClick={() => sync({ placements: { mode: 'CUSTOM', list: on ? list.filter(x => x !== p) : [...list, p] } as never })}
                    className={cn('rounded-full border px-3 py-1 text-[13px]',
                      on ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-[hsl(var(--gold-ink))]' : 'border-border text-muted-foreground')}>
                    {t(`mads_pl_${p}` as never)}
                  </button>
                );
              })}
              <p className="w-full text-[13px] text-muted-foreground">{t('mads_placements_tradeoff')}</p>
            </div>
          )}
        </Section>

        {/* 8 · PREVIEW */}
        <Section title={t('mads_step_preview')} done={readyCreatives.length > 0}>
          {readyCreatives.length === 0
            ? <p className="text-sm text-muted-foreground">{t('mads_preview_none')}</p>
            : <AdPreview creative={readyCreatives[0]} pageName={pageSel?.name ?? 'Page'} />}
        </Section>

        {/* 9 · FINAL CHECK + LAUNCH */}
        <div className="overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover">
          <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_60%)]">
            <ShieldCheck className="h-4 w-4" />{t('mads_step_check')}
          </p>
          {preflight && (
            <ul className="mt-3 space-y-1 text-sm">
              {preflight.checks.map(ch => (
                <li key={ch.key} className="flex items-center gap-2">
                  {ch.ok ? <CheckCircle2 className="h-4 w-4 text-[hsl(152_60%_55%)]" /> : <XCircle className="h-4 w-4 text-[hsl(0_70%_62%)]" />}
                  <span className={ch.ok ? 'text-white/85' : 'text-white'}>{t(`mads_check_${ch.key}` as never)}</span>
                  {ch.detail && !ch.ok && <span className="text-2xs text-white/60">{ch.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[13px] leading-relaxed text-white/70">{t('mads_meta_review_note')}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={doPreflight} disabled={busy !== null}
              className="border border-white/40 bg-white text-[#0C1119] hover:bg-white/90">
              {busy === 'preflight' ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mads_run_preflight')}
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={!canLaunch || busy !== null}
              className="bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:bg-white/[0.14] disabled:text-white/50 disabled:opacity-100">
              {t('mads_launch')}
            </Button>
            {totals && <span className="text-sm text-white/80 tabular-nums" dir="ltr">{money(totals.totalCents)}</span>}
          </div>
        </div>

        {/* EXPLICIT SPEND CONFIRMATION — the money moment, spelled out. */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
            <DialogHeader><DialogTitle>{t('mads_confirm_title')}</DialogTitle></DialogHeader>
            {totals && (
              <dl className="space-y-1 text-sm tabular-nums">
                <div className="flex justify-between"><dt>{t('mads_total_media')}</dt><dd dir="ltr">{money(totals.mediaCents)}</dd></div>
                <div className="flex justify-between"><dt>{t('mads_total_fee', { pct: String(totals.feePercent) })}</dt><dd dir="ltr">{money(totals.feeCents)}</dd></div>
                <div className="flex justify-between border-t border-border pt-1 text-base font-bold"><dt>{t('mads_total_total')}</dt><dd dir="ltr">{money(totals.totalCents)}</dd></div>
                <div className="flex justify-between text-muted-foreground"><dt>{t('mads_confirm_balance')}</dt><dd dir="ltr">{money(wallet?.available_cents ?? 0)}</dd></div>
              </dl>
            )}
            <p className="text-[13px] leading-relaxed text-muted-foreground">{t('mads_confirm_note')}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('general_cancel')}</Button>
              <Button onClick={doLaunch} disabled={busy !== null}
                className="bg-[hsl(var(--gold))] font-bold text-[#161309] hover:bg-[hsl(var(--gold-hover))]">
                {busy === 'launch' ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mads_confirm_go')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

/* ── PIECES ───────────────────────────────────────────────────────────── */

function Section({ title, done, children }: { title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-foreground">
        {done !== undefined && (done
          ? <CheckCircle2 className="h-4 w-4 text-[hsl(152_54%_30%)]" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
        {title}
      </h2>
      {children}
    </section>
  );
}

function OfferChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('max-w-full truncate rounded-full border px-3.5 py-1.5 text-sm transition-colors',
        active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-[hsl(var(--gold-border))]')}>
      {label}
    </button>
  );
}

function GoalPicker({ value, onChange, enabled }: { value: Goal; onChange: (g: Goal) => void; enabled: string[] }) {
  const { t } = useLanguage();
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {GOALS.filter(g => enabled.includes(g)).map(g => (
        <button key={g} type="button" onClick={() => onChange(g)}
          className={cn('rounded-xl border px-3.5 py-3 text-start transition-colors',
            value === g ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border bg-card hover:border-[hsl(var(--gold-border))]')}>
          <p className={cn('text-sm font-semibold', value === g ? 'text-foreground' : 'text-foreground/90')}>
            {t(`mads_goal_${g.toLowerCase()}` as never)}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t(`mads_goal_${g.toLowerCase()}_d` as never)}</p>
        </button>
      ))}
    </div>
  );
}

function BudgetRow({ dailyUsd, days, onDaily, onDays }: {
  dailyUsd: string; days: string; onDaily: (v: string) => void; onDays: (v: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-muted-foreground">{t('mads_budget_daily')}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-bold">$</span>
          <Input inputMode="decimal" dir="ltr" className="w-24" defaultValue={dailyUsd} onBlur={e => onDaily(e.target.value)} />
        </div>
      </label>
      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-muted-foreground">{t('mads_budget_days')}</span>
        <Input inputMode="numeric" dir="ltr" className="w-20" defaultValue={days} onBlur={e => onDays(e.target.value)} />
      </label>
    </div>
  );
}

function CheckLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="h-4 w-4 text-[hsl(152_54%_30%)]" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
      <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </p>
  );
}

/* THE CREATIVE STUDIO — real media, editable copy, honest safety states. */
function CreativeStudio({ campaign, creatives, onChanged, aiEnabled }: {
  campaign: MetaCampaignRow; creatives: MetaCreativeRow[]; onChanged: () => void; aiEnabled: boolean;
}) {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | null) => {
    if (!file || !homatchUser) return;
    if (file.size > 50 * 1024 * 1024) { toast.error(t('mads_media_too_large')); return; }
    setBusy(true);
    try {
      await addCreative(homatchUser.id, campaign.id, file, { headline: '', primaryText: '' });
      onChanged();
    } catch { toast.error(t('mads_upload_failed')); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4" className="hidden"
          onChange={e => upload(e.target.files?.[0] ?? null)} />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          {t('mads_add_media')}
        </Button>
        {aiEnabled && (
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => navigate('/ai', { state: { prompt: t('mads_ai_prompt', { title: campaign.name || campaign.property_id || '' }) } })}>
            <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" />{t('mads_ai_assist')}
          </Button>
        )}
        <p className="w-full text-[13px] text-muted-foreground">{t('mads_creative_hint')}</p>
      </div>
      {creatives.map(cr => <CreativeCard key={cr.id} cr={cr} onChanged={onChanged} />)}
    </div>
  );
}

function CreativeCard({ cr, onChanged }: { cr: MetaCreativeRow; onChanged: () => void }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const p = cr.media?.[0]?.path;
    if (p) creativeMediaUrl(p).then(setUrl).catch(() => {});
  }, [cr.media]);
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-card">
      <div className="flex gap-3">
        {url
          ? (cr.media[0]?.mime?.startsWith('video')
            ? <video src={url} className="h-20 w-28 shrink-0 rounded-lg object-cover" muted />
            : <img src={url} alt="" className="h-20 w-28 shrink-0 rounded-lg object-cover" />)
          : <Skeleton className="h-20 w-28 shrink-0 rounded-lg" />}
        <div className="min-w-0 flex-1 space-y-1.5">
          <Input placeholder={t('mads_headline_ph')} defaultValue={cr.headline}
            onBlur={e => updateCreative(cr.id, { headline: e.target.value }).then(onChanged)} maxLength={80} />
          <Textarea placeholder={t('mads_text_ph')} defaultValue={cr.primary_text} rows={2}
            onBlur={e => updateCreative(cr.id, { primary_text: e.target.value }).then(onChanged)} maxLength={500} />
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between">
          <span className={cn('rounded-full border px-2 py-0.5 text-[13px] font-medium',
            cr.safety_status === 'READY' ? 'border-[hsl(152_40%_40%)]/30 bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)]'
              : cr.safety_status === 'PENDING' ? 'border-border bg-[hsl(var(--secondary))] text-muted-foreground'
                : 'border-destructive/30 bg-destructive/10 text-destructive')}>
            {t(`mads_safety_${cr.safety_status.toLowerCase()}` as never)}
          </span>
          <button type="button" aria-label={t('live_chat_delete')}
            onClick={() => removeCreative(cr.id).then(onChanged)}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-[hsl(var(--secondary))] hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* PREVIEW — clearly an approximation, never claimed to be Meta's exact
 * final rendering. */
function AdPreview({ creative, pageName }: { creative: MetaCreativeRow; pageName: string }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const p = creative.media?.[0]?.path;
    if (p) creativeMediaUrl(p).then(setUrl).catch(() => {});
  }, [creative.media]);
  return (
    <div>
      <p className="mb-2 inline-flex rounded-full border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] px-2 py-0.5 text-[13px] font-semibold uppercase tracking-wide text-[hsl(var(--gold-ink))]">
        {t('mads_preview_badge')}
      </p>
      <div className="max-w-sm overflow-hidden rounded-xl border border-border bg-white shadow-card" dir="ltr">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#0C1119] text-[13px] font-bold text-[hsl(38_92%_60%)]">
            {pageName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="text-[13px] font-semibold text-[#16181d]">{pageName}</p>
            <p className="text-2xs text-[#5b6472]">{t('mads_sponsored')}</p>
          </div>
        </div>
        {creative.primary_text && <p className="px-3 pb-2 text-sm text-[#16181d]">{creative.primary_text}</p>}
        {url
          ? (creative.media[0]?.mime?.startsWith('video')
            ? <video src={url} className="aspect-[4/3] w-full object-cover" muted controls />
            : <img src={url} alt="" className="aspect-[4/3] w-full object-cover" />)
          : <Skeleton className="aspect-[4/3] w-full" />}
        <div className="flex items-center justify-between gap-2 bg-[#f0f2f5] px-3 py-2">
          <p className="min-w-0 truncate text-sm font-semibold text-[#16181d]">{creative.headline || '—'}</p>
          <span className="shrink-0 rounded-md bg-[#e4e6eb] px-3 py-1.5 text-[13px] font-semibold text-[#16181d]">
            {t('mads_preview_cta')}
          </span>
        </div>
      </div>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{t('mads_preview_note')}</p>
    </div>
  );
}
