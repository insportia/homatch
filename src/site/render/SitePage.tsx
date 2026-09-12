import React from 'react';
import { SectionScope } from '../content';
import { Reveal } from '@/components/common/Reveal';
import { KNOWN_SECTION_TYPES } from '../registry';
import type { SitePageContent } from '../model';
import { resolveSections } from './order';

import { HeroSection } from '@/components/home/sections/HeroSection';
import { ActionLauncherSection } from '@/components/home/sections/ActionLauncherSection';
import { IntelligenceLayersSection } from '@/components/home/sections/IntelligenceLayersSection';
import { VerifyShowcaseSection } from '@/components/home/sections/VerifyShowcaseSection';
import { ContractIntelligenceSection } from '@/components/home/sections/ContractIntelligenceSection';
import { MatchingShowcaseSection } from '@/components/home/sections/MatchingShowcaseSection';
import { MortgageSection } from '@/components/home/sections/MortgageSection';
import { CallCenterSection } from '@/components/home/sections/CallCenterSection';
import { EmailCampaignsSection } from '@/components/home/sections/EmailCampaignsSection';
import { AISection } from '@/components/home/sections/AISection';
import { DeveloperB2BSection } from '@/components/home/sections/DeveloperB2BSection';
import { ClosingCTASection } from '@/components/home/sections/ClosingCTASection';
import {
  AboutHeroSection, AboutWhatSection, AboutMarketSection,
  AboutSourcesSection, AboutIntlSection, AboutAskSection,
} from '@/components/home/sections/about';
import { RichTextSection } from '@/components/home/sections/RichTextSection';

/**
 * THE PUBLIC RENDERER
 *
 * §20: the public site renders published content, and a transient Supabase
 * error must not produce a blank homepage.
 *
 * The guarantee is structural rather than defensive. This component does not
 * render content; it renders COMPONENTS, chosen from a fixed map below, and
 * hands each one an optional bag of overrides. The components are the same
 * ones the site shipped with, they carry their own copy, and they render
 * correctly with no overrides at all.
 *
 * So the failure modes line up like this:
 *
 *   no database row      → DEFAULT order, no overrides → today's site
 *   fetch failed         → DEFAULT order, no overrides → today's site
 *   row with one section → that section overridden, everything else default
 *   row naming a type nobody registered → dropped in normalizePage
 *
 * There is no path where the page comes out empty, because the page is never
 * built from the data. The data only ever adjusts it.
 */

/** The one place a section type becomes running code. */
const COMPONENTS: Record<string, React.ComponentType> = {
  hero: HeroSection,
  action_launcher: ActionLauncherSection,
  intelligence_layers: IntelligenceLayersSection,
  verify: VerifyShowcaseSection,
  contract_intelligence: ContractIntelligenceSection,
  matching: MatchingShowcaseSection,
  mortgage: MortgageSection,
  call_center: CallCenterSection,
  email_campaign: EmailCampaignsSection,
  homatch_ai: AISection,
  developers: DeveloperB2BSection,
  closing_cta: ClosingCTASection,
  about_hero: AboutHeroSection,
  about_what: AboutWhatSection,
  about_market: AboutMarketSection,
  about_sources: AboutSourcesSection,
  about_intl: AboutIntlSection,
  about_ask: AboutAskSection,
  rich_text: RichTextSection,
};

export {
  DEFAULT_HOME_ORDER, DEFAULT_ABOUT_ORDER, defaultOrderFor, resolveSections,
} from './order';

export interface SitePageProps {
  slug: string;
  content: SitePageContent | null;
  /** Editor only: click-to-select in the live preview. */
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  /**
   * Editor only: told what each field rendered as, per section, so the
   * inline edit layer can find the element that produced it.
   */
  /**
   * True inside Site Studio. Sections then mark the elements that render
   * editable copy with their section, field and locale, which is how the
   * editor knows what a caret is sitting in.
   */
  editing?: boolean;
  /**
   * Editor only: a click landed on a marked picture.
   *
   * Reported from the section's own click handler rather than from a
   * listener the editor attaches to the preview document — that handler
   * demonstrably runs for every click on a section, which a separately
   * attached one did not.
   */
  onSelectMedia?: (sectionId: string, slot: string | null) => void;
}

