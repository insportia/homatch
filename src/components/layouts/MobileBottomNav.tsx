import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { LayoutDashboard, MessageSquare, Shield, Search, Bot } from 'lucide-react';

const items = [
  { key: 'nav_dashboard',     path: '/dashboard',     icon: LayoutDashboard },
  { key: 'nav_chat',          path: '/chat',          icon: MessageSquare },
  { key: 'nav_ai',            path: '/ai',            icon: Bot,    highlight: true },
  { key: 'nav_verify',        path: '/verify',        icon: Shield },
  { key: 'nav_active_search', path: '/active-search', icon: Search },
];

export function MobileBottomNav() {
  const { t } = useLanguage();
  const location = useLocation();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-card border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center justify-around h-16">
        {items.map(item => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5"
            >
              <item.icon
                className={`h-5 w-5 ${
                  item.highlight
                    ? 'text-primary'
                    : active
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
              />
              <span
                /* Georgian nav words are long and unhyphenated. At 320px
                   each of five slots is about 64px, which none of them
                   fit, so the label used to escape the bar. It truncates
                   instead — the icon above it carries the meaning — and
                   steps down one size only at the narrowest widths. */
                className={`w-full truncate text-center text-[12px] leading-tight sm:text-[13px] font-medium ${
                  item.highlight
                    ? 'text-primary'
                    : active
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {t(item.key)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
