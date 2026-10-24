// CONTRACT INTELLIGENCE — "what could be better, and do you want it?"
//
// One card per flagged clause: the contract's own words, the risk, why it
// matters, whose interests the wording serves, a proposed replacement and
// what the other side may say. The signer accepts, edits or rejects each;
// nothing reaches the revised contract without that choice. Saving writes a
// numbered revision; exports are built from the stored contract text and the
// choices, in the browser.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Download, FileText, History, Pencil, Printer, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { applyDecisions, reviewItems, type AnalysisLike, type Decision, type ReviewItem } from '@/contracts/revisions';
import { DOCX_MIME, buildDocx, downloadBytes } from '@/contracts/docx';
import { getContractText, listRevisions, saveRevision, type SavedRevision } from '@/services/contractRevisions';

const chip = 'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors';

function printHtml(title: string, text: string, lang: string, dir: 'ltr' | 'rtl') {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.opener = null;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  w.document.write(`<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:"Noto Sans Georgian","Sylfaen","Segoe UI",system-ui,sans-serif;max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;line-height:1.6;color:#111}
h1{font-size:1.25rem;margin:0 0 1.5rem}p{margin:0 0 .6rem;white-space:pre-wrap}@media print{body{margin:0 auto}}</style></head>
<body><h1>${esc(title)}</h1>${text.split('\n').map((l) => `<p>${esc(l) || '&nbsp;'}</p>`).join('')}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

export function ContractReview({ documentId, title, analysis }: { documentId: string; title: string; analysis: AnalysisLike }) {
  const { t, lang, isRTL } = useLanguage();
  const navigate = useNavigate();
  const items = useMemo(() => reviewItems(analysis), [analysis]);
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<SavedRevision[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getContractText(documentId).then((x) => { if (alive) setText(x); }).catch(() => { if (alive) setText(null); });
    listRevisions(documentId).then((h) => {
      if (!alive) return;
      setHistory(h);
      if (h[0]) setDecisions(Object.fromEntries(h[0].decisions.map((d) => [d.key, d])));
    }).catch(() => {});
    return () => { alive = false; };
  }, [documentId]);

  const list = Object.values(decisions);
  const result = useMemo(
    () => (text ? applyDecisions(text, items, list, t('ct_rev_added_heading')) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, items, decisions, t],
  );

  if (!items.length) return null;

  const decide = (key: string, d: Decision | null) => {
    setNotice(null);
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
      const saved = await saveRevision({ documentId, decisions: list, applied: result.changes.length, unplaced: result.unplaced.length, nextVersion: (history[0]?.version ?? 0) + 1 });
      setHistory((h) => [saved, ...h]);
      setNotice('ct_rev_saved');
    } catch { setNotice('ct_rev_save_failed'); } finally { setSaving(false); }
  };

  const fileBase = (title || 'contract').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'contract';
  const exportDocx = (tracked: boolean) => {
    if (!result || !text) return;
    const bytes = buildDocx({
      title: `${title} · ${t('ct_rev_revised')}`,
      text: result.text,
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

  return (
    <section aria-labelledby="ct-review-title" className="space-y-4" data-testid="contract-review">
      <div className="rounded-2xl bg-[#0C1119] p-5 text-white">
        <h2 id="ct-review-title" className="font-display text-lg font-semibold">{t('ct_rev_title')}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-white/80">{t('ct_rev_intro')}</p>
        <p className="mt-3 text-xs text-white/70" aria-live="polite">{t('ct_rev_counts', { accepted: counts.accepted, rejected: counts.rejected, open: counts.open })}</p>
      </div>

      <ol className="space-y-4">
        {items.map((item) => {
          const d = decisions[item.key];
          const isEditing = editing === item.key;
          return (
            <li key={item.key} className={cn('rounded-2xl border bg-card p-4 shadow-card sm:p-5', d?.status === 'REJECTED' ? 'border-border opacity-80' : d ? 'border-[hsl(var(--gold))]' : 'border-border')}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base font-semibold text-foreground">{item.label}</h3>
                <span className="rounded-full bg-[hsl(var(--gold-soft))] px-2.5 py-0.5 text-2xs font-semibold text-[hsl(var(--gold-ink))]">
                  {t(item.kind === 'MISSING' ? 'ct_rev_kind_missing' : `ct_rev_attention_${(item.attention ?? 'UNUSUAL').toLowerCase()}`)}
                </span>
                {item.page ? <span className="text-2xs text-muted-foreground">{t('ct_rev_page', { n: item.page })}</span> : null}
              </div>

              {item.original ? (
                <div className="mt-3">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('ct_rev_original')}</p>
                  <blockquote className="mt-1 border-s-2 border-border ps-3 text-sm leading-relaxed text-foreground/90">{item.original}</blockquote>
                </div>
              ) : null}

              <dl className="mt-3 grid gap-2 text-sm">
                <div><dt className="font-semibold text-foreground">{t('ct_rev_risk')}</dt><dd className="text-foreground/90">{item.review.risk}</dd></div>
                <div><dt className="font-semibold text-foreground">{t('ct_rev_why')}</dt><dd className="text-foreground/90">{item.review.why}</dd></div>
                <div><dt className="font-semibold text-foreground">{t('ct_rev_favours')}</dt><dd className="text-foreground/90">{t(`ct_rev_party_${item.review.favours.toLowerCase()}`)}</dd></div>
              </dl>

              <div className="mt-3 rounded-xl bg-[hsl(var(--gold-soft))] p-3">
                <p className="text-2xs font-semibold uppercase tracking-wide text-[hsl(var(--gold-ink))]">{t(item.kind === 'MISSING' ? 'ct_rev_add_clause' : 'ct_rev_suggestion')}</p>
                {isEditing ? (
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} aria-label={t('ct_rev_edit')}
                    className="mt-2 w-full rounded-lg border border-border bg-background p-2 text-sm leading-relaxed outline-none focus:border-[hsl(var(--gold))]" />
                ) : (
                  <p className="mt-1 text-sm leading-relaxed text-foreground">{d?.status === 'EDITED' ? d.text : item.review.suggestion}</p>
                )}
              </div>
              {item.review.tradeoffs ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">{t('ct_rev_tradeoffs')}:</span> {item.review.tradeoffs}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
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
                      className={cn(chip, d?.status === 'ACCEPTED' ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]' : 'border-border')}>
                      <Check className="h-4 w-4" aria-hidden="true" />{t('ct_rev_accept')}
                    </button>
                    <button type="button" aria-pressed={d?.status === 'EDITED'} onClick={() => { setDraft(d?.text ?? item.review.suggestion); setEditing(item.key); }}
                      className={cn(chip, d?.status === 'EDITED' ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold-soft))]' : 'border-border')}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />{t('ct_rev_edit')}
                    </button>
                    <button type="button" aria-pressed={d?.status === 'REJECTED'} onClick={() => decide(item.key, d?.status === 'REJECTED' ? null : { key: item.key, status: 'REJECTED' })}
                      className={cn(chip, d?.status === 'REJECTED' ? 'border-foreground bg-foreground text-background' : 'border-border')}>
                      <X className="h-4 w-4" aria-hidden="true" />{t('ct_rev_reject')}
                    </button>
                    <button type="button" onClick={() => askHomi(item)} className={cn(chip, 'border-[hsl(var(--gold-border))] text-[hsl(var(--gold-ink))]')}>{t('ct_rev_ask_homi')}</button>
                  </>
                )}
              </div>
              {result?.unplaced.includes(item.key) ? <p role="status" className="mt-2 text-xs text-[hsl(var(--destructive))]">{t('ct_rev_unplaced')}</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-3 z-10 rounded-2xl border border-[hsl(var(--gold-border))] bg-card/95 p-4 shadow-hover backdrop-blur">
        {text === null ? <p className="mb-2 text-xs text-muted-foreground">{t('ct_rev_no_text')}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={saving || !result} onClick={() => void save()} className={cn(chip, 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-60')}>
            {t('ct_rev_save')}
          </button>
          <button type="button" disabled={!result} onClick={() => setShowCompare((v) => !v)} aria-expanded={showCompare} className={cn(chip, 'border-border')}>
            <FileText className="h-4 w-4" aria-hidden="true" />{t('ct_rev_compare')}
          </button>
          <button type="button" disabled={!result} onClick={() => exportDocx(false)} className={cn(chip, 'border-border')}><Download className="h-4 w-4" aria-hidden="true" />{t('ct_rev_docx')}</button>
          <button type="button" disabled={!result || !result.changes.length} onClick={() => exportDocx(true)} className={cn(chip, 'border-border')}><Download className="h-4 w-4" aria-hidden="true" />{t('ct_rev_docx_tracked')}</button>
          <button type="button" disabled={!result} onClick={() => { if (result && !printHtml(`${title} · ${t('ct_rev_revised')}`, result.text, lang, isRTL ? 'rtl' : 'ltr')) setNotice('ct_rev_popup_blocked'); }} className={cn(chip, 'border-border')}>
            <Printer className="h-4 w-4" aria-hidden="true" />{t('ct_rev_pdf')}
          </button>
          {history.length ? (
            <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className={cn(chip, 'border-border')}><History className="h-4 w-4" aria-hidden="true" />{t('ct_rev_history')}</button>
          ) : null}
        </div>
        {notice ? <p role="status" className="mt-2 text-sm text-foreground">{t(notice)}</p> : null}
        <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">{t('ct_rev_disclaimer')}</p>
      </div>

      {showCompare && result ? (
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h3 className="font-display text-base font-semibold">{t('ct_rev_compare')}</h3>
          {result.changes.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('ct_rev_no_changes')}</p> : (
            <ul className="mt-3 space-y-3">
              {result.changes.map((c) => (
                <li key={c.key} className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-muted/60 p-3 text-sm"><p className="text-2xs font-semibold uppercase text-muted-foreground">{t('ct_rev_before')}</p><p className="mt-1 line-through decoration-[hsl(var(--destructive))]/60">{c.before ?? t('ct_rev_not_in_original')}</p></div>
                  <div className="rounded-lg bg-[hsl(var(--gold-soft))] p-3 text-sm"><p className="text-2xs font-semibold uppercase text-[hsl(var(--gold-ink))]">{t('ct_rev_after')}</p><p className="mt-1">{c.after}</p></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {showHistory ? (
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h3 className="font-display text-base font-semibold">{t('ct_rev_history')}</h3>
          <ol className="mt-2">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
                <span>{t('ct_rev_version', { n: h.version })} · {new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(h.createdAt))} · {t('ct_rev_version_counts', { applied: h.applied })}</span>
                <button type="button" className="min-h-11 font-medium text-[hsl(var(--gold-ink))] underline underline-offset-4"
                  onClick={() => setDecisions(Object.fromEntries(h.decisions.map((d) => [d.key, d])))}>{t('ct_rev_restore')}</button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
