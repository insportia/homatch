// ADMIN — SERVICE-FEE POLICY PER CUSTOMER. Find the customer the way every
// admin page does (admin_search_users: email, name, username, id, phone or a
// property reference), show the effective percent, set a policy with a stated
// reason. The function writes the policy, its audit row and the admin audit.
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Confirm, IdChip, When } from '@/components/admin/control/AdminKit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { searchUsers, type UserSearchRow } from '@/services/adminControl';
import { adminFeePolicyGet, adminFeePolicySet } from '@/services/metaAds';
import { errorText, MIN_REASON, Panel } from './kit';

type Kind = 'STANDARD_PERCENT' | 'FEE_EXEMPT' | 'CUSTOM_PERCENT';
const KINDS: Kind[] = ['STANDARD_PERCENT', 'FEE_EXEMPT', 'CUSTOM_PERCENT'];
type PolicyData = Awaited<ReturnType<typeof adminFeePolicyGet>>;

/** The percent a customer actually pays under a policy. */
export function effectivePercent(policy: { kind: string; percent: number | null }, standard: number): number {
  if (policy.kind === 'FEE_EXEMPT') return 0;
  if (policy.kind === 'CUSTOM_PERCENT' && policy.percent != null && Number.isFinite(Number(policy.percent))) return Number(policy.percent);
  return standard;
}

const fmtPolicy = (v: unknown) => {
  if (!v || typeof v !== 'object') return '—';
  const p = v as { kind?: string; percent?: number | null };
  return `${p.kind ?? '—'}${p.percent != null ? ` ${p.percent}%` : ''}`;
};

