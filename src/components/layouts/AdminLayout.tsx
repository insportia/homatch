import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, Users, Building2, Zap, Globe, Radio,
  Activity, Puzzle, CreditCard, Receipt, Server, Settings2,
  ShieldAlert, Wrench, ChevronLeft, Menu, X, AlertTriangle,
  SlidersHorizontal, HeartPulse, UserSearch, MessageSquareWarning,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { getSpendCapStatus } from '@/services/api';
import type { SpendCapStatus } from '@/types/types';
import { cn } from '@/lib/utils';
import { ImpersonationBannerBar } from '@/components/admin/ImpersonationBannerBar';
import { useLanguage } from '@/contexts/LanguageContext';

const NAV = [
  { path: '/admin',              labelKey: 'admin_nav_overview',   icon: LayoutDashboard },
  { path: '/admin/users',        labelKey: 'admin_nav_users',      icon: Users },
  { path: '/admin/user360',      labelKey: 'admin_nav_user360',    icon: UserSearch },
  { path: '/admin/properties',   labelKey: 'admin_nav_properties', icon: Building2 },
  { path: '/admin/campaigns',    labelKey: 'admin_nav_campaigns',  icon: Zap },
  { path: '/admin/markets',      labelKey: 'admin_nav_markets',    icon: Globe },
  { path: '/admin/sources',      labelKey: 'admin_nav_sources',    icon: Radio },
  { path: '/admin/signals',      labelKey: 'admin_nav_signals',    icon: Activity },
  { path: '/admin/matches',      labelKey: 'admin_nav_matches',    icon: Puzzle },
  { path: '/admin/credits',      labelKey: 'admin_nav_credits',    icon: CreditCard },
  { path: '/admin/payments',     labelKey: 'admin_nav_payments',   icon: Receipt },
  { path: '/admin/live-chat-reports', labelKey: 'admin_livechat_title', icon: MessageSquareWarning },
  { path: '/admin/providers',    labelKey: 'admin_nav_providers',  icon: Server },
  { path: '/admin/pricing',      labelKey: 'admin_nav_pricing',    icon: Settings2 },
  { path: '/admin/spend-caps',   labelKey: 'admin_nav_spend_caps', icon: ShieldAlert },
  { path: '/admin/diagnostics',  labelKey: 'admin_nav_diagnostics', icon: Wrench },
  { path: '/admin/sponsored',    labelKey: 'admin_nav_sponsored',  icon: Activity },
  { path: '/admin/settings',     labelKey: 'admin_nav_settings',   icon: SlidersHorizontal },
  { path: '/admin/health',       labelKey: 'admin_nav_health',     icon: HeartPulse },
];

function SidebarContent({ capWarnings, onClose }: { capWarnings: number; onClose?: () => void }) {
  const location = useLocation();
  const { t } = useLanguage();
  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-4 py-4 border-b border-sidebar-border shrink-0">
        <Link to="/admin" className="flex items-center gap-2" onClick={onClose}>
          <span className="font-bold text-base tracking-tight text-primary">HOMATCH</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary">ADMIN</Badge>
        </Link>
        {onClose && (
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV.map(({ path, labelKey, icon: Icon }) => {
          const active = location.pathname === path || (path !== '/admin' && location.pathname.startsWith(path));
          const isSpendCap = path === '/admin/spend-caps';
          return (
            <Link
              key={path}
              to={path}
              onClick={onClose}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors mb-0.5',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{t(labelKey)}</span>
              {isSpendCap && capWarnings > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">{capWarnings}</Badge>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-sidebar-border shrink-0">
        <Link to="/dashboard">
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground text-xs gap-1.5">
            <ChevronLeft className="h-3.5 w-3.5" /> {t('admin_back_to_app')}
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const { homatchUser, loading } = useAuth();
  const navigate = useNavigate();
  const [capWarnings, setCapWarnings] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !homatchUser?.is_admin) navigate('/dashboard', { replace: true });
  }, [homatchUser, loading, navigate]);

  useEffect(() => {
    if (!homatchUser?.is_admin) return;
    getSpendCapStatus().then((caps: SpendCapStatus[]) => {
      setCapWarnings(caps.filter(c => c.warning).length);
    }).catch(() => {});
  }, [homatchUser]);

  if (loading || !homatchUser?.is_admin) return null;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <ImpersonationBannerBar />
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border">
        <SidebarContent capWarnings={capWarnings} />
      </aside>

      {/* Mobile sidebar — SheetTrigger MUST be a descendant of Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          {/* Invisible placeholder — actual trigger button is inside the header below */}
          <span className="sr-only" />
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-56 bg-sidebar" aria-label={t('admin_nav_aria_label')}>
          <SidebarContent capWarnings={capWarnings} onClose={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-background/90 backdrop-blur border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {capWarnings > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{capWarnings === 1 ? t('admin_spend_cap_warning_one', { count: capWarnings }) : t('admin_spend_cap_warning_multi', { count: capWarnings })}</span>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
