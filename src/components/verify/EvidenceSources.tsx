/*
 * EVIDENCE & SOURCES — and the BUYER CHECKLIST that closes the report.
 *
 * Two sections, one file, because they are the same idea from two ends: what
 * this report rests on, and what the reader should do next. Both were
 * previously at the mercy of the model.
 *
 * WHY THE HEADER IS A BUTTON AND NOT A LINE OF TEXT
 *
 * The evidence drawer used a bare `<summary>` with a small chevron glyph. On
 * the live report it read as a footer caption, and people did not know it
 * opened. It is now an explicit expand control: a real heading, a source
 * count, a rotating chevron, and a hover/focus/active state across the whole
 * row — so the affordance is the entire header rather than a character at
 * the end of it.
 *
 * `<details>`/`<summary>` is kept deliberately. It is open/closed without
 * JavaScript, it is keyboard-operable and screen-reader-announced for free,
 * and its children do not mount while collapsed — which matters when the
 * expanded view is dozens of rows.
 *
 * WHAT IS NOT IN HERE
 *
 * No item ids, no tiers, no relevance scores, no provider names. Those are
 * our notes about our own pipeline; a customer reading them learns nothing
 * except that we shipped them. See evidenceGroups.ts.
 */
import { ChevronRight, ExternalLink, ShieldCheck, ClipboardList } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection } from './ui';
import {
  EVIDENCE_GROUP_KEY, evidenceRowCount,
  type EvidenceGroup,
} from '@/verify/intelligence/evidenceGroups';
import type { ChecklistItem } from '@/verify/intelligence/buyerChecklist';

export function EvidenceSources({ groups }: { groups: EvidenceGroup[] }) {
  const { t } = useLanguage();
  if (!groups.length) return null;
  const total = evidenceRowCount(groups);

  return (
    <details className="hm-invest-panel group overflow-hidden">
      {/*
        * The whole header is the control: `list-none` removes the native
        * marker, and the padding gives a tap target far larger than the old
        * chevron glyph.
        */}
      <summary
        className="flex cursor-pointer list-none items-start gap-3 p-5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] active:bg-muted/60 sm:p-6"
      >
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-xl font-semibold leading-tight text-foreground break-words">
              {t('ev_title')}
            </span>
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-2xs tabular-nums text-muted-foreground">
              {t('ev_count').replace('{n}', String(total))}
            </span>
          </span>
          <span className="mt-1.5 block max-w-[60ch] break-words text-sm leading-relaxed text-muted-foreground">
            {t('ev_subtitle')}
          </span>
        </span>
        <ChevronRight
          className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>

      <div className="space-y-5 border-t border-border px-5 pb-5 pt-5 sm:px-6">
        {groups.map((group) => (
          <section key={group.key} className="min-w-0">
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
              {t(EVIDENCE_GROUP_KEY[group.key])}
            </h3>
            <ul className="space-y-2">
              {group.rows.map((row, i) => (
                <li
                  key={`${row.claim}-${i}`}
                  className="min-w-0 rounded-xl border border-border bg-background/40 p-3"
                >
                  <p className="min-w-0 break-words text-sm leading-relaxed text-foreground">{row.claim}</p>
                  {/* Wraps rather than competing: the source name and date
                      share a row only while there is room for both. */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                    {row.official ? (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                        {t('ev_official')}
                      </span>
                    ) : null}
                    {row.source ? <span className="min-w-0 break-words">{row.source}</span> : null}
                    {row.date ? <span className="shrink-0 tabular-nums">{row.date}</span> : null}
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 text-[hsl(var(--gold-ink))] underline underline-offset-2"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-words">{t('verify_ir_selfcheck_open')}</span>
                      </a>
                    ) : null}
                  </div>
                  {/* A disagreement between sources is never merged away. */}
                  {row.conflict ? (
                    <p className="mt-1.5 min-w-0 break-words text-2xs leading-relaxed text-amber-700 dark:text-amber-400">
                      {row.conflict}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

/**
 * The closing checklist.
 *
 * Every item here was earned by a finding (see buyerChecklist.ts), so an
 * empty list renders nothing at all rather than a generic reassurance. It is
 * deliberately NOT the risks section: these are things to do, not things that
 * are wrong.
 */
export function BuyerChecklist({ items }: { items: ChecklistItem[] }) {
  const { t } = useLanguage();
  if (!items.length) return null;

  return (
    <VerifySection
      eyebrow={t('bc_intro')}
      title={t('bc_title')}
    >
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={item.key} className="flex min-w-0 gap-3">
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-2xs font-semibold tabular-nums text-[hsl(var(--gold-ink))]"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="min-w-0 break-words text-sm font-medium text-foreground">{t(item.labelKey)}</p>
              <p className="mt-1 min-w-0 break-words text-sm leading-relaxed text-muted-foreground">
                {t(item.detailKey)}
              </p>
              {/* The value they need in hand, and the place to use it. */}
              {item.value || item.url ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {item.value ? (
                    <code className="min-w-0 break-all rounded bg-muted px-2 py-1 text-2xs tabular-nums">
                      {item.value}
                    </code>
                  ) : null}
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 min-w-0 items-center gap-1.5 text-sm text-[hsl(var(--gold-ink))] underline underline-offset-2"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-words">{t('verify_ir_selfcheck_open')}</span>
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-2xs leading-relaxed text-muted-foreground">
        <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{t('dr_docs_legal_note')}</span>
      </p>
    </VerifySection>
  );
}
