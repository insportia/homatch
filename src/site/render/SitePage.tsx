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
  onRecordField?: (sectionId: string, field: string, value: string) => void;
}

export function SitePage({ slug, content, onSelect, selectedId, onRecordField }: SitePageProps) {
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
            recordField={section && onRecordField
              ? (f, v) => onRecordField(section.id, f, v)
              : undefined}
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

        // In the editor, a click target over the section. It is a sibling
        // overlay rather than a handler on the section itself, so a real
        // button inside the preview does not have to compete with it and the
        // page's own interactivity keeps working underneath.
        //
        // ONCE SELECTED, THE OVERLAY STEPS ASIDE.
        //
        // It covers the whole section, so while it is a button nothing
        // underneath can be clicked — including the text. That is correct
        // for a section you have not chosen yet, and fatal for the one you
        // have: click-to-edit would be unreachable, because every click
        // would land on the overlay instead of the words. So the selected
        // section keeps the ring and gives up the clicks.
        const isSelected = selectedId === section.id;
        return (
          <div key={key} className="relative" data-studio-section={section.id}>
            {body}
            {isSelected ? (
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 z-10 ring-2 ring-inset ring-primary ${
                  section.enabled ? '' : 'bg-background/60'
                }`}
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                aria-label={section.type}
                className={`absolute inset-0 z-10 w-full cursor-pointer transition-colors hover:bg-primary/[0.06] hover:ring-1 hover:ring-inset hover:ring-primary/40 ${
                  section.enabled ? '' : 'bg-background/60'
                }`}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
