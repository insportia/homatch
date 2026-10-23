// EMAIL STUDIO — the Settings area's tabs: Deliverability & compliance · Sender settings · Plan &
// usage. One rail entry ("Settings") opens this group, which keeps the email rail inside its
// six-entry ceiling while every area stays one click away.

import { Globe, ShieldCheck, Wallet } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '/outreach/email/deliverability', key: 'ems_nav_deliverability', icon: ShieldCheck },
  { to: '/outreach/email/domains', key: 'ems_nav_sender', icon: Globe },
  { to: '/outreach/email/plan', key: 'emx_nav_plan', icon: Wallet },
];

export function EmailSettingsTabs() {
  const { t } = useLanguage();
  return (
    <nav aria-label={t('ems_nav_settings')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {TABS.map(({ to, key, icon: Icon }) => (
        <NavLink key={to} to={to}
          className={({ isActive }) => cn('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors',
            isActive ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
          <Icon className="h-4 w-4" aria-hidden="true" />{t(key)}
        </NavLink>
      ))}
    </nav>
  );
}
