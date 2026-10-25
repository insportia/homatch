import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Cookie, FileText, Printer, Shield } from 'lucide-react';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer } from '@/components/home/PublicHeader';
import { usePublicNavLinks } from '@/site/publicNav';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { PAGE } from '@/components/home/sections/primitives';
import { useLanguage } from '@/contexts/LanguageContext';
import { LEGAL_OPERATOR, formatLegalDate, operatorDisplayName, type LegalDoc } from '@/lib/legal/operator';

/*
 * THE LEGAL CENTER — one layout for Terms, Privacy and Cookies.
 *
 * Desktop: a sticky contents column that follows the reader (scroll-spy),
 * the document, a hairline reading-progress bar. Mobile: the contents fold
 * into one disclosure above the text. Version, effective date and the
 * operator come from src/lib/legal/operator.ts, never from the page.
 *
 * Print hides the chrome and prints the document alone.
 */
export interface LegalSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

const DOCS: { doc: LegalDoc; path: string; key: 'home_footer_terms' | 'home_footer_privacy' | 'home_footer_cookies'; Icon: typeof FileText }[] = [
  { doc: 'terms', path: '/terms', key: 'home_footer_terms', Icon: FileText },
  { doc: 'privacy', path: '/privacy', key: 'home_footer_privacy', Icon: Shield },
  { doc: 'cookies', path: '/cookies', key: 'home_footer_cookies', Icon: Cookie },
];

