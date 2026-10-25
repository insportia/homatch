// CONTRACT INTELLIGENCE — "what could be better, and do you want it?"
//
// One card per flagged clause, laid out in the order a signer asks:
//   1. what is wrong with it (the risk, and why it matters),
//   2. EXACTLY what the proposal changes: the contract's words with removed
//      words struck and added words underlined, word by word (ClauseDiff),
//      with "now" and "will be written" one tap away,
//   3. why the new wording is better for them (review.benefit; older
//      analyses fall back to "why it matters"),
//   4. whose interests the current wording serves, ONLY when the analyser
//      knew (an "unclear" here was a vague label that said nothing),
//   5. what the other side may say, and the choice: accept, edit, reject.
// Nothing reaches the revised contract without that choice. Saving writes a
// numbered revision; exports are built from the stored contract text and the
// choices, in the browser.
//
// THE ACTIONS NO LONGER SIT ON TOP OF THE READING. The old sticky sheet held
// six buttons and a disclaimer and covered the middle of the screen on a
// phone (and slid under the mobile tab bar). Save, compare, downloads, print
// and history now live in an in-flow "Finish" section after the last card.
// While there are unsaved choices and that section is out of view, one slim
// bar (counts + Save + a jump to Finish) rides above the mobile tab bar.
//
// Unsaved choices live in sessionStorage, keyed by document and analysis, so
// going to "Ask HOMI" about a clause and coming back loses nothing. A saved
// revision made against a different analysis is listed as stale and cannot
// be opened onto this one: its clauses may not be this analysis's clauses.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, Check, CheckCircle2, Download, FileText, History, MessageCircle, Pencil, Printer, Sparkles, X,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  analysisIdentity, applyDecisions, draftStorageKey, isStaleRevision, replacementFor, reviewItems,
  type AnalysisLike, type Decision, type ReviewItem,
} from '@/contracts/revisions';
import { DOCX_MIME, buildDocx, downloadBytes } from '@/contracts/docx';
import { getContractText, listRevisions, saveRevision, type SavedRevision } from '@/services/contractRevisions';
import { ClauseDiff } from './ClauseDiff';
import './contracts.css';

const chip = 'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors';
const KNOWN_PARTIES = new Set(['BUYER', 'SELLER', 'DEVELOPER', 'BOTH']);

interface Draft { decisions: Record<string, Decision>; editing: string | null; draft: string }

function readDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Draft>;
    if (!v || typeof v !== 'object' || !v.decisions || typeof v.decisions !== 'object') return null;
    return { decisions: v.decisions, editing: typeof v.editing === 'string' ? v.editing : null, draft: typeof v.draft === 'string' ? v.draft : '' };
  } catch { return null; }
}

function writeDraft(key: string, d: Draft): void {
  try { sessionStorage.setItem(key, JSON.stringify(d)); } catch { /* storage full or blocked: the page still works */ }
}

/** A stable signature of a set of decisions, to tell saved from unsaved. */
function signature(list: Decision[]): string {
  return JSON.stringify([...list].sort((a, b) => a.key.localeCompare(b.key)).map((d) => [d.key, d.status, d.text ?? '']));
}

/*
 * "PDF" EXPORT IS THE BROWSER'S PRINT DIALOG, NOT A GENERATED FILE.
 *
 * This opens the revised text in a plain printable window and calls
 * window.print(). Whether a .pdf comes out depends on the customer choosing
 * "Save as PDF" (or a PDF printer) in their own browser's dialog; HOMATCH
 * builds no PDF and the button copy (ct_rev_print_pdf, ct_rev_print_hint)
 * must never promise one. A pop-up blocker can stop the window: reported as
 * ct_rev_popup_blocked.
 */
