// WHERE PEOPLE GO — a destination step shaped by the goal, never just "URL".
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileText, Globe, MessageCircle, Instagram, Loader2, Plus, Radio, ThumbsUp, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { GOAL_SPECS } from '@/lib/metaAds/payload';
import type { MetaGoal } from '@/lib/metaAds/strategy';
import { recheckLeadForms, selectMetaAsset, type MetaCampaignRow, type MetaStatus } from '@/services/metaAds';
import { ChoiceCard, StepShell, VerdictBadge } from './ui';
import { selectedAsset, urlProblem } from './steps';
import { LeadFormBuilder } from './LeadFormBuilder';
import { formsStateOf, FORMS_COPY, leadTermsOf } from './instantFormsCopy';
import { destinationForGoal } from './masterLogic';
import { LeadTermsFlow } from './LeadTermsFlow';
import { Hint } from './FinishKit';

export function DestinationStep({ campaign, status, patch, reloadStatus, propertyUrl }: {
  campaign: MetaCampaignRow; status: MetaStatus | null;
  patch: (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean }) => void;
  reloadStatus: () => Promise<void>;
  propertyUrl: string | null;
}) {
  const { t } = useLanguage();
  const goal = campaign.goal as MetaGoal;
  const spec = GOAL_SPECS[goal];
  const page = selectedAsset(status, 'PAGE');
  const ig = selectedAsset(status, 'INSTAGRAM');
  const dest = campaign.destination ?? { type: 'WEBSITE' };
  const setDest = (p: Partial<NonNullable<MetaCampaignRow['destination']>>, immediate = false) =>
    patch({ destination: { ...dest, ...p } as MetaCampaignRow['destination'] }, { immediate });

  return (
    <StepShell eyebrow={t(`mads_goal_${goal.toLowerCase()}` as never)} title={t('madsb_dest_title')} lead={t(`madsb_dest_lead_${goal.toLowerCase()}` as never)}>
      <Hint k={spec.needsLeadForm ? 'mm_c_hint_forms' : spec.needsPixel ? 'mm_c_hint_pixel' : 'mm_c_hint_destination'} />
      {spec.needsLeadForm && <LeadFormPicker status={status} campaign={campaign} setDest={setDest} reloadStatus={reloadStatus} patch={patch} />}
      {spec.needsWebsiteUrl && <WebsiteDestination campaign={campaign} setDest={setDest} propertyUrl={goal === 'PROMOTE' ? propertyUrl : null} />}
      {spec.needsPixel && <PixelPicker status={status} reloadStatus={reloadStatus} event={spec.pixelEvent} />}
      {spec.needsMessagingApp && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t('madsb_msg_where')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard active={dest.messagingApp === 'MESSENGER'} disabled={!page} icon={<MessageCircle className="h-4 w-4" />}
              title={t('madsb_msg_messenger')} body={page ? t('madsb_msg_messenger_d', { page: page.name ?? '' }) : t('madsb_gap_page')}
              onClick={() => setDest({ type: 'MESSAGING', messagingApp: 'MESSENGER' }, true)} />
            {ig ? (
              <ChoiceCard active={dest.messagingApp === 'INSTAGRAM_DIRECT'} icon={<Instagram className="h-4 w-4" />}
                title={t('madsb_msg_instagram')} body={t('madsb_msg_instagram_d', { account: ig.name ?? '' })}
                onClick={() => setDest({ type: 'MESSAGING', messagingApp: 'INSTAGRAM_DIRECT' }, true)} />
            ) : null}
            {status?.settings.whatsappEnabled && selectedAsset(status, 'WHATSAPP') ? (
              <ChoiceCard active={dest.messagingApp === 'WHATSAPP'} icon={<MessageCircle className="h-4 w-4" />}
                title={t('madsb_msg_whatsapp')} body={t('madsb_msg_whatsapp_d')}
                onClick={() => setDest({ type: 'MESSAGING', messagingApp: 'WHATSAPP' }, true)} />
            ) : null}
          </div>
          {!ig && <p className="text-[13px] text-muted-foreground">{t('madsb_msg_instagram_hint')}</p>}
          <p className="text-[13px] leading-relaxed text-muted-foreground">{t('madsb_msg_telemetry_note')}</p>
        </div>
      )}
      {goal === 'ENGAGEMENT' && (
        <div className="rounded-xl border border-border bg-[hsl(var(--secondary))]/50 p-3.5 text-sm">
          <p className="flex items-center gap-2 font-medium text-foreground"><ThumbsUp className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('madsb_eng_identity')}</p>
          <p className="mt-1 text-muted-foreground">{page ? t('madsb_eng_identity_d', { page: page.name ?? '' }) : t('madsb_gap_page')}{ig ? ` · ${ig.name}` : ''}</p>
        </div>
      )}
    </StepShell>
  );
}