/** Older keys carry their own "3. " prefix; the layout numbers sections itself. */
const cleanTitle = (title: string) => title.replace(/^\s*\d+\.\s*/, '');

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function LegalLayout({
  doc, title, intro, sections, blocks,
}: {
  doc: LegalDoc;
  title: string;
  intro?: React.ReactNode;
  sections: LegalSection[];
  /** The page's Site Studio band (<PageBlocks slug=…/>), rendered below the document. */
  blocks?: React.ReactNode;
}) {
  useSurfaceTheme('light');
  const { t, lang } = useLanguage();
  const headerLinks = usePublicNavLinks();
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const [progress, setProgress] = useState(0);
  const tocOpen = useRef<HTMLDetailsElement>(null);

  // Scroll-spy: the section whose heading most recently crossed the upper third.
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? Math.min(1, h.scrollTop / max) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    history.replaceState(null, '', `#${id}`);
    setActive(id);
    if (tocOpen.current) tocOpen.current.open = false;
  };

  const version = LEGAL_OPERATOR.versions[doc];
  const effective = formatLegalDate(LEGAL_OPERATOR.effectiveDates[doc], lang);
  const operator = operatorDisplayName(lang, t('legal_entity_individual_entrepreneur'));

  const toc = (
    <ol className="space-y-0.5 text-[14px]">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            onClick={go(s.id)}
            aria-current={active === s.id ? 'location' : undefined}
            className={`block rounded-md border-s-2 py-1.5 ps-3 pe-2 leading-snug transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active === s.id
                ? 'border-gold-ink bg-secondary/70 font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="me-1.5 tabular-nums opacity-70">{i + 1}.</span>{cleanTitle(s.title)}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="hm-public min-h-screen bg-background text-foreground flex flex-col">
      <div className="print:hidden">
        <PublicHeader links={headerLinks} solid />
        <HeaderSpacer />
      </div>
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-[70] h-0.5 origin-left bg-gold-ink rtl:origin-right print:hidden"
        style={{ transform: `scaleX(${progress})` }}
      />

      <main className={`flex-1 ${PAGE} py-10 sm:py-14`} data-legal-doc={doc}>
        {/* Document switcher */}
        <nav aria-label={t('legal_center_title')} className="mb-8 flex flex-wrap gap-2 print:hidden">
          {DOCS.map(({ doc: d, path, key, Icon }) => (
            <Link
              key={d}
              to={path}
              aria-current={d === doc ? 'page' : undefined}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[14px] transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                d === doc ? 'border-foreground/30 bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {t(key)}
            </Link>
          ))}
        </nav>

        <div className="grid gap-10 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-14">
          <aside className="hidden lg:block print:hidden">
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pe-1">
              <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.16em] text-gold-ink">{t('legal_toc')}</p>
              {toc}
            </div>
          </aside>

          <article className="min-w-0 max-w-[46rem]">
            <header className="space-y-4">
              <h1 className="text-2xl md:text-[2rem] font-semibold leading-tight text-foreground text-balance">{title}</h1>
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-muted-foreground">
                <div className="flex gap-1.5"><dt>{t('legal_version')}</dt><dd className="font-medium text-foreground" dir="ltr">{version}</dd></div>
                <div className="flex gap-1.5"><dt>{t('legal_effective')}</dt><dd className="font-medium text-foreground">{effective}</dd></div>
              </dl>
              <div className="rounded-[0.9rem] border border-border bg-card px-4 py-3 text-[14px] leading-relaxed text-muted-foreground">
                <span className="text-foreground font-medium">{t('legal_operated_by')}</span>{' '}
                {operator}
                {' · '}{t('legal_id_number')} <span dir="ltr">{LEGAL_OPERATOR.identificationNumber}</span>
                {' · '}{LEGAL_OPERATOR.country[lang as keyof typeof LEGAL_OPERATOR.country] ?? LEGAL_OPERATOR.country.en}
              </div>
              {lang !== 'ka' && (
                <p className="rounded-[0.9rem] border border-border bg-secondary/50 px-4 py-2.5 text-[13px] text-muted-foreground">{t('legal_translation_notice')}</p>
              )}
              {intro && <div className="text-[15px] leading-relaxed text-muted-foreground">{intro}</div>}
              <div className="flex items-center gap-3 print:hidden">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" /> {t('legal_print')}
                </button>
              </div>
            </header>

            <details ref={tocOpen} className="group mt-8 rounded-[0.9rem] border border-border bg-card lg:hidden print:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[0.9rem]">
                {t('legal_toc')}
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
              </summary>
              <div className="border-t border-border px-2 py-2">{toc}</div>
            </details>

            <div className="mt-10 space-y-10">
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} tabIndex={-1} aria-labelledby={`${s.id}-h`} className="scroll-mt-24 focus:outline-none">
                  <h2 id={`${s.id}-h`} className="mb-3 text-[1.0625rem] font-semibold text-foreground">
                    <span className="me-2 tabular-nums text-gold-ink">{i + 1}.</span>{cleanTitle(s.title)}
                  </h2>
                  <div className="space-y-2.5 text-[15px] leading-[1.75] text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground [&_a]:font-medium [&_a]:text-gold-ink hover:[&_a]:text-foreground">
                    {s.content}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>

      {blocks && <div className="print:hidden">{blocks}</div>}
      <div className="print:hidden"><SiteFooter /></div>
    </div>
  );
}

/** A labelled sub-heading inside a section. */
export function LegalSub({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 text-[15px] font-semibold text-foreground">{children}</h3>;
}

export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 ps-5 marker:text-gold-ink/70">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

/** The operator and its published contacts, from src/lib/legal/operator.ts. */
export function LegalContactCard({ show }: { show: Array<'legal' | 'privacy' | 'support'> }) {
  const { t, lang } = useLanguage();
  const mails = { legal: LEGAL_OPERATOR.legalContactEmail, privacy: LEGAL_OPERATOR.privacyContact, support: LEGAL_OPERATOR.supportEmail };
  const label = { legal: t('legal_contact_legal'), privacy: t('legal_contact_privacy'), support: t('legal_contact_support') };
  return (
    <dl className="mt-1 grid gap-x-6 gap-y-2 rounded-[0.9rem] border border-border bg-card p-4 text-[14px] sm:grid-cols-[auto_1fr]">
      <dt className="text-muted-foreground">{t('legal_contact_operator')}</dt>
      <dd className="text-foreground">
        {operatorDisplayName(lang, t('legal_entity_individual_entrepreneur'))} · {t('legal_id_number')} <span dir="ltr">{LEGAL_OPERATOR.identificationNumber}</span>
        {LEGAL_OPERATOR.registeredAddress && <> · {LEGAL_OPERATOR.registeredAddress}</>}
      </dd>
      {show.filter((k) => mails[k]).map((k) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{label[k]}</dt>
          <dd><a href={`mailto:${mails[k]}`} dir="ltr">{mails[k]}</a></dd>
        </React.Fragment>
      ))}
      <dt className="text-muted-foreground">{t('legal_contact_website')}</dt>
      <dd><a href={LEGAL_OPERATOR.website} dir="ltr">{LEGAL_OPERATOR.website.replace(/^https?:\/\//, '')}</a></dd>
    </dl>
  );
}

/** Translation variables every legal page passes to t(). */
export function useOperatorVars() {
  const { t, lang } = useLanguage();
  return {
    operator: operatorDisplayName(lang, t('legal_entity_individual_entrepreneur')),
    id: LEGAL_OPERATOR.identificationNumber,
    email: LEGAL_OPERATOR.privacyContact ?? '',
    support: LEGAL_OPERATOR.supportEmail ?? '',
  };
}