function printHtml(title: string, text: string, lang: string, dir: 'ltr' | 'rtl', notes: string[] = []) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.opener = null;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  w.document.write(`<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:"Noto Sans Georgian","Sylfaen","Segoe UI",system-ui,sans-serif;max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;line-height:1.6;color:#111}
h1{font-size:1.25rem;margin:0 0 1.5rem}p{margin:0 0 .6rem;white-space:pre-wrap}@media print{body{margin:0 auto}}</style></head>
<body><h1>${esc(title)}</h1>${notes.map((n) => `<p><em>${esc(n)}</em></p>`).join('')}${text.split('\n').map((l) => `<p>${esc(l) || '&nbsp;'}</p>`).join('')}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

export function ContractReview({ documentId, title, analysis }: { documentId: string; title: string; analysis: AnalysisLike }) {
  const { t, lang, isRTL } = useLanguage();
  const navigate = useNavigate();
  const items = useMemo(() => reviewItems(analysis), [analysis]);
  const analysisId = useMemo(() => analysisIdentity(analysis), [analysis]);
  const draftKey = draftStorageKey(documentId, analysisId);
  // Set once the stored draft for this document and analysis has been read; nothing is written before.
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const hadDraft = useRef(false);
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<SavedRevision[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const finishRef = useRef<HTMLElement>(null);
  const [finishInView, setFinishInView] = useState(false);

  /* The unsaved draft for this document and analysis, if the customer left the page mid-review. */
  useEffect(() => {
    const d = readDraft(draftKey);
    hadDraft.current = !!d;
    setDecisions(d?.decisions ?? {});
    setEditing(d?.editing ?? null);
    setDraft(d?.draft ?? '');
    setHydratedKey(draftKey);
  }, [draftKey]);

  useEffect(() => {
    if (hydratedKey !== draftKey) return;
    writeDraft(draftKey, { decisions, editing, draft });
  }, [hydratedKey, draftKey, decisions, editing, draft]);

  useEffect(() => {
    let alive = true;
    getContractText(documentId).then((x) => { if (alive) setText(x); }).catch(() => { if (alive) setText(null); });
    listRevisions(documentId).then((h) => {
      if (!alive) return;
      setHistory(h);
      // The latest saved revision is the starting point only when nothing unsaved exists
      // and it was made against this very analysis.
      const latest = h[0];
      if (latest && !hadDraft.current && !isStaleRevision(latest.analysisSha, analysis)) {
        setDecisions(Object.fromEntries(latest.decisions.map((d) => [d.key, d])));
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [documentId, analysis]);

  /* Is the Finish section on screen? The slim bar hides while it is. */
  useEffect(() => {
    const el = finishRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setFinishInView(entries.some((e) => e.isIntersecting)), { rootMargin: '0px 0px -10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length]);

  const list = Object.values(decisions);
  const result = useMemo(
    () => (text ? applyDecisions(text, items, list, t('ct_rev_added_heading')) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, items, decisions, t],
  );

  const savedSignature = useMemo(() => {
    const latest = history[0];
    return latest && !isStaleRevision(latest.analysisSha, analysis) ? signature(latest.decisions) : signature([]);
  }, [history, analysis]);

  if (!items.length) return null;

  const dirty = signature(list) !== savedSignature;

  const decide = (key: string, d: Decision | null) => {
    setNotice(null);
    hadDraft.current = true; // a choice made here is never replaced by a saved revision arriving late
    setDecisions((cur) => { const next = { ...cur }; if (d) next[key] = d; else delete next[key]; return next; });
  };
  const counts = {
    accepted: list.filter((d) => d.status !== 'REJECTED').length,
    rejected: list.filter((d) => d.status === 'REJECTED').length,
    open: items.length - list.length,
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const saved = await saveRevision({ documentId, analysisSha: analysisId, decisions: list, applied: result.changes.length, unplaced: result.unplaced.length, nextVersion: (history[0]?.version ?? 0) + 1 });
      setHistory((h) => [saved, ...h]);
      setNotice('ct_rev_saved');
    } catch { setNotice('ct_rev_save_failed'); } finally { setSaving(false); }
  };

  const truncated = analysis.textTruncated === true;
  const exportNotes = truncated ? [t('ct_rev_truncated_export')] : [];

  const fileBase = (title || 'contract').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'contract';
  const exportDocx = (tracked: boolean) => {
    if (!result || !text) return;
    const bytes = buildDocx({
      title: `${title} · ${t('ct_rev_revised')}`,
      text: result.text,
      notes: exportNotes,
      ...(tracked ? { tracked: { original: text, changes: result.changes, author: 'HOMATCH', addedHeading: t('ct_rev_added_heading') } } : {}),
    });
    downloadBytes(bytes, `${fileBase}${tracked ? '-changes' : '-revised'}.docx`, DOCX_MIME);
  };

  const askHomi = (item: ReviewItem) => navigate('/ai', {
    state: {
      context: { type: 'workspace', data: {
        surface: 'contract', clause: item.label, contractWording: item.original?.slice(0, 600) ?? null,
        risk: item.review.risk, suggestion: item.review.suggestion.slice(0, 800), favours: item.review.favours,
        note: 'Wording comes from the customer\'s own contract. Explain it plainly; no legal verdicts; do not invent terms.',
      } },
      prompt: t('ct_rev_ask_prompt', { clause: item.label }),
    },
  });

  const jumpToFinish = () => finishRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section aria-labelledby="ct-review-title" className="space-y-4" data-testid="contract-review">
      <div className="relative overflow-hidden rounded-3xl bg-[#0C1119] p-5 text-white shadow-hover sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_80%_at_100%_0%,hsl(38_92%_56%/0.18),transparent_60%)]" aria-hidden="true" />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(38_92%_56%)]/15 px-2.5 py-0.5 text-xs font-semibold text-[hsl(38_92%_70%)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{t('ux_ct_review_eyebrow', { n: items.length })}
          </p>
          <h2 id="ct-review-title" className="mt-2 font-display text-xl font-semibold sm:text-2xl">{t('ct_rev_title')}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-white/80">{t('ct_rev_intro')}</p>
          {truncated ? (
            <p role="note" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm leading-relaxed text-white">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <span className="min-w-0 break-words">{t('ct_rev_truncated')}</span>
            </p>
          ) : null}
          {/* How far through the decisions the signer is. */}
          <div className="mt-4">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <span className="bg-[hsl(38_92%_56%)] transition-all duration-500 motion-reduce:transition-none" style={{ width: `${(counts.accepted / items.length) * 100}%` }} />
              <span className="bg-white/40 transition-all duration-500 motion-reduce:transition-none" style={{ width: `${(counts.rejected / items.length) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/75" aria-live="polite">{t('ct_rev_counts', { accepted: counts.accepted, rejected: counts.rejected, open: counts.open })}</p>
          </div>
        </div>
      </div>

      <ol className="space-y-4">
        {items.map((item, idx) => {
          const d = decisions[item.key];
          const isEditing = editing === item.key;
          const proposed = isEditing ? (draft.trim() || item.review.suggestion) : (replacementFor(item, d && d.status !== 'REJECTED' ? d : { key: item.key, status: 'ACCEPTED' }) ?? item.review.suggestion);
          const favoursKnown = KNOWN_PARTIES.has(item.review.favours);
          const benefit = item.review.benefit?.trim() || null;
          return (
            <li key={item.key}
              className={cn('ct-rise min-w-0 rounded-2xl border bg-card shadow-card transition-colors',
                d?.status === 'REJECTED' ? 'border-border' : d ? 'border-[hsl(var(--gold))] ring-1 ring-[hsl(var(--gold))]/30' : 'border-border')}
              style={{ ['--i' as string]: Math.min(idx, 8) } as React.CSSProperties}
            >
              {/* 1. What it is and what is wrong with it. */}
              <div className="flex min-w-0 items-start gap-3 p-4 pb-0 sm:p-5 sm:pb-0">
                <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                  d && d.status !== 'REJECTED' ? 'bg-[hsl(var(--gold))] text-[#0C1119]' : 'bg-[#0C1119] text-white')}>
                  {d && d.status !== 'REJECTED' ? <Check className="h-4 w-4" aria-hidden="true" /> : idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 break-words font-display text-base font-semibold text-foreground sm:text-lg">{item.label}</h3>
                    <span className="rounded-full bg-[hsl(var(--gold-soft))] px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--gold-ink))]">
                      {t(item.kind === 'MISSING' ? 'ct_rev_kind_missing' : `ct_rev_attention_${(item.attention ?? 'UNUSUAL').toLowerCase()}`)}
                    </span>
                    {item.page ? <span className="text-xs text-muted-foreground">{t('ct_rev_page', { n: item.page })}</span> : null}
                  </div>
                  <p className="mt-1.5 min-w-0 break-words text-[15px] font-medium leading-relaxed text-foreground">{item.review.risk}</p>
                  <p className="mt-1 min-w-0 break-words text-sm leading-relaxed text-ink-soft">{item.review.why}</p>
                </div>
              </div>

              {/* 2. Exactly what changes. */}
              <div className="mt-4 px-4 sm:px-5">
                <p className="mb-2 text-sm font-semibold text-foreground">
                  {isEditing ? t('ux_ct_edit_preview') : t(item.kind === 'MISSING' ? 'ct_rev_add_clause' : 'ux_ct_what_changes')}
                </p>
                <ClauseDiff before={item.original} after={proposed} idBase={`ct-${item.key.replace(/[^a-z0-9]/gi, '')}`} />
              </div>

              {/* 3 + 4. Why it is better, and who the wording serves today. */}
              <div className="mt-3 space-y-2 px-4 sm:px-5">
                {benefit ? (
                  <p className="flex min-w-0 items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-950 dark:bg-emerald-500/10 dark:text-emerald-100">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                    <span className="min-w-0 break-words"><span className="font-semibold">{t('ux_ct_better')}: </span>{benefit}</span>
                  </p>
                ) : null}
                {favoursKnown ? (
                  <p className="min-w-0 break-words text-sm text-ink-soft">
                    {t('ux_ct_favours_now', { party: t(`ct_rev_party_${item.review.favours.toLowerCase()}`) })}
                  </p>
                ) : null}
                {item.review.tradeoffs ? (
                  <p className="min-w-0 break-words text-sm leading-relaxed text-ink-soft"><span className="font-semibold text-foreground">{t('ux_ct_other_side')}: </span>{item.review.tradeoffs}</p>
                ) : null}
              </div>

              {isEditing ? (
                <div className="mt-3 px-4 sm:px-5">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} aria-label={t('ct_rev_edit')}
                    className="w-full rounded-xl border border-border bg-background p-3 text-base leading-relaxed outline-none focus:border-[hsl(var(--gold))] md:text-sm" />
                </div>
              ) : null}

              {/* 5. The choice, and what it means for the contract. */}
              <div className="mt-4 border-t border-border p-4 sm:p-5">
                {d && !isEditing ? (
                  <p role="status" className={cn('mb-3 flex min-w-0 items-start gap-2 text-sm leading-relaxed',
                    d.status === 'REJECTED' ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                    {d.status === 'REJECTED' ? <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />}
                    <span className="min-w-0 break-words">{t(d.status === 'REJECTED' ? 'ux_ct_written_reject' : d.status === 'EDITED' ? 'ux_ct_written_edit' : 'ux_ct_written_ok')}</span>
                  </p>
                ) : !isEditing ? (
                  <p className="mb-3 min-w-0 break-words text-sm text-muted-foreground">{t('ux_ct_will_write')}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {isEditing ? (
                    <>
                      <button type="button" className={cn(chip, 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]')}
                        onClick={() => { decide(item.key, draft.trim() ? { key: item.key, status: 'EDITED', text: draft.trim() } : null); setEditing(null); }}>
                        <Check className="h-4 w-4" aria-hidden="true" />{t('ct_rev_use_edit')}
                      </button>
                      <button type="button" className={cn(chip, 'border-border')} onClick={() => setEditing(null)}>{t('ct_rev_cancel')}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" aria-pressed={d?.status === 'ACCEPTED'} onClick={() => decide(item.key, d?.status === 'ACCEPTED' ? null : { key: item.key, status: 'ACCEPTED' })}
                        className={cn(chip, d?.status === 'ACCEPTED' ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]' : 'border-foreground/25')}>
                        <Check className="h-4 w-4" aria-hidden="true" />{t('ct_rev_accept')}
                      </button>
                      <button type="button" aria-pressed={d?.status === 'EDITED'} onClick={() => { setDraft(d?.text ?? item.review.suggestion); setEditing(item.key); }}
                        className={cn(chip, d?.status === 'EDITED' ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold-soft))]' : 'border-foreground/25')}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />{t('ct_rev_edit')}
                      </button>
                      <button type="button" aria-pressed={d?.status === 'REJECTED'} onClick={() => decide(item.key, d?.status === 'REJECTED' ? null : { key: item.key, status: 'REJECTED' })}
                        className={cn(chip, d?.status === 'REJECTED' ? 'border-foreground bg-foreground text-background' : 'border-foreground/25')}>
                        <X className="h-4 w-4" aria-hidden="true" />{t('ct_rev_reject')}
                      </button>
                      <button type="button" onClick={() => askHomi(item)} className={cn(chip, 'border-[hsl(var(--gold-border))] text-[hsl(var(--gold-ink))]')}>
                        <MessageCircle className="h-4 w-4" aria-hidden="true" />{t('ct_rev_ask_homi')}
                      </button>
                    </>
                  )}
                </div>
                {result?.unplaced.includes(item.key) ? (
                  <p role="status" className="mt-3 text-sm text-[hsl(var(--destructive))]">
                    {t(result.unplacedReasons[item.key] === 'TRUNCATED' ? 'ct_rev_unplaced_truncated' : 'ct_rev_unplaced')}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* The slim bar: only while choices are unsaved and Finish is out of view.
          Sits above the mobile tab bar (3.75rem + safe area), never over the middle. */}
      {dirty && !finishInView ? (
        <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 md:bottom-4">
          <div className="mx-auto flex max-w-xl items-center gap-2 rounded-full border border-[hsl(var(--gold-border))] bg-[#0C1119]/95 py-1.5 pe-1.5 ps-4 text-white shadow-hover backdrop-blur">
            <span className="min-w-0 flex-1 truncate text-sm">{t('ux_ct_unsaved', { n: list.length })}</span>
            <button type="button" onClick={jumpToFinish} aria-label={t('ux_ct_jump_finish')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/85 hover:bg-white/10">
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" disabled={saving || !result} onClick={() => void save()}
              className="min-h-10 shrink-0 rounded-full bg-[hsl(38_92%_56%)] px-4 text-sm font-semibold text-[#0C1119] disabled:opacity-60">
              {t('ct_rev_save')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Finish: in the flow of the page, after the last point. */}
      <section ref={finishRef} aria-labelledby="ct-finish-title" className="scroll-mt-24 rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-4 shadow-card sm:p-5">
        <h3 id="ct-finish-title" className="font-display text-lg font-semibold text-foreground">{t('ux_ct_finish_title')}</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t('ux_ct_finish_hint')}</p>
        {text === null ? <p className="mt-2 text-sm text-muted-foreground">{t('ct_rev_no_text')}</p> : null}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button type="button" disabled={saving || !result} onClick={() => void save()}
            className={cn(chip, 'justify-center border-[hsl(var(--gold))] bg-[hsl(var(--gold))] font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-60 sm:col-span-2')}>
            <Check className="h-4 w-4" aria-hidden="true" />{t('ct_rev_save')}
          </button>
          <button type="button" disabled={!result} onClick={() => setShowCompare((v) => !v)} aria-expanded={showCompare} className={cn(chip, 'border-foreground/25')}>
            <FileText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words text-start">{t('ct_rev_compare')}</span>
          </button>
          <button type="button" disabled={!result} onClick={() => exportDocx(false)} className={cn(chip, 'border-foreground/25')}>
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words text-start">{t('ct_rev_docx')}</span>
          </button>
          <button type="button" disabled={!result || !result.changes.length} onClick={() => exportDocx(true)} className={cn(chip, 'border-foreground/25')}>
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words text-start">{t('ct_rev_docx_tracked')}</span>
          </button>
          <button type="button" disabled={!result} aria-describedby="ct-rev-print-hint"
            onClick={() => { if (result && !printHtml(`${title} · ${t('ct_rev_revised')}`, result.text, lang, isRTL ? 'rtl' : 'ltr', exportNotes)) setNotice('ct_rev_popup_blocked'); }}
            className={cn(chip, 'border-foreground/25')}>
            <Printer className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words text-start">{t('ct_rev_print_pdf')}</span>
          </button>
          {history.length ? (
            <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className={cn(chip, 'border-foreground/25')}>
              <History className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words text-start">{t('ct_rev_history')}</span>
            </button>
          ) : null}
        </div>
        {notice ? <p role="status" className="mt-3 text-sm font-medium text-foreground">{t(notice)}</p> : null}
        <p id="ct-rev-print-hint" className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('ct_rev_print_hint')}</p>
        {truncated ? <p className="mt-1 text-xs leading-relaxed text-foreground">{t('ct_rev_truncated_export')}</p> : null}

        {showCompare && result ? (
          <div className="mt-4 border-t border-border pt-4">
            <h4 className="font-display text-base font-semibold">{t('ct_rev_compare')}</h4>
            {result.changes.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('ct_rev_no_changes')}</p> : (
              <ul className="mt-3 space-y-4">
                {result.changes.map((c) => (
                  <li key={c.key} className="min-w-0">
                    <p className="mb-1.5 text-sm font-semibold text-foreground">{c.label}</p>
                    <ClauseDiff before={c.before} after={c.after} idBase={`ct-cmp-${c.key.replace(/[^a-z0-9]/gi, '')}`} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {showHistory ? (
          <div className="mt-4 border-t border-border pt-4">
            <h4 className="font-display text-base font-semibold">{t('ct_rev_history')}</h4>
            <ol className="mt-2">
              {history.map((h) => {
                const stale = isStaleRevision(h.analysisSha, analysis);
                return (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
                    <span className="min-w-0 break-words">
                      {t('ct_rev_version', { n: h.version })} · {new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(h.createdAt))} · {t('ct_rev_version_counts', { applied: h.applied })}
                      {stale ? <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-2xs font-semibold text-muted-foreground">{t('ct_rev_stale')}</span> : null}
                    </span>
                    {stale ? (
                      <span className="text-2xs text-muted-foreground">{t('ct_rev_stale_hint')}</span>
                    ) : (
                      <button type="button" className="min-h-11 font-medium text-[hsl(var(--gold-ink))] underline underline-offset-4"
                        onClick={() => { setNotice(null); setEditing(null); setDecisions(Object.fromEntries(h.decisions.map((d) => [d.key, d]))); }}>{t('ct_rev_restore')}</button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">{t('ct_rev_disclaimer')}</p>
      </section>
    </section>
  );
}
