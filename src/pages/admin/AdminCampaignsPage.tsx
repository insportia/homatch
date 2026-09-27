// HOMATCH Admin — Campaigns.
//
// WHAT THIS REPLACED
//
// Two hundred rows with no filters and a "Budget" column reading
// `monthly_budget_credits` — a column matching_campaigns does not have — so it
// said "—" for every campaign while printing a dollar sign in front of
// credits for any row where it would have said something.
//
// FOUR NUMBERS, KEPT APART
//
//   Budget          what the owner authorised for this search (credits)
//   Spent           what was actually settled against it (credits)
//   Provider cost   what the providers charged US for its runs (USD, COGS)
//   Wallet          the owner's balance, which is none of the above
//
// Credits are shown as credits with their dollar value beside them at the
// configured rate (10 credits = $1). Nothing here moves money.
import React from 'react';
import { labelFor } from '@/admin/labels';
import {
  Empty, ErrorNote, FilterBar, IdChip, KV, PageHeader, Pager, SelectFilter,
  TextFilter, UserLine, When, useQueryState,
} from '@/components/admin/control/AdminKit';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { listCampaigns, totalOf, type CampaignRow } from '@/services/adminControl';

const LIMIT = 25;
const DEFAULTS = { owner: '', state: '', transaction: '', language: '', id: '' };
/* campaign_search_languages() in production: the six the product speaks. */
const LANGS = ['ka', 'en', 'ru', 'he', 'ar', 'tr'];

export default function AdminCampaignsPage() {
  const { t } = useLanguage();
  const [applied, setApplied] = useQueryState(DEFAULTS);
  const [draft, setDraft] = React.useState(applied);
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState<CampaignRow[]>([]);
  const [cpu, setCpu] = React.useState(10);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(applied.id || null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    listCampaigns(applied, LIMIT, offset)
      .then((r) => { if (live) { setRows(r.rows); setCpu(Number(r.credits_per_usd) || 10); setError(null); } })
      .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied, offset]);

  const credits = (n: number | null | undefined) =>
    n == null ? '—' : `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${t('admin_cc_credits_unit')} ($${(Number(n) / cpu).toFixed(2)})`;
  const usd = (n: number) => `$${Number(n).toFixed(2)}`;

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_campaigns_title')} subtitle={t('admin_cc_campaigns_subtitle')} />
      <FilterBar
        busy={loading}
        onApply={() => { setOffset(0); setApplied({ ...draft, id: '' }); }}
        onReset={() => { setDraft(DEFAULTS); setOffset(0); setApplied(DEFAULTS); }}
        primary={<>
          <TextFilter label={t('admin_cc_owner_filter')} value={draft.owner} placeholder={t('admin_cc_owner_placeholder')}
                      onChange={(v) => setDraft({ ...draft, owner: v })} />
          <SelectFilter label={t('admin_cc_state')} value={draft.state}
                        options={['ACTIVE', 'PAUSED', 'LOW_BALANCE', 'ARCHIVED'].map((v) => ({ value: v, label: labelFor(t, 'campaignState', v) }))}
                        onChange={(v) => setDraft({ ...draft, state: v })} />
          <SelectFilter label={t('admin_cc_transaction')} value={draft.transaction}
                        options={['SALE', 'RENT', 'INVESTMENT'].map((v) => ({ value: v, label: labelFor(t, 'deal', v) }))}
                        onChange={(v) => setDraft({ ...draft, transaction: v })} />
          <SelectFilter label={t('admin_cc_language')} value={draft.language}
                        options={LANGS.map((v) => ({ value: v, label: v.toUpperCase() }))}
                        onChange={(v) => setDraft({ ...draft, language: v })} />
        </>}
      />
      <p className="text-xs text-muted-foreground">{t('admin_cc_money_note')}</p>
      {error && <ErrorNote message={error} />}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <Empty>{t('admin_campaigns_empty')}</Empty>
          ) : (
            <ul>
              {rows.map((c) => (
                <li key={c.id} className="border-t border-border first:border-0">
                  <button type="button" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                    <span className="min-w-[10rem] flex-1">
                      <span className="block truncate text-sm font-medium">
                        {c.property?.homatch_id ? `#${c.property.homatch_id} ` : ''}{c.property?.title ?? '—'}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {c.owner?.email ?? '—'}{c.property?.city ? ` · ${c.property.city}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={c.state === 'ACTIVE' ? 'default' : 'outline'} className="text-2xs">{labelFor(t, 'campaignState', c.state)}</Badge>
                      {c.property?.transaction_type && <Badge variant="secondary" className="text-2xs">{labelFor(t, 'deal', c.property.transaction_type)}</Badge>}
                      <span className="text-2xs tabular-nums text-muted-foreground" dir="ltr">{(c.languages_resolved ?? c.languages_selected ?? []).join(' ').toUpperCase()}</span>
                    </span>
                  </button>
                  {open === c.id && (
                    <div className="border-t border-border bg-muted/30 px-4 py-3">
                      <KV rows={[
                        [t('admin_cc_owner'), <UserLine user={c.owner} />],
                        [t('admin_cc_budget'), credits(c.budget_credits)],
                        [t('admin_cc_spent'), credits(c.spent_credits)],
                        [t('admin_cc_provider_cogs'), usd(c.provider_cogs_usd)],
                        [t('admin_cc_wallet_balance'), credits(c.wallet_balance_credits)],
                        [t('admin_cc_runs'), c.last_run ? `${c.runs} · ${c.last_run.status} · ${c.last_run.matches_created}` : String(c.runs)],
                        [t('admin_cc_language_mode'), c.language_mode ?? '—'],
                        [t('admin_cc_created'), <When at={c.created_at} />],
                        [t('admin_cc_internal_id'), <IdChip id={c.id} />],
                      ]} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pager offset={offset} limit={LIMIT} total={totalOf(rows)} count={rows.length} onChange={setOffset} />
    </div>
  );
}
