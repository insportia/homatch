/*
 * AI OUTREACH COMPOSER (Find Buyers 2.0, owner 2026-10-18).
 *
 * For one unlocked lead: pick the channel, tone, purpose and language, generate a draft
 * from the listing facts and the member's documented search (outreach-send →
 * studio_lead_draft), then read, edit, copy and send it YOURSELF. Generating never sends
 * and never marks the lead contacted.
 *
 * Channels are honest about what HOMATCH can do:
 *   HOMATCH_CHAT  copy, then the canonical conversation opens (the owner sends it there);
 *   EMAIL         the consent-gated Email Studio (review, schedule or send after approval);
 *   WHATSAPP/SMS  the owner's own app opens with the text, only when the member shares a phone;
 *   TELEGRAM      copy only — HOMATCH has no Telegram send for members.
 * "I sent it" records the owner's own statement (crm_update.logContact); nothing else does.
 */

import { Check, Copy, ExternalLink, Loader2, Mail, MessageSquare, RefreshCw, Send, Sparkles } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useServiceVisible } from '@/lib/serviceControls';
import { cn } from '@/lib/utils';
import {
  crmUpdate, generateLeadDraft, LeadDraftError, type LeadDraftRequest,
} from '@/services/leadsCrm';
import { permittedPhone, type LeadContact } from '@/services/homatchLeads';
import { FIELD, GOLD_BUTTON, SECONDARY_BUTTON, SectionCard } from './ui';

const CHANNELS: LeadDraftRequest['channel'][] = ['HOMATCH_CHAT', 'EMAIL', 'WHATSAPP', 'TELEGRAM', 'SMS'];
const TONES: LeadDraftRequest['tone'][] = ['PROFESSIONAL', 'FRIENDLY', 'PREMIUM', 'CONCISE', 'FORMAL'];
const PURPOSES: LeadDraftRequest['purpose'][] = ['INTRODUCTION', 'RECOMMENDATION', 'FOLLOW_UP', 'VIEWING_INVITATION', 'FINAL_FOLLOW_UP'];
const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
const LANG_NAME: Record<string, string> = { ka: 'ქართული', en: 'English', ru: 'Русский', tr: 'Türkçe', ar: 'العربية', he: 'עברית' };

/** The log channel a draft channel corresponds to (HOMATCH chat is logged by the message itself). */
const LOG_CHANNEL: Record<LeadDraftRequest['channel'], 'EMAIL' | 'WHATSAPP' | 'TELEGRAM' | 'SMS' | null> = {
  HOMATCH_CHAT: null, EMAIL: 'EMAIL', WHATSAPP: 'WHATSAPP', TELEGRAM: 'TELEGRAM', SMS: 'SMS',
};

