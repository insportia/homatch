import React, { useState, useCallback } from 'react';
import { Search, User, Building2, Mail, Phone, CreditCard, Bot, DollarSign, Eye, Loader2, ChevronRight, ArrowLeft, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/db/supabase';
import { User360, User as HUser } from '@/types/types';
import { toast } from 'sonner';

interface UserRowItem {
  id: string;
  auth_id?: string;
  email: string;
  full_name?: string;
  is_admin?: boolean;
  created_at: string;
}

export default function AdminUser360Page() {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserRowItem[]>([]);
  const [selected, setSelected] = useState<User360 | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSelected(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user360?action=search_users', {
        method: 'GET',
      });
      // POST fallback since GET with body is unreliable in some envs
      const { data: pData, error: pErr } = await supabase.functions.invoke('admin-user360', {
        body: { action: 'search_users', query: query.trim() },
      });
      if (pErr) { const msg = await pErr?.context?.text(); throw new Error(msg ?? pErr.message); }
      setResults(Array.isArray(pData?.users) ? pData.users : []);
    } catch (err) {
      toast.error('Search failed');
      console.error(err);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const loadUser360 = useCallback(async (targetUserId: string) => {
    setLoadingUser(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user360', {
        body: { action: 'user360', target_user_id: targetUserId },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      setSelected(data as User360);
    } catch (err) {
      toast.error('Failed to load user profile');
      console.error(err);
    } finally {
      setLoadingUser(false);
    }
  }, []);

  const handleImpersonate = useCallback(async (targetUser: HUser | null) => {
    if (!targetUser) return;
    const reason = prompt('Reason for impersonation (required for audit):');
    if (!reason?.trim()) { toast.error('Reason is required'); return; }
    setImpersonating(true);
    try {
      const { data, error } = await supabase.functions.invoke('impersonate-user', {
        body: { action: 'start', target_user_id: targetUser.id, reason },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      // Store session for banner
      sessionStorage.setItem('impersonation_session', JSON.stringify({
        session_id: data.session_id,
        target_user: data.target_user,
        banner: data.banner,
        started_at: data.started_at,
      }));
      toast.success('Impersonation session started');
      window.location.href = '/dashboard';
    } catch (err) {
      toast.error('Failed to start impersonation');
      console.error(err);
    } finally {
      setImpersonating(false);
    }
  }, []);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          User 360° View
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">Search users and inspect their full profile, campaigns, contacts, credits, and AI usage.</p>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder="Search by email or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <Button onClick={handleSearch} disabled={searching || !query.trim()}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="ms-2 hidden sm:inline">Search</span>
        </Button>
      </div>

      {/* Results list */}
      {!selected && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{results.length} result{results.length !== 1 ? 's' : ''}</p>
          {results.map((u) => (
            <Card key={u.id} className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => loadUser360(u.id)}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{u.full_name ?? 'No name'}</span>
                    {u.is_admin && <Badge className="text-[10px] px-1.5 bg-red-500/10 text-red-700">Admin</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Loading user360 */}
      {loadingUser && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      )}

      {/* User360 detail */}
      {selected && !loadingUser && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="gap-2 -ms-2">
            <ArrowLeft className="h-4 w-4" />Back to results
          </Button>

          {/* User card */}
          <Card>
            <CardHeader className="p-4 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{selected.user?.full_name ?? 'No name'}</CardTitle>
                    <p className="text-sm text-muted-foreground">{selected.user?.email}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="shrink-0 gap-2"
                  onClick={() => handleImpersonate(selected.user)}
                  disabled={impersonating}>
                  {impersonating
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Eye className="h-3.5 w-3.5" />}
                  View as User
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Properties" value={selected.properties.length} icon={<Building2 className="h-3.5 w-3.5" />} />
                <Stat label="Campaigns" value={selected.campaigns.length} icon={<Mail className="h-3.5 w-3.5" />} />
                <Stat label="Contact Lists" value={selected.contact_lists.length} icon={<Phone className="h-3.5 w-3.5" />} />
                <Stat label="Credits" value={selected.credits?.balance ?? 0} icon={<CreditCard className="h-3.5 w-3.5" />} />
              </div>
            </CardContent>
          </Card>

          {/* Properties */}
          {selected.properties.length > 0 && (
            <Section title="Properties" icon={<Building2 className="h-4 w-4" />}>
              {selected.properties.map((p) => (
                <Row key={p.id} primary={p.title} secondary={`${p.property_type} · ${p.status}`} date={p.created_at} />
              ))}
            </Section>
          )}

          {/* Campaigns */}
          {selected.campaigns.length > 0 && (
            <Section title="Outreach Campaigns" icon={<Mail className="h-4 w-4" />}>
              {selected.campaigns.map((c) => (
                <Row key={c.id} primary={c.name}
                  secondary={`${c.campaign_type} · ${c.status} · ${c.audience_count ?? 0} contacts`}
                  badge={c.status} date={c.created_at} />
              ))}
            </Section>
          )}

          {/* Contact lists */}
          {selected.contact_lists.length > 0 && (
            <Section title="Contact Lists" icon={<Phone className="h-4 w-4" />}>
              {selected.contact_lists.map((l) => (
                <Row key={l.id} primary={l.name}
                  secondary={`${l.import_status} · ${l.valid_rows ?? 0}/${l.total_rows ?? 0} valid`}
                  date={l.created_at} />
              ))}
            </Section>
          )}

          {/* Credits & costs */}
          {selected.credits && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />Credits & Spending
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Balance" value={selected.credits.balance} icon={<CreditCard className="h-3.5 w-3.5" />} />
                  <Stat label="Purchased" value={selected.credits.lifetime_purchased} icon={<DollarSign className="h-3.5 w-3.5" />} />
                  <Stat label="Spent" value={selected.credits.lifetime_spent} icon={<DollarSign className="h-3.5 w-3.5" />} />
                </div>
                {selected.recent_cost_events.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Recent cost events</p>
                    {selected.recent_cost_events.slice(0, 5).map((e, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-muted-foreground truncate">{e.event_type}</span>
                        <span className="font-medium shrink-0 ms-2">${Number(e.amount_usd).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* AI usage */}
          {selected.ai_conversations.length > 0 && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" />AI Conversations ({selected.ai_conversations.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-xs text-muted-foreground">Last: {new Date(selected.ai_conversations[0].created_at).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          )}

          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription className="text-xs">
              All admin reads are audited. Sensitive operations (export, delete, impersonate) require SUPER_ADMIN or SUPPORT_ADMIN role.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 p-2 bg-muted/40 rounded-lg">
      <div className="flex items-center gap-1 text-muted-foreground">{icon}<span className="text-[10px]">{label}</span></div>
      <span className="text-base font-semibold">{value}</span>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-1">{children}</CardContent>
    </Card>
  );
}

function Row({ primary, secondary, badge, date }: { primary: string; secondary?: string; badge?: string; date?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{primary}</p>
        {secondary && <p className="text-xs text-muted-foreground truncate">{secondary}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge && <Badge variant="outline" className="text-[10px] px-1.5">{badge}</Badge>}
        {date && <span className="text-[11px] text-muted-foreground whitespace-nowrap">{new Date(date).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}
