import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { useFieldProps, useSectionField } from '@/site/content';
import { ShellScope } from '@/site/render/ShellScope';
import type { TranslationKey } from '@/i18n/translations';
import { PAGE } from './primitives';

/**
 * REGION 12 — the footer. Quiet, hairline top, no card anywhere in it.
 *
 * ITS WORDS ARE EDITABLE, ITS DESTINATIONS ARE NOT.
 *
 * Every label here resolves through the content model, falling back to the
 * reviewed translation key it has always used — so an admin can rename
 * "Privacy" and cannot produce a footer with an unlabelled link.
 *
 * The PATHS are deliberately not editable. A footer is where somebody goes
 * looking for the terms they agreed to, and a link that points wherever an
 * admin typed is a link that can point nowhere. Renaming is content;
 * re-routing is a code change with a review.
 */

/** Field key → the translation key it falls back to. See src/site/registry.ts. */
const FIELD: Readonly<Record<string, TranslationKey>> = {
  heading_product: 'mp_footer_product',
  heading_company: 'mp_footer_company',
  heading_legal: 'mp_footer_legal',
  tagline: 'mp_footer_tagline',
  link_verify: 'nav_verify',
  link_contract: 'mp_contract_title',
  link_mortgage: 'nav_mortgage',
  link_ai: 'ai_title',
  link_calls: 'call_center_title',
  link_email: 'mp_email_title',
  link_about: 'nav_about',
  link_partners: 'home_nav_partners',
  link_developers: 'mp_nav_developers',
  link_privacy: 'home_footer_privacy',
  link_terms: 'home_footer_terms',
};

export function SiteFooter() {
  return <ShellScope part="site_footer"><FooterBody /></ShellScope>;
}

function FooterBody() {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const sf = useSectionField();
  const fp = useFieldProps();

  /** The stored override for a field, else the copy the site ships. */
  const label = (key: string) => sf(key, FIELD[key]);

  const columns = [
    {
      key: 'product',
      field: 'heading_product',
      links: [
        { key: 'link_verify', path: '/verify' },
        { key: 'link_contract', path: session ? '/verify' : '/auth/signup' },
        { key: 'link_mortgage', path: '/mortgage' },
        { key: 'link_ai', path: session ? '/ai' : '/auth/signup' },
        { key: 'link_calls', path: session ? '/outreach/calls' : '/auth/signup' },
        { key: 'link_email', path: session ? '/outreach/email' : '/auth/signup' },
      ],
    },
    {
      key: 'company',
      field: 'heading_company',
      links: [
        { key: 'link_about', path: '/about' },
        { key: 'link_partners', path: '/partners' },
        { key: 'link_developers', path: '/developers' },
      ],
    },
    {
      key: 'legal',
      field: 'heading_legal',
      links: [
        { key: 'link_privacy', path: '/privacy' },
        { key: 'link_terms', path: '/terms' },
      ],
    },
  ];

  return (
    <footer className="border-t border-border">
      <div className={`${PAGE} grid gap-12 py-16 sm:grid-cols-2 lg:grid-cols-4`}>
        <div className="sm:col-span-2 lg:col-span-1">
          <HomatchLogo size="md" withTagline />
          <p
            className="mt-5 max-w-xs text-pretty text-xs leading-relaxed text-muted-foreground"
            {...fp('tagline')}
          >
            {label('tagline')}
          </p>
        </div>

        {columns.map(column => (
          <nav key={column.key} aria-label={label(column.field)}>
            <p
              className="text-[14px] font-semibold uppercase tracking-[0.22em] text-foreground"
              {...fp(column.field)}
            >
              {label(column.field)}
            </p>
            <ul className="mt-5 space-y-3">
              {column.links.map(link => (
                <li key={link.key}>
                  <button
                    type="button"
                    onClick={() => navigate(link.path)}
                    className="min-h-0 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...fp(link.key)}
                  >
                    {label(link.key)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-border">
        {/* Not editable: a copyright line with a year in it is generated, and
            an admin editing it would freeze the year. */}
        <p className={`${PAGE} py-6 text-xs text-muted-foreground`}>
          {t('home_footer_copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
