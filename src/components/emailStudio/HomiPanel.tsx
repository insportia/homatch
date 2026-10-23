// HOMI — the Email Studio copilot panel. Owner brief §6.
//
// HOMI proposes; the user decides. Every answer arrives as a proposal card — subject ideas,
// a preview line, edits to named blocks, a full draft, campaign ideas, or an explanation — with
// its warnings (an invented figure, a misleading claim) shown first. Nothing changes until the user
// presses Apply on that card, and a draft that would replace the whole design asks once more.

import { AlertTriangle, Check, Languages, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CopilotProposal, CopilotTask } from '@/emailMarketing/copilot';
import type { Block, EmailDoc } from '@/emailMarketing/designer/document';
import type { Finding } from '@/emailMarketing/risk/links';
import { cn } from '@/lib/utils';
import { askHomi, StudioError } from '@/services/emailCampaignStudio';
import { findingText } from './shared';

export interface HomiContext {
  name: string; objective: string; subject: string; previewText: string; language: string; audience?: string;
  design: EmailDoc | null; findings?: Finding[];
}

export interface HomiActions {
  applySubject?: (s: string) => void;
  applyPreview?: (p: string) => void;
  applyEdits?: (edits: NonNullable<CopilotProposal['edits']>) => void;
  applyBlocks?: (blocks: Block[], mode: 'replace' | 'append') => void;
  applyIdea?: (idea: { name: string; objective: string }) => void;
  applyLanguage?: (lang: string) => void;
}

const QUICK: Array<{ task: CopilotTask; key: string }> = [
  { task: 'subjects', key: 'ems_homi_q_subjects' }, { task: 'preview', key: 'ems_homi_q_preview' },
  { task: 'draft', key: 'ems_homi_q_draft' }, { task: 'professional', key: 'ems_homi_q_professional' },
  { task: 'shorten', key: 'ems_homi_q_shorten' }, { task: 'cta', key: 'ems_homi_q_cta' },
  { task: 'ideas', key: 'ems_homi_q_ideas' }, { task: 'audience', key: 'ems_homi_q_audience' },
];
const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

interface Turn { id: string; task: CopilotTask; ask: string; target?: string; proposal?: CopilotProposal; error?: string; applied?: boolean }