function WebsiteDestination({ campaign, setDest, propertyUrl }: {
  campaign: MetaCampaignRow; setDest: (p: Partial<NonNullable<MetaCampaignRow['destination']>>, immediate?: boolean) => void;
  propertyUrl: string | null;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(campaign.destination?.url ?? '');
  const problem = urlProblem(value);
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground"><Globe className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('madsb_url_label')}</span>
        <Input dir="ltr" inputMode="url" placeholder="https://" value={value}
          aria-invalid={!!problem && value.length > 0}
          onChange={(e) => { setValue(e.target.value); setDest({ type: 'WEBSITE', url: e.target.value.trim() }); }} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {value ? (problem ? <VerdictBadge verdict="ACTION_REQUIRED" label={t(problem as never)} /> : <VerdictBadge verdict="READY" label={t('madsb_url_ok')} />) : null}
        {propertyUrl && value !== propertyUrl && (
          <Button type="button" variant="outline" size="sm" className="gap-1.5"
            onClick={() => { setValue(propertyUrl); setDest({ type: 'WEBSITE', url: propertyUrl }, true); }}>
            <Home className="h-3.5 w-3.5" />{t('madsb_use_property_page')}
          </Button>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">{t('madsb_url_reachability_note')}</p>
    </div>
  );
}

function PixelPicker({ status, reloadStatus, event }: { status: MetaStatus | null; reloadStatus: () => Promise<void>; event: string | null }) {
  const { t } = useLanguage();
  const acct = selectedAsset(status, 'AD_ACCOUNT');
  const pixels = (status?.assets ?? []).filter((a) => a.kind === 'PIXEL' && a.status !== 'UNAVAILABLE' && (!acct || !a.parent_external_id || a.parent_external_id === acct.external_id));
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground"><Radio className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('madsb_pixel_title')}</p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{t('madsb_pixel_lead', { event: event ?? '' })}</p>
      {pixels.length === 0 ? (
        <p className="rounded-xl border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] px-3 py-2 text-[13px] text-foreground">{t('madsb_pixel_none')}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {pixels.map((p) => {
            const fired = (p.capabilities as { last_fired_time?: string | null } | undefined)?.last_fired_time;
            return (
              <ChoiceCard key={p.id} active={p.selected} title={p.name ?? p.external_id}
                body={fired ? t('madsb_pixel_fired', { when: new Date(fired).toLocaleDateString() }) : t('madsb_pixel_never_fired')}
                onClick={async () => { setBusy(p.id); try { await selectMetaAsset('PIXEL', p.id); await reloadStatus(); } finally { setBusy(null); } }}
                icon={busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeadFormPicker({ status, campaign, setDest, reloadStatus, patch }: {
  status: MetaStatus | null; campaign: MetaCampaignRow;
  patch: (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean }) => void;
  setDest: (p: Partial<NonNullable<MetaCampaignRow['destination']>>, immediate?: boolean) => void;
  reloadStatus: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const page = selectedAsset(status, 'PAGE');
  const forms = useMemo(() => (status?.assets ?? []).filter((a) => a.kind === 'LEAD_FORM' && a.status !== 'UNAVAILABLE'
    && (!page || !a.parent_external_id || a.parent_external_id === page.external_id)), [status, page]);
  const chosen = campaign.destination?.formId ?? forms.find((f) => f.selected)?.external_id ?? null;
  const [creating, setCreating] = useState(false);
  const formsState = formsStateOf(status);
  const terms = leadTermsOf(status);
  /* Leads chosen and the Page never checked: ask Meta once, quietly — the
     state shown is then Meta's answer, not a guess. */
  const asked = React.useRef(false);
  React.useEffect(() => {
    if (asked.current || status?.mode !== 'REAL' || !page || status?.connection?.status !== 'CONNECTED') return;
    if (status.connection.lead_checked_at) return;
    asked.current = true;
    recheckLeadForms().then(() => reloadStatus()).catch(() => undefined);
  }, [status, page, reloadStatus]);
  const messagesOn = (status?.settings.goalsEnabled ?? []).includes('MESSAGES');

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground"><FileText className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('madsb_form_title')}</p>
      {!page ? <p className="text-[13px] text-muted-foreground">{t('madsb_gap_page')}</p> : (
        <>
          {forms.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {forms.map((f) => (
                <ChoiceCard key={f.id} active={chosen === f.external_id} title={f.name ?? f.external_id}
                  body={[
                    (f.capabilities as { created_by_homatch?: boolean } | undefined)?.created_by_homatch ? t('madsb_form_by_homatch') : t('madsb_form_existing'),
                    Array.isArray((f.capabilities as { questions?: unknown[] } | undefined)?.questions) ? t('mm_c_lf_n_questions', { n: String(((f.capabilities as { questions: unknown[] }).questions).length) }) : null,
                    (f.capabilities as { locale?: string } | undefined)?.locale ?? null,
                  ].filter(Boolean).join(' · ')}
                  onClick={async () => { await selectMetaAsset('LEAD_FORM', f.id).catch(() => undefined); setDest({ type: 'META_FORM', formId: f.external_id }, true); await reloadStatus(); }} />
              ))}
            </div>
          )}
          {formsState !== 'READY' && formsState !== 'DISABLED' && (
            /* What Meta confirmed, row by row, and ONE action for the first real
               blocker. Never a permission name; "not confirmed" is never "not accepted". */
            <div role="status" data-mm-forms-state={formsState} className="space-y-2 rounded-xl border border-[hsl(var(--gold-border))]/70 bg-[hsl(var(--gold-soft))] px-3.5 py-3 text-[13px] leading-relaxed text-foreground">
              <ul className="space-y-1" aria-label={t('mm_c_lf_ready_title')}>
                {([
                  ['perms', formsState === 'PERMISSIONS_MISSING' ? 'todo' : 'ok'],
                  ['terms', terms === 'ACCEPTED' ? 'ok' : terms === 'REQUIRED' ? 'todo' : 'unknown'],
                  ['access', formsState === 'FORM_ACCESS_UNAVAILABLE' ? 'todo' : formsState === 'PERMISSIONS_MISSING' ? 'unknown' : status?.connection?.instant_forms === 'READY' || terms === 'ACCEPTED' ? 'ok' : 'unknown'],
                ] as const).map(([row, st]) => (
                  <li key={row} data-mm-lf-row={row} data-mm-lf-row-state={st} className="flex items-start gap-2">
                    <span aria-hidden className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                      st === 'ok' ? 'bg-[hsl(152_54%_28%)] text-white' : st === 'todo' ? 'bg-[hsl(32_78%_45%)] text-white' : 'border border-muted-foreground/50 text-muted-foreground')}>
                      {st === 'ok' ? '✓' : st === 'todo' ? '!' : '?'}
                    </span>
                    <span><span className="font-medium">{t(`mm_c_lf_row_${row}`)}</span> · {t(`mm_c_lf_state_${st}`)}</span>
                  </li>
                ))}
              </ul>
              <p>{t(FORMS_COPY[formsState])}</p>
              {formsState === 'TERMS_REQUIRED' && status?.connection?.instant_forms_next && status.connection.instant_forms_next !== 'READY' && status.connection.instant_forms_next !== 'DISABLED' && (
                <p className="text-2xs text-muted-foreground" data-mm-terms-next={status.connection.instant_forms_next}>{t('mm_l_next', { next: t(FORMS_COPY[status.connection.instant_forms_next as keyof typeof FORMS_COPY]) })}</p>
              )}
              {formsState === 'PERMISSIONS_MISSING' || formsState === 'FORM_ACCESS_UNAVAILABLE' ? (
                <Link to={{ search: `?draft=${encodeURIComponent(campaign.id)}&step=account` }} data-mm-forms-action="RECONNECT"
                  className="inline-flex min-h-11 items-center rounded-full bg-[hsl(var(--gold))] px-4 text-[13px] font-semibold text-[#161309] hover:bg-[hsl(var(--gold-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                  {t('mm_m_forms_reconnect_cta')}
                </Link>
              ) : formsState === 'TERMS_REQUIRED' || formsState === 'TERMS_UNKNOWN' || formsState === 'META_ERROR' ? (
                <LeadTermsFlow status={status} onRechecked={reloadStatus} checkOnly={formsState !== 'TERMS_REQUIRED'} />
              ) : null}
              {/* One action: the fix when there is one in HOMATCH; messages only when there is none. */}
              {formsState === 'PAGE_UNAVAILABLE' && messagesOn && (
                <button type="button" data-mm-forms-action="USE_MESSAGES"
                  onClick={() => patch({ goal: 'MESSAGES', destination: destinationForGoal('MESSAGES', campaign.destination, !!page) } as never, { immediate: true })}
                  className="inline-flex min-h-11 items-center rounded-full border border-[hsl(var(--gold-border))] bg-card px-4 text-[13px] font-semibold text-foreground hover:bg-[hsl(var(--gold-soft))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                  {t('mm_m_forms_use_messages')}
                </button>
              )}
            </div>
          )}
          {formsState === 'READY' && (!creating ? (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setCreating(true)} data-mm-lf-open="">
              <Plus className="h-3.5 w-3.5" />{t('mm_b_lf_open')}
            </Button>
          ) : (
            <LeadFormBuilder propertyId={campaign.property_id} formsState={formsState} pageName={page?.name ?? null}
              context={{
                isProperty: !!campaign.property_id || (campaign.offer as { isProperty?: boolean } | null)?.isProperty === true,
                dealKind: (campaign.offer as { dealKind?: string } | null)?.dealKind ?? null,
              }}
              onCreated={async (externalId) => { await reloadStatus(); setDest({ type: 'META_FORM', formId: externalId }, true); setCreating(false); }}
              onCancel={() => setCreating(false)} />
          ))}
          <p className={cn('text-[13px] leading-relaxed text-muted-foreground')}>{t('madsb_form_delivery')}</p>
        </>
      )}
    </div>
  );
}