export function LeadOutreachComposer({
  entryId, propertyId, memberLanguage, contact, conversationId, onOpenConversation, onOpenEmailStudio, onLogged,
}: {
  entryId: string;
  propertyId: string | null;
  /** The member's preferred language, when known. */
  memberLanguage: string | null;
  /** internal_lead_contact's answer: consent and blocks re-checked on every read. */
  contact: LeadContact | null;
  conversationId: string | null;
  onOpenConversation: () => void;
  onOpenEmailStudio: () => void;
  onLogged: () => void;
}) {
  const phone = permittedPhone(contact);
  const { t } = useLanguage();
  /* EMAIL drafts are Email Studio's (service email_marketing, hidden 2026-10-29): while it is off
     the channel is not offered and the server refuses it too. The lead's address is copied
     from the contact card instead. */
  const emailMarketing = useServiceVisible('email_marketing');
  const channels = emailMarketing ? CHANNELS : CHANNELS.filter((c) => c !== 'EMAIL');
  const startLang = (LANGS as readonly string[]).includes(String(memberLanguage)) ? String(memberLanguage) : 'ka';
  const [channel, setChannel] = useState<LeadDraftRequest['channel']>('HOMATCH_CHAT');
  const [tone, setTone] = useState<LeadDraftRequest['tone']>('PROFESSIONAL');
  const [purpose, setPurpose] = useState<LeadDraftRequest['purpose']>('INTRODUCTION');
  const [language, setLanguage] = useState<string>(startLang);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<null | 'gen' | 'log'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setLanguage(startLang); }, [startLang]);
  useEffect(() => { setCopied(false); }, [body, subject]);

  const generate = async () => {
    setBusy('gen'); setError(null);
    try {
      const d = await generateLeadDraft({ entryId, propertyId, channel, tone, purpose, language });
      setSubject(d.subject ?? '');
      setBody(d.body);
    } catch (e) {
      setError(e instanceof LeadDraftError ? e.code : 'AI_FAILED');
    } finally {
      setBusy(null);
    }
  };

  const text = channel === 'EMAIL' && subject.trim() ? `${subject.trim()}\n\n${body.trim()}` : body.trim();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t('lo_copied'));
    } catch {
      toast.error(t('lo_copy_failed'));
    }
  };
  const digits = phone ? phone.replace(/[^\d]/g, '') : '';
  const external = channel === 'WHATSAPP' && digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : channel === 'SMS' && phone ? `sms:${phone}?body=${encodeURIComponent(text)}` : null;

  const logSent = async () => {
    const ch = LOG_CHANNEL[channel];
    if (!ch) return;
    setBusy('log');
    try {
      await crmUpdate(entryId, { logContact: ch });
      toast.success(t('lo_logged'));
      onLogged();
    } catch {
      toast.error(t('crm_save_failed'));
    } finally {
      setBusy(null);
    }
  };

  const select = (id: string, label: string, value: string, set: (v: string) => void, options: Array<[string, string]>) => (
    <label htmlFor={id} className="grid min-w-0 gap-1 text-xs font-semibold text-[hsl(218_28%_30%)]">
      <span>{label}</span>
      <select id={id} className={cn(FIELD, 'h-11 min-w-0')} value={value} onChange={(e) => set(e.target.value)} disabled={busy !== null}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <SectionCard title={t('lo_title')} icon={Sparkles} labelledBy="lo-h">
      <p className="text-xs leading-relaxed text-[hsl(218_28%_34%)]">{t('lo_intro')}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="lo-controls">
        {select('lo-channel', t('lo_channel'), channel, (v) => setChannel(v as LeadDraftRequest['channel']), channels.map((c) => [c, t(`lo_channel_${c}`)]))}
        {select('lo-purpose', t('lo_purpose'), purpose, (v) => setPurpose(v as LeadDraftRequest['purpose']), PURPOSES.map((p) => [p, t(`lo_purpose_${p}`)]))}
        {select('lo-tone', t('lo_tone'), tone, (v) => setTone(v as LeadDraftRequest['tone']), TONES.map((x) => [x, t(`lo_tone_${x}`)]))}
        {select('lo-lang', t('lo_language'), language, setLanguage, LANGS.map((l) => [l, LANG_NAME[l]]))}
      </div>
      {memberLanguage ? <p className="mt-1.5 text-2xs text-[hsl(218_15%_42%)]">{t('lo_member_language', { language: LANG_NAME[memberLanguage] ?? memberLanguage })}</p> : null}

      <button type="button" className={cn(GOLD_BUTTON, 'mt-3 w-full sm:w-auto')} onClick={() => void generate()} disabled={busy !== null} data-testid="lo-generate">
        {busy === 'gen' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          : body ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
        {t(body ? 'lo_regenerate' : channel === 'EMAIL' ? 'lo_generate_email' : 'lo_generate_message')}
      </button>
      {error ? (
        <p role="alert" className="mt-2 rounded-xl bg-[hsl(0_60%_97%)] px-3 py-2 text-sm text-[hsl(0_55%_34%)]" data-testid="lo-error">
          {t(error === 'RATE_LIMITED' ? 'lo_error_rate' : error === 'DRAFT_REJECTED' ? 'lo_error_rejected' : error === 'AI_UNAVAILABLE' ? 'lo_error_unavailable' : 'lo_error')}
        </p>
      ) : null}

      {body ? (
        <div className="mt-4 space-y-2" data-testid="lo-preview">
          <p className="text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_34%)]">{t('lo_preview')}</p>
          {channel === 'EMAIL' ? (
            <label className="grid gap-1 text-xs font-semibold text-[hsl(218_28%_30%)]">
              <span>{t('lo_subject')}</span>
              <input className={cn(FIELD, 'h-11')} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} dir="auto" />
            </label>
          ) : null}
          <label className="grid gap-1 text-xs font-semibold text-[hsl(218_28%_30%)]">
            <span>{t('lo_body')}</span>
            <textarea className={cn(FIELD, 'min-h-[10rem] resize-y py-3 text-sm font-normal leading-relaxed')} value={body}
              onChange={(e) => setBody(e.target.value)} maxLength={1600} dir="auto" data-testid="lo-body" />
          </label>
          <p className="text-2xs leading-relaxed text-[hsl(218_15%_42%)]">{t('lo_review_note')}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" className={cn(SECONDARY_BUTTON, 'h-11')} onClick={() => void copy()} disabled={!text} data-testid="lo-copy">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{t(copied ? 'lo_copied' : 'lo_copy')}
            </button>
            {channel === 'HOMATCH_CHAT' ? (
              <button type="button" className={cn(SECONDARY_BUTTON, 'h-11')} onClick={() => { void copy(); onOpenConversation(); }} disabled={!conversationId}>
                <MessageSquare className="h-4 w-4" aria-hidden="true" />{t('lo_copy_open_chat')}
              </button>
            ) : null}
            {channel === 'EMAIL' && emailMarketing ? (
              <button type="button" className={cn(SECONDARY_BUTTON, 'h-11')} onClick={onOpenEmailStudio}>
                <Mail className="h-4 w-4" aria-hidden="true" />{t('lo_plan_email')}
              </button>
            ) : null}
            {external ? (
              <a href={external} target="_blank" rel="noopener noreferrer" className={cn(SECONDARY_BUTTON, 'h-11')}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />{t(channel === 'WHATSAPP' ? 'lo_open_whatsapp' : 'lo_open_sms')}
              </a>
            ) : null}
            {LOG_CHANNEL[channel] ? (
              <button type="button" className={cn(SECONDARY_BUTTON, 'h-11')} onClick={() => void logSent()} disabled={busy !== null} data-testid="lo-log-sent">
                {busy === 'log' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {t('lo_i_sent_it')}
              </button>
            ) : null}
          </div>
          {channel === 'HOMATCH_CHAT' && !conversationId ? <p className="text-2xs text-[hsl(218_15%_42%)]">{t('crm_no_conversation')}</p> : null}
          {(channel === 'WHATSAPP' || channel === 'SMS') && !phone ? <p className="text-2xs text-[hsl(218_15%_42%)]">{t('lo_no_phone')}</p> : null}
          {channel === 'TELEGRAM' ? <p className="text-2xs text-[hsl(218_15%_42%)]">{t('lo_telegram_copy_only')}</p> : null}
          {channel === 'EMAIL' ? <p className="text-2xs text-[hsl(218_15%_42%)]">{t('lo_email_consent_note')}</p> : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

export default LeadOutreachComposer;
