import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE, SECTION_Y } from './primitives';

/**
 * REGION 03 — what Homatch actually understands.
 *
 * THE ARGUMENT
 *
 * A listings site knows a property. Homatch's claim is that it knows the
 * seven things stacked underneath one — and that each of them changes the
 * decision. Saying that in prose takes a paragraph nobody reads. Built as a
 * tower whose floors light up one at a time, it takes two seconds.
 *
 * Every layer here is something the product genuinely gathers: the official
 * record and the project behind it (Verify), the district and comparable
 * prices (the research that feeds a report), the demand signals matching
 * runs against, the contract analysis inside a verification case, and the
 * financing model on the mortgage page. Nothing in this list is aspirational.
 *
 * MOTION
 *
 * The highlight advances on its own so the idea lands without interaction,
 * pauses while a visitor is hovering or tabbing through it, and does not run
 * at all under prefers-reduced-motion — where the section is simply a list
 * with the first floor lit, which reads perfectly well.
 */

const LAYERS = [
  { key: 'property', label: 'mp_layer_property', desc: 'mp_layer_property_d' },
  { key: 'project', label: 'mp_layer_project', desc: 'mp_layer_project_d' },
  { key: 'location', label: 'mp_layer_location', desc: 'mp_layer_location_d' },
  { key: 'market', label: 'mp_layer_market', desc: 'mp_layer_market_d' },
  { key: 'demand', label: 'mp_layer_demand', desc: 'mp_layer_demand_d' },
  { key: 'contract', label: 'mp_layer_contract', desc: 'mp_layer_contract_d' },
  { key: 'financing', label: 'mp_layer_financing', desc: 'mp_layer_financing_d' },
] as const;

