// META ADS — one lead's record. Contact details are PRIVATE: they appear only
// here, inside the authenticated owner's workspace — never in a page title,
// a URL or a toast. A lead is a potentially interested person, nothing more.
//
// The workspace: quality (automatic from the person's own answers, with the
// reasons; the owner's rating wins), the next follow-up, why it was lost,
// the timeline (database-written), and a follow-up DRAFT built only from
// what the lead told us — copied by the owner, never sent by HOMATCH.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { listLeadEvents, updateMetaLead, type MetaLeadEventRow, type MetaLeadRow } from '@/services/metaAds';
import { autoQuality, LOST_REASONS } from '@/lib/metaAds/leadCenter';
import { SELECT_CLASS } from './format';
import { dateTime } from './format';
import { LeadStatusSelect } from './LeadStatusSelect';

/** The premium lead form's qualifying questions, in the order they are asked. */
export const ANSWER_KEYS = ['buy_or_rent', 'budget', 'preferred_location', 'property_type', 'bedrooms', 'timeframe', 'agent_contact'] as const;

export const leadName = (l: MetaLeadRow) => {
  const f = l.fields ?? {};
  return String(f.full_name ?? f.name ?? '').trim();
};

/** A first message from facts the lead gave — no invented details, nothing sent. */
export function followUpDraft(t: (k: string, v?: Record<string, string>) => string, lead: MetaLeadRow, campaign: string | null): string {
  const first = leadName(lead).split(/\s+/)[0] ?? '';
  const a = lead.answers ?? {};
  const parts = [t(first ? 'mm_lc_draft_hello_name' : 'mm_lc_draft_hello', { name: first })];
  parts.push(t(campaign ? 'mm_lc_draft_thanks_campaign' : 'mm_lc_draft_thanks', { campaign: campaign ?? '' }));
  if (a.preferred_location) parts.push(t('mm_lc_draft_location', { place: String(a.preferred_location) }));
  if (a.budget) parts.push(t('mm_lc_draft_budget', { budget: String(a.budget) }));
  parts.push(t('mm_lc_draft_close'));
  return parts.join(' ');
}

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function LeadRecordDrawer({ lead, campaignName, onClose, onStatus, onNote, onPatch, repeats = 1 }: {
  lead: MetaLeadRow | null;
  campaignName: (id: string | null) => string | null;
  onClose: () => void;
  onStatus: (lead: MetaLeadRow, status: string) => Promise<boolean>;
  onNote: (lead: MetaLeadRow, note: string) => void;
  onPatch?: (lead: MetaLeadRow, patch: Partial<MetaLeadRow>) => void;
  /** Submissions by the same person (contact key) — shown, never merged. */
  repeats?: number;
}) {
  const { t, lang, isRTL } = useLanguage();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [events, setEvents] = useState<MetaLeadEventRow[] | null>(null);
  useEffect(() => { setNote(lead?.note ?? ''); }, [lead?.id, lead?.note]);
  useEffect(() => {
    if (!lead?.id) { setEvents(null); return; }
    let live = true;
    listLeadEvents(lead.id).then((e) => { if (live) setEvents(e); }).catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [lead?.id, lead?.status, lead?.follow_up_at, lead?.quality, lead?.note]);

  const save = async (patch: Partial<MetaLeadRow>) => {
    if (!lead) return;
    try {
      await updateMetaLead(lead.id, patch as never);
      onPatch?.(lead, patch);
      toast.success(t('mm_lc_saved'));
    } catch { toast.error(t('mm_w_lead_save_failed')); }
  };
  const followIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(10, 0, 0, 0); void save({ follow_up_at: d.toISOString() }); };

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

            {lead.status === 'LOST' && (
              <label className="block space-y-1">
                <span className="text-2xs font-medium text-muted-foreground">{t('mm_lc_lost_reason')}</span>
                <select className={SELECT_CLASS} value={lead.lost_reason ?? ''} data-mm-lc-lost=""
                  onChange={(e) => void save({ lost_reason: e.target.value || null })}>
                  <option value="">—</option>
                  {LOST_REASONS.map((r) => <option key={r} value={r}>{t(`mm_lc_lost_${r}`)}</option>)}
                </select>
              </label>
            )}
            {lead.status === 'WON' && lead.won_at && <p className="text-[13px] text-foreground">{t('mm_lc_won_on', { date: dateTime(lead.won_at, lang) })}</p>}

            {/* NEXT FOLLOW-UP — the owner's own time zone. */}
            <section aria-labelledby="mm-lc-fu" className="space-y-1.5" data-mm-lc-followup="">
              <h3 id="mm-lc-fu" className="text-sm font-semibold text-foreground">{t('mm_lc_followup')}</h3>
              <input type="datetime-local" className={SELECT_CLASS} value={toLocalInput(lead.follow_up_at)} aria-labelledby="mm-lc-fu"
                onChange={(e) => void save({ follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="min-h-11" onClick={() => followIn(1)}>{t('mm_lc_fu_tomorrow')}</Button>
                <Button size="sm" variant="outline" className="min-h-11" onClick={() => followIn(3)}>{t('mm_lc_fu_3days')}</Button>
                {lead.follow_up_at && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => void save({ follow_up_at: null })}>{t('mm_lc_fu_clear')}</Button>}
              </div>
            </section>

            {/* QUALITY — explainable; a manual rating stays. */}
            <section aria-labelledby="mm-lc-q" className="space-y-1.5" data-mm-lc-quality-edit={lead.quality_source ?? 'AUTO'}>
              <h3 id="mm-lc-q" className="text-sm font-semibold text-foreground">{t('mm_lc_quality')}</h3>
              <select className={SELECT_CLASS} value={lead.quality ?? 'UNRATED'} aria-labelledby="mm-lc-q"
                onChange={(e) => void save({ quality: e.target.value as MetaLeadRow['quality'], quality_source: 'MANUAL' })}>
                {(['HIGH', 'MEDIUM', 'LOW', 'UNRATED'] as const).map((q) => <option key={q} value={q}>{t(`mm_lc_q_${q}`)}</option>)}
              </select>
              <p className="text-2xs leading-relaxed text-muted-foreground">
                {lead.quality_source === 'MANUAL' ? t('mm_lc_q_manual')
                  : autoQuality(lead).reasons.map((r) => t(`mm_lc_qr_${r}`)).join(' · ') || t('mm_lc_q_no_reasons')}
              </p>
              {repeats > 1 && <p className="text-2xs text-muted-foreground" data-mm-lc-repeat="">{t('mm_lc_repeat_long', { n: String(repeats) })}</p>}
            </section>

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

            {/* A DRAFT to copy — HOMATCH never sends it. */}
            <section aria-labelledby="mm-lc-draft" className="space-y-1.5" data-mm-lc-draft="">
              <h3 id="mm-lc-draft" className="text-sm font-semibold text-foreground">{t('mm_lc_draft_title')}</h3>
              <p className="whitespace-pre-wrap rounded-xl border border-border bg-[hsl(var(--secondary))]/40 p-3 text-[13px] leading-relaxed" dir="auto">{followUpDraft(t as never, lead, cName)}</p>
              <Button size="sm" variant="outline" className="min-h-11 gap-1.5"
                onClick={() => { void navigator.clipboard?.writeText(followUpDraft(t as never, lead, cName)).then(() => toast.success(t('mm_lc_copied'))).catch(() => undefined); }}>
                <Copy className="h-3.5 w-3.5" aria-hidden />{t('mm_lc_copy')}
              </Button>
              <p className="text-2xs text-muted-foreground">{t('mm_lc_draft_never_sent')}</p>
            </section>

            {/* TIMELINE — written by the database, newest first. */}
            <section aria-labelledby="mm-lc-tl" className="space-y-1.5" data-mm-lc-timeline="">
              <h3 id="mm-lc-tl" className="text-sm font-semibold text-foreground">{t('mm_lc_timeline')}</h3>
              {events === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : events.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t('mm_lc_timeline_empty')}</p>
              ) : (
                <ol className="space-y-1 text-[13px]">
                  {events.map((e) => (
                    <li key={e.id} className="flex justify-between gap-3">
                      <span className="min-w-0">{e.kind === 'STATUS' ? t('mm_lc_ev_STATUS', { to: t(`mm_w_lead_status_${e.to_value}`) })
                        : e.kind === 'QUALITY' ? t('mm_lc_ev_QUALITY', { to: t(`mm_lc_q_${e.to_value}`) }) : t(`mm_lc_ev_${e.kind}`)}</span>
                      <span className="shrink-0 text-2xs text-muted-foreground">{dateTime(e.at, lang)}</span>
                    </li>
                  ))}
                </ol>
              )}
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
