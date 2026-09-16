import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Handshake, Plus, Copy, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SalesLedgerRow } from '@/services/developer/types';
import {
  Panel, PanelHeader, TableScroll, Th, Td, formatDate, formatMoney, formatNumber,
} from './primitives';
import {
  listBrokerInvites, createBrokerInvite, revokeBrokerInvite, brokerInviteUrl,
  type BrokerInviteRow,
} from '@/services/developer/brokers';
import { listUnits, listProjects } from '@/services/developer/inventory';
import { devErrorText } from '@/services/developer/client';
import type { DevUnit, DevProject, DevBrokerInvite } from '@/services/developer/types';

/**
 * BROKER DISTRIBUTION — inventory out, on terms, to somebody who does not
 * work here.
 *
 * A BROKER IS NOT A TEAMMATE, and this is deliberately not built on
 * dev_members. They get a link, a named list of apartments, a commission and
 * an expiry. They do not get a workspace login, they cannot see the pipeline,
 * and they cannot see what another broker was offered — because none of that
 * is in what the link resolves to.
 *
 * THE UNITS ARE NAMED, ALWAYS. There is no "all current inventory" option,
 * because that is an agreement whose scope changes every time somebody adds a
 * unit, and nobody should be able to sign one by leaving a field blank.
 *
 * REVOKING IS IMMEDIATE. The same share machinery as every other link in this
 * product, so there is no second access system to secure and no second place
 * for a stale grant to survive.
 */
const STATUS_TONE: Record<DevBrokerInvite['status'], string> = {
  INVITED: 'border-gold-border/60 text-gold-ink bg-gold/[0.06]',
  ACCEPTED: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
  DECLINED: 'border-border text-muted-foreground bg-muted/60',
  REVOKED: 'border-dashed border-border text-muted-foreground bg-transparent',
  EXPIRED: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]',
};

const STATUS_KEY: Record<DevBrokerInvite['status'], string> = {
  INVITED: 'dev_broker_status_invited',
  ACCEPTED: 'dev_broker_status_accepted',
  DECLINED: 'dev_broker_status_declined',
  REVOKED: 'dev_broker_status_revoked',
  EXPIRED: 'dev_broker_status_expired',
};

/**
 * A broker is a sales channel, so the table says what the channel produced.
 *
 * It listed who had been invited, how many apartments they could see and what
 * commission had been agreed — everything about the arrangement and nothing
 * about the business. `sales` and `revenue` come from the sales ledger, which
 * records the broker on the sale itself; a broker with no sales shows a dash
 * rather than a zero, because nought sales and no attribution are different
 * facts and only one of them is this table's to assert.
 */