export function HomiPanel({ ctx, actions, className }: { ctx: HomiContext; actions: HomiActions; className?: string }) {
  const { t, lang } = useLanguage();
  const [instruction, setInstruction] = useState('');
  const [facts, setFacts] = useState('');
  const [showFacts, setShowFacts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [target, setTarget] = useState<string>(ctx.language === 'en' ? 'ka' : 'en');

  const ask = async (task: CopilotTask, label: string, targetLanguage?: string) => {
    if (busy) return;
    setBusy(true);
    const id = crypto.randomUUID();
    setTurns((ts) => [{ id, task, ask: label, target: targetLanguage }, ...ts].slice(0, 12));
    try {
      const proposal = await askHomi({
        task, instruction: instruction.trim(), language: ctx.language, targetLanguage: targetLanguage ?? null, uiLanguage: lang,
        campaign: { name: ctx.name, objective: ctx.objective, subject: ctx.subject, preview_text: ctx.previewText, audience: ctx.audience },
        design: ctx.design, facts: facts.trim(), findings: task === 'review' ? ctx.findings : undefined,
      });
      setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, proposal } : x)));
    } catch (e) {
      const code = e instanceof StudioError ? e.code : 'REQUEST_FAILED';
      setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, error: code } : x)));
    } finally { setBusy(false); }
  };

  const markApplied = (id: string) => setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, applied: true } : x)));

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex items-center gap-2.5 rounded-xl bg-[#0C1119] px-3.5 py-3 text-white">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(38_92%_54%)] text-[#161309]"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">HOMI</p>
          <p className="text-2xs leading-snug text-white/70">{t('ems_homi_tagline')}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button key={q.task} type="button" disabled={busy} onClick={() => ask(q.task, t(q.key))}
            className="rounded-full border bg-card px-2.5 py-1 text-2xs leading-tight text-foreground/80 transition-colors hover:border-[hsl(38_70%_60%)] hover:bg-[hsl(38_90%_97%)] disabled:opacity-50">
            {t(q.key)}
          </button>
        ))}
        {ctx.findings?.length ? (
          <button type="button" disabled={busy} onClick={() => ask('review', t('ems_homi_q_review'))}
            className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-2xs text-amber-900 disabled:opacity-50">
            {t('ems_homi_q_review')}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-2">
        <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs text-muted-foreground">{t('ems_homi_translate_to')}</span>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-7 w-auto min-w-[7rem] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{LANGS.filter((l) => l !== ctx.language).map((l) => <SelectItem key={l} value={l}>{t(`ems_lang_${l}`)}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => ask('translate', `${t('ems_homi_translate_to')} ${t(`ems_lang_${target}`)}`, target)}>
          {t('ems_homi_translate')}
        </Button>
      </div>

      <div className="space-y-1.5">
        <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} maxLength={1500}
          placeholder={t('ems_homi_placeholder')} className="text-sm" />
        <button type="button" className="text-2xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowFacts((v) => !v)} aria-expanded={showFacts}>
          {showFacts ? t('ems_homi_facts_hide') : t('ems_homi_facts_show')}
        </button>
        {showFacts ? (
          <Textarea value={facts} onChange={(e) => setFacts(e.target.value)} rows={4} maxLength={3000} placeholder={t('ems_homi_facts_placeholder')} className="text-sm" />
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" className="h-8 gap-1.5 bg-[#0C1119] text-white hover:bg-[#1B2230]" disabled={busy || !instruction.trim()} onClick={() => ask('draft', instruction.trim())}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}{t('ems_homi_write')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy || !instruction.trim()} onClick={() => ask('rewrite', instruction.trim())}>
            {t('ems_homi_edit_current')}
          </Button>
        </div>
        <p className="text-2xs leading-snug text-muted-foreground">{t('ems_homi_rules')}</p>
      </div>

      <div className="space-y-2.5" aria-live="polite">
        {turns.map((turn) => (
          <ProposalCard key={turn.id} turn={turn} actions={actions} onApplied={() => markApplied(turn.id)}
            onDismiss={() => setTurns((ts) => ts.filter((x) => x.id !== turn.id))} />
        ))}
      </div>
    </div>
  );
}

function ProposalCard({ turn, actions, onApplied, onDismiss }: { turn: Turn; actions: HomiActions; onApplied: () => void; onDismiss: () => void }) {
  const { t } = useLanguage();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const p = turn.proposal;
  return (
    <div className={cn('rounded-xl border bg-card p-3 text-sm', turn.applied && 'opacity-70')}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 text-2xs font-medium text-muted-foreground [overflow-wrap:anywhere]">{turn.ask}</p>
        <button type="button" onClick={onDismiss} aria-label={t('ems_homi_dismiss')} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
      {!p && !turn.error ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('ems_homi_thinking')}</p> : null}
      {turn.error ? <p className="text-red-700">{t(`ems_homi_err_${turn.error.toLowerCase()}`) === `ems_homi_err_${turn.error.toLowerCase()}` ? t('ems_homi_err_generic') : t(`ems_homi_err_${turn.error.toLowerCase()}`)}</p> : null}
      {p ? (
        <div className="space-y-2.5">
          {p.warnings.length ? (
            <ul className="space-y-1">
              {p.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-2xs text-amber-900">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{findingText(t, w)}
                </li>
              ))}
            </ul>
          ) : null}
          {p.message ? <p className="whitespace-pre-line leading-relaxed">{p.message}</p> : null}
          {p.ideas?.length ? p.ideas.map((idea, i) => (
            <div key={i} className="flex items-start justify-between gap-2 rounded-lg border px-2.5 py-2">
              <div className="min-w-0"><p className="font-medium">{idea.name}</p><p className="text-2xs text-muted-foreground">{idea.objective}</p></div>
              {actions.applyIdea ? <ApplyBtn onClick={() => { actions.applyIdea?.(idea); onApplied(); }} /> : null}
            </div>
          )) : null}
          {p.subjects?.length ? p.subjects.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
              <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{s}</p>
              {actions.applySubject ? <ApplyBtn onClick={() => { actions.applySubject?.(s); onApplied(); }} /> : null}
            </div>
          )) : null}
          {p.preview ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
              <p className="min-w-0 text-[13px] [overflow-wrap:anywhere]">{p.preview}</p>
              {actions.applyPreview ? <ApplyBtn onClick={() => { actions.applyPreview?.(p.preview!); onApplied(); }} /> : null}
            </div>
          ) : null}
          {p.edits?.length ? (
            <div className="space-y-1.5">
              {p.edits.slice(0, 6).map((e, i) => <p key={i} className="rounded-md bg-muted/60 px-2 py-1.5 text-[13px] [overflow-wrap:anywhere]">{e.value}</p>)}
              {p.edits.length > 6 ? <p className="text-2xs text-muted-foreground">{t('ems_homi_more_edits', { n: p.edits.length - 6 })}</p> : null}
              {actions.applyEdits ? (
                <Button type="button" size="sm" className="h-8 gap-1.5" disabled={turn.applied} onClick={() => { actions.applyEdits?.(p.edits!); if (turn.task === 'translate' && turn.target) actions.applyLanguage?.(turn.target); onApplied(); }}>
                  <Check className="h-3.5 w-3.5" />{t('ems_homi_apply_edits', { n: p.edits.length })}
                </Button>
              ) : null}
            </div>
          ) : null}
          {p.blocks?.length ? (
            <div className="space-y-1.5">
              {p.blocks.slice(0, 5).map((b, i) => (
                <p key={i} className={cn('rounded-md bg-muted/60 px-2 py-1.5 text-[13px] [overflow-wrap:anywhere]', b.type === 'heading' && 'font-semibold')}>
                  {b.type === 'button' ? `▸ ${b.label}` : (b as { text?: string }).text}
                </p>
              ))}
              {actions.applyBlocks ? (
                confirmReplace ? (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-50 p-2 text-2xs text-amber-900">
                    <span className="me-auto">{t('ems_homi_replace_confirm')}</span>
                    <Button type="button" size="sm" className="h-7" onClick={() => { actions.applyBlocks?.(p.blocks!, 'replace'); onApplied(); setConfirmReplace(false); }}>{t('ems_homi_replace_yes')}</Button>
                    <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setConfirmReplace(false)}>{t('ems_homi_cancel')}</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <Button type="button" size="sm" className="h-8" disabled={turn.applied} onClick={() => setConfirmReplace(true)}>{t('ems_homi_use_draft')}</Button>
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={turn.applied} onClick={() => { actions.applyBlocks?.(p.blocks!, 'append'); onApplied(); }}>{t('ems_homi_append')}</Button>
                  </div>
                )
              ) : null}
            </div>
          ) : null}
          {turn.applied ? <p className="flex items-center gap-1 text-2xs text-emerald-700"><Check className="h-3.5 w-3.5" />{t('ems_homi_applied')}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ApplyBtn({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage();
  return <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={onClick}>{t('ems_homi_apply')}</Button>;
}
