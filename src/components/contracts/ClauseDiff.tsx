/*
 * ONE CLAUSE: WHAT IS THERE NOW, WHAT WILL BE WRITTEN, AND EXACTLY WHAT CHANGES.
 *
 * Three views of the same proposal, one tap apart:
 *   · Changes   the contract's words with removed words struck in red and
 *               added words underlined in green (word-level diff, wordDiff.ts);
 *   · Now       the contract's own words, unchanged;
 *   · Written   the exact text that goes into the revised contract.
 * Under them, in words: how many words go, how many come in, how many stay.
 *
 * A protection the contract is missing has no "now": it is all new text, and
 * the card says so instead of showing an empty column.
 */
import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { diffStats, wordDiff } from '@/contracts/wordDiff';
import './contracts.css';

type View = 'changes' | 'before' | 'after';

export function ClauseDiff({ before, after, idBase }: { before: string | null; after: string; idBase: string }) {
  const { t } = useLanguage();
  const [view, setView] = useState<View>('changes');
  const segs = useMemo(() => (before ? wordDiff(before, after) : null), [before, after]);
  const stats = useMemo(() => (segs ? diffStats(segs) : null), [segs]);

  if (!before) {
    return (
      <div className="rounded-xl border border-emerald-600/25 bg-emerald-50/60 p-3 dark:bg-emerald-500/5">
        <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">{t('ux_ct_diff_new')}</p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground"><span className="ct-ins">{after}</span></p>
      </div>
    );
  }

  const tabs: Array<[View, string]> = [['changes', t('ux_ct_tab_changes')], ['before', t('ux_ct_tab_before')], ['after', t('ux_ct_tab_after')]];
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/60">
      <div role="tablist" aria-label={t('ux_ct_tab_changes')} className="flex min-w-0 gap-1 border-b border-border p-1">
        {tabs.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`${idBase}-tab-${v}`}
            aria-selected={view === v}
            aria-controls={`${idBase}-panel`}
            onClick={() => setView(v)}
            className={cn(
              'min-h-10 min-w-0 flex-1 rounded-lg px-2 text-[13px] font-medium leading-tight transition-colors',
              view === v ? 'bg-[#0C1119] text-white shadow-card' : 'text-foreground/75 hover:bg-muted',
            )}
          >
            <span className="break-words">{label}</span>
          </button>
        ))}
      </div>
      <div id={`${idBase}-panel`} role="tabpanel" aria-labelledby={`${idBase}-tab-${view}`} className="p-3">
        <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.75] text-foreground">
          {view === 'changes' && segs
            ? segs.map((s, i) => (
                s.kind === 'same' ? <span key={i}>{s.text}</span>
                  : s.kind === 'del' ? <del key={i} className="ct-del">{s.text}</del>
                  : <ins key={i} className="ct-ins no-underline">{s.text}</ins>
              ))
            : view === 'before' ? before : after}
        </p>
        {view === 'changes' && stats ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="ct-del inline-block h-3 w-5" aria-hidden="true" />{t('ux_ct_legend_del')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="ct-ins inline-block h-3 w-5" aria-hidden="true" />{t('ux_ct_legend_ins')}</span>
            <span className="min-w-0 break-words">{t('ux_ct_diff_stats', { removed: stats.removed, added: stats.added, kept: stats.kept })}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
