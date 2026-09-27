import React from 'react';
import { ArrowRight, Check, Globe2, Network, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * THE PUBLIC SITE'S SHARED PIECES.
 *
 * Buttons, the eyebrow, and the two product illustrations that appear both
 * on the home page and on the product entry pages. The illustrations are
 * STRUCTURE, never data: a search plan shows the fields a plan has with the
 * example the Find Property composer itself offers, and a match shows the
 * three fit words and the reasons the product really gives — no names, no
 * counts, no prices, no photograph of a property that does not exist.
 *
 * Styling lives in the `.hm-public` block of src/index.css.
 */

type ButtonTone = 'primary' | 'secondary' | 'tertiary';

export function PubButton({
  tone = 'primary', size, arrow = false, className = '', children, ...rest
}: {
  tone?: ButtonTone;
  size?: 'lg';
  arrow?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`hm-pub-btn hm-pub-btn--${tone} ${size === 'lg' ? 'hm-pub-btn--lg' : ''} ${className}`}
      {...rest}
    >
      <span className="min-w-0">{children}</span>
      {arrow && <ArrowRight className="hm-pub-arrow" strokeWidth={2} aria-hidden="true" />}
    </button>
  );
}

export function PubEyebrow({
  children, className = '', ...rest
}: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`hm-pub-eyebrow ${className}`} {...rest}>{children}</p>;
}

/** Numbered steps, the page's one way of explaining a sequence. */
export function PubSteps({
  steps, className = '',
}: {
  steps: { title: React.ReactNode; body: React.ReactNode; titleMark?: object; bodyMark?: object }[];
  className?: string;
}) {
  return (
    <ol className={`space-y-5 ${className}`}>
      {steps.map((step, i) => (
        <li key={i} className="flex gap-4">
          <span
            className="hm-pub-num grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold-border/70 bg-gold-soft text-[13px] font-semibold text-gold-ink"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-[16.5px] font-semibold leading-snug text-foreground" {...(step.titleMark ?? {})}>{step.title}</p>
            <p className="mt-1 text-pretty text-[15.5px] leading-relaxed text-ink-soft" {...(step.bodyMark ?? {})}>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * What a search plan is: the fields Homatch reads out of a description.
 *
 * The description is the Find Property composer's own example, so the
 * illustration and the product say the same thing in every language.
 */
export function SearchPlanPreview({ className = '' }: { className?: string }) {
  const { t } = useLanguage();
  const rows: [string, string][] = [
    [t('plan_row_goal'), t('pub_ex_goal')],
    [t('plan_field_city'), t('pub_ex_city')],
    [t('plan_field_districts'), t('pub_ex_districts')],
    [t('plan_field_budget'), t('pub_ex_budget')],
    [t('plan_row_bedrooms'), t('pub_ex_bedrooms')],
  ];
  return (
    <figure className={`hm-pub-card bg-card overflow-hidden ${className}`}>
      <div className="border-b border-border bg-secondary/60 px-5 py-4">
        <p className="hm-pub-label">{t('pub_ex_described')}</p>
        <p className="mt-2 text-pretty text-[15px] leading-relaxed text-foreground">“{t('plan_composer_placeholder')}”</p>
      </div>
      <div className="px-5 py-4">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-gold-ink" strokeWidth={1.9} aria-hidden="true" />
          {t('plan_understood_title')}
        </p>
        <dl className="mt-3 divide-y divide-border rounded-xl border border-border">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
              <dt className="text-[14px] text-muted-foreground">{label}</dt>
              <dd className="text-end text-[14.5px] font-medium text-foreground"><bdi>{value}</bdi></dd>
            </div>
          ))}
        </dl>
      </div>
      <figcaption className="border-t border-border px-5 py-3 text-[13px] leading-snug text-muted-foreground">
        {t('pub_ex_caption')}
      </figcaption>
    </figure>
  );
}

/**
 * What a match is: a fit word, the reasons, where it came from, and the
 * sentence that keeps the claim honest. No person, no number.
 */
export function MatchPreview({
  className = '', why, reasons, caveat, marks,
}: {
  className?: string;
  why?: string;
  reasons?: [string, string, string];
  caveat?: string;
  marks?: { why?: object; reasons?: [object, object, object]; caveat?: object };
}) {
  const { t } = useLanguage();
  const lines = reasons ?? [t('mp_result_match_reason_1'), t('mp_result_match_reason_2'), t('mp_result_match_reason_3')];
  return (
    <figure className={`hm-pub-card bg-card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <p className="text-[15px] font-semibold text-foreground">{t('pub_match_card_title')}</p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-border/70 bg-gold-soft px-2.5 py-1 text-[13px] font-semibold text-gold-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
          {t('match_fit_strong')}
        </span>
      </div>
      <div className="px-5 py-4">
        <p className="hm-pub-label" {...(marks?.why ?? {})}>
          {why ?? t('mp_result_match_why')}
        </p>
        <ul className="mt-2.5 space-y-2">
          {lines.map((line, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[15px] leading-snug text-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(152_60%_32%)]" strokeWidth={2.5} aria-hidden="true" />
              <span {...(marks?.reasons?.[i] ?? {})}>{line}</span>
            </li>
          ))}
        </ul>
        {/* One match has one origin; both kinds are shown so the card says
            that either is possible, and which one this is. */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="text-muted-foreground">{t('pub_match_source')}</span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/25 bg-card px-2.5 py-1 font-medium text-foreground">
            <Network className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
            {t('pub_source_native')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1 text-muted-foreground">
            <Globe2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
            {t('pub_source_external')}
          </span>
        </div>
      </div>
      <figcaption className="border-t border-border bg-secondary/60 px-5 py-3 text-[13.5px] leading-snug text-ink-soft" {...(marks?.caveat ?? {})}>
        {caveat ?? t('mp_match_caveat')}
      </figcaption>
    </figure>
  );
}
