// HOMATCH Verify — a link to an official public record (TAS case page or
// file), opened in a new tab. We never proxy or re-host a private copy: the
// reader goes to the official source itself. Only hrefs that passed
// safeHref() (src/verify/reportPresentation.ts) reach this component.

import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { safeHref } from '@/verify/reportPresentation';

export function OfficialLink({ href, label, tone = 'light' }: { href: string; label?: string; tone?: 'light' | 'dark' }) {
  const { t } = useLanguage();
  // Only an official https page ever becomes a link (safeHref); anything else renders nothing.
  const safe = safeHref(href);
  if (!safe) return null;
  const colour = tone === 'dark'
    ? 'text-[hsl(38_92%_66%)] focus-visible:ring-[hsl(38_92%_60%)]'
    : 'text-[hsl(var(--gold-ink))] focus-visible:ring-[hsl(var(--gold-ink))]';
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={`-mx-1 inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 ${colour}`}
    >
      {label ?? t('verify_v3_official_source')}
      <ExternalLink className="h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
      <span className="sr-only">{t('verify_v3_opens_new_tab')}</span>
    </a>
  );
}

