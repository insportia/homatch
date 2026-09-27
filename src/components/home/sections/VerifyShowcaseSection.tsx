import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { PAGE, SECTION_Y } from './primitives';
import { useMotion } from '@/hooks/useMotion';
import { useSectionField, useSectionMedia, useFieldProps, useMediaProps, useSectionIconName, useIsEditing } from '@/site/content';
import { iconFor } from '@/site/icons';

/**
 * REGION 05 — Buyer Intelligence.
 *
 * The launcher already let someone start a check. This region answers the
 * question that stops them from pressing it: what do I actually get back?
 *
 * So the right-hand column is the report itself — the property that was
 * identified, what the record confirmed, what deserves attention, and the
 * step Homatch recommends. It is marked ILLUSTRATIVE in the interface,
 * because it is a composed example and a visitor is entitled to know that
 * before they read it as someone's real property.
 */
export function VerifyShowcaseSection() {
  const plate = useSectionMedia()('plate');
  const sf = useSectionField();
  const fp = useFieldProps();
  const mp = useMediaProps();
  const { t } = useLanguage();
  const [code, setCode] = useState('');
  const editing = useIsEditing();
  const navigate = useNavigate();

  /*
   * THE REPORT IS CONTENT, NOT A FIXTURE.
   *
   * Every line of this panel was a hardcoded t() call, which meant the one
   * screen a visitor reads most carefully was the one nobody could change
   * without a deploy. Nine strings and three icons are now addressable, each
   * falling back to the same reviewed key it always used, so an untouched
   * site renders exactly what it rendered before.
   */
  const icon = useSectionIconName();
  const OkIcon = iconFor(icon('pi_ok'), Check);
  const WarnIcon = iconFor(icon('pi_warn'), AlertCircle);
  const NextIcon = iconFor(icon('pi_next'), FileText);

  const confirmed: Array<[string, string]> = [
    ['pi_l1', sf('pi_l1', 'mp_verify_frag_identity')],
    ['pi_l2', sf('pi_l2', 'mp_verify_frag_official')],
    ['pi_l3', sf('pi_l3', 'mp_market_1_title')],
  ];

  /*
   * THE FINDINGS ARRIVE IN ORDER.
   *
   * A report that is simply present says "here is a page". A report whose
   * lines land one after another says "this was worked out", which is the
   * whole claim of the section. Six steps, started only when the panel is
   * genuinely on screen — on a phone this sits far down a long page, and a
   * timer started at mount finishes long before a thumb arrives.
   *
   * Identical on both widths: the phone gets the same story, not a static
   * summary of it.
   */
  const still = useMotion() === 'none';
  const panel = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState(0);
  const STEPS = 6;

  useEffect(() => {
    if (still) { setStep(STEPS); return; }
    const el = panel.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setStep(STEPS); return; }
    let timers: number[] = [];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.disconnect();
        timers = Array.from({ length: STEPS }, (_, i) => window.setTimeout(
          () => setStep(i + 1), 300 + i * 620,
        ));
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); };
  }, [still]);

  /** Visible once the sequence has reached this line. 20px is a movement a
      reader notices; the 6px this pass replaced was not. */
  const enter = (n: number) => ({
    opacity: step > n ? 1 : 0,
    transform: step > n ? 'none' : 'translateY(20px)',
    transition: still ? undefined : 'opacity 520ms cubic-bezier(0.16,1,0.3,1), transform 520ms cubic-bezier(0.16,1,0.3,1)',
  });

  const openVerify = (e: React.FormEvent) => {
    e.preventDefault();
    /* In Site Studio the button's label is being edited, and Enter commits
       the edit -- which is also what submits a form. It must not navigate
       the editor away. */
    if (editing) return;
    const value = code.trim();
    navigate(value ? `/verify?code=${encodeURIComponent(value)}` : '/verify');
  };

  return (
    <section id="verify" className={`scroll-mt-24 ${SECTION_Y}`}>
      <div className={`${PAGE} grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16`}>
        {/* ── The argument ─────────────────────────────────────── */}
        <div className="min-w-0">
          <p className="hm-pub-eyebrow" {...fp('eyebrow')}>{sf('eyebrow', 'mp_verify_eyebrow')}</p>

          <h2 className="hm-pub-h2 mt-4 text-foreground" {...fp('title')}>
            {sf('title', 'mp_verify_show_title')}
          </h2>
          <p className="hm-pub-lead mt-4 max-w-[36rem]" {...fp('body')}>
            {sf('body', 'mp_verify_capability_desc')}
          </p>

          {/* The section's actual promise, in three lines. They were the
              only part of this region that still needed a deploy to reword,
              which is backwards: the report beside them is fixed, and what
              Homatch covers is what keeps changing. */}
          <ul className="mt-7 space-y-3.5 sm:mt-9 sm:space-y-4">
            {[
              { key: 'record', field: 'cap1', title: sf('cap1_t', 'mp_market_2_title'), desc: sf('cap1_d', 'mp_market_2_desc') },
              { key: 'project', field: 'cap2', title: sf('cap2_t', 'mp_market_3_title'), desc: sf('cap2_d', 'mp_market_3_desc') },
              { key: 'contract', field: 'cap3', title: sf('cap3_t', 'mp_contract_title'), desc: sf('cap3_d', 'mp_verify_show_contract_d') },
            ].map(row => (
              <li key={row.key} className="flex gap-3.5">
                <span className="mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] font-semibold leading-snug text-foreground" {...fp(`${row.field}_t`)}>{row.title}</span>
                  <span className="mt-1 block text-pretty text-[16px] leading-relaxed text-ink-soft sm:text-sm" {...fp(`${row.field}_d`)}>{row.desc}</span>
                </span>
              </li>
            ))}
          </ul>

          {/*
            * VERIFY IS PUBLIC, SO THE FIELD IS HERE.
            *
            * A cadastral code posts straight into the Verification Center's
            * own reader (/verify?code=…). No account is asked for, because
            * none is needed; the empty form simply opens Verify.
            */}
          <form onSubmit={openVerify} className="mt-8 flex max-w-[34rem] flex-col gap-2.5 sm:flex-row">
            <label className="sr-only" htmlFor="hm-verify-code">{t('mp_verify_code_label')}</label>
            <input
              id="hm-verify-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t('mp_verify_code_placeholder')}
              inputMode="numeric"
              className="h-12 w-full min-w-0 shrink-0 rounded-xl sm:w-auto sm:flex-1 border border-[hsl(var(--pub-line-strong))] bg-card px-4 text-[16px] text-foreground shadow-[var(--pub-shadow-sm)] transition-colors placeholder:text-muted-foreground focus:border-foreground/60 focus:outline-none focus:ring-2 focus:ring-gold/30"
            />
            <button type="submit" className="hm-pub-btn hm-pub-btn--primary hm-pub-btn--lg">
              <span {...fp('cta')}>{sf('cta', 'mp_verify_capability_cta')}</span>
              <ArrowRight className="hm-pub-arrow" strokeWidth={2} aria-hidden="true" />
            </button>
          </form>
        </div>

        {/* ── The report ───────────────────────────────────────── */}
        <div className="min-w-0 overflow-hidden rounded-[1.375rem] border border-border bg-card shadow-[var(--pub-shadow-lg)]">
          {/*
            * THE PHOTOGRAPH, SEEN RATHER THAN CROPPED.
            *
            * It was a 144px strip — a fixed height with the image covering
            * it, so most of the building was outside the box at every
            * width. An aspect ratio keeps the whole frame in view and lets
            * it grow with the column instead of staying a letterbox.
            *
            * The cadastral number that sat over it is gone. A real
            * identifier printed on a marketing page invites somebody to
            * read it as a specific property, and it was covering the
            * photograph it was supposed to be labelling.
            */}
          {/* The ratio is a custom property with the plate's own shape as
              its fallback, so a Site Studio preset can make this square or
              panoramic and an unstyled section is unchanged. */}
          <div
            className="relative saturate-[0.72] aspect-[var(--hm-media-ratio,16/10)] sm:aspect-[var(--hm-media-ratio,16/9)]"
            {...mp('plate')}
          >
            <SceneMedia
              scene="verification"
              alt={plate?.alt ?? ''}
              sizes="(min-width: 1024px) 40vw, 100vw"
              position="50% 45%"
              overrideUrl={plate?.url}
            />
            {/* Lighter than before: the plate no longer has to carry text,
                so it no longer has to be dark enough to read text on. */}
            <div className="absolute inset-0 bg-[#0D0D0D]/28" aria-hidden="true" />
            <div
              className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#0D0D0D]/85 to-transparent"
              aria-hidden="true"
            />
            <div className="absolute inset-x-0 bottom-0 p-5">
              <p className="hm-pub-label !text-gold" {...fp('pi_label')}>
                {sf('pi_label', 'mp_result_prop_label')}
              </p>
            </div>
          </div>

          <div className="p-5 sm:p-7" ref={panel}>
            <p
              className="hm-pub-label"
              style={enter(0)}
              {...fp('pi_confirmed')}
            >
              {sf('pi_confirmed', 'mp_result_prop_confirmed')}
            </p>
            <ul className="mt-3 space-y-2">
              {confirmed.map(([field, line], i) => (
                <li key={field} className="flex items-start gap-2.5 text-sm text-foreground" style={enter(i + 1)}>
                  <OkIcon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[#12A06B]" strokeWidth={3} aria-hidden="true" />
                  <span className="min-w-0" {...fp(field)}>{line}</span>
                </li>
              ))}
            </ul>

            <p
              className="hm-pub-label mt-6"
              style={enter(4)}
              {...fp('pi_attention')}
            >
              {sf('pi_attention', 'mp_result_prop_attention')}
            </p>
            <p className="mt-3 flex items-start gap-2.5 text-sm text-foreground" style={enter(4)}>
              <WarnIcon className="mt-[2px] h-3.5 w-3.5 shrink-0 text-gold-ink" strokeWidth={2.5} aria-hidden="true" />
              <span className="min-w-0" {...fp('pi_attention_line')}>
                {sf('pi_attention_line', 'mp_result_prop_attention_line')}
              </span>
            </p>

            <div className="mt-6 rounded-xl bg-primary p-4 text-primary-foreground" style={enter(5)}>
              <p className="hm-pub-label flex items-center gap-2 !text-gold">
                <NextIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="min-w-0" {...fp('pi_next')}>{sf('pi_next', 'mp_result_prop_next')}</span>
              </p>
              <p className="mt-2 text-pretty text-sm leading-relaxed" {...fp('pi_next_line')}>
                {sf('pi_next_line', 'mp_result_prop_next_line')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
