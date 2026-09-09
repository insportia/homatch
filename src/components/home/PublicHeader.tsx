import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';

/**
 * The Main Page header.
 *
 * Every destination here is a route that exists — the reference's six centre
 * links map onto three in-page sections and three real pages, rather than
 * inventing marketing routes that would 404.
 */
export interface HeaderLink {
  key: string;
  label: string;
  /** In-page section id, or a router path when it starts with '/'. */
  target: string;
}

interface PublicHeaderProps {
  links: HeaderLink[];
}

export function PublicHeader({ links }: PublicHeaderProps) {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // The mobile panel is a full-height overlay; leaving the page scrollable
  // behind it lets a touch drag move the page under the menu.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const go = (target: string) => {
    setOpen(false);
    if (target.startsWith('/')) {
      navigate(target);
      return;
    }
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[100rem] items-center gap-4 px-5 sm:px-8 lg:px-10 md:h-20">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate('/');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('home_nav_home_aria')}
        >
          <HomatchLogo size="md" withTagline />
        </button>

        <nav className="mx-auto hidden items-center gap-1 lg:flex">
          {links.map(link => (
            <button
              key={link.key}
              type="button"
              onClick={() => go(link.target)}
              className="rounded-full px-3.5 py-2 text-sm text-ink-soft transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </button>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2 lg:ms-0">
          <LanguageSwitcher showGlobe triggerClassName="h-9 rounded-full px-2.5" />

          {session ? (
            <Button size="sm" className="h-9 rounded-full px-4" onClick={() => navigate('/dashboard')}>
              {t('nav_dashboard')}
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="hidden h-9 rounded-full px-4 text-ink-soft sm:inline-flex"
                onClick={() => navigate('/auth/login')}
              >
                {t('nav_login')}
              </Button>
              <Button size="sm" className="hidden h-9 rounded-full px-4 sm:inline-flex" onClick={() => navigate('/auth/signup')}>
                {t('nav_signup')}
              </Button>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-label={open ? t('mp_nav_menu_close') : t('mp_nav_menu_open')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-foreground lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background lg:hidden">
            <nav className="mx-auto flex max-w-[100rem] flex-col px-5 sm:px-8 lg:px-10 py-3">
            {links.map(link => (
              <button
                key={link.key}
                type="button"
                onClick={() => go(link.target)}
                className="rounded-xl px-3 py-3 text-start text-sm text-foreground transition-colors hover:bg-secondary"
              >
                {link.label}
              </button>
            ))}
            {!session && (
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-3 sm:hidden">
                <Button variant="outline" className="h-10 rounded-full" onClick={() => go('/auth/login')}>
                  {t('nav_login')}
                </Button>
                <Button className="h-10 rounded-full" onClick={() => go('/auth/signup')}>
                  {t('nav_signup')}
                </Button>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
