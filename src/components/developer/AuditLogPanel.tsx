import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Panel, PanelHeader, TableScroll, Th, Td, formatDateTime,
} from './primitives';
import { listAudit, listTeam, type DevAuditRow } from '@/services/developer/workspace';
import { devErrorText } from '@/services/developer/client';
import type { DevMember } from '@/services/developer/types';

/**
 * WHO CHANGED WHAT.
 *
 * The audit log has been written since the first migration — every workflow
 * RPC inserts into it — and until now nothing could read it, which made it a
 * promise rather than a record. This is the reading.
 *
 * IT SHOWS THE BEFORE AND THE AFTER, not a sentence about them. "Status
 * changed" is useless six weeks later in an argument about who discounted an
 * apartment; "sale_price 184,000 → 171,000, by Nino, on 3 February" settles
 * it. The raw json is there for the cases the summary does not cover.
 *
 * ONLY MANAGEMENT SEES IT. dev_audit_select requires dev_can(workspace,
 * 'team'), which is owners and admins — a sales agent cannot read the record
 * of their own colleagues' work, and this component is simply not offered to
 * them.
 */
const ACTION_KEY: Record<string, string> = {
  STATUS_CHANGED: 'dev_audit_status_changed',
  BULK_UPDATE: 'dev_audit_bulk_update',
  INVENTORY_IMPORT: 'dev_audit_import',
  EXTRACTION_APPLIED: 'dev_audit_extraction_applied',
  EXTRACTION_REJECTED: 'dev_audit_extraction_rejected',
  PUBLISHED: 'dev_audit_published',
  UNPUBLISHED: 'dev_audit_unpublished',
  CONFIGURED: 'dev_audit_configured',
};

const ENTITY_KEY: Record<string, string> = {
  unit: 'dev_unit',
  project: 'dev_project',
  contract: 'dev_sales_tab_contracts',
  commission: 'dev_sales_tab_commissions',
  document: 'dev_nav_documents',
  offer: 'dev_sales_tab_offers',
  scene: 'studio_scene',
  experience: 'studio_experience',
};

/** The handful of fields worth naming in a one-line summary. */
const SUMMARY_FIELDS = [
  'status', 'contract_status', 'sale_price', 'price', 'count', 'amount',
];

export function AuditLogPanel({ workspaceId }: { workspaceId: string }) {
  const { t, lang: language } = useLanguage();
  const [rows, setRows] = useState<DevAuditRow[]>([]);
  const [team, setTeam] = useState<DevMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [entity, setEntity] = useState<string>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [audit, members] = await Promise.all([
        listAudit(workspaceId, 200),
        listTeam(workspaceId),
      ]);
      setRows(audit);
      setTeam(members);
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => { void load(); }, [load]);

  const entities = useMemo(
    () => Array.from(new Set(rows.map((r) => r.entity_type).filter(Boolean))) as string[],
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (entity !== 'ALL' && r.entity_type !== entity) return false;
      if (!q) return true;
      return (r.action ?? '').toLowerCase().includes(q)
        || (r.entity_type ?? '').toLowerCase().includes(q)
        || JSON.stringify(r.after_state ?? {}).toLowerCase().includes(q);
    });
  }, [rows, query, entity]);

  function who(actorId: string | null): string {
    if (!actorId) return t('dev_audit_system');
    const person = team.find((m) => m.user_id === actorId);
    return person?.full_name || person?.email || t('dev_audit_unknown_actor');
  }

  /** "sale_price 184,000 → 171,000" — the before and the after, not a label. */
  function summarise(row: DevAuditRow): string | null {
    const before = (row.before_state ?? {}) as Record<string, unknown>;
    const after = (row.after_state ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    for (const field of SUMMARY_FIELDS) {
      const to = after[field];
      if (to === undefined || to === null) continue;
      const from = before[field];
      parts.push(
        from !== undefined && from !== null && String(from) !== String(to)
          ? `${field}: ${String(from)} → ${String(to)}`
          : `${field}: ${String(to)}`,
      );
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  return (
    <Panel>
      <PanelHeader
        title={t('dev_audit_title')}
        description={t('dev_audit_body')}
        action={
          <div className="flex items-center gap-2">
            {entities.length > 1 && (
              <Select value={entity} onValueChange={setEntity}>
                <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('dev_audit_all_kinds')}</SelectItem>
                  {entities.map((e) => (
                    <SelectItem key={e} value={e}>{t(ENTITY_KEY[e] ?? e)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="relative w-44">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('dev_search')}
                aria-label={t('dev_search')}
                className="h-9 pl-8"
              />
            </div>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-2 p-4" role="status" aria-live="polite">
          <span className="sr-only">{t('dev_loading')}</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted/70" aria-hidden="true" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <History className="mx-auto h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium">
            {t(rows.length === 0 ? 'dev_audit_empty_title' : 'dev_audit_no_match')}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {t(rows.length === 0 ? 'dev_audit_empty_body' : 'dev_audit_no_match_body')}
          </p>
        </div>
      ) : (
        <TableScroll>
          <table className="w-full text-sm" data-tabular>
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <Th>{t('dev_audit_when')}</Th>
                <Th>{t('dev_audit_who')}</Th>
                <Th>{t('dev_audit_what')}</Th>
                <Th>{t('dev_audit_change')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((row) => {
                const summary = summarise(row);
                return (
                  <React.Fragment key={row.id}>
                    <tr className="hover:bg-muted/30">
                      <Td className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(row.created_at, language)}
                      </Td>
                      <Td>{who(row.actor_id)}</Td>
                      <Td>
                        <span className="font-medium">
                          {t(ACTION_KEY[row.action] ?? row.action)}
                        </span>
                        {row.entity_type && (
                          <span className="ml-1.5 text-2xs text-muted-foreground">
                            {t(ENTITY_KEY[row.entity_type] ?? row.entity_type)}
                          </span>
                        )}
                      </Td>
                      <Td className="max-w-[20rem] truncate text-muted-foreground" title={summary ?? ''}>
                        {summary ?? '—'}
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                            aria-expanded={expanded === row.id}
                          >
                            {t(expanded === row.id ? 'dev_audit_hide' : 'dev_audit_detail')}
                          </Button>
                        </div>
                      </Td>
                    </tr>
                    {expanded === row.id && (
                      <tr>
                        <td colSpan={5} className="bg-muted/20 px-3 py-3">
                          {/* The raw record, for the cases a one-line summary
                              cannot cover. Nothing is hidden from somebody who
                              is already allowed to read this table. */}
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-2xs text-muted-foreground">
{JSON.stringify({ before: row.before_state, after: row.after_state }, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}
