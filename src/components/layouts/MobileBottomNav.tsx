import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { LayoutDashboard, MessageSquare, Shield, Search, Bot, Radio } from 'lucide-react';

const items = [
  { key: 'nav_dashboard',     path: '/dashboard',     icon: LayoutDashboard },
  { key: 'nav_chat',          path: '/chat',          icon: MessageSquare },
  { key: 'nav_ai',            path: '/ai',            icon: Bot,    highlight: true },
  { key: 'nav_live_chat',     path: '/live-chat',     icon: Radio },
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
              className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full"
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
                className={`text-[10px] font-medium ${
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