export function BrokerPanel({
  workspaceId, ledger = [],
}: { workspaceId: string; ledger?: SalesLedgerRow[] }) {
  const { t, lang: language } = useLanguage();
  const [rows, setRows] = useState<BrokerInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listBrokerInvites(workspaceId));
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => { void load(); }, [load]);

  /** What each broker actually sold, keyed by the name the ledger records. */
  const byBroker = useMemo(() => {
    const map = new Map<string, { sales: number; revenue: number; currency: string | null }>();
    for (const sale of ledger) {
      if (!sale.broker) continue;
      const found = map.get(sale.broker) ?? { sales: 0, revenue: 0, currency: null };
      found.sales += 1;
      found.revenue += Number(sale.sale_price ?? 0);
      found.currency = found.currency ?? sale.currency;
      map.set(sale.broker, found);
    }
    return map;
  }, [ledger]);

  async function copyLink(row: BrokerInviteRow) {
    try {
      await navigator.clipboard.writeText(brokerInviteUrl(row.token));
      toast.success(t('dev_share_copied'));
    } catch {
      toast.error(t('dev_share_copy_failed'));
    }
  }

  async function revoke(row: BrokerInviteRow) {
    setBusy(true);
    try {
      await revokeBrokerInvite(row.id);
      toast.success(t('dev_broker_revoked'));
      await load();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title={t('dev_broker_title')}
        description={t('dev_broker_body')}
        action={
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t('dev_broker_add')}
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-2 p-4" role="status" aria-live="polite">
          <span className="sr-only">{t('dev_loading')}</span>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/70" aria-hidden="true" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <Handshake className="mx-auto h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium">{t('dev_broker_empty_title')}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {t('dev_broker_empty_body')}
          </p>
        </div>
      ) : (
        <TableScroll>
          <table className="w-full text-sm" data-tabular>
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <Th>{t('dev_broker')}</Th>
                <Th className="text-right">{t('dev_broker_units')}</Th>
                <Th className="text-right">{t('dev_broker_commission')}</Th>
                <Th className="text-right">{t('dev_funnel_sold')}</Th>
                <Th className="text-right">{t('dev_mk_revenue')}</Th>
                <Th>{t('dev_broker_valid_until')}</Th>
                <Th>{t('dev_status')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30">
                  <Td>
                    <span className="font-medium">{row.broker_name ?? '—'}</span>
                    {row.broker_email && (
                      <span className="ml-1.5 text-2xs text-muted-foreground">
                        {row.broker_email}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">{formatNumber(row.unit_count, language)}</Td>
                  <Td className="text-right">
                    {row.commission_type === 'PERCENT'
                      ? `${row.commission_value}%`
                      : formatMoney(row.commission_value, row.currency, language)}
                  </Td>
                  <Td className="text-right tabular font-semibold">
                    {(byBroker.get(row.broker_name ?? '')?.sales ?? 0) > 0
                      ? formatNumber(byBroker.get(row.broker_name ?? '')?.sales ?? 0, language)
                      : '—'}
                  </Td>
                  <Td className="text-right tabular">
                    {(byBroker.get(row.broker_name ?? '')?.revenue ?? 0) > 0
                      ? formatMoney(byBroker.get(row.broker_name ?? '')?.revenue ?? 0,
                        byBroker.get(row.broker_name ?? '')?.currency, language)
                      : '—'}
                  </Td>
                  <Td className="text-muted-foreground">
                    {row.valid_until ? formatDate(row.valid_until, language) : t('dev_broker_no_expiry')}
                  </Td>
                  <Td>
                    <span className={cn(
                      'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
                      STATUS_TONE[row.status],
                    )}>
                      {t(STATUS_KEY[row.status])}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {row.status === 'INVITED' && (
                        <>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => void copyLink(row)}
                            aria-label={t('dev_copy')}
                            title={t('dev_copy')}
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" disabled={busy}
                            onClick={() => void revoke(row)}
                            aria-label={t('dev_broker_revoke')}
                            title={t('dev_broker_revoke')}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {adding && (
        <InviteDialog
          workspaceId={workspaceId}
          onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await load(); }}
        />
      )}
    </Panel>
  );
}

function InviteDialog({
  workspaceId, onClose, onSaved,
}: { workspaceId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, lang: language } = useLanguage();
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [units, setUnits] = useState<DevUnit[]>([]);
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [commissionType, setCommissionType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [commissionValue, setCommissionValue] = useState('3');
  const [validUntil, setValidUntil] = useState('');
  const [terms, setTerms] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listProjects(workspaceId);
        if (cancelled) return;
        setProjects(list);
        if (list[0]) setProjectId(list[0].id);
      } catch {
        // The dialog still opens; the unit list below simply stays empty and
        // says so.
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!projectId) { setUnits([]); return undefined; }
    let cancelled = false;
    void (async () => {
      try {
        // Only what is actually sellable. Offering a broker a reserved unit is
        // how two people get sold the same apartment.
        const page = await listUnits(workspaceId, {
          projectId, status: ['AVAILABLE'], limit: 2000,
        });
        if (!cancelled) setUnits(page.rows);
      } catch {
        if (!cancelled) setUnits([]);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, projectId]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) => u.unit_number.toLowerCase().includes(q));
  }, [units, search]);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const valid = name.trim() !== ''
    && selected.size > 0
    && Number.isFinite(Number(commissionValue))
    && Number(commissionValue) > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      await createBrokerInvite(workspaceId, {
        projectId: projectId || null,
        brokerName: name.trim(),
        brokerEmail: email.trim() || null,
        commissionType,
        commissionValue: Number(commissionValue),
        currency: project?.currency ?? 'USD',
        terms: terms.trim() || null,
        unitIds: [...selected],
        validUntil: validUntil || null,
      });
      toast.success(t('dev_broker_created'));
      await onSaved();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dev_broker_add')}</DialogTitle>
          <DialogDescription>{t('dev_broker_add_body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="broker-name">{t('dev_broker_name')}</Label>
              <Input id="broker-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="broker-email">{t('dev_broker_email')}</Label>
              <Input
                id="broker-email" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="broker-ctype">{t('dev_broker_commission')}</Label>
              <Select
                value={commissionType}
                onValueChange={(v) => setCommissionType(v as 'PERCENT' | 'FIXED')}
              >
                <SelectTrigger id="broker-ctype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">{t('dev_commission_basis_percent')}</SelectItem>
                  <SelectItem value="FIXED">{t('dev_commission_basis_fixed')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="broker-cvalue">
                {t(commissionType === 'PERCENT' ? 'dev_commission_rate_pct' : 'dev_commission_rate_fixed')}
              </Label>
              <Input
                id="broker-cvalue" type="number" min="0" step="0.01" inputMode="decimal"
                value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="broker-valid">{t('dev_broker_valid_until')}</Label>
              <Input
                id="broker-valid" type="date" value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </div>

          {projects.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="broker-project">{t('dev_project')}</Label>
              <Select value={projectId} onValueChange={(v) => { setProjectId(v); setSelected(new Set()); }}>
                <SelectTrigger id="broker-project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Label className="text-sm">{t('dev_broker_pick_units')}</Label>
              <span className="text-2xs text-muted-foreground">
                {t('dev_n_selected').replace('{n}', formatNumber(selected.size, language))}
              </span>
              <div className="relative ml-auto w-40">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('dev_search')}
                  aria-label={t('dev_search')}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>

            {visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t('dev_broker_no_available_units')}
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto p-2">
                {visible.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/50">
                    <Checkbox
                      id={`broker-unit-${u.id}`}
                      checked={selected.has(u.id)}
                      onCheckedChange={() => toggle(u.id)}
                    />
                    <label htmlFor={`broker-unit-${u.id}`} className="min-w-0 flex-1 text-sm">
                      {u.unit_number}
                    </label>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {formatMoney(u.price, u.currency, language)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="broker-terms">{t('dev_broker_terms')}</Label>
            <Textarea
              id="broker-terms" rows={2} value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder={t('dev_broker_terms_placeholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving || !valid}>
            {saving ? t('dev_saving') : t('dev_broker_send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
