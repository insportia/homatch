import { Infinity as InfinityIcon, Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserAccessPanel } from '@/components/admin/UserAccessPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { planLabel } from '@/subscriptions/components';
import { type AdminAccessUserRow, adminAccessUsers, isAccessForbidden } from '@/subscriptions/service';

/*
 * ADMIN → MONEY → USER ACCESS ("მომხმარებლების წვდომები", /admin/access). Owner requirement 2026-10-30.
 *
 * Find an account, then manage its access in UserAccessPanel (the same panel the admin user
 * profile shows). The rules live server-side in the admin_access_* RPCs.
 */
export default function AdminAccessPage() {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<AdminAccessUserRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const find = useCallback(async (q: string) => {
    try { setUsers(await adminAccessUsers(q.trim() || null)); } catch (e) {
      toast.error(isAccessForbidden(String((e as Error)?.message ?? e)) ? t('acc_forbidden') : t('sub_err_generic'));
      setUsers([]);
    }
  }, [t]);
  useEffect(() => { void find(''); }, [find]);
  const open = (id: string) => setSelected(id);
  const roleOf = (u: { owner: boolean; isAdmin: boolean }) => (u.owner ? t('acc_role_owner') : u.isAdmin ? t('acc_role_admin') : t('acc_role_customer'));

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="admin-access-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('acc_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('acc_intro')}</p>
      </div>

      <form className="flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); void find(search); }}>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('acc_search_placeholder')} aria-label={t('acc_search_placeholder')} className="h-11 min-w-0 flex-1" />
        <Button type="submit" className="h-11 shrink-0" aria-label={t('acc_search')}><Search className="h-4 w-4" aria-hidden="true" /></Button>
      </form>

      {users === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" /> : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('acc_no_results')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label={t('acc_title')}>
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => open(u.id)} aria-current={selected === u.id ? 'true' : undefined}
                className={`flex min-h-12 w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-start text-sm hover:bg-secondary ${selected === u.id ? 'bg-secondary' : ''}`}>
                <span className="min-w-0 flex-1 truncate font-medium" dir="ltr">{u.email ?? u.id}</span>
                <span className="text-xs text-muted-foreground">{roleOf(u)}</span>
                {u.unlimited ? <span className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2 py-0.5 text-xs font-semibold text-gold-ink"><InfinityIcon className="h-3 w-3" aria-hidden="true" />{t('acc_unlimited')}</span>
                  : u.plan ? <span className="text-xs">{planLabel(t, u.plan)}</span> : null}
                {u.activeGrants > 0 && !u.unlimited ? <span className="text-xs text-muted-foreground">{t('acc_manual_grant')}</span> : null}
                {u.suspended ? <span className="text-xs text-destructive">{t('acc_status_suspended')}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!selected ? <p className="text-sm text-muted-foreground">{t('acc_select_user')}</p> : <UserAccessPanel userId={selected} onChanged={() => void find(search)} />}
    </div>
  );
}
