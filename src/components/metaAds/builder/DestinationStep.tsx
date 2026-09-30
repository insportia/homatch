// WHERE PEOPLE GO — a destination step shaped by the goal, never just "URL".
import React, { useMemo, useState } from 'react';
import { FileText, Globe, MessageCircle, Instagram, Loader2, Plus, Radio, ThumbsUp, Home } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { GOAL_SPECS } from '@/lib/metaAds/payload';
import type { MetaGoal } from '@/lib/metaAds/strategy';
import { createLeadForm, selectMetaAsset, type MetaCampaignRow, type MetaStatus } from '@/services/metaAds';
import { ChoiceCard, StepShell, VerdictBadge } from './ui';
import { selectedAsset, urlProblem } from './steps';

export function DestinationStep({ campaign, status, patch, reloadStatus, propertyUrl }: {
  campaign: MetaCampaignRow; status: MetaStatus | null;
  patch: (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean }) => void;
  reloadStatus: () => Promise<void>;
  propertyUrl: string | null;
}) {
  const { t, lang } = useLanguage();
  const goal = campaign.goal as MetaGoal;
  const spec = GOAL_SPECS[goal];
  const page = selectedAsset(status, 'PAGE');
  const ig = selectedAsset(status, 'INSTAGRAM');
  const dest = campaign.destination ?? { type: 'WEBSITE' };
  const setDest = (p: Partial<NonNullable<MetaCampaignRow['destination']>>, immediate = false) =>
    patch({ destination: { ...dest, ...p } as MetaCampaignRow['destination'] }, { immediate });

  return (
    <StepShell eyebrow={t(`mads_goal_${goal.toLowerCase()}` as never)} title={t('madsb_dest_title')} lead={t(`madsb_dest_lead_${goal.toLowerCase()}` as never)}>
      {spec.needsLeadForm && <LeadFormPicker status={status} campaign={campaign} setDest={setDest} reloadStatus={reloadStatus} lang={lang} />}
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

function LeadFormPicker({ status, campaign, setDest, reloadStatus, lang }: {
  status: MetaStatus | null; campaign: MetaCampaignRow;
  setDest: (p: Partial<NonNullable<MetaCampaignRow['destination']>>, immediate?: boolean) => void;
  reloadStatus: () => Promise<void>; lang: string;
}) {
  const { t } = useLanguage();
  const page = selectedAsset(status, 'PAGE');
  const forms = useMemo(() => (status?.assets ?? []).filter((a) => a.kind === 'LEAD_FORM' && a.status !== 'UNAVAILABLE'
    && (!page || !a.parent_external_id || a.parent_external_id === page.external_id)), [status, page]);
  const chosen = campaign.destination?.formId ?? forms.find((f) => f.selected)?.external_id ?? null;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState('');
  const [fields, setFields] = useState<Array<'FULL_NAME' | 'EMAIL' | 'PHONE'>>(['FULL_NAME', 'PHONE', 'EMAIL']);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const locale = { ka: 'ka_GE', ru: 'ru_RU', tr: 'tr_TR', ar: 'ar_AR', he: 'he_IL' }[lang] ?? 'en_US';
      const r = await createLeadForm({ name: name.trim(), privacyPolicyUrl: privacy.trim(), fields, locale });
      await reloadStatus();
      setDest({ type: 'META_FORM', formId: r.form.external_id }, true);
      setCreating(false);
      toast.success(t('madsb_form_created'));
    } catch (e: any) {
      toast.error(t(String(e?.code ?? '') === 'PRIVACY_URL_REQUIRED' ? 'madsb_form_privacy_required' : String(e?.message ?? '').startsWith('meta_err') ? e.message : 'mads_load_failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground"><FileText className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('madsb_form_title')}</p>
      {!page ? <p className="text-[13px] text-muted-foreground">{t('madsb_gap_page')}</p> : (
        <>
          {forms.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {forms.map((f) => (
                <ChoiceCard key={f.id} active={chosen === f.external_id} title={f.name ?? f.external_id}
                  body={(f.capabilities as { created_by_homatch?: boolean } | undefined)?.created_by_homatch ? t('madsb_form_by_homatch') : t('madsb_form_existing')}
                  onClick={async () => { await selectMetaAsset('LEAD_FORM', f.id).catch(() => undefined); setDest({ type: 'META_FORM', formId: f.external_id }, true); await reloadStatus(); }} />
              ))}
            </div>
          )}
          {!creating ? (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />{t('madsb_form_create')}
            </Button>
          ) : (
            <div className="space-y-2.5 rounded-xl border border-border bg-[hsl(var(--secondary))]/40 p-3.5">
              <Input placeholder={t('madsb_form_name_ph')} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              <Input dir="ltr" inputMode="url" placeholder={t('madsb_form_privacy_ph')} value={privacy} onChange={(e) => setPrivacy(e.target.value)} />
              <p className="text-2xs text-muted-foreground">{t('madsb_form_privacy_why')}</p>
              <div className="flex flex-wrap gap-4">
                {(['FULL_NAME', 'PHONE', 'EMAIL'] as const).map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={fields.includes(f)} onCheckedChange={(v) => setFields((cur) => (v ? [...new Set([...cur, f])] : cur.filter((x) => x !== f)))} />
                    {t(`madsb_form_field_${f.toLowerCase()}` as never)}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={create} disabled={busy || !name.trim() || !/^https:\/\//.test(privacy) || fields.length === 0}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('madsb_form_create_go')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>{t('general_cancel')}</Button>
              </div>
            </div>
          )}
          <p className={cn('text-[13px] leading-relaxed text-muted-foreground')}>{t('madsb_form_delivery')}</p>
        </>
      )}
    </div>
  );
}
