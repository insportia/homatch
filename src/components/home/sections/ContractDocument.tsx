import React, { useEffect, useRef, useState } from 'react';
import { FileText, Check, AlertTriangle, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMotion } from '@/hooks/useMotion';

/**
 * A PROPERTY PURCHASE CONTRACT, BEING READ.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * The previous scene was ten grey bars with a band passing over them. Two
 * things were wrong with it. It did not look like a contract — it looked like
 * a loading skeleton, which is the one thing a visitor already reads as
 * "nothing here yet". And the pass ran on a `setInterval` started at mount,
 * so on a phone it had been cycling for half a minute before anyone scrolled
 * far enough to see it: the sequence was always half-finished on arrival.
 *
 * This is a document with the SHAPE of a purchase agreement — a title, the
 * two parties, the property, the price, the clauses, the signatures — read
 * top to bottom by a scan that starts when the visitor can actually see it.
 *
 * WHY THERE IS NO CONTRACT TEXT IN IT
 *
 * A marketing page that prints a plausible clause and calls it risky is
 * writing legal fiction about somebody's purchase. So every VALUE here is a
 * shape: the parties are rules, the address is a rule, the price is a gold
 * block of about the right width. Only the structural labels are words, and
 * they come from the translation system, so the scene reads as a contract in
 * six languages without ever asserting a fact about a real one.
 *
 * HOW THE MOTION WORKS
 *
 * One `phase` counter, advanced by timers that only start once an
 * IntersectionObserver says the document is on screen. The scan band's
 * position is bound to the phase through a CSS transition, so the band
 * genuinely travels between the regions rather than looping independently of
 * what is being claimed about it. Region highlights and findings are keyed to
 * the same counter, which is why they cannot drift out of step.
 *
 * At motion level 'none' the whole sequence jumps to its final state on
 * arrival: every finding present, the clause marked, no band. Nothing is
 * hidden behind an animation that may never run.
 */

/** The stops the scan makes, in the order it makes them. */
const REGIONS = ['parties', 'property', 'price', 'clause'] as const;
type Region = (typeof REGIONS)[number];

export interface DocumentCopy {
  heading: string;
  fileName: string;
  scanning: string;
  complete: string;
  note: string;
  alt: string;
  labels: Record<Region, string>;
  states: { detected: string; verified: string; review: string };
}

/** phase 0 = idle · 1..4 = reading a region · 5 = settled. */
const LAST = REGIONS.length + 1;

