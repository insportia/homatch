import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE, SECTION_Y } from './primitives';
import { BuildingScene, FLOORS, storeyOf } from './BuildingScene';
import { useSectionField, useFieldProps } from '@/site/content';

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

/*
 * The registry keys behind the four callouts, in the order they render.
 *
 * The storey (index 0) is deliberately not marked on the VALUE: it is the lit
 * floor, computed from the active layer, and letting somebody type over it
 * would let the number disagree with the drawing beside it. Its LABEL is
 * editable like the rest.
 */
const CALLOUT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['bi_cal_floor', 'bi_val_floor'],
  ['bi_cal_area', 'bi_val_area'],
  ['bi_cal_rooms', 'bi_val_rooms'],
  ['bi_cal_status', 'bi_val_status'],
];

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

  const sf = useSectionField();
  const fp = useFieldProps();
  const { t } = useLanguage();
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);

  /*
   * THE HIGHLIGHT WALKS THE TOWER ON A PHONE TOO.
   *
   * It used to be gated on `(min-width: 1024px)`, on the reasoning that a
   * phone visitor would tap and that something moving under a reaching thumb
   * is worse than something still. That reasoning produced a phone
   * composition where nothing moved at all AND -- because the layer list and
   * its description were both inside the desktop-only grid -- nothing said
   * what the seven layers were either. A visitor on a phone got a drawing of
   * a building and four numbers.
   *
   * So it runs at every width now, and `held` still stops it the moment a
   * finger or a cursor is on the list: interaction wins, absence does not.
   */
  const [autoplay, setAutoplay] = useState(false);
  /*
   * Every visible word in the building scene, through the content model.
   * The animation must not depend on literal English: it plays in six
   * languages, and an admin can change any of these labels.
   */
  const buildingCopy = {
    stages: [
      sf('bi_stage_idle', 'bi_stage_idle'),
      sf('bi_stage_scan', 'bi_stage_scan'),
      sf('bi_stage_floors', 'bi_stage_floors'),
      sf('bi_stage_floor', 'bi_stage_floor'),
      sf('bi_stage_unit', 'bi_stage_unit'),
      sf('bi_stage_done', 'bi_stage_done'),
    ],
    callouts: [
      { label: sf('bi_cal_floor', 'bi_cal_floor'), value: sf('bi_val_floor', 'bi_val_floor') },
      { label: sf('bi_cal_area', 'bi_cal_area'), value: sf('bi_val_area', 'bi_val_area') },
      { label: sf('bi_cal_rooms', 'bi_cal_rooms'), value: sf('bi_val_rooms', 'bi_val_rooms') },
      { label: sf('bi_cal_status', 'bi_cal_status'), value: sf('bi_val_status', 'bi_val_status') },
    ],
    note: sf('bi_note', 'bi_note'),
    alt: t('bi_alt'),
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setAutoplay(!still.matches);
    sync();
    still.addEventListener('change', sync);
    return () => still.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!autoplay || held) return;
    const id = window.setInterval(() => setActive(i => (i + 1) % LAYERS.length), 3400);
    return () => window.clearInterval(id);
  }, [autoplay, held]);

  /*
   * ONE NUMBER DRIVES BOTH.
   *
   * Seven layers, eight floors. The property is the ground the rest stands
   * on, so layer 0 is the bottom of the stack and financing is near the top —
   * the same order the desktop tower is drawn in. The building is handed this
   * floor as a prop rather than keeping its own clock, which is what makes
   * the highlight and the sentence change on the same tick instead of
   * drifting apart within seconds.
   */
  const focusFloor = FLOORS - 1 - active;

  /* What the editor needs to find each string the scene draws. The scene
     receives resolved copy, so the identity has to travel separately. */
  const sceneFields = {
    stage: fp('bi_stage_done'),
    callout: (i: number) => fp(CALLOUT_FIELDS[i]?.[0] ?? 'bi_cal_floor'),
    value: (i: number) => fp(CALLOUT_FIELDS[i]?.[1] ?? 'bi_val_floor'),
    note: fp('bi_note'),
  };

  /*
   * THE FINDINGS ARRIVE, THEY DO NOT APPEAR.
   *
   * These four used to live inside the drawing, where they carried a 20px
   * staggered reveal. Moving them out to sit under the pair — the only place
   * on a 320px screen with width for them — left them arriving instantly,
   * which reads as four boxes that were always there rather than as four
   * things the analysis just worked out. Same 20px, same stagger, started
   * when the block is genuinely on screen.
   */
  const phone = useRef<HTMLDivElement | null>(null);
  const [found, setFound] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setFound(true); return; }
    const el = phone.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        setFound(true);
        io.disconnect();
      }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="intelligence" className="scroll-mt-20 bg-[#0D0D0D] text-white">
      <div className={`${PAGE} ${SECTION_Y}`}>
        <div className="max-w-[46rem]">
          <p className="flex items-center gap-2.5 text-[14px] font-semibold uppercase tracking-[0.24em] text-gold" {...fp('eyebrow')}>
            <span className="h-px w-7 bg-gold" aria-hidden="true" />
            {sf('eyebrow', 'mp_layers_eyebrow')}
          </p>
          <h2
            className="mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:mt-5"
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
           {...fp('title')}>
            {sf('title', 'mp_layers_title')}
          </h2>
          <p className="mt-4 max-w-[38rem] text-pretty text-[16px] leading-[1.65] text-white/65 sm:mt-5 sm:text-base sm:leading-[1.7]" {...fp('body')}>
            {sf('body', 'mp_layers_sub')}
          </p>
        </div>

        {/*
          * ── THE PHONE COMPOSITION ─────────────────────────────────
          *
          * The same three things the desktop shows, stacked instead of
          * placed side by side: the building, the layer it is currently
          * reading, and the seven layers as a list you can tap.
          *
          * Until now this was the building alone. The list and the sentence
          * lived inside the `hidden lg:grid` container below, so a phone
          * visitor was shown a drawing and four numbers and never learned
          * what the seven layers were -- the section's entire argument,
          * absent, on the device most people arrive on.
          *
          * Order matters: picture, then what it found, then the control. The
          * sentence sits directly under the drawing because it is the
          * caption for what just moved.
          */}
        <div
          ref={phone}
          className="mt-8 lg:hidden"
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
        >
          {/*
            * THE BUILDING STANDS BESIDE WHAT IT FOUND.
            *
            * It used to be full width with the sentence underneath, which on
            * a 390px phone puts about 380px of drawing between the thing
            * moving and the words explaining it — far enough that they read
            * as two unrelated blocks, and on a 320px screen the sentence is
            * off the bottom of the fold entirely while the highlight moves
            * where nobody is looking.
            *
            * 42/58. Measured rather than chosen: at 320px that leaves the
            * drawing 118px, which is still legibly a tower with distinct
            * floors, and the text 163px, which fits "ხელშეკრულების
            * ანალიზი" on two lines without hyphenating. Anything narrower
            * for the text and Georgian starts breaking mid-word; anything
            * narrower for the building and the floors stop resolving.
            *
            * `items-center` rather than `items-start`: the lit floor moves
            * up and down the façade, and a centred pairing keeps it near the
            * words at every step instead of only at the top of the stack.
            */}
          <div className="grid grid-cols-[42fr_58fr] items-center gap-3 sm:gap-4">
            <div className="min-w-0">
              <BuildingScene copy={buildingCopy} focus={focusFloor} compact />
            </div>

            <div className="min-w-0">
              <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-gold">
                {String(active + 1).padStart(2, '0')} / {String(LAYERS.length).padStart(2, '0')}
              </p>
              <p
                className="mt-1.5 text-pretty text-[19px] font-semibold leading-[1.15] text-white"
                {...fp(`layer_${LAYERS[active].key}`)}
              >
                {sf(`layer_${LAYERS[active].key}`, LAYERS[active].label)}
              </p>
              {/* The finding, clamped so a long Georgian sentence cannot push
                  the row taller than the drawing beside it and make the page
                  jump on every tick. The whole sentence is directly below. */}
              <p
                className="mt-2 line-clamp-4 text-pretty text-[14px] leading-[1.5] text-white/65"
                {...fp(`layer_${LAYERS[active].key}_d`)}
              >
                {sf(`layer_${LAYERS[active].key}_d`, LAYERS[active].desc)}
              </p>
            </div>
          </div>

          {/* The four things the analysis actually read off the building.
              Out of the drawing column, where there is no width for them,
              and under the pair, where there is. The floor is the LIT floor,
              so it cannot disagree with the highlight. */}
          <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {buildingCopy.callouts.map((callout, i) => (
              <div
                key={callout.label}
                className="min-w-0 rounded-[0.7rem] border border-white/15 bg-white/[0.04] px-3 py-2.5"
                style={{
                  opacity: found ? 1 : 0,
                  transform: found ? 'none' : 'translateY(20px)',
                  transition: `opacity 520ms cubic-bezier(0.16,1,0.3,1) ${i * 140}ms, transform 520ms cubic-bezier(0.16,1,0.3,1) ${i * 140}ms`,
                }}
              >
                <dt
                  className="text-[13px] uppercase tracking-[0.14em] text-white/45"
                  {...fp(CALLOUT_FIELDS[i][0])}
                >
                  {callout.label}
                </dt>
                <dd
                  className="mt-0.5 text-pretty text-[17px] font-semibold leading-tight text-white"
                  {...(i === 0 ? {} : fp(CALLOUT_FIELDS[i][1]))}
                >
                  {i === 0 ? String(storeyOf(focusFloor)) : callout.value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 text-[13px] leading-relaxed text-white/40">{buildingCopy.note}</p>

          <div className="mt-6">
            <LayerPanel active={active} />
          </div>
          <div className="mt-6">
            <LayerList active={active} onPick={setActive} />
          </div>
        </div>

        {/* Three columns from lg: the picture, the floors, and the floor you
            are on. Two columns left a wide dead band to the right of seven
            short labels, which is the empty premium-SaaS look this pass
            exists to remove. */}
        <div
          className="mt-8 hidden gap-8 sm:mt-12 sm:gap-10 lg:grid lg:grid-cols-[minmax(0,19rem)_minmax(0,26rem)_minmax(0,20rem)] lg:items-center lg:justify-between lg:gap-12 xl:gap-16"
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocusCapture={() => setHeld(true)}
          onBlurCapture={() => setHeld(false)}
        >
          <BuildingScene copy={buildingCopy} fields={sceneFields} />

          <div className="order-3 min-w-0 lg:order-none">
            <LayerList active={active} onPick={setActive} />
          </div>

          <div className="order-2 min-w-0 lg:order-none">
            <LayerPanel active={active} />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * THE SEVEN LAYERS, AS A LIST YOU CAN TAP.
 *
 * One component for both widths. It used to be two — a desktop list inside
 * the grid and a `MobileStack` that nothing rendered — and the phone quietly
 * ended up with neither.
 *
 * Rows are 48px minimum, which is a thumb, and the active row carries a gold
 * bar rather than only a colour shift: a shift in text colour is the kind of
 * signal that survives a design review and not daylight.
 */
function LayerList({ active, onPick }: { active: number; onPick: (i: number) => void }) {
  const sf = useSectionField();
  const fp = useFieldProps();
  return (
    <ul>
      {LAYERS.map((layer, i) => {
        const on = i === active;
        return (
          <li key={layer.key}>
            <button
              type="button"
              onClick={() => onPick(i)}
              onMouseEnter={() => onPick(i)}
              onFocus={() => onPick(i)}
              aria-current={on}
              className={`group relative flex min-h-[48px] w-full items-center gap-3.5 border-b py-3.5 ps-4 text-start transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold motion-reduce:transition-none sm:gap-4 sm:py-4 ${
                on ? 'border-gold/60' : 'border-white/[0.12] hover:border-white/30'
              }`}
            >
              <span
                className={`absolute inset-y-2 start-0 w-[3px] rounded-full transition-colors duration-300 motion-reduce:transition-none ${
                  on ? 'bg-gold' : 'bg-transparent'
                }`}
                aria-hidden="true"
              />
              <span
                className={`shrink-0 font-mono text-[14px] tabular-nums tracking-widest transition-colors duration-300 motion-reduce:transition-none ${
                  on ? 'text-gold' : 'text-white/35'
                }`}
                aria-hidden="true"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={`min-w-0 flex-1 text-pretty text-[17px] leading-snug transition-colors duration-300 motion-reduce:transition-none sm:text-lg ${
                  on ? 'font-semibold text-white' : 'font-medium text-white/55 group-hover:text-white/85'
                }`}
                {...fp(`layer_${layer.key}`)}
              >
                {sf(`layer_${layer.key}`, layer.label)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What the currently-lit layer means.
 *
 * A fixed minimum height, because inside the list this sentence changed a
 * row's height on every tick and shunted the rows below it — a section that
 * moves under the reader's eye while they are reading it.
 */
function LayerPanel({ active }: { active: number }) {
  const sf = useSectionField();
  const fp = useFieldProps();
  const layer = LAYERS[active];
  return (
    <div className="min-w-0 rounded-[0.9rem] border border-white/15 bg-[#171717] p-5 sm:p-6">
      <p className="text-[14px] font-semibold uppercase tracking-[0.2em] text-gold" {...fp(`layer_${layer.key}`)}>
        {sf(`layer_${layer.key}`, layer.label)}
      </p>
      <p
        className="mt-3 min-h-[7.5rem] text-pretty text-sm leading-relaxed text-white/70 sm:min-h-[8.5rem]"
        {...fp(`layer_${layer.key}_d`)}
      >
        {sf(`layer_${layer.key}_d`, layer.desc)}
      </p>
      <p className="border-t border-white/[0.12] pt-4 text-[14px] uppercase tracking-[0.16em] text-white/35">
        {String(active + 1).padStart(2, '0')} / {String(LAYERS.length).padStart(2, '0')}
      </p>
    </div>
  );
}
