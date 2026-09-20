// HOMATCH FOR EXPATS — the trust layer, kept small on purpose.
//
// §38 asks for somewhere between "you can see why we say this" and "this
// looks like forensic software", and the difference is almost entirely
// restraint. A badge on every sentence turns a page into a bibliography
// and stops anybody reading it.
//
// So the default state of a sourced fact is ONE quiet line: who said it and
// when. Everything else — the excerpt, the URL, the effective date, the
// conflict — is one tap away in the drawer. A reader who trusts us never
// opens it and a reader who does not can check every word.
//
// WHAT IS SHOWN WITHOUT BEING ASKED FOR
//
// Only the things that change whether the sentence should be believed:
// that the source is official, and that the reading is old. Both are
// one-word marks. Everything else waits.

import React from 'react';
import { ExternalLink, ShieldCheck, Clock, AlertTriangle, HelpCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { Availability, Freshness, SourceRef } from '@/expats/types';
import { factFreshness, judgeFreshness, type Fact } from '@/expats/types';

/* ── Freshness ────────────────────────────────────────────────────────── */

const FRESHNESS_KEY: Record<Freshness, string> = {
  FRESH: 'expat_freshness_fresh',
  AGEING: 'expat_freshness_ageing',
  STALE: 'expat_freshness_stale',
  UNKNOWN: 'expat_freshness_unknown',
};

/**
 * A mark, and only when it earns one.
 *
 * FRESH renders nothing. "We checked this recently" is the expected state
 * and a green tick on every line is noise that makes the amber one
 * invisible. The badge appears when the reader should adjust how much
 * weight they put on the sentence.
 */
export function FreshnessMark({
  observedAt,
  factClass,
  className,
}: {
  observedAt: string | null | undefined;
  factClass: Parameters<typeof judgeFreshness>[1];
  className?: string;
}) {
  const { t } = useLanguage();
  const freshness = judgeFreshness(observedAt, factClass);
  if (freshness === 'FRESH') return null;

  const Icon = freshness === 'STALE' ? AlertTriangle : Clock;
  return (
    <span
      data-expat-freshness={freshness}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs',
        freshness === 'STALE'
          ? 'border-[hsl(var(--warning))] text-[hsl(var(--warning))]'
          : 'border-border text-muted-foreground',
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(FRESHNESS_KEY[freshness])}
    </span>
  );
}

/* ── Availability ─────────────────────────────────────────────────────── */

/*
 * Only the three that say something. The two ESTABLISHED states render
 * nothing at all — a page does not announce that its ordinary sentences
 * are true — so giving them a key would mean six translations of a string
 * no branch can reach.
 */
const AVAILABILITY_KEY: Partial<Record<Availability, string>> = {
  UNKNOWN: 'expat_availability_unknown',
  COVERAGE_GAP: 'expat_availability_coverage_gap',
  STALE: 'expat_availability_stale',
};

/**
 * Says, in one line, that we do not know something.
 *
 * Renders nothing for the two ESTABLISHED states: a page does not announce
 * that its ordinary sentences are true. It exists for the other three, and
 * the wording of each is different on purpose — "we have not established
 * this" and "our research could not reach enough sources" are different
 * admissions and a reader deciding whether to hire a lawyer needs to know
 * which one they are looking at (§36).
 */
export function AvailabilityNote({
  availability,
  className,
}: {
  availability: Availability;
  className?: string;
}) {
  const { t } = useLanguage();
  if (availability === 'ESTABLISHED' || availability === 'ESTABLISHED_NEGATIVE') return null;
  return (
    <p
      data-expat-availability={availability}
      className={cn(
        'flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground',
        className,
      )}
    >
      <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{t(AVAILABILITY_KEY[availability] as string)}</span>
    </p>
  );
}

/* ── The quiet line ───────────────────────────────────────────────────── */

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Who said it, when we read it, and a way to check.
 *
 * One line under a fact. The publisher's name is not translated — it is a
 * name, and a reader who wants to search for it needs the string the
 * publisher actually uses.
 */
