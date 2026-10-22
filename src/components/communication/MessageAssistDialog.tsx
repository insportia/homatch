// THE MESSAGE ASSISTANT — AI-assisted private messages, honest about channels.
//
// Channels do not all work the same way, and the assistant does not pretend:
//   PROFILE_DM    a public profile (Facebook, Telegram, …). HOMATCH has no
//                 authorised integration that posts into those platforms, so
//                 the assistant copies the message and opens the profile; the
//                 owner sends it themselves, and nothing claims delivery.
//   HOMATCH_CHAT  a HOMATCH member: opens (or reuses) the native conversation
//                 with the draft pre-filled; the owner presses Send there.
//   PHONE         an imported contact with a number: WhatsApp and SMS go
//                 through the existing campaign builder, which enforces
//                 approved templates, opt-outs and the 24-hour window.
//   EMAIL         goes to Email Studio with these recipients selected.
//
// AI (communication-studio-ai) only ever proposes text. A proposal is shown
// beside the draft with Accept / Discard; it never replaces the owner's words
// on its own and never sends.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AtSign, Check, Copy, ExternalLink, Languages, Loader2, MessageCircle, Phone, Sparkles, Wand2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { applyMergeFields } from '@/communication/emailDesign';
import { openExternal, safeExternalUrl } from '@/lib/safeExternalUrl';
import { type LibraryContact, channelsOf } from '@/services/contactLibrary';
import { openNativeConversation } from '@/services/nativeMatches';
import { type MessageChannel, type RewriteMode, StudioError, studioAi } from '@/services/communicationStudio';

type Mode = 'PROFILE_DM' | 'HOMATCH_CHAT' | 'PHONE' | 'EMAIL';
const LIMIT: Record<Mode, number> = { PROFILE_DM: 900, HOMATCH_CHAT: 1500, PHONE: 1000, EMAIL: 5000 };
const MODE_ICON: Record<Mode, React.ComponentType<{ className?: string }>> = { PROFILE_DM: ExternalLink, HOMATCH_CHAT: MessageCircle, PHONE: Phone, EMAIL: AtSign };
const AI_CHANNEL: Record<Mode, MessageChannel> = { PROFILE_DM: 'PROFILE_DM', HOMATCH_CHAT: 'HOMATCH_CHAT', PHONE: 'WHATSAPP', EMAIL: 'PROFILE_DM' };
const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
const TEMPLATES = ['ma_tpl_first', 'ma_tpl_viewing', 'ma_tpl_followup'] as const;

export function aiErrorKey(e: unknown): string {
  const code = e instanceof StudioError ? e.code : '';
  if (code === 'RATE_LIMITED') return 'es_ai_rate_limited';
  if (code === 'OUT_OF_SCOPE') return 'es_ai_out_of_scope';
  if (code === 'GENERATION_UNAVAILABLE') return 'es_ai_unavailable';
  return 'es_ai_failed';
}

function modesFor(recipients: LibraryContact[]): Mode[] {
  const out: Mode[] = [];
  const has = (ch: ReturnType<typeof channelsOf>[number]) => recipients.some((r) => channelsOf(r).includes(ch));
  if (has('PROFILE')) out.push('PROFILE_DM');
  if (has('HOMATCH_CHAT')) out.push('HOMATCH_CHAT');
  if (has('PHONE')) out.push('PHONE');
  if (has('EMAIL')) out.push('EMAIL');
  return out;
}

