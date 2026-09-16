import React, { useCallback, useEffect, useState } from 'react';
import { Megaphone, Plug, Lock, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { Panel, PanelHeader, formatDateTime } from './primitives';
import {
  listAdConnections, createAdConnection, deleteAdConnection, setLeadSourceMap,
} from '@/services/developer/marketing';
import { devErrorText } from '@/services/developer/client';
import type { DevAdConnection } from '@/services/developer/types';

/**
 * WHERE PAID TRAFFIC WOULD ARRIVE FROM — and an honest account of why it
 * does not yet.
 *
 * WHAT IS REAL HERE. The connection record, its status, and the mapping from a
 * campaign identifier to the lead source string the CRM reports on. That
 * mapping is the half that actually pays for itself: a lead that arrives with
 * `utm_source=meta_towerA` becomes a lead whose source reads "Meta — Tower A"
 * in the pipeline and in the sales-by-source table, with no manual tagging.
 * Every one of those rows is stored, enforced by RLS, and used.
 *
 * WHAT IS NOT REAL, AND WHY THERE IS NO PLACE TO PASTE A TOKEN. Pulling spend
 * and lead forms from Meta or Google needs an OAuth credential issued to a
 * reviewed application. This deployment has no such credential, and inventing
 * a text field for one would be worse than not having it: an access token
 * belongs in the platform's secret store, referenced by name, never in a table
 * a customer's browser can read. So `credential_ref` names a secret an
 * operator provisions, the schema carries no token column at all, and nothing
 * in this product can spend money on an ad platform.
 *
 * BLOCKED BY EXTERNAL CREDENTIALS. Everything up to that boundary is built.
 */
const PROVIDERS: DevAdConnection['provider'][] = ['META', 'GOOGLE', 'TIKTOK', 'OTHER'];

const PROVIDER_KEY: Record<DevAdConnection['provider'], string> = {
  META: 'dev_ads_provider_meta',
  GOOGLE: 'dev_ads_provider_google',
  TIKTOK: 'dev_ads_provider_tiktok',
  OTHER: 'dev_ads_provider_other',
};

const STATUS_TONE: Record<DevAdConnection['status'], string> = {
  NOT_CONNECTED: 'border-border text-muted-foreground bg-muted/60',
  PENDING_CREDENTIALS: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]',
  CONNECTED: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
  ERROR: 'border-red-600/45 text-red-700 dark:text-red-400 bg-red-500/[0.07]',
  DISABLED: 'border-dashed border-border text-muted-foreground bg-transparent',
};

const STATUS_KEY: Record<DevAdConnection['status'], string> = {
  NOT_CONNECTED: 'dev_ads_status_not_connected',
  PENDING_CREDENTIALS: 'dev_ads_status_pending',
  CONNECTED: 'dev_ads_status_connected',
  ERROR: 'dev_ads_status_error',
  DISABLED: 'dev_ads_status_disabled',
};