export function ContractDocument({ copy }: { copy: DocumentCopy }) {
  const level = useMotion();
  const still = level === 'none';
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState(0);

  /*
   * Start when it is SEEN, not when it is mounted.
   *
   * This is the whole fix for "the animation never plays for me": the
   * section sits well down a long phone page, and a timer started at mount
   * has always finished by the time a thumb gets there.
   */
  useEffect(() => {
    if (still) { setPhase(LAST); return; }
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setPhase(LAST); return; }

    let timers: number[] = [];
    const run = () => {
      timers.forEach(clearTimeout);
      // 1..LAST, a beat apart. Slow enough to read, short enough to finish
      // before somebody scrolls past.
      timers = Array.from({ length: LAST }, (_, i) => window.setTimeout(
        () => setPhase(i + 1), 260 + i * 1150,
      ));
    };

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        // A third of the document visible is the point at which somebody
        // has actually arrived at it rather than flicked past.
        if (e.isIntersecting) { run(); io.disconnect(); }
      }
    }, { threshold: 0.33 });

    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); };
  }, [still]);

  const reached = (r: Region) => phase > REGIONS.indexOf(r) + 0;
  const reading = (r: Region) => phase === REGIONS.indexOf(r) + 1;
  const done = phase >= LAST;

  return (
    <div className="min-w-0" ref={ref}>
      <div
        className="relative min-w-0 overflow-hidden rounded-[1.1rem] border border-foreground/15 bg-card shadow-hover"
        role="img"
        aria-label={copy.alt}
      >
        {/* ── The file it is reading ─────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-b border-foreground/[0.12] px-4 py-3 sm:px-6 sm:py-3.5">
          <span className="inline-flex min-w-0 items-center gap-2.5">
            <FileText className="h-4 w-4 shrink-0 text-gold-ink" strokeWidth={2} aria-hidden="true" />
            <span className="min-w-0 truncate text-[15px] font-medium text-foreground">{copy.fileName}</span>
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold transition-colors duration-500 motion-reduce:transition-none ${
              done ? 'bg-gold-soft text-gold-ink' : 'bg-secondary text-muted-foreground'
            }`}
          >
            {done
              ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              : <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />}
            <span className="truncate">{done ? copy.complete : copy.scanning}</span>
          </span>
        </div>

        {/* ── The page ───────────────────────────────────────────── */}
        <div className="relative overflow-hidden bg-white px-4 py-5 sm:px-7 sm:py-7" aria-hidden="true">
          {/*
            * THE SCAN.
            *
            * Positioned by phase and moved by a transition, so what travels
            * down the page is the same number that decides which region is
            * lit and which finding has appeared. One source of truth means
            * the band cannot be somewhere the findings disagree with.
            */}
          {!still && !done && (
            <span
              className="pointer-events-none absolute inset-x-0 z-10 h-16 transition-transform duration-[1100ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                top: 0,
                transform: `translateY(${[0, 34, 104, 176, 268][Math.min(phase, 4)]}px)`,
                background: 'linear-gradient(to bottom, hsl(38 88% 54% / 0) 0%, hsl(38 88% 54% / 0.20) 50%, hsl(38 88% 54% / 0) 100%)',
              }}
            />
          )}

          <DocTitle text={copy.heading} />
          <Block region="parties" reading={reading('parties')} reached={reached('parties')}>
            <Rules widths={[46, 62]} />
            <Rules widths={[42, 58]} className="mt-2" />
          </Block>
          <Block region="property" reading={reading('property')} reached={reached('property')}>
            <Rules widths={[88]} />
            <Rules widths={[54, 30]} className="mt-2" />
          </Block>
          <Block region="price" reading={reading('price')} reached={reached('price')}>
            <div className="flex items-center gap-2">
              <span className={`h-3.5 w-24 rounded-[0.25rem] transition-colors duration-500 motion-reduce:transition-none ${reached('price') ? 'bg-gold' : 'bg-foreground/20'}`} />
              <span className="h-2 w-12 rounded-full bg-foreground/[0.14]" />
            </div>
            <Rules widths={[70]} className="mt-2" />
          </Block>
          <Block region="clause" reading={reading('clause')} reached={reached('clause')} flagged>
            <Rules widths={[94]} />
            <Rules widths={[90]} className="mt-1.5" />
            <Rules widths={[66]} className="mt-1.5" />
          </Block>

          {/* Signatures. Nothing is found here; it is what makes the page
              end like a contract rather than stop like a list. */}
          <div className="mt-5 flex gap-6">
            {[0, 1].map((i) => (
              <span key={i} className="flex-1">
                <span className="block h-px w-full bg-foreground/25" />
                <span className="mt-1.5 block h-1.5 w-10 rounded-full bg-foreground/[0.12]" />
              </span>
            ))}
          </div>
        </div>

        {/* ── What the reading found ─────────────────────────────── */}
        <div className="border-t border-foreground/[0.12] bg-secondary/50 p-4 sm:p-6">
          <ul className="grid gap-2 sm:grid-cols-2">
            {REGIONS.map((r, i) => {
              const shown = phase > i;
              const isClause = r === 'clause';
              return (
                <li
                  key={r}
                  className={`flex items-center gap-2.5 rounded-[0.6rem] border px-3 py-2.5 transition-all duration-500 motion-reduce:transition-none ${
                    shown
                      ? 'border-foreground/[0.12] bg-card opacity-100 translate-y-0'
                      : 'border-transparent bg-transparent opacity-0 translate-y-1'
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                      isClause ? 'bg-gold-soft text-gold-ink' : 'bg-primary text-primary-foreground'
                    }`}
                  >
                    {isClause
                      ? <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                      : <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium leading-tight text-foreground">
                      {copy.labels[r]}
                    </span>
                    <span className="block truncate text-[13px] leading-tight text-muted-foreground">
                      {isClause ? copy.states.review : r === 'parties' ? copy.states.verified : copy.states.detected}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-pretty text-xs leading-relaxed text-muted-foreground">{copy.note}</p>
        </div>
      </div>
    </div>
  );
}

/** The contract's own heading: centred, ruled under, like a real one. */
function DocTitle({ text }: { text: string }) {
  return (
    <div className="mb-4 text-center">
      <p className="truncate text-[13px] font-semibold uppercase tracking-[0.18em] text-[#0D0D0D]">{text}</p>
      <span className="mx-auto mt-2 block h-px w-16 bg-foreground/30" />
    </div>
  );
}

/**
 * One region of the page, and what the scan does to it.
 *
 * `reading` is the moment the band is over it; `reached` is everything after,
 * which is why a region stays marked once it has been understood rather than
 * blinking off as the scan moves on.
 */
function Block({
  region, reading, reached, flagged = false, children,
}: {
  region: Region; reading: boolean; reached: boolean; flagged?: boolean; children: React.ReactNode;
}) {
  return (
    <div
      data-region={region}
      className={`relative mt-3 rounded-[0.5rem] px-2 py-2 transition-all duration-500 first:mt-0 motion-reduce:transition-none ${
        reading ? 'bg-gold-soft/70' : reached && flagged ? 'bg-gold-soft/45' : 'bg-transparent'
      }`}
    >
      {/* The outline that says THIS is what was understood. */}
      <span
        className={`pointer-events-none absolute inset-0 rounded-[0.5rem] border-2 transition-opacity duration-500 motion-reduce:transition-none ${
          reached ? (flagged ? 'border-gold opacity-100' : 'border-gold/45 opacity-100') : 'border-transparent opacity-0'
        }`}
      />
      {children}
    </div>
  );
}

/** Ruled lines standing in for prose. No sentence is asserted. */
function Rules({ widths, className = '' }: { widths: number[]; className?: string }) {
  return (
    <div className={`flex gap-2 ${className}`}>
      {widths.map((w, i) => (
        <span key={i} className="block h-2 rounded-full bg-foreground/[0.17]" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
