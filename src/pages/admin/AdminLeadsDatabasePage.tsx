// HOMATCH Admin — Leads Database (External Leads Database manager + matching controls).
//
// Five tabs, the active one in the URL (?tab=, and ?batch= for a batch's import results or a
// batch-filtered lead list): Overview (KPIs, the four independent matching switches, price),
// Import (template → upload → map → validate → fix → commit; never publishes), Leads (browse,
// publish / hide, edit, audited export), Batches (provenance + rights), User lists (oversight).
//
// ACCESS CONTROL IS NOT THIS FILE'S JOB: every RPC re-checks is_admin() and writes the audit
// row (migration 20261129090000_curated_leads_marketplace.sql).
import React from 'react';
import { PageHeader, useQueryState } from '@/components/admin/control/AdminKit';
import { BatchesTab } from '@/components/admin/leads/BatchesTab';
import { ImportTab } from '@/components/admin/leads/ImportTab';
import { LeadsTab } from '@/components/admin/leads/LeadsTab';
import { OverviewTab } from '@/components/admin/leads/OverviewTab';
import { UserListsTab } from '@/components/admin/leads/UserListsTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';

const TABS = ['overview', 'import', 'leads', 'batches', 'lists'] as const;
type Tab = typeof TABS[number];
const DEFAULTS = { tab: 'overview', batch: '' };

export default function AdminLeadsDatabasePage() {
  const { t } = useLanguage();
  const [q, setQ] = useQueryState(DEFAULTS);
  const tab: Tab = (TABS as readonly string[]).includes(q.tab) ? (q.tab as Tab) : 'overview';
  const go = (next: Tab, batch = '') => setQ({ tab: next === 'overview' ? '' : next, batch });

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title={t('admin_ldb_title')} subtitle={t('admin_ldb_subtitle')} />
      <Tabs value={tab} onValueChange={(v) => go(v as Tab)}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {TABS.map((k) => <TabsTrigger key={k} value={k}>{t(`admin_ldb_tab_${k}`)}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          {tab === 'overview' && <OverviewTab onOpenBatch={(id) => go('import', id)} />}
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          {tab === 'import' && <ImportTab batchId={q.batch} onBatchChange={(id) => go('import', id ?? '')} />}
        </TabsContent>
        <TabsContent value="leads" className="mt-4">
          {tab === 'leads' && <LeadsTab initialBatch={q.batch} />}
        </TabsContent>
        <TabsContent value="batches" className="mt-4">
          {tab === 'batches' && <BatchesTab onOpenStaged={(id) => go('import', id)} onOpenLeads={(id) => go('leads', id)} />}
        </TabsContent>
        <TabsContent value="lists" className="mt-4">
          {tab === 'lists' && <UserListsTab />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
