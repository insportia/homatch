import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Search, Shield, UserX } from 'lucide-react';
import { getAdminUsers } from '@/services/api';
import type { AdminUserRow, AdminUsersResult } from '@/services/api';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';
import { labelFor } from '@/admin/labels';
import { searchUsers, type UserSearchRow } from '@/services/adminControl';

/**
 * ADMIN USERS.
 *
 * The previous version listed public.users with four columns and called it a
 * user list. On production that is ten rows, of which three are people: the
 * other seven are CI and smoke-test leftovers with a profile row and no auth
 * user, which can never sign in. The page reported 10 and an operator had no
 * way to know better.
 *
 * It also printed the credit balance as `$99978.60`. That is 99,978.60
 * CREDITS, worth $9,997.86 — the dollar sign was applied to the wrong unit,
 * and after the 1 Credit = $0.10 redenomination it overstated by ten times.
 *
 * So: registration state is stated per row, the count is split into people and
 * leftovers, and credits are labelled as credits with their value beside them.
 */

function relTime(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return null;
  if (mins < 60) return `${Math.max(mins, 0)}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export default function AdminUsersPage() {
  const { t } = useLanguage();
  const [result, setResult] = useState<AdminUsersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showOrphans, setShowOrphans] = useState(false);

  useEffect(() => {
    let alive = true;
    getAdminUsers(200)
      .then(r => { if (alive) { setResult(r); setError(null); } })
      // A failed load must not look like "nobody has signed up".
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  /*
   * THE SEARCH RUNS IN THE DATABASE.
   *
   * It used to filter the two hundred rows already on screen, so an account
   * older than the two-hundredth did not exist here. admin_search_users looks
   * at every account — by name, email, username, id, phone digits, or the
   * six-digit reference of a property they own.
   */
  const [hits, setHits] = useState<UserSearchRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); setSearchError(null); return; }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchUsers(term, 50)
        .then(r => { if (alive) { setHits(r); setSearchError(null); } })
        .catch(e => { if (alive) { setHits([]); setSearchError(e instanceof Error ? e.message : String(e)); } })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [q]);

  const rows: AdminUserRow[] = result?.rows ?? [];
  const totals = result?.totals;

  const filtered = rows.filter(u => showOrphans || u.registered);

  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t('admin_users_title')}</h1>
        {totals && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('admin_users_counts')
              .replace('{registered}', String(totals.registered))
              .replace('{active}', String(totals.active_30d))}
          </p>
        )}
      </div>

      {/* Profile rows that can never sign in. Said plainly, not hidden and not
          silently counted as customers. */}
      {totals && totals.orphaned > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {t('admin_users_orphans_note').replace('{n}', String(totals.orphaned))}
          </p>
          <Button variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => setShowOrphans(v => !v)}>
            {showOrphans ? t('admin_users_hide_orphans') : t('admin_users_show_orphans')}
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm font-semibold text-red-400">{t('admin_users_load_failed')}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder={t('admin_cc_user_search_placeholder')}
               value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {searchError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm font-semibold text-red-400">{t('admin_users_load_failed')}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{searchError}</p>
        </div>
      )}

      {hits !== null ? (
        <Card>
          <CardContent className="p-0">
            {searching ? (
              <div className="space-y-2 p-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : hits.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('admin_users_empty')}</p>
            ) : (
              <ul>
                {hits.map(u => (
                  <li key={u.id} className="border-t border-border first:border-0">
                    <a href={`/admin/user360?user=${u.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/30">
                      <span className="min-w-[12rem] flex-1">
                        <span className="block truncate text-sm font-medium">{u.full_name || u.email}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.email}{u.username ? ` · @${u.username}` : ''}{u.phone_hint ? ` · ${u.phone_hint}` : ''}
                        </span>
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {labelFor(t, 'matchedBy', u.matched_by)}{u.property_reference ? ` #${u.property_reference}` : ''}
                      </Badge>
                      {u.is_admin && <Badge variant="default" className="gap-1 text-xs"><Shield className="h-3 w-3" />{t('admin_users_admin_badge')}</Badge>}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-muted-foreground">{t('admin_credits_user')}</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-muted-foreground">{t('admin_users_signin')}</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-muted-foreground">{t('admin_users_credits')}</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-muted-foreground">{t('admin_users_verifies')}</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-muted-foreground">{t('admin_users_cost')}</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-muted-foreground">{t('admin_users_role')}</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-muted-foreground">{t('admin_users_joined')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t('admin_users_empty')}</td></tr>
                ) : filtered.map(u => (
                  <tr key={u.id} className={`border-b border-border last:border-0 hover:bg-muted/30 ${
                    u.registered ? '' : 'opacity-60'
                  }`}>
                    <td className="px-4 py-2.5">
                      <a href={`/admin/user360?user=${u.id}`} className="block max-w-[240px] truncate font-medium hover:underline">{u.email}</a>
                      {u.full_name && (
                        <div className="max-w-[240px] truncate text-xs text-muted-foreground">{u.full_name}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {u.registered ? (
                        <div className="flex flex-col">
                          <span className="text-xs capitalize">{u.sign_in_provider ?? '—'}</span>
                          <span className="text-xs text-muted-foreground">
                            {u.last_sign_in_at
                              ? t('admin_users_last_seen').replace('{t}', relTime(u.last_sign_in_at) ?? '')
                              : t('admin_users_never_signed_in')}
                          </span>
                        </div>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                          <UserX className="h-3 w-3" />
                          {t('admin_users_no_login')}
                        </Badge>
                      )}
                    </td>
                    {/* Credits, labelled as credits, with what they are worth
                        beside them. Never a bare dollar sign on a credit. */}
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums" dir="ltr">
                      {Number(u.credits_balance).toFixed(2)}
                      <span className="ms-1 text-xs text-muted-foreground">CR</span>
                      <div className="text-xs text-muted-foreground">
                        ${Number(u.credits_value_usd).toFixed(2)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                      {u.verify_runs || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted-foreground" dir="ltr">
                      {Number(u.provider_cost_usd) > 0 ? `$${Number(u.provider_cost_usd).toFixed(2)}` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {u.is_admin
                        ? <Badge variant="default" className="gap-1 text-xs"><Shield className="h-3 w-3" />{t('admin_users_admin_badge')}</Badge>
                        : <Badge variant="outline" className="text-xs">{u.plan}</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                      {u.created_at ? format(new Date(u.created_at), 'MMM d, yyyy') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
