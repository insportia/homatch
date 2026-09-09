import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE, SECTION_Y, SectionIntro } from './primitives';

/**
 * REGION 07 — how Homatch works.
 *
 * A narrative, not a flowchart. Five nodes on a single hairline rail: no
 * boxes, no connector arrows, no engineering diagram. The rail runs
 * horizontally on desktop and rotates to a vertical spine on mobile, so the
 * same five beats read the same way at both sizes.
 */
export function ProcessSection() {
  const { t } = useLanguage();

  const nodes = [
    { key: '1', title: t('mp_flow_1'), desc: t('mp_flow_1_desc') },
    { key: '2', title: t('mp_flow_2'), desc: t('mp_flow_2_desc') },
    { key: '3', title: t('mp_flow_3'), desc: t('mp_flow_3_desc') },
    { key: '4', title: t('mp_flow_4'), desc: t('mp_flow_4_desc') },
    { key: '5', title: t('mp_flow_5'), desc: t('mp_flow_5_desc') },
  ];

  return (
    <section id="how" className={`${PAGE} scroll-mt-24 ${SECTION_Y}`}>
      <SectionIntro eyebrow={t('mp_how_eyebrow')} title={t('mp_how_title')} body={t('mp_how_sub')} />

      <ol className="relative mt-16 grid gap-10 md:grid-cols-5 md:gap-6">
        {/* The rail. Vertical spine below md, horizontal rule from md up —
            one element, positioned differently, rather than two drawn twice. */}
        <span
          className="pointer-events-none absolute start-[7px] top-2 bottom-2 w-px rule-y md:start-0 md:end-0 md:top-[7px] md:bottom-auto md:h-px md:w-auto md:rule-x"
          aria-hidden="true"
        />

        {nodes.map((node, i) => (
          <li key={node.key} className="relative ps-9 md:ps-0 md:pt-9">
            <span
              className="absolute start-0 top-1.5 grid h-[15px] w-[15px] place-items-center rounded-full bg-background md:top-0"
              aria-hidden="true"
            >
              <span className={`h-2 w-2 rounded-full ${i === 0 || i === nodes.length - 1 ? 'bg-gold' : 'bg-border'}`} />
            </span>

            <span className="block text-[11px] font-semibold tabular-nums tracking-[0.2em] text-gold">{`0${i + 1}`}</span>
            <h3 className="mt-2.5 text-balance text-base font-semibold leading-snug text-foreground">{node.title}</h3>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-ink-soft md:pe-4">{node.desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
