import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { InstallApp } from '@/components/common/InstallApp';
import { useFieldProps, useNotEditable, useSectionField } from '@/site/content';
import { ShellScope } from '@/site/render/ShellScope';
import { productPath, useProductNavigation } from '@/site/productEntry';
import type { TranslationKey } from '@/i18n/translations';
import { PAGE } from './primitives';

/**
 * THE FOOTER — every public destination, and nothing that is not one.
 *
 * It used to list AI Chat, AI Calls and Email campaigns, which for a visitor
 * with no account were three links to the sign-up form. Those are signed-in
 * tools and live in the signed-in navigation. What is here now is the public
 * site's map: the two products (through their entry pages when signed out),
 * the public tools, the professional pages, the company and the legal pages.
 *
 * Contracts is the one signed-in product listed, because it is part of the
 * home page's story; signed out it goes through sign-up and comes back to
 * /contracts rather than to the dashboard.
 *
 * Each label is a field of the `site_footer` block (src/site/registry.ts),
 * falling back to the reviewed key beside it.
 */
const FIELD: Readonly<Record<string, TranslationKey>> = {
  heading_product: 'mp_footer_product',
  heading_professional: 'nav_professional',
  heading_company: 'mp_footer_company',
  heading_legal: 'mp_footer_legal',
  tagline: 'mp_footer_tagline',
  link_find_property: 'dnav_find_property',
  link_find_client: 'pub_nav_find_client',
  link_verify: 'nav_verify',
  link_contract: 'mp_contract_title',
  link_mortgage: 'nav_mortgage',
  link_investment: 'nav_investment',
  link_expat: 'nav_for_expats',
  link_brokers: 'pub_nav_brokers',
  link_developers: 'mp_nav_developers',
  link_partners: 'home_nav_partners',
  link_about: 'nav_about',
  link_pricing: 'nav_pricing',
  link_privacy: 'home_footer_privacy',
  link_terms: 'home_footer_terms',
};

export function SiteFooter() {
  return <ShellScope part="site_footer"><FooterBody /></ShellScope>;
}

interface FooterLink { key: string; path: string; gated?: boolean }

function FooterBody() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { signedIn, gated } = useProductNavigation();
  const sf = useSectionField();
  const fp = useFieldProps();
  const notEditable = useNotEditable();

  const label = (key: string) => sf(key, FIELD[key]);

  const columns: { key: string; field: string; links: FooterLink[] }[] = [
    {
      key: 'product',
      field: 'heading_product',
      links: [
        { key: 'link_find_property', path: productPath('find_property', signedIn) },
        { key: 'link_find_client', path: signedIn ? '/property' : productPath('find_client', false) },
        { key: 'link_verify', path: '/verify' },
        { key: 'link_contract', path: '/contracts', gated: true },
        { key: 'link_mortgage', path: '/mortgage' },
        { key: 'link_investment', path: '/investment' },
        { key: 'link_expat', path: '/for-expats/georgia' },
      ],
    },
    {
      key: 'professional',
      field: 'heading_professional',
      links: [
        { key: 'link_brokers', path: '/brokers' },
        { key: 'link_developers', path: '/developers' },
        { key: 'link_partners', path: '/partners' },
      ],
    },
    {
      key: 'company',
      field: 'heading_company',
      links: [
        { key: 'link_about', path: '/about' },
        { key: 'link_pricing', path: '/pricing' },
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
    <footer className="hm-public border-t border-border">
      <div className={`${PAGE} grid gap-10 py-14 sm:grid-cols-2 sm:py-16 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] lg:gap-8`}>
        <div className="sm:col-span-2 lg:col-span-1">
          <HomatchLogo size="md" withTagline />
          <p className="mt-5 max-w-xs text-pretty text-[14.5px] leading-relaxed text-muted-foreground" {...fp('tagline')}>
            {label('tagline')}
          </p>
        </div>

        {columns.map(column => (
          <nav key={column.key} aria-label={label(column.field)}>
            <p className="hm-pub-label !text-foreground" {...fp(column.field)}>{label(column.field)}</p>
            <ul className="mt-3 grid grid-cols-1 gap-0.5">
              {column.links.map(link => (
                <li key={link.key}>
                  <Link
                    to={link.path}
                    onClick={(e) => {
                      e.preventDefault();
                      if (link.gated) gated(link.path); else navigate(link.path);
                    }}
                    className="inline-flex min-h-[2.75rem] items-center text-[15px] text-ink-soft transition-colors hover:text-foreground sm:min-h-[2.25rem] hm-pub-focus"
                    {...fp(link.key)}
                  >
                    {label(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-border">
        {/* Not editable: a copyright line with a year in it is generated, and
            an admin editing it would freeze the year. The install control
            names what the browser offers, which is not copy either. It lives
            here on a desktop, where the header row has no room for it; on a
            phone it is also in the menu. */}
        <div
          data-hm-footer-utility
          className={`${PAGE} flex flex-wrap items-center justify-between gap-3 py-5`}
          {...notEditable('SYSTEM_GENERATED')}
        >
          <p className="text-[13.5px] text-muted-foreground">
            {t('home_footer_copyright', { year: new Date().getFullYear() })}
          </p>
          <InstallApp source="footer" />
        </div>
      </div>
    </footer>
  );
}