export function IntelligenceLayersSection() {
  const { t } = useLanguage();
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (held || reduced.current) return;
    const id = window.setInterval(() => setActive(i => (i + 1) % LAYERS.length), 3400);
    return () => window.clearInterval(id);
  }, [held]);

  return (
    <section id="intelligence" className="scroll-mt-20 bg-[#080808] text-white">
      <div className={`${PAGE} ${SECTION_Y}`}>
        <div className="max-w-[46rem]">
          <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">
            <span className="h-px w-7 bg-gold" aria-hidden="true" />
            {t('mp_layers_eyebrow')}
          </p>
          <h2
            className="mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:mt-5"
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
          >
            {t('mp_layers_title')}
          </h2>
          <p className="mt-4 max-w-[38rem] text-pretty text-[14.5px] leading-[1.65] text-white/65 sm:mt-5 sm:text-base sm:leading-[1.7]">
            {t('mp_layers_sub')}
          </p>
        </div>

        {/* Three columns: the picture, the floors, and the floor you are on.
            Two columns left a wide dead band to the right of seven short
            labels, which is exactly the empty premium-SaaS look this pass is
            supposed to get rid of. */}
        <div
          className="mt-8 grid gap-8 sm:mt-12 sm:gap-10 lg:grid-cols-[minmax(0,19rem)_minmax(0,26rem)_minmax(0,20rem)] lg:items-center lg:justify-between lg:gap-12 xl:gap-16"
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocusCapture={() => setHeld(true)}
          onBlurCapture={() => setHeld(false)}
        >
          <Tower active={active} />

          {/* The floors, as a list. Selecting one drives the tower; this is
              the accessible control, and the tower is its picture. */}
          <ul className="order-3 min-w-0 lg:order-none">
            {LAYERS.map((layer, i) => {
              const on = i === active;
              return (
                <li key={layer.key}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    aria-current={on}
                    className={`group relative flex w-full items-center gap-3.5 border-b py-3.5 ps-4 sm:gap-4 sm:py-4 text-start transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold motion-reduce:transition-none ${
                      on ? 'border-gold/60' : 'border-white/[0.12] hover:border-white/30'
                    }`}
                  >
                    {/* The gold bar is what ties this row to the lit floor.
                        A colour shift alone was too quiet to read as a link
                        between the two columns. */}
                    <span
                      className={`absolute inset-y-2 start-0 w-[3px] rounded-full transition-colors duration-300 motion-reduce:transition-none ${
                        on ? 'bg-gold' : 'bg-transparent'
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={`shrink-0 font-mono text-[11px] tabular-nums tracking-widest transition-colors duration-300 motion-reduce:transition-none ${
                        on ? 'text-gold' : 'text-white/35'
                      }`}
                      aria-hidden="true"
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={`min-w-0 flex-1 text-[17px] leading-snug transition-colors duration-300 motion-reduce:transition-none sm:text-lg ${
                        on ? 'font-semibold text-white' : 'font-medium text-white/55 group-hover:text-white/85'
                      }`}
                    >
                      {t(layer.label)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* The floor you are on, in a block of fixed height. Inside the list
              this sentence changed a row's height on every tick and shunted
              the rows below it — a section that moves under the reader's eye
              while they are reading it. */}
          <div className="order-2 min-w-0 rounded-[0.9rem] border border-white/15 bg-[#0C0C0C] p-6 lg:order-none">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">{t(LAYERS[active].label)}</p>
            <p className="mt-3 min-h-[7.5rem] text-pretty text-sm leading-relaxed text-white/70 sm:min-h-[8.5rem]">
              {t(LAYERS[active].desc)}
            </p>
            <p className="border-t border-white/[0.12] pt-4 text-[11px] uppercase tracking-[0.16em] text-white/35">
              {String(active + 1).padStart(2, '0')} / {String(LAYERS.length).padStart(2, '0')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The tower. Seven floors, bottom to top, tapering — the property is the
 * ground it all stands on and financing is what sits on top of the finished
 * picture. The lit floor is gold and steps out of the stack.
 */
function Tower({ active }: { active: number }) {
  const floors = LAYERS.length;
  const H = 46;
  const GAP = 9;
  const topY = 34;

  return (
    <div className="relative mx-auto w-full max-w-[17rem] sm:max-w-[19rem] lg:mx-0">
      <svg
        viewBox="0 0 300 440"
        className="h-auto w-full"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* The mast, and the ground it stands on. */}
        <path d="M150 6 V30" stroke="hsl(38 88% 54%)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="150" cy="6" r="3.5" fill="hsl(38 88% 54%)" />

        {LAYERS.map((layer, i) => {
          /* Index 0 is the ground floor, so it is drawn last from the top. */
          const fromTop = floors - 1 - i;
          const y = topY + fromTop * (H + GAP);
          /* Widest at the bottom: the property is the ground everything else
             is stacked on, and a tower that narrows upward is the only way
             this reads as a building rather than as a bar chart. */
          const width = 124 + fromTop * 21;
          const x = 150 - width / 2;
          const on = i === active;

          return (
            <g
              key={layer.key}
              style={{
                transform: on ? 'translateX(10px)' : 'translateX(0)',
                transition: 'transform 420ms cubic-bezier(0.22,1,0.36,1)',
              }}
              className="motion-reduce:!transform-none motion-reduce:![transition:none]"
            >
              <rect
                x={x}
                y={y}
                width={width}
                height={H}
                rx="4"
                fill={on ? 'hsl(38 88% 54%)' : '#1A1A1A'}
                stroke={on ? 'hsl(38 88% 68%)' : 'rgba(255,255,255,0.28)'}
                strokeWidth="1.5"
                style={{ transition: 'fill 420ms ease, stroke 420ms ease' }}
              />
              {/* Glazing. On the lit floor it reads as black windows in a gold
                  slab; on the rest as faint light in a dark one. */}
              <g fill={on ? 'rgba(0,0,0,0.58)' : 'rgba(255,255,255,0.22)'} style={{ transition: 'fill 420ms ease' }}>
                {Array.from({ length: Math.max(3, Math.floor((width - 20) / 30)) }).map((_, c, arr) => {
                  const span = arr.length * 30 - 14;
                  const startX = x + (width - span) / 2;
                  return <rect key={c} x={startX + c * 30} y={y + 13} width={16} height={20} rx="1.5" />;
                })}
              </g>
            </g>
          );
        })}

        {/* The plinth: a gold rule the whole structure sits on. */}
        <rect x="18" y={topY + floors * (H + GAP) + 4} width="264" height="4" rx="2" fill="hsl(38 88% 54%)" opacity="0.65" />
      </svg>
    </div>
  );
}
