import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { PAGE } from '@/components/home/sections/primitives';

/**
 * REGION 01 — the header.
 *
 * Quiet by design: no border and no background at the top of the page, so the
 * hero reads as one uninterrupted composition; a hairline and a white wash
 * fade in only once the page has scrolled under it.
 *
 * IT SITS ON BLACK UNTIL IT DOESN'T
 *
 * The hero is a black band, so at the top of the page every control here is
 * white-on-transparent. Past the hero the header becomes a white bar and the
 * same controls flip to near-black. One `scrolled` flag drives both, which is
 * why the tone is threaded through rather than set per element.
 *
 * Spacing and type carry
 * the hierarchy — the navigation has no pills, and there is exactly one
 * filled control.
 *
 * Every destination is a route that exists: the reference's six centre links
 * map onto three in-page regions and three real pages.
 */
export interface HeaderLink {
  key: string;
  label: string;
  /** In-page region id, or a router path when it starts with '/'. */
  target: string;
}

/**
 * @param solid  Forces the opaque white bar from the top of the page. The
 *               transparent state only works over a full-bleed black hero;
 *               on a page that opens on white it renders the logo and the
 *               navigation white on white, which is how a header disappears.
 */
export function PublicHeader({ links, solid = false }: { links: HeaderLink[]; solid?: boolean }) {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The mobile panel is a full-height overlay; leaving the page scrollable
  // behind it lets a touch drag move the page under the menu.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
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

  /* Inverted while the header is still over the hero. */
  const onDark = !solid && !scrolled && !open;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 motion-reduce:transition-none ${
        onDark ? 'border-b border-transparent bg-transparent' : 'border-b border-border bg-background/95 backdrop-blur-md'
      }`}
    >
      <div className={`${PAGE} flex h-[4.5rem] items-center gap-6 md:h-[5.5rem]`}>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate('/');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
          aria-label={t('home_nav_home_aria')}
        >
          <HomatchLogo size="md" withTagline tone={onDark ? 'light' : 'dark'} />
        </button>

        <nav className="mx-auto hidden items-center gap-6 lg:flex xl:gap-8">
          {links.map(link => (
            <button
              key={link.key}
              type="button"
              onClick={() => go(link.target)}
              className={`relative whitespace-nowrap [overflow-wrap:normal] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                onDark ? 'text-white/75 hover:text-white' : 'text-ink-soft hover:text-foreground'
              }`}
            >
              {link.label}
            </button>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-3 lg:ms-0">
          <LanguageSwitcher showGlobe triggerClassName={`h-9 px-2 ${onDark ? 'text-white hover:bg-white/10' : ''}`} />

          {session ? (
            <Button
              size="sm"
              className={`h-10 whitespace-nowrap rounded-full px-5 text-[15px] font-semibold ${
                onDark ? 'bg-gold text-[#0D0D0D] hover:bg-white' : ''
              }`}
              onClick={() => navigate('/dashboard')}
            >
              {t('nav_dashboard')}
            </Button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => navigate('/auth/login')}
                className={`hidden whitespace-nowrap text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline ${
                  onDark ? 'text-white/75 hover:text-white' : 'text-ink-soft hover:text-foreground'
                }`}
              >
                {t('nav_login')}
              </button>
              <Button
                size="sm"
                className={`hidden h-10 whitespace-nowrap rounded-full px-5 text-[15px] font-semibold sm:inline-flex ${
                  onDark ? 'bg-gold text-[#0D0D0D] hover:bg-white' : ''
                }`}
                onClick={() => navigate('/auth/signup')}
              >
                {t('nav_signup')}
              </Button>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-label={open ? t('mp_nav_menu_close') : t('mp_nav_menu_open')}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border lg:hidden ${
              onDark ? 'border-white/35 text-white' : 'border-foreground/25 text-foreground'
            }`}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background lg:hidden">
          <nav className={`${PAGE} flex flex-col py-3`}>
            {links.map(link => (
              <button
                key={link.key}
                type="button"
                onClick={() => go(link.target)}
                className="rounded-xl py-3.5 text-start text-[17px] text-foreground transition-colors hover:text-gold"
              >
                {link.label}
              </button>
            ))}
            {!session && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:hidden">
                <Button variant="outline" className="h-11 rounded-full border-border bg-transparent" onClick={() => go('/auth/login')}>
                  {t('nav_login')}
                </Button>
                <Button className="h-11 rounded-full" onClick={() => go('/auth/signup')}>
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