export function SourceLine({
  sources,
  factClass,
  className,
}: {
  sources: readonly SourceRef[];
  factClass: Parameters<typeof judgeFreshness>[1];
  className?: string;
}) {
  const { t, lang } = useLanguage();
  if (sources.length === 0) return null;

  const official = sources.filter((s) => s.official);
  const lead = (official.length > 0 ? official : [...sources]).reduce((a, b) =>
    a.observedAt > b.observedAt ? a : b,
  );
  const others = sources.length - 1;

  return (
    <div
      data-expat-source
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground', className)}
    >
      {lead.official ? (
        <span className="inline-flex items-center gap-1 text-[hsl(var(--gold-ink))]">
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          {t('expat_source_official')}
        </span>
      ) : null}
      <span>{lead.publisher}</span>
      <span aria-hidden="true">·</span>
      <span>{t('expat_source_checked', { date: formatDate(lead.observedAt, lang) })}</span>
      {lead.effectiveFrom ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{t('expat_source_effective', { date: formatDate(lead.effectiveFrom, lang) })}</span>
        </>
      ) : null}
      <FreshnessMark observedAt={lead.observedAt} factClass={factClass} />
      <EvidenceDrawer sources={sources} extra={others} />
    </div>
  );
}

/* ── The drawer ───────────────────────────────────────────────────────── */

/**
 * Every source behind a claim, with its own words.
 *
 * `excerpt` is kept in the language the source published in and is NOT
 * translated. A translated quotation is no longer a quotation, and the one
 * thing this drawer exists to let somebody do is check us against the
 * original.
 */
export function EvidenceDrawer({
  sources,
  extra,
}: {
  sources: readonly SourceRef[];
  extra?: number;
}) {
  const { t, lang } = useLanguage();
  if (sources.length === 0) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          data-expat-evidence-open
          className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
        >
          {extra && extra > 0
            ? t('expat_evidence_open_n', { n: sources.length })
            : t('expat_evidence_open')}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('expat_evidence_title')}</SheetTitle>
          <SheetDescription>{t('expat_evidence_intro')}</SheetDescription>
        </SheetHeader>

        <ul className="mt-6 space-y-5">
          {sources.map((s) => (
            <li key={s.sourceId} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                {s.official ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--gold-border))] px-2 py-0.5 text-2xs text-[hsl(var(--gold-ink))]">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    {t('expat_source_official')}
                  </span>
                ) : (
                  <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground">
                    {t('expat_source_unofficial')}
                  </span>
                )}
                <span className="text-sm font-medium text-foreground">{s.publisher}</span>
              </div>

              <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                <dt>{t('expat_evidence_checked')}</dt>
                <dd>{formatDate(s.observedAt, lang)}</dd>
                {s.publishedOn ? (
                  <>
                    <dt>{t('expat_evidence_published')}</dt>
                    <dd>{formatDate(s.publishedOn, lang)}</dd>
                  </>
                ) : null}
                {s.effectiveFrom ? (
                  <>
                    <dt>{t('expat_evidence_effective')}</dt>
                    <dd>{formatDate(s.effectiveFrom, lang)}</dd>
                  </>
                ) : null}
                <dt>{t('expat_evidence_language')}</dt>
                <dd className="uppercase">{s.language}</dd>
              </dl>

              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-3 inline-flex items-center gap-1.5 text-2xs text-[hsl(var(--gold-ink))] underline underline-offset-2"
                >
                  {t('expat_evidence_open_source')}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

/* ── A whole fact ─────────────────────────────────────────────────────── */

/**
 * One sourced statement, rendered with everything it needs to be trusted.
 *
 * The statement text comes in already localised — this component does not
 * reach into a locale map, because the fallback decision (this language, or
 * English, and say which) belongs to the page that knows what it asked for.
 */
export function SourcedFact({
  statement,
  fact,
  className,
}: {
  statement: string;
  fact: Pick<Fact, 'factClass' | 'availability' | 'sources' | 'register' | 'needsReview'>;
  className?: string;
}) {
  const { t } = useLanguage();
  const freshness = factFreshness(fact as Fact);

  return (
    <div className={cn('space-y-2', className)} data-expat-fact>
      <p className="text-[0.9375rem] leading-relaxed text-foreground">{statement}</p>

      <AvailabilityNote availability={fact.availability} />

      {fact.needsReview ? (
        <p className="flex items-start gap-2 text-2xs text-[hsl(var(--warning))]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {t('expat_fact_under_review')}
        </p>
      ) : null}

      {freshness === 'STALE' && fact.sources.length > 0 ? (
        <p className="text-2xs text-[hsl(var(--warning))]">{t('expat_fact_stale_warning')}</p>
      ) : null}

      <SourceLine sources={fact.sources} factClass={fact.factClass} />
    </div>
  );
}
