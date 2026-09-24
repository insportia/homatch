// HOMATCH Admin — the AI & Communication control centre.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// This answers "how is this configured". The /outreach workspace answers
// "what are we doing with it" — campaigns, contacts, the inbox, the call
// log. Two different jobs for two different people on two different days,
// so they are two different places and neither is a tab of the other.
//
// THE SECONDARY NAVIGATION
//
// Seven destinations, scrolling horizontally only when the viewport
// genuinely cannot hold them. Tabs were the obvious choice and the wrong
// one: these are routes, so a reader can link to Email, bookmark WhatsApp
// and use the back button, none of which a tab component gives you.

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ADMIN_GROUPS } from '@/admin/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';

/** The communication destinations, in the order the sidebar lists them. */
const SECTION = ADMIN_GROUPS.find((g) => g.id === 'comms')!;
const TABS = SECTION.items.filter((i) => i.path.startsWith('/admin/communication'));

export function CommunicationShell({
  titleKey, subtitleKey, children, actions,
}: {
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const { pathname } = useLocation();

  return (
    <div className="mx-auto w-full max-w-[64rem] space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem] flex-1">
          <h1 className="font-display text-2xl font-semibold text-foreground">{t(titleKey)}</h1>
          <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{t(subtitleKey)}</p>
        </div>
        {actions}
      </header>

      <nav aria-label={t('comms_admin_title')} className="-mx-1 overflow-x-auto pb-1">
        <div className="flex min-w-max gap-1 px-1">
          {TABS.map((tab) => {
            const active = pathname === tab.path
              || (tab.path !== '/admin/communication' && pathname.startsWith(`${tab.path}/`));
            return (
              <Link
                key={tab.path}
                to={tab.path}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <tab.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>

      {children}
    </div>
  );
}

/**
 * A section of a management page.
 *
 * Title, one plain sentence, then the controls — the order every page in
 * this area follows so that a reader never has to work out which part of
 * a card is the thing they came to change.
 */
export function AdminSection({
  title, description, children, className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border p-4 sm:p-5', className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {description && (
        <p className="mt-1 max-w-[70ch] text-2xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}
