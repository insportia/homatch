// HOMATCH Admin — the shell, and the seven doors in it.
//
// WHAT CHANGED, AND WHY
//
// This used to render twenty-six sibling links in one scrolling column:
// Overview, Users, User 360, Properties, Campaigns, Outreach, Markets,
// Sources, Signals, Matches, Credits, Payments, Finance, Live Chat
// Reports, Providers, Voice AI, Verify COGS, Pricing, Spend Caps,
// Diagnostics, Sponsored, Settings, Health, Storage, Site Studio, App
// Content, Engagement. That is a sitemap of the codebase, and it asks the
// reader to already know which of twenty-six engineering words contains
// the thing they want.
//
// Now there are seven groups, each of which is something an owner WANTS,
// and the destinations live inside the group they belong to. Nothing was
// deleted: every one of those twenty-six pages is still reachable, and
// src/admin/navigation.ts is the single description of where each one is.
//
// THE GROUP OPENS WHEN YOU ARE IN IT
//
// Collapsing everything and making the reader hunt would trade one
// problem for another, so the group containing the current page is open,
// and the others are closed until asked. On a phone the whole thing is a
// sheet, which is what it already was.

import { AlertTriangle, ChevronDown, ChevronLeft, Menu, Search, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ADMIN_GROUPS, destinationForPath, groupForPath } from '@/admin/navigation';
import { AdminSearch } from '@/components/admin/AdminSearch';
import { ImpersonationBannerBar } from '@/components/admin/ImpersonationBannerBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { getSpendCapStatus } from '@/services/api';
import type { SpendCapStatus } from '@/types/types';

function SidebarContent({ capWarnings, onClose, onSearch }: {
  capWarnings: number;
  onClose?: () => void;
  onSearch: () => void;
}) {
  const location = useLocation();
  const { t } = useLanguage();
  const currentGroup = useMemo(() => groupForPath(location.pathname), [location.pathname]);
  /*
   * Exactly one destination is highlighted.
   *
   * A plain startsWith lit up both "Overview" and "Voice" when the reader
   * was on /admin/communication/voice, because the section's own landing
   * page is a prefix of every page inside it. destinationForPath resolves
   * by LONGEST match, which is the one the reader is actually on.
   */
  const currentItem = useMemo(() => destinationForPath(location.pathname), [location.pathname]);

  /* Open the group you are standing in; remember what the reader opens
     after that. */
  const [openIds, setOpenIds] = useState<string[]>(() => (currentGroup ? [currentGroup.id] : ['overview']));
  useEffect(() => {
    if (currentGroup) setOpenIds((prev) => (prev.includes(currentGroup.id) ? prev : [...prev, currentGroup.id]));
  }, [currentGroup]);

  const toggle = useCallback((id: string) => {
    setOpenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex shrink-0 items-center justify-between border-b border-sidebar-border px-4 py-4">
        <Link to="/admin" className="flex items-center gap-2" onClick={onClose}>
          <span className="font-bold text-base tracking-tight text-primary">HOMATCH</span>
          <Badge variant="outline" className="text-[13px] px-1.5 py-0 border-primary/40 text-primary">ADMIN</Badge>
        </Link>
        {onClose && (
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onClose} aria-label={t('general_close')}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="shrink-0 px-2 pt-2">
        <button
          type="button"
          onClick={() => { onClose?.(); onSearch(); }}
          className="flex w-full items-center gap-2 rounded-md border border-sidebar-border/70 px-3 py-2 text-start text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t('admin_search_placeholder')}</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label={t('admin_nav_aria_label')}>
        {ADMIN_GROUPS.map((group) => {
          const open = openIds.includes(group.id);
          const inGroup = currentGroup?.id === group.id;
          const GroupIcon = group.icon;
          return (
            <div key={group.id} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={open}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                  inGroup
                    ? 'text-sidebar-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <GroupIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {/* Wraps rather than truncates. "Properties & matching" is
                    already cut in English at 240px, and Georgian and Russian
                    are longer; a label ending in an ellipsis is not a label. */}
                <span className="min-w-0 flex-1 text-balance text-start leading-snug">{t(group.labelKey)}</span>
                <ChevronDown
                  className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90 rtl:rotate-90')}
                  aria-hidden="true"
                />
              </button>

              {open && (
                <div className="mt-0.5 space-y-0.5 ps-3">
                  {group.items.map((item) => {
                    const active = currentItem?.path === item.path;
                    const showCap = item.path === '/admin/spend-caps' && capWarnings > 0;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <span className="min-w-0 flex-1 leading-snug">{t(item.labelKey)}</span>
                        {showCap && (
                          <Badge variant="destructive" className="h-4 px-1.5 text-[13px]">{capWarnings}</Badge>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-4 py-3">
        <Link to="/dashboard">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-1.5 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground">
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" /> {t('admin_back_to_app')}
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
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (!loading && !homatchUser?.is_admin) navigate('/dashboard', { replace: true });
  }, [homatchUser, loading, navigate]);

  useEffect(() => {
    if (!homatchUser?.is_admin) return;
    getSpendCapStatus().then((caps: SpendCapStatus[]) => {
      setCapWarnings(caps.filter((c) => c.warning).length);
    }).catch(() => {});
  }, [homatchUser]);

  /* Ctrl/Cmd-K, the shortcut every admin already tries. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loading || !homatchUser?.is_admin) return null;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-e border-sidebar-border lg:w-72 md:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent capWarnings={capWarnings} onSearch={() => setSearchOpen(true)} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('general_menu')}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar" aria-label={t('admin_nav_aria_label')}>
              <SidebarContent
                capWarnings={capWarnings}
                onClose={() => setMobileOpen(false)}
                onSearch={() => setSearchOpen(true)}
              />
            </SheetContent>
          </Sheet>
          <Link to="/admin" className="flex items-center gap-1.5">
            <span className="text-sm font-bold tracking-tight text-primary">HOMATCH</span>
            <Badge variant="outline" className="h-4 border-primary/40 px-1 text-[13px] text-primary">ADMIN</Badge>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="ms-auto"
            onClick={() => setSearchOpen(true)}
            aria-label={t('admin_search_placeholder')}
          >
            <Search className="h-4 w-4" />
          </Button>
          {capWarnings > 0 && (
            <Badge variant="destructive" className="gap-1 text-[13px]">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {capWarnings}
            </Badge>
          )}
        </div>

        <ImpersonationBannerBar />
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>

      <AdminSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