export function FeePolicyPanel() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserSearchRow[] | null>(null);
  const [user, setUser] = useState<UserSearchRow | null>(null);
  const [data, setData] = useState<PolicyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<Kind>('STANDARD_PERCENT');
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try { setResults(await searchUsers(q, 20)); } catch (err) { toast.error(t('mm_a_act_failed', { error: errorText(err) })); } finally { setSearching(false); }
  };

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const d = await adminFeePolicyGet(id);
      setData(d);
      setKind((KINDS as string[]).includes(d.policy.kind) ? d.policy.kind as Kind : 'STANDARD_PERCENT');
      setPercent(d.policy.percent != null ? String(d.policy.percent) : '');
      setReason('');
    } catch (err) {
      setData(null);
      toast.error(t('mm_a_act_failed', { error: errorText(err) }));
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { if (user) void load(user.id); }, [user, load]);

  const pct = Number(percent);
  const percentOk = kind !== 'CUSTOM_PERCENT' || (percent.trim() !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 100);
  const canSave = !!user && percentOk && reason.trim().length >= MIN_REASON;

  const save = async () => {
    if (!user || !canSave) return;
    setSaving(true);
    try {
      await adminFeePolicySet(user.id, kind, reason.trim(), kind === 'CUSTOM_PERCENT' ? pct : undefined);
      toast.success(t('mm_a_fee_saved'));
      setConfirming(false);
      await load(user.id);
    } catch (err) {
      toast.error(t('mm_a_act_failed', { error: errorText(err) }));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <Panel>
        <form onSubmit={(e) => void search(e)} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1" htmlFor="mm-fee-search">
            <span className="text-2xs font-medium text-muted-foreground">{t('mm_a_fee_search_label')}</span>
            <Input id="mm-fee-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('mm_a_fee_search_ph')} />
          </label>
          <Button type="submit" size="sm" disabled={searching || !query.trim()} className="gap-1.5">
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Search className="h-3.5 w-3.5" aria-hidden="true" />}
            {t('mm_a_search')}
          </Button>
        </form>
        {results && (
          <div className="mt-3" aria-live="polite">
            {results.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_no_users')}</p> : (
              <ul className="space-y-1">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setUser(r)}
                      aria-pressed={user?.id === r.id}
                      className={cn('flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2 text-start text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        user?.id === r.id ? 'border-foreground bg-[hsl(var(--secondary))]' : 'border-border hover:bg-[hsl(var(--secondary))]/60')}
                    >
                      <b className="min-w-0 break-all" dir="ltr">{r.email ?? '—'}</b>
                      <span className="min-w-0 break-words text-muted-foreground">{r.full_name ?? r.username ?? ''}</span>
                      <span className="font-mono text-2xs text-muted-foreground" dir="ltr">{r.id.slice(0, 8)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      {user && (loading && !data ? <Skeleton className="h-40 rounded-2xl" /> : data && (
        <Panel title={t('mm_a_fee_selected', { who: user.email ?? user.id })}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-live="polite">
            <b className="text-base">{t('mm_a_fee_effective', { percent: effectivePercent(data.policy, data.standardPercent) })}</b>
            <span className="text-muted-foreground">{t('mm_a_fee_standard', { percent: data.standardPercent })}</span>
            <IdChip id={user.id} />
          </div>

          <fieldset className="mt-4 space-y-2">
            <legend className="text-2xs font-medium text-muted-foreground">{t('mm_a_fee_kind')}</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <label key={k} className={cn('inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px]',
                  kind === k ? 'border-foreground bg-[hsl(var(--secondary))] font-semibold' : 'border-border')}>
                  <input type="radio" name="mm-fee-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-current" />
                  {t(`mm_a_fee_kind_${k}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {kind === 'CUSTOM_PERCENT' && (
            <label className="mt-3 flex max-w-xs flex-col gap-1" htmlFor="mm-fee-percent">
              <span className="text-2xs font-medium text-muted-foreground">{t('mm_a_fee_percent_label')}</span>
              <Input id="mm-fee-percent" dir="ltr" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)}
                aria-invalid={!percentOk} aria-describedby={!percentOk ? 'mm-fee-percent-err' : undefined} className="w-32 font-mono" />
              {!percentOk && <span id="mm-fee-percent-err" className="text-2xs text-destructive">{t('mm_a_fee_percent_invalid')}</span>}
            </label>
          )}

          <label className="mt-3 block space-y-1 text-sm" htmlFor="mm-fee-reason">
            <span className="text-2xs font-medium text-muted-foreground">{t('mm_a_reason_label')}</span>
            <Textarea id="mm-fee-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('mm_a_reason_ph')}
              maxLength={500} required aria-required="true" />
          </label>
          <p className="mt-2 text-2xs text-muted-foreground">{t('mm_a_fee_note')}</p>
          <Button size="sm" className="mt-3" disabled={!canSave || saving} onClick={() => setConfirming(true)}>{t('mm_a_fee_save')}</Button>

          <h3 className="mb-1.5 mt-5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('mm_a_fee_history')}</h3>
          {data.audit.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_fee_no_history')}</p> : (
            <ul className="space-y-1.5 text-[13px]">
              {data.audit.map((a, i) => (
                <li key={String(a.id ?? i)} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border/60 pb-1.5 last:border-0">
                  <When at={String(a.created_at ?? '')} />
                  <span className="font-mono" dir="ltr">{fmtPolicy(a.previous)} → {fmtPolicy(a.next)}</span>
                  <span className="text-muted-foreground">{t('mm_a_fee_by', { admin: String(a.admin_user_id ?? '').slice(0, 8) })}</span>
                  <span className="min-w-0 break-words">{t('mm_a_reason')}: {String(a.reason ?? '')}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ))}

      <Confirm
        open={confirming}
        onOpenChange={(v) => { if (!v && !saving) setConfirming(false); }}
        title={t('mm_a_confirm_title', { action: t(`mm_a_fee_kind_${kind}`) })}
        description={t('mm_a_fee_note')}
        confirmLabel={t('mm_a_confirm')}
        onConfirm={() => void save()}
        busy={saving}
        confirmDisabled={!canSave}
      />
    </div>
  );
}
