import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PublicHeader, type HeaderLink } from '@/components/home/PublicHeader';

/**
 * THE HEADER, AS SITE STUDIO SEES IT.
 *
 * The real component, with the real navigation the home page passes it, so
 * what an admin edits is the header they will get. Two differences, both
 * forced by the canvas rather than chosen:
 *
 *   `solid`, because the transparent state only works over a full-bleed black
 *   hero, and in the editor this block is on its own.
 *
 *   NOT fixed. On the real site the header is pinned to the viewport; in the
 *   preview that viewport is the iframe, so a fixed header would float over
 *   the footer beneath it and over its own editing controls. It is put back
 *   in the flow here, by the one CSS rule that does it, rather than by
 *   threading a prop through a component that has no business knowing it is
 *   being previewed.
 */
export function SiteHeaderBlock() {
  const { t } = useLanguage();

  /* The home page's navigation — the longest one, so every label the block
     declares has somewhere to be clicked. */
  const links: HeaderLink[] = [
    { key: 'start', label: t('mp_nav_start'), target: 'start' },
    { key: 'intelligence', label: t('mp_nav_capabilities'), target: 'intelligence' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'mortgage', label: t('nav_mortgage'), target: '/mortgage' },
    { key: 'developers', label: t('mp_nav_developers'), target: '/developers' },
    { key: 'about', label: t('nav_about'), target: '/about' },
  ];

  return (
    <div className="relative [&>header]:!static">
      <PublicHeader links={links} solid />
    </div>
  );
}
