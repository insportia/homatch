import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Table2, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import {
  Panel, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  Money, PaymentStatusPill, formatDate, formatArea,
  formatMoney,
} from '@/components/developer/primitives';
import { SalesContext } from '@/components/developer/SalesContext';
import { Headline, BarRows, MoneyBar, SectionHead } from '@/components/developer/visuals';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import { listLedger } from '@/services/developer/sales';
import { listProjects } from '@/services/developer/inventory';
import {
  exportLedgerXlsx, exportLedgerCsv, listTemplates, type ExportTemplate,
} from '@/services/developer/exports';
import { devErrorText } from '@/services/developer/client';
import type { SalesLedgerRow, DevProject } from '@/services/developer/types';

/**
 * THE SALES LEDGER (§41, §43, §124).
 *
 * This is the screen that replaces the spreadsheet, and the important thing
 * about it is what it is NOT: it is not a table anybody types into. Every
 * column is derived from the deal, the unit, the buyer, the manager and the
 * confirmed payments. Reserve a unit and a row appears here; confirm a
 * payment and Outstanding falls, without anybody opening this page.
 *
 * The export is a rendering of what is on screen, in the developer's own
 * column order when they have saved one, and it prints the filters that
 * produced it so the figures can be checked later (§81).
 */
export default function DeveloperLedgerPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [rows, setRows] = useState<SalesLedgerRow[]>([]);
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [ledger, projectRows, templateRows] = await Promise.all([
        listLedger(workspace.id, {
          projectId: projectId === 'ALL' ? null : projectId,
          from: from || null,
          to: to || null,
        }),
        listProjects(workspace.id),
        listTemplates(workspace.id, 'SALES_LEDGER'),
      ]);
      setRows(ledger);
      setProjects(projectRows);
      setTemplates(templateRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace, projectId, from, to]);

  useEffect(() => { void load(); }, [load]);

  /**
   * THE BOOK, GROUPED THE THREE WAYS ANYBODY ASKS FOR IT.
   *
   * A ledger is a record and the table below stays one — it is what gets
   * exported and handed to a bank, column for column. But nobody opens a sales
   * record to read it row by row; they open it to ask who sold what, out of
   * which development, and from which source. All three are sums over the very
   * rows in the table, so nothing here can disagree with what exports.
   */
  const grouped = useMemo(() => {
    const group = (pick: (row: SalesLedgerRow) => string | null) => {
      const map = new Map<string, number>();
      for (const row of rows) {
        const key = pick(row);
        if (!key) continue;
        map.set(key, (map.get(key) ?? 0) + Number(row.sale_price ?? 0));
      }
      return [...map.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
    };
    return {
      byProject: group((r) => r.project),
      byManager: group((r) => r.sales_manager),
      bySource: group((r) => r.lead_source),
    };
  }, [rows]);

  const totals = useMemo(() => ({
    value: rows.reduce((s, r) => s + Number(r.sale_price), 0),
    paid: rows.reduce((s, r) => s + Number(r.paid), 0),
    outstanding: rows.reduce((s, r) => s + Number(r.outstanding), 0),
  }), [rows]);

  const filterLines = useMemo(() => {
    const lines: string[] = [];
    const project = projects.find((p) => p.id === projectId);
    lines.push(`${t('dev_filter_project')}: ${project?.name ?? t('dev_all_projects')}`);
    if (from || to) {
      lines.push(`${t('dev_filter_period')}: ${from || '…'} – ${to || '…'}`);
    }
    lines.push(`${t('dev_rows')}: ${rows.length}`);
    return lines;
  }, [projects, projectId, from, to, rows.length, t]);

  const doExport = (kind: 'xlsx' | 'csv', template?: ExportTemplate | null) => {
    if (!workspace) return;
    try {
      const context = {
        workspaceName: workspace.name,
        projectName: projects.find((p) => p.id === projectId)?.name ?? null,
        filters: filterLines,
      };
      if (kind === 'xlsx') exportLedgerXlsx(rows, context, template);
      else exportLedgerCsv(rows, context, template);
      toast.success(t('dev_export_ready'));
    } catch (e) {
      toast.error(devErrorText(e, t));
    }
  };

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_ledger_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
      actions={(
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={rows.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              {t('dev_export')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={() => doExport('xlsx', null)}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {t('dev_export_xlsx')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => doExport('csv', null)}>
              <Table2 className="mr-2 h-4 w-4" />
              {t('dev_export_csv')}
            </DropdownMenuItem>
            {templates.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {t('dev_export_your_templates')}
                </DropdownMenuLabel>
                {templates.map((template) => (
                  <DropdownMenuItem key={template.id} onSelect={() => doExport('xlsx', template)}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {template.name}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/developers/settings/exports">
                <Settings2 className="mr-2 h-4 w-4" />
                {t('dev_export_manage_templates')}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    >
      <SalesContext className="mb-6" />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="dev-led-project" className="text-2xs uppercase tracking-wider text-muted-foreground">
            {t('dev_filter_project')}
          </Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="dev-led-project" className="w-auto min-w-[10rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('dev_all_projects')}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dev-led-from" className="text-2xs uppercase tracking-wider text-muted-foreground">
            {t('dev_from')}
          </Label>
          <Input id="dev-led-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dev-led-to" className="text-2xs uppercase tracking-wider text-muted-foreground">
            {t('dev_to')}
          </Label>
          <Input id="dev-led-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(from || to || projectId !== 'ALL') && (
          <Button variant="ghost" size="sm"
            onClick={() => { setFrom(''); setTo(''); setProjectId('ALL'); }}>
            {t('dev_clear_filters')}
          </Button>
        )}
      </div>

      {loading && <LoadingRows rows={8} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <EmptyState
            icon={<FileSpreadsheet className="h-7 w-7" />}
            title={t('dev_ledger_empty_title')}
            description={t('dev_ledger_empty_body')}
          />
        </Panel>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="space-y-6">
          <Headline
            metrics={[
              {
                label: t('dev_ledger_sold'),
                value: String(rows.length),
                hint: t('dev_ledger_sold_hint'),
              },
              {
                label: t('dev_stat_contracted'),
                value: <Money amount={totals.value} currency={workspace?.default_currency} />,
              },
              {
                label: t('dev_receivables_remaining'),
                value: <Money amount={totals.outstanding} currency={workspace?.default_currency} />,
                tone: totals.outstanding > 0 ? 'attention' : undefined,
              },
            ]}
          >
            <MoneyBar
              collected={totals.paid}
              contracted={totals.value}
              currency={workspace?.default_currency ?? 'USD'}
            />
          </Headline>

          {/* Who produced the book. Each list is a sum over the rows below. */}
          {(grouped.byProject.length > 1 || grouped.byManager.length > 0
            || grouped.bySource.length > 0) && (
            <div className="grid gap-5 lg:grid-cols-3">
              {grouped.byProject.length > 0 && (
                <section>
                  <SectionHead title={t('dev_insights_by_project')} />
                  <Panel className="p-4">
                    <BarRows
                      rows={grouped.byProject}
                      format={(n) => formatMoney(n, workspace?.default_currency, language)}
                    />
                  </Panel>
                </section>
              )}
              {grouped.byManager.length > 0 && (
                <section>
                  <SectionHead title={t('dev_ledger_by_manager')} />
                  <Panel className="p-4">
                    <BarRows
                      rows={grouped.byManager}
                      format={(n) => formatMoney(n, workspace?.default_currency, language)}
                    />
                  </Panel>
                </section>
              )}
              {grouped.bySource.length > 0 && (
                <section>
                  <SectionHead title={t('dev_mk_by_source')} />
                  <Panel className="p-4">
                    <BarRows
                      rows={grouped.bySource}
                      format={(n) => formatMoney(n, workspace?.default_currency, language)}
                    />
                  </Panel>
                </section>
              )}
            </div>
          )}

        <Panel>
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('dev_project')}</Th>
                  <Th>{t('dev_unit')}</Th>
                  <Th>{t('dev_unit_area')}</Th>
                  <Th>{t('dev_buyer')}</Th>
                  <Th>{t('dev_sales_manager')}</Th>
                  <Th>{t('dev_contract_number')}</Th>
                  <Th>{t('dev_contract_date')}</Th>
                  <Th className="text-right">{t('dev_sale_price')}</Th>
                  <Th className="text-right">{t('dev_paid')}</Th>
                  <Th className="text-right">{t('dev_outstanding')}</Th>
                  <Th>{t('dev_next_payment')}</Th>
                  <Th>{t('dev_status')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.deal_id} className="transition-colors hover:bg-muted/40">
                    <Td className="text-muted-foreground">{row.project}</Td>
                    <Td className="font-medium">{row.unit_number}</Td>
                    <Td>{formatArea(row.area_total, language)}</Td>
                    <Td>{row.buyer ?? '—'}</Td>
                    <Td className="text-muted-foreground">{row.sales_manager ?? '—'}</Td>
                    <Td className="text-muted-foreground">{row.contract_number ?? '—'}</Td>
                    <Td className="text-muted-foreground">{formatDate(row.contract_date, language)}</Td>
                    <Td className="text-right font-medium">
                      <Money amount={row.sale_price} currency={row.currency} />
                    </Td>
                    <Td className="text-right"><Money amount={row.paid} currency={row.currency} /></Td>
                    <Td className="text-right"><Money amount={row.outstanding} currency={row.currency} /></Td>
                    <Td className="text-muted-foreground">{formatDate(row.next_payment_due, language)}</Td>
                    <Td><PaymentStatusPill status={row.payment_status} /></Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/30">
                <tr>
                  <Td colSpan={7} className="font-semibold">{t('dev_total')}</Td>
                  <Td className="text-right font-semibold">
                    <Money amount={totals.value} currency={rows[0]?.currency} />
                  </Td>
                  <Td className="text-right font-semibold">
                    <Money amount={totals.paid} currency={rows[0]?.currency} />
                  </Td>
                  <Td className="text-right font-semibold">
                    <Money amount={totals.outstanding} currency={rows[0]?.currency} />
                  </Td>
                  <Td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </TableScroll>
          {/* The footer adds numbers that may be in different currencies when
              a workspace runs projects in more than one. Saying so is the
              difference between a total and a wrong total (§162). */}
          {new Set(rows.map((r) => r.currency)).size > 1 && (
            <p className="border-t border-border px-4 py-2 text-2xs text-amber-700">
              {t('dev_mixed_currency_warning')}
            </p>
          )}
        </Panel>
        </div>
      )}
    </DeveloperShell>
  );
}