export function MessageAssistDialog({ open, recipients: initial, propertyId, onClose }: {
  open: boolean;
  recipients: LibraryContact[];
  propertyId?: string | null;
  onClose: () => void;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [recipients, setRecipients] = useState(initial);
  const modes = useMemo(() => modesFor(recipients), [recipients]);
  const [mode, setMode] = useState<Mode | null>(modes[0] ?? null);
  const active: Mode | null = mode && modes.includes(mode) ? mode : modes[0] ?? null;
  const [language, setLanguage] = useState<string>(LANGS.includes(lang as never) ? lang : 'en');
  const [instruction, setInstruction] = useState('');
  const [text, setText] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [previewIdx, setPreviewIdx] = useState(0);

  const targets = recipients.filter((r) => {
    const ch = channelsOf(r);
    if (active === 'PROFILE_DM') return ch.includes('PROFILE');
    if (active === 'HOMATCH_CHAT') return ch.includes('HOMATCH_CHAT');
    if (active === 'PHONE') return ch.includes('PHONE');
    if (active === 'EMAIL') return ch.includes('EMAIL');
    return false;
  });
  const limit = active ? LIMIT[active] : 1000;
  const messageFor = (r: LibraryContact) => applyMergeFields(overrides[r.key] ?? text, r.name, false);
  const preview = targets[Math.min(previewIdx, Math.max(0, targets.length - 1))];

  const runAi = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    try { setSuggestion(await fn()); } catch (e) { toast.error(t(aiErrorKey(e))); } finally { setBusy(null); }
  };
  const generate = () => runAi('generate', async () => (await studioAi.composeMessage({
    channel: active ? AI_CHANNEL[active] : 'PROFILE_DM', instruction, language, propertyId: propertyId ?? null,
  })).text);
  const rewrite = (m: RewriteMode, target?: string) => runAi(m, () => studioAi.rewrite({
    text, mode: m, language, targetLanguage: target, propertyId: propertyId ?? null,
  }).then((html) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')));
  const personalizeOne = async (r: LibraryContact) => {
    setBusy(`p:${r.key}`);
    try {
      const out = await studioAi.personalize({ text: overrides[r.key] ?? text, language, recipientName: r.name, recipientLanguage: r.language });
      setOverrides((o) => ({ ...o, [r.key]: out.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '') }));
      toast.success(t('ma_personalized'));
    } catch (e) { toast.error(t(aiErrorKey(e))); } finally { setBusy(null); }
  };

  const copyAndOpen = async (r: LibraryContact) => {
    const msg = messageFor(r);
    try { await navigator.clipboard.writeText(msg); } catch { toast.error(t('ma_copy_failed')); return; }
    if (safeExternalUrl(r.profileUrl)) openExternal(r.profileUrl);
    setDone((d) => new Set(d).add(r.key));
    toast.success(t('ma_copied_opened'));
  };
  const openChat = async (r: LibraryContact) => {
    if (!r.native) return;
    setBusy(`c:${r.key}`);
    try {
      const conversationId = await openNativeConversation(r.native.kind, r.native.id);
      onClose();
      navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`, { state: { draft: messageFor(r), conversationId } });
    } catch { toast.error(t('ma_chat_failed')); } finally { setBusy(null); }
  };
  const toStudio = () => {
    onClose();
    navigate('/outreach/email/studio', { state: { recipients: targets.map((r) => r.key), body: text, propertyId: propertyId ?? null } });
  };

  const aiBtn = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-2xs font-semibold ring-1 ring-inset ring-border hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-[calc(100%-1.5rem)] overflow-y-auto p-0 sm:max-w-3xl [&>*]:min-w-0">
        <div className="space-y-5 p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5 text-[hsl(34_90%_40%)]" aria-hidden="true" />{t('ma_title')}</DialogTitle>
            <DialogDescription>{t('ma_subtitle')}</DialogDescription>
          </DialogHeader>

          {/* recipients */}
          <section aria-labelledby="ma-to" className="space-y-2">
            <h3 id="ma-to" className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{t('ma_recipients', { n: String(recipients.length) })}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {recipients.map((r) => (
                <li key={r.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pe-1 ps-2.5 text-2xs font-semibold">
                  <span dir="auto" className="min-w-0 truncate">{r.name || r.email || t('cl_unnamed')}</span>
                  <button type="button" aria-label={t('ma_remove', { name: r.name ?? '' })} onClick={() => setRecipients((all) => all.filter((x) => x.key !== r.key))}
                    className="grid h-6 w-6 place-items-center rounded-full hover:bg-background"><X className="h-3 w-3" aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          </section>

          {/* channel */}
          {modes.length === 0 ? (
            <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">{t('ma_no_channel')}</p>
          ) : (
            <section aria-labelledby="ma-ch" className="space-y-2">
              <h3 id="ma-ch" className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{t('ma_channel')}</h3>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="ma-ch">
                {modes.map((m) => {
                  const Icon = MODE_ICON[m];
                  const on = active === m;
                  return (
                    <button key={m} type="button" role="radio" aria-checked={on} onClick={() => setMode(m)}
                      className={cn('flex min-w-0 items-start gap-2.5 rounded-xl p-3 text-start ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        on ? 'bg-[hsl(42_100%_96%)] ring-[hsl(38_92%_50%)]' : 'ring-border hover:bg-muted/50')}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{t(`ma_mode_${m.toLowerCase()}`)}</span>
                        <span className="block text-2xs leading-relaxed text-muted-foreground">{t(`ma_mode_${m.toLowerCase()}_note`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {active && active !== 'EMAIL' && (
            <>
              {/* compose */}
              <section aria-labelledby="ma-write" className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="ma-write" className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{t('ma_write')}</h3>
                  <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">{t('es_language')}</span>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-8 rounded-lg bg-background px-2 text-2xs ring-1 ring-inset ring-border">
                      {LANGS.map((l) => <option key={l} value={l}>{t(`fbx_lang_${l}`)}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATES.map((k) => (
                    <button key={k} type="button" className={aiBtn} onClick={() => setText(t(`${k}_body`))}>{t(k)}</button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input value={instruction} onChange={(e) => setInstruction(e.target.value)} dir="auto" placeholder={t('ma_instruction_ph')}
                    className="h-10 min-w-0 flex-1 rounded-xl bg-background px-3 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring" />
                  <button type="button" onClick={() => void generate()} disabled={busy !== null}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[hsl(218_52%_11%)] px-4 text-sm font-semibold text-[hsl(40_94%_64%)] disabled:opacity-60">
                    {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                    {t(propertyId ? 'ma_generate_from_property' : 'ma_generate')}
                  </button>
                </div>
                <div className="relative">
                  <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, limit))} rows={6} dir="auto" aria-label={t('ma_message')}
                    placeholder={t('ma_message_ph')}
                    className="w-full rounded-xl bg-background p-3 text-sm leading-relaxed ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring" />
                  <span className={cn('absolute bottom-2 end-3 text-2xs tabular-nums', text.length > limit * 0.9 ? 'text-[hsl(34_90%_36%)]' : 'text-muted-foreground')}>{text.length}/{limit}</span>
                </div>
                <div className="flex flex-wrap gap-1.5" aria-label={t('es_ai_actions')}>
                  {(['improve', 'shorten', 'professional', 'persuasive'] as RewriteMode[]).map((m) => (
                    <button key={m} type="button" className={aiBtn} disabled={!text.trim() || busy !== null} onClick={() => void rewrite(m)}>
                      {busy === m ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}{t(`es_ai_${m}`)}
                    </button>
                  ))}
                  <button type="button" className={aiBtn} disabled={!text.trim() || busy !== null} onClick={() => void rewrite('translate', language)}>
                    {busy === 'translate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Languages className="h-3.5 w-3.5" aria-hidden="true" />}{t('es_ai_translate_to', { lang: t(`fbx_lang_${language}`) })}
                  </button>
                  <button type="button" className={aiBtn} onClick={() => setText((v) => `${v}{{first_name|}}`)}>{t('es_insert_name')}</button>
                </div>
                {suggestion !== null && (
                  <div className="space-y-2 rounded-xl bg-[hsl(42_100%_96%)] p-3 ring-1 ring-inset ring-[hsl(40_80%_75%)]" role="region" aria-label={t('es_ai_suggestion')}>
                    <p className="text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_32%)]">{t('es_ai_suggestion')}</p>
                    <p dir="auto" className="whitespace-pre-wrap break-words text-sm">{suggestion}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setText(suggestion.slice(0, limit)); setSuggestion(null); }}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[hsl(218_52%_11%)] px-3 text-2xs font-semibold text-[hsl(40_94%_64%)]"><Check className="h-3.5 w-3.5" aria-hidden="true" />{t('es_accept')}</button>
                      <button type="button" onClick={() => setSuggestion(null)} className={aiBtn}><X className="h-3.5 w-3.5" aria-hidden="true" />{t('es_discard')}</button>
                    </div>
                  </div>
                )}
              </section>

              {/* preview */}
              {preview && text.trim() ? (
                <section aria-labelledby="ma-preview" className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id="ma-preview" className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{t('ma_preview_for', { name: preview.name || t('cl_unnamed') })}</h3>
                    {targets.length > 1 && (
                      <div className="flex gap-1">
                        <button type="button" className={aiBtn} onClick={() => setPreviewIdx((i) => (i - 1 + targets.length) % targets.length)} aria-label={t('fbl_page_prev')}>‹</button>
                        <button type="button" className={aiBtn} onClick={() => setPreviewIdx((i) => (i + 1) % targets.length)} aria-label={t('fbl_page_next')}>›</button>
                      </div>
                    )}
                  </div>
                  <div className="max-w-md rounded-2xl rounded-ss-sm bg-[hsl(158_45%_92%)] p-3 text-sm leading-relaxed text-[hsl(218_45%_14%)] shadow-sm" dir="auto">
                    <p className="whitespace-pre-wrap break-words">{messageFor(preview)}</p>
                  </div>
                </section>
              ) : null}

              {/* per-recipient actions */}
              <section aria-labelledby="ma-send" className="space-y-2">
                <h3 id="ma-send" className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{t(`ma_send_${active.toLowerCase()}`)}</h3>
                {active === 'PHONE' ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={aiBtn} disabled={!text.trim()} onClick={async () => { try { await navigator.clipboard.writeText(text); toast.success(t('ma_copied')); } catch { toast.error(t('ma_copy_failed')); } }}>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />{t('ma_copy')}
                    </button>
                    <button type="button" className={aiBtn} onClick={() => { onClose(); navigate('/outreach/whatsapp/campaigns/new'); }}>
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />{t('ma_open_whatsapp_builder')}
                    </button>
                  </div>
                ) : (
                  <ul className="divide-y divide-border rounded-xl ring-1 ring-inset ring-border">
                    {targets.map((r) => (
                      <li key={r.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium">{r.name || t('cl_unnamed')}</span>
                        {overrides[r.key] ? <span className="rounded-full bg-[hsl(158_45%_90%)] px-2 py-0.5 text-2xs font-semibold text-[hsl(158_64%_24%)]">{t('ma_personal')}</span> : null}
                        <button type="button" className={aiBtn} disabled={!text.trim() || busy !== null} onClick={() => void personalizeOne(r)}>
                          {busy === `p:${r.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}{t('es_ai_personalize')}
                        </button>
                        {active === 'PROFILE_DM' ? (
                          <button type="button" disabled={!text.trim()} onClick={() => void copyAndOpen(r)}
                            className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-2xs font-semibold disabled:opacity-50',
                              done.has(r.key) ? 'bg-muted text-foreground' : 'bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)]')}>
                            {done.has(r.key) ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
                            {t(done.has(r.key) ? 'ma_opened' : 'ma_copy_open')}
                          </button>
                        ) : (
                          <button type="button" disabled={!text.trim() || busy !== null} onClick={() => void openChat(r)}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[hsl(158_64%_30%)] px-3 text-2xs font-semibold text-white disabled:opacity-50">
                            {busy === `c:${r.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                            {t('ma_open_chat')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-2xs leading-relaxed text-muted-foreground">{t(`ma_mode_${active.toLowerCase()}_truth`)}</p>
              </section>
            </>
          )}

          {active === 'EMAIL' && (
            <div className="space-y-2 rounded-xl bg-muted/40 p-4">
              <p className="text-sm">{t('ma_email_goes_to_studio', { n: String(targets.length) })}</p>
              <button type="button" onClick={toStudio} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[hsl(218_52%_11%)] px-4 text-sm font-semibold text-[hsl(40_94%_64%)]">
                <AtSign className="h-4 w-4" aria-hidden="true" />{t('ma_open_studio')}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MessageAssistDialog;
