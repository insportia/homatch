import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { LayoutDashboard, Coins, Activity, PlusCircle } from 'lucide-react';

const items = [
  { key: 'nav_dashboard', path: '/dashboard', icon: LayoutDashboard },
  { key: 'nav_credits', path: '/credits', icon: Coins },
  { key: 'nav_activity', path: '/activity', icon: Activity },
  { key: 'nav_add', path: '/property/add', icon: PlusCircle, highlight: true },
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
