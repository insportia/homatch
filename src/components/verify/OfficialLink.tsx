// HOMATCH Verify — a link to an official public record (TAS case page or
// file), opened in a new tab. We never proxy or re-host a private copy: the
// reader goes to the official source itself. Only hrefs that passed
// safeHref() (src/verify/reportPresentation.ts) reach this component.

import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export function OfficialLink({ href, label }: { href: string; label?: string }) {
  const { t } = useLanguage();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="-mx-1 inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-semibold text-[hsl(var(--gold-ink))] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))]"
    >
      {label ?? t('verify_v3_official_source')}
      <ExternalLink className="h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
      <span className="sr-only">{t('verify_v3_opens_new_tab')}</span>
    </a>
  );
}

