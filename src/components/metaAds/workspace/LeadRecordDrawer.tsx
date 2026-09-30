// META ADS — one lead's record. Contact details are PRIVATE: they appear only
// here, inside the authenticated owner's workspace — never in a page title,
// a URL or a toast. A lead is a potentially interested person, nothing more.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { updateMetaLead, type MetaLeadRow } from '@/services/metaAds';
import { dateTime } from './format';
import { LeadStatusSelect } from './LeadStatusSelect';

/** The premium lead form's qualifying questions, in the order they are asked. */
export const ANSWER_KEYS = ['buy_or_rent', 'budget', 'preferred_location', 'property_type', 'bedrooms', 'timeframe', 'agent_contact'] as const;

export const leadName = (l: MetaLeadRow) => {
  const f = l.fields ?? {};
  return String(f.full_name ?? f.name ?? '').trim();
};

export function LeadRecordDrawer({ lead, campaignName, onClose, onStatus, onNote }: {
  lead: MetaLeadRow | null;
  campaignName: (id: string | null) => string | null;
  onClose: () => void;
  onStatus: (lead: MetaLeadRow, status: string) => Promise<boolean>;
  onNote: (lead: MetaLeadRow, note: string) => void;
}) {
  const { t, lang, isRTL } = useLanguage();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setNote(lead?.note ?? ''); }, [lead?.id, lead?.note]);

  const saveNote = async () => {
    if (!lead) return;
    setSaving(true);
    try {
      await updateMetaLead(lead.id, { note });
      onNote(lead, note);
      toast.success(t('mm_w_lead_note_saved'));
    } catch {
      toast.error(t('mm_w_lead_save_failed'));
    } finally { setSaving(false); }
  };

  const f = lead?.fields ?? {};
  const email = (f.email ?? '') as string;
  const phone = (f.phone_number ?? f.phone ?? '') as string;
  const answers = lead?.answers ?? {};
  const known = ANSWER_KEYS.filter(k => answers[k] != null && String(answers[k]).trim() !== '');
  const extra = Object.keys(answers).filter(k => !(ANSWER_KEYS as readonly string[]).includes(k) && String(answers[k] ?? '').trim() !== '');
  const cName = lead ? campaignName(lead.campaign_id) : null;
  const unknown = t('mm_w_lead_attr_unknown');

  return (
    <Sheet open={!!lead} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent side={isRTL ? 'left' : 'right'} className="w-full overflow-y-auto sm:max-w-md">
        {lead && (
          <div className="space-y-5 pb-6">
            <SheetHeader className="pe-8 text-start">
              <SheetTitle className="break-words">{leadName(lead) || t('mads_lead_unnamed')}</SheetTitle>
              <SheetDescription>{t('mm_w_leads_intro')}</SheetDescription>
            </SheetHeader>

            <div className="space-y-1">
              <p className="text-2xs font-medium text-muted-foreground">{t('mm_w_lead_change_status')}</p>
              <LeadStatusSelect lead={lead} onChange={s => onStatus(lead, s)} />
            </div>

            <section aria-labelledby="mm-w-lead-contact" className="space-y-1.5">
              <h3 id="mm-w-lead-contact" className="text-sm font-semibold text-foreground">{t('mm_w_lead_contact')}</h3>
              <p className="text-2xs text-muted-foreground">{t('mm_w_lead_contact_private')}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t('mm_w_lead_name')}</dt>
                <dd className="min-w-0 break-words">{leadName(lead) || '—'}</dd>
                <dt className="text-muted-foreground">{t('mm_w_lead_phone')}</dt>
                <dd className="min-w-0 break-all" dir="ltr">{phone ? <a className="hover:underline" href={`tel:${phone}`}>{phone}</a> : '—'}</dd>
                <dt className="text-muted-foreground">{t('mm_w_lead_email')}</dt>
                <dd className="min-w-0 break-all" dir="ltr">{email ? <a className="hover:underline" href={`mailto:${email}`}>{email}</a> : '—'}</dd>
              </dl>
            </section>

            <section aria-labelledby="mm-w-lead-answers" className="space-y-1.5">
              <h3 id="mm-w-lead-answers" className="text-sm font-semibold text-foreground">{t('mm_w_lead_answers')}</h3>
              {known.length + extra.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t('mm_w_lead_no_answers')}</p>
              ) : (
                <dl className="space-y-1.5 text-sm">
                  {known.map(k => (
                    <div key={k}>
                      <dt className="text-2xs text-muted-foreground">{t(`mm_w_answer_${k}`)}</dt>
                      <dd className="break-words">{String(answers[k])}</dd>
                    </div>
                  ))}
                  {extra.map(k => (
                    <div key={k}>
                      <dt className="break-words text-2xs text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
                      <dd className="break-words">{String(answers[k])}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section aria-labelledby="mm-w-lead-attr" className="space-y-1.5">
              <h3 id="mm-w-lead-attr" className="text-sm font-semibold text-foreground">{t('mm_w_lead_attribution')}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t('mm_w_lead_attr_campaign')}</dt>
                <dd className="min-w-0 break-words">
                  {lead.campaign_id
                    ? <Link className="text-[hsl(var(--gold-ink))] hover:underline" to={`/outreach/meta/campaigns/${lead.campaign_id}`}>{cName || lead.campaign_id}</Link>
                    : unknown}
                </dd>
                <dt className="text-muted-foreground">{t('mm_w_lead_attr_ad')}</dt>
                <dd className="min-w-0 break-all tabular-nums" dir="ltr">{lead.ad_external_id || unknown}</dd>
                <dt className="text-muted-foreground">{t('mm_w_lead_attr_adset')}</dt>
                <dd className="min-w-0 break-all tabular-nums" dir="ltr">{lead.adset_external_id || unknown}</dd>
                <dt className="text-muted-foreground">{t('mm_w_lead_attr_property')}</dt>
                <dd className="min-w-0 break-all tabular-nums" dir="ltr">{lead.property_id || unknown}</dd>
                <dt className="text-muted-foreground">{t('mm_w_lead_received')}</dt>
                <dd className="min-w-0">{dateTime(lead.received_at, lang)}</dd>
                {lead.meta_created_time && (
                  <>
                    <dt className="text-muted-foreground">{t('mm_w_lead_meta_time')}</dt>
                    <dd className="min-w-0">{dateTime(lead.meta_created_time, lang)}</dd>
                  </>
                )}
              </dl>
            </section>

            <section className="space-y-1.5">
              <label htmlFor="mm-w-lead-note" className="text-sm font-semibold text-foreground">{t('mm_w_lead_notes')}</label>
              <Textarea id="mm-w-lead-note" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={4}
                placeholder={t('mm_w_lead_notes_ph')} />
              <Button size="sm" onClick={saveNote} disabled={saving || note === (lead.note ?? '')}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mm_w_lead_note_save')}
              </Button>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