export function SitePage({ slug, content, onSelect, selectedId, editing, onSelectMedia }: SitePageProps) {
  // onSelect is set only by the editor, so it doubles as the signal that
  // hidden sections should still be drawn.
  const resolved = resolveSections(slug, content, Boolean(onSelect));

  return (
    <>
      {resolved.map(({ type, section }, i) => {
        const Component = COMPONENTS[type];
        // Belt and braces. normalizePage already dropped unregistered types;
        // this is the second gate, so a bug in one cannot render anything.
        if (!Component || !KNOWN_SECTION_TYPES.includes(type)) return null;

        const body = (
          <SectionScope
            section={section}
            onSelect={onSelect}
            selectedId={selectedId}
            editing={editing}
          >
            <Component />
          </SectionScope>
        );

        const key = section?.id ?? `${type}-${i}`;

        /*
         * THE PUBLIC SITE: each section arrives as you reach it.
         *
         * Reveal is the motion system's own primitive, so this inherits
         * every rule in it: nothing moves at all for somebody who asked
         * their operating system to stop, or whose browser reports data
         * saver; a phone gets a shorter, smaller version; and anything
         * already on screen when the page loads is shown immediately
         * rather than waiting for a scroll that may never come.
         *
         * NOT staggered. Stagger is for a group of small things arriving
         * together; a full-width section arrives on its own, and delaying
         * it behind a sibling would just make the page feel slow.
         *
         * The editor is excluded deliberately — `onSelect` is only
         * supplied by Site Studio. A section at opacity 0 waiting for a
         * scroll is not something to click, select or type into, and the
         * transform while it moves would fight the floating controls
         * positioned over it.
         */
        if (!onSelect) return <Reveal key={key}>{body}</Reveal>;

        // In the editor, but a code-only region with no stored section:
        // nothing to select, so nothing to wrap.
        if (!section) return <React.Fragment key={key}>{body}</React.Fragment>;

        /*
         * IN THE EDITOR, THE SECTION IS A CLICK TARGET — AND NOTHING MORE.
         *
         * This used to be a button covering the whole section, which meant
         * that while it was there NOTHING underneath could be clicked,
         * including the text. Click-to-edit could never receive a click,
         * so every edit went through the sidebar and the canvas was a
         * picture of the page rather than the page.
         *
         * Now the overlay is decoration only — pointer-events-none, always
         * — and selecting is a handler on the wrapper. Clicks reach the
         * real page underneath: a caret lands in the words, and the edit
         * layer stops that click here so typing never doubles as
         * selecting something else.
         *
         * The handler is on a div rather than a button on purpose. The
         * sections contain their own buttons, links and inputs, and
         * nesting those inside a button is invalid HTML and breaks them.
         * Selection is reachable from the structure list for anyone using
         * a keyboard, which is also where reordering lives.
         */
        const isSelected = selectedId === section.id;
        return (
          <div
            key={key}
            className="relative"
            data-studio-section={section.id}
            onClick={(e) => {
              onSelect(section.id);
              // Which picture, if any, was under the pointer.
              const hit = (e.target as HTMLElement | null)?.closest?.('[data-hm-media]');
              onSelectMedia?.(section.id, hit?.getAttribute('data-hm-media') ?? null);
            }}
          >
            {body}
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 z-10 transition-colors ${
                isSelected
                  ? 'ring-2 ring-inset ring-primary'
                  : 'hover:bg-primary/[0.04]'
              } ${section.enabled ? '' : 'bg-background/60'}`}
            />
          </div>
        );
      })}
    </>
  );
}