export function AdConnectionsPanel({ workspaceId }: { workspaceId: string }) {
  const { t, lang: language } = useLanguage();
  const [rows, setRows] = useState<DevAdConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [mapping, setMapping] = useState<DevAdConnection | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAdConnections(workspaceId));
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => { void load(); }, [load]);

  async function remove(row: DevAdConnection) {
    setBusy(true);
    try {
      await deleteAdConnection(row.id);
      toast.success(t('dev_ads_removed'));
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
        title={t('dev_ads_title')}
        description={t('dev_ads_body')}
        action={
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t('dev_ads_add')}
          </Button>
        }
      />

      {/* The boundary, stated plainly and in the same place as the feature.
          A customer reading this knows exactly what they would have to give us
          for the rest of it to work. */}
      <div className="flex items-start gap-2 border-b border-border bg-amber-500/[0.05] px-4 py-2.5 sm:px-5">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 text-xs">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            {t('dev_ads_blocked_title')}
          </p>
          <p className="mt-0.5 text-muted-foreground">{t('dev_ads_blocked_body')}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 p-4" role="status" aria-live="polite">
          <span className="sr-only">{t('dev_loading')}</span>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/70" aria-hidden="true" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <Plug className="mx-auto h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium">{t('dev_ads_empty_title')}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {t('dev_ads_empty_body')}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const mapped = Object.keys(row.source_map ?? {}).length;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {t(PROVIDER_KEY[row.provider])}
                    {row.account_label && (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {row.account_label}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-2xs text-muted-foreground">
                    {mapped > 0
                      ? t('dev_ads_n_mapped').replace('{n}', String(mapped))
                      : t('dev_ads_none_mapped')}
                    {row.last_checked_at && ` · ${formatDateTime(row.last_checked_at, language)}`}
                  </p>
                </div>
                <span className={cn(
                  'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
                  STATUS_TONE[row.status],
                )}>
                  {t(STATUS_KEY[row.status])}
                </span>
                <Button variant="outline" size="sm" onClick={() => setMapping(row)}>
                  {t('dev_ads_map')}
                </Button>
                <Button
                  variant="ghost" size="sm" disabled={busy}
                  onClick={() => void remove(row)}
                  aria-label={t('dev_ads_remove')}
                  title={t('dev_ads_remove')}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <AddConnectionDialog
          workspaceId={workspaceId}
          onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await load(); }}
        />
      )}

      {mapping && (
        <SourceMapDialog
          connection={mapping}
          onClose={() => setMapping(null)}
          onSaved={async () => { setMapping(null); await load(); }}
        />
      )}
    </Panel>
  );
}

function AddConnectionDialog({
  workspaceId, onClose, onSaved,
}: { workspaceId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLanguage();
  const [provider, setProvider] = useState<DevAdConnection['provider']>('META');
  const [label, setLabel] = useState('');
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await createAdConnection(workspaceId, {
        provider,
        accountLabel: label.trim() || null,
        externalAccountId: accountId.trim() || null,
      });
      toast.success(t('dev_ads_added'));
      await onSaved();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dev_ads_add')}</DialogTitle>
          <DialogDescription>{t('dev_ads_add_body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ads-provider">{t('dev_ads_provider')}</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as DevAdConnection['provider'])}
            >
              <SelectTrigger id="ads-provider"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>{t(PROVIDER_KEY[p])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ads-label">{t('dev_ads_label')}</Label>
            <Input
              id="ads-label" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder={t('dev_ads_label_placeholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ads-account">{t('dev_ads_account_id')}</Label>
            <Input
              id="ads-account" value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="act_1234567890"
              className="font-mono text-xs"
            />
            {/* Said before they look for the field that is not there. */}
            <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              {t('dev_ads_no_token_here')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t('dev_saving') : t('dev_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The half that works today.
 *
 * One line per mapping: the campaign identifier a link will carry, and the
 * source string a lead created from it should read. Nothing about this needs
 * an ad platform's permission.
 */
function SourceMapDialog({
  connection, onClose, onSaved,
}: { connection: DevAdConnection; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLanguage();
  const [text, setText] = useState(
    Object.entries(connection.source_map ?? {})
      .map(([k, v]) => `${k} = ${v}`)
      .join('\n'),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const map: Record<string, string> = {};
      for (const line of text.split('\n')) {
        const [rawKey, ...rest] = line.split('=');
        const key = rawKey?.trim();
        const value = rest.join('=').trim();
        if (key && value) map[key] = value;
      }
      await setLeadSourceMap(connection.id, map);
      toast.success(t('dev_ads_map_saved'));
      await onSaved();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dev_ads_map_title')}</DialogTitle>
          <DialogDescription>{t('dev_ads_map_body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="ads-map">{t('dev_ads_map_field')}</Label>
          <textarea
            id="ads-map"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('dev_ads_map_placeholder')}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-2xs text-muted-foreground">{t('dev_ads_map_hint')}</p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t('dev_saving') : t('dev_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
