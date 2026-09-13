import React from 'react';
import { Database, Plug, ShieldCheck } from 'lucide-react';
import { PAGE, SECTION_Y } from '../primitives';
import { useSectionField, useFieldProps, useSectionIconName } from '@/site/content';
import { iconFor } from '@/site/icons';

/**
 * WHERE HOMATCH SITS IN A DEVELOPER'S EXISTING STACK.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not list named integrations. A logo wall is a promise that a
 * specific system is supported today, and the honest answer is that it
 * depends on the system — which the note says, in those words, rather than
 * being buried in a footnote or omitted.
 *
 * It also does not publish endpoint names or keys. That is documentation,
 * not a product page, and printing a shape here would be inventing an API
 * surface to look credible.
 */

const POINTS = [
  { key: 'feed', icon: Database, fallback: 'devp_api_body' },
  { key: 'connect', icon: Plug, fallback: 'devp_api_body' },
  { key: 'control', icon: ShieldCheck, fallback: 'devp_api_body' },
] as const;

export function DevApiSection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const icon = useSectionIconName();

  return (
    <section className="bg-secondary/40">
      <div className={`${PAGE} ${SECTION_Y}`}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-14">
          <div className="min-w-0">
            <p
              className="flex items-center gap-2.5 text-[14px] font-semibold uppercase tracking-[0.24em] text-gold-ink"
              {...fp('eyebrow')}
            >
              <span className="h-px w-7 bg-gold" aria-hidden="true" />
              {sf('eyebrow', 'devp_api_eyebrow')}
            </p>
            <h2
              className="mt-4 text-balance font-semibold leading-[1.12] tracking-[-0.02em] text-foreground"
              style={{ fontSize: 'clamp(1.35rem, 4.4vw, 2.2rem)' }}
              {...fp('title')}
            >
              {sf('title', 'devp_api_title')}
            </h2>
            <p className="mt-4 text-pretty text-[16px] leading-[1.7] text-ink-soft" {...fp('body')}>
              {sf('body', 'devp_api_body')}
            </p>
          </div>

          <ul className="grid min-w-0 gap-3 sm:grid-cols-3 lg:content-start">
            {POINTS.map(point => {
              const Icon = iconFor(icon(point.key), point.icon);
              return (
                <li
                  key={point.key}
                  className="min-w-0 rounded-[0.9rem] border border-border bg-card p-4"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-gold-soft text-gold-ink">
                    <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <p
                    className="mt-3 text-pretty text-[16px] font-semibold leading-snug text-foreground"
                    {...fp(`point_${point.key}_t`)}
                  >
                    {sf(`point_${point.key}_t`, 'devp_api_eyebrow')}
                  </p>
                  <p
                    className="mt-1.5 text-pretty text-[15px] leading-relaxed text-ink-soft"
                    {...fp(`point_${point.key}_d`)}
                  >
                    {sf(`point_${point.key}_d`, point.fallback)}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        {/* The honest caveat, at full width under both columns, rather than
            as small print beside one of them. */}
        <p className="mt-6 text-pretty text-[14px] leading-relaxed text-muted-foreground" {...fp('note')}>
          {sf('note', 'devp_api_note')}
        </p>
      </div>
    </section>
  );
}
