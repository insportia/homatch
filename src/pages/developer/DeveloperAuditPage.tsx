import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import { Panel, PermissionState } from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { AuditLogPanel } from '@/components/developer/AuditLogPanel';
import { SETTINGS_TABS } from './DeveloperSettingsPage';

/**
 * THE RECORD OF WHO CHANGED WHAT.
 *
 * Filed under Settings rather than given a top-level place of its own: it is
 * read when there is an argument to settle, not every morning, and the cap of
 * eight destinations is worth more than the one click it saves.
 *
 * `requires="team"` matches dev_audit_select exactly, so a role that cannot
 * read the table is not shown a page that would come back empty.
 */
export default function DeveloperAuditPage() {
  const { t } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  return (
    <DeveloperShell
      title={t('dev_nav_settings')}
      description={t('dev_audit_body')}
      tabs={<SubNav items={SETTINGS_TABS} />}
      requires="team"
    >
      {workspace && can('team') ? (
        <AuditLogPanel workspaceId={workspace.id} />
      ) : (
        <Panel><PermissionState /></Panel>
      )}
    </DeveloperShell>
  );
}
