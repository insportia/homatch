// src/pages/FindPropertyCampaignPage.tsx — one paid Deep Search campaign's own results.
// The server decides who may read it (the campaign's owner, or an admin); this page only
// renders what find-property-run returns for that campaign.
import { useParams } from 'react-router-dom';
import { RouteGuard } from '@/components/common/RouteGuard';
import { DISCOVERY_SURFACE } from '@/components/customer/surface';
import { CampaignResultsView } from '@/components/findProperty/campaign/CampaignResultsView';
import { AppLayout } from '@/components/layouts/AppLayout';

export default function FindPropertyCampaignPage() {
  const { runId = '' } = useParams();
  return (
    <RouteGuard>
      <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
        <CampaignResultsView runId={runId} />
      </AppLayout>
    </RouteGuard>
  );
}
