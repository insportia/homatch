// HOMATCH Admin — what the communication products used, and what it cost.
//
// WHY THIS IS A HOST AND NOT A NEW REPORT
//
// The cost of AI TALK is already computed by TalkCostPanel, against the
// accounting source of truth, with its own rules about what is measured
// and what is estimated. Writing a second cost view here would be a
// second answer to a question that must only have one — and the brief is
// explicit that billing logic does not move to make a UI tidier.
//
// So this page brings the existing panels together under one destination
// and adds nothing of its own. "Usage & cost" becomes a place instead of
// a tab somebody has to know is inside Voice AI.
//
// WHERE A NUMBER IS MISSING IT STAYS MISSING. Those panels already
// distinguish measured from estimated and render "no usage recorded"
// rather than zero; nothing here converts one into the other.

import { ArrowRight } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import { TalkCostPanel } from '@/components/admin/TalkCostPanel';
import { SectionBoundary } from '@/components/common/SectionBoundary';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { AdminSection, CommunicationShell } from './CommunicationShell';

export default function CommunicationUsagePage() {
  const { t } = useLanguage();
  return (
    <CommunicationShell titleKey="usage_admin_title" subtitleKey="usage_admin_subtitle">
      <AdminSection title={t('comms_card_ai_talk')} description={t('comms_card_ai_talk_desc')}>
        {/*
          * A cost readout is exactly the optional block SectionBoundary
          * exists for. Without it, a cost RPC that answers in an
          * unexpected shape takes the whole Usage page down with it --
          * including the heading and the links to Finance and Spend caps,
          * which are the things somebody would go looking for next.
          *
          * The panel itself is untouched. Its accounting rules, and what
          * it treats as measured rather than estimated, are the source of
          * truth for this number and are not re-decided here.
          */}
        <SectionBoundary name="comm-usage-ai-talk-cost">
          <TalkCostPanel />
        </SectionBoundary>
      </AdminSection>

      <AdminSection title={t('admin_nav_outreach')}>
        <p className="mb-3 max-w-[70ch] text-2xs leading-relaxed text-muted-foreground">
          {t('admin_outreach_subtitle')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/admin/outreach">
              {t('admin_nav_outreach')}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/admin/finance">
              {t('admin_nav_finance')}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/admin/spend-caps">
              {t('admin_nav_spend_caps')}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </AdminSection>
    </CommunicationShell>
  );
}
