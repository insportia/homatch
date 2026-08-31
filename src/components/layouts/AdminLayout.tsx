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

const NAV = [
  { path: '/admin',              label: 'Overview',           icon: LayoutDashboard },
  { path: '/admin/users',        label: 'Users',              icon: Users },
  { path: '/admin/user360',      label: 'User 360°',          icon: UserSearch },
  { path: '/admin/properties',   label: 'Properties',         icon: Building2 },
  { path: '/admin/campaigns',    label: 'Campaigns',          icon: Zap },
  { path: '/admin/markets',      label: 'Markets',            icon: Globe },
  { path: '/admin/sources',      label: 'Sources',            icon: Radio },
  { path: '/admin/signals',      label: 'Signals',            icon: Activity },
  { path: '/admin/matches',      label: 'Matches',            icon: Puzzle },
  { path: '/admin/credits',      label: 'Credits',            icon: CreditCard },
  { path: '/admin/payments',     label: 'Payments',           icon: Receipt },
  { path: '/admin/live-chat-reports', label: 'Reported Messages', icon: MessageSquareWarning },
  { path: '/admin/providers',    label: 'Provider Health',    icon: Server },
  { path: '/admin/pricing',      label: 'Pricing Config',     icon: Settings2 },
  { path: '/admin/spend-caps',   label: 'Spend Caps',         icon: ShieldAlert },
  { path: '/admin/diagnostics',  label: 'Import Diagnostics', icon: Wrench },
  { path: '/admin/sponsored',    label: 'Sponsored Ads',      icon: Activity },
  { path: '/admin/settings',     label: 'Settings',           icon: SlidersHorizontal },
  { path: '/admin/health',       label: 'System Health',      icon: HeartPulse },
];

function SidebarContent({ capWarnings, onClose }: { capWarnings: number; onClose?: () => void }) {
  const location = useLocation();
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
        {NAV.map(({ path, label, icon: Icon }) => {
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
              <span className="flex-1 truncate">{label}</span>
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
            <ChevronLeft className="h-3.5 w-3.5" /> Back to App
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
        <SheetContent side="left" className="p-0 w-56 bg-sidebar" aria-label="Admin navigation">
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
              <span>{capWarnings} spend cap{capWarnings > 1 ? 's' : ''} near limit</span>
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
