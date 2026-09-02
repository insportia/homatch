import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Search, Bell, BellOff, Trash2, Plus, Home, TrendingUp,
  CalendarCheck, MapPin, CheckCircle,
} from 'lucide-react';
import {
  getActiveSearchSubscriptions, toggleActiveSearch, deleteActiveSearch,
  createActiveSearch,
} from '@/services/api3';
import { getProperties } from '@/services/api';
import type { ActiveSearchSubscription } from '@/types/phase3';
import type { Property } from '@/types/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── Subscription Card ─────────────────────────────────────────
function SubCard({
  sub, onToggle, onDelete,
}: {
  sub: ActiveSearchSubscription & { properties?: { title?: string; city?: string } };
  onToggle: (id: string, active: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const lastNotified = sub.last_notified_at
    ? new Date(sub.last_notified_at).toLocaleDateString()
    : t('as_never');

  const handleToggle = async () => {
    setToggling(true);
    await onToggle(sub.id, !sub.is_active);
    setToggling(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(sub.id);
    setDeleting(false);
  };

  const criteria = sub.search_criteria as Record<string, string | number | boolean | null | undefined> | undefined;

  return (
    <Card className={cn('bg-card border-border transition-opacity', !sub.is_active && 'opacity-60')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={sub.is_active ? 'default' : 'secondary'} className="text-[10px] h-4 px-1.5">
                {sub.is_active ? t('as_status_active') : t('as_status_paused')}
              </Badge>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                {sub.side === 'DEMAND' ? t('as_side_demand') : t('as_side_supply')}
              </Badge>
            </div>

            {/* Property info for SUPPLY side */}
            {sub.side === 'SUPPLY' && sub.properties && (
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Home className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{sub.properties.title ?? t('as_default_property_name')}</span>
                {sub.properties.city && (
                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />{sub.properties.city}
                  </span>
                )}
              </div>
            )}

            {/* Search criteria for DEMAND side */}
            {sub.side === 'DEMAND' && criteria && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {criteria.city && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">{String(criteria.city)}</span>}
                {criteria.transaction && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">{String(criteria.transaction)}</span>}
                {criteria.property_type && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">{String(criteria.property_type)}</span>}
                {criteria.budget_max && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full" dir="ltr">{t('as_up_to')} {String(criteria.budget_max)}</span>}
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <CalendarCheck className="h-3 w-3" />
              {t('as_last_notified')} {lastNotified}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={handleToggle} disabled={toggling}
            >
              {sub.is_active
                ? <Bell className="h-4 w-4 text-primary" />
                : <BellOff className="h-4 w-4 text-muted-foreground" />
              }
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={handleDelete} disabled={deleting}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Add Supply Dialog ─────────────────────────────────────────
function AddSupplyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !homatchUser) return;
    getProperties(homatchUser.id).then(setProperties).catch(() => {});
  }, [open, homatchUser]);

  const handleCreate = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await createActiveSearch('SUPPLY', { property_id: selected });
      toast.success(t('as_toast_supply_enabled'));
      onCreated();
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('as_dialog_supply_title')}</DialogTitle>
          <DialogDescription>{t('as_dialog_supply_desc')}</DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <label className="text-xs text-muted-foreground mb-1 block">{t('as_field_property')}</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={selected}
            onChange={e => setSelected(e.target.value)}
          >
            <option value="">{t('as_select_property_ph')}</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>{p.title ?? p.facts?.city ?? p.id}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {t('as_supply_notice')}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('general_cancel')}</Button>
          <Button onClick={handleCreate} disabled={!selected || loading}>
            {loading ? t('as_enabling') : t('as_enable')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Demand Dialog ─────────────────────────────────────────
function AddDemandDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t } = useLanguage();
  const [city, setCity] = useState('');
  const [transaction, setTransaction] = useState('SALE');
  const [propType, setPropType] = useState('APARTMENT');
  const [budgetMax, setBudgetMax] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      await createActiveSearch('DEMAND', {
        search_criteria: {
          city: city || undefined,
          transaction,
          property_type: propType,
          budget_max: budgetMax ? Number(budgetMax) : undefined,
        },
      });
      toast.success(t('as_toast_demand_created'));
      onCreated();
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('as_dialog_demand_title')}</DialogTitle>
          <DialogDescription>{t('as_dialog_demand_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t('as_field_city')}</label>
            <input className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder={t('as_city_ph')} value={city} onChange={e => setCity(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('as_field_transaction')}</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={transaction} onChange={e => setTransaction(e.target.value)}>
                <option value="SALE">{t('as_txn_buy')}</option>
                <option value="RENT">{t('as_txn_rent')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('as_field_type')}</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={propType} onChange={e => setPropType(e.target.value)}>
                <option value="APARTMENT">{t('as_type_apartment')}</option>
                <option value="HOUSE">{t('as_type_house')}</option>
                <option value="VILLA">{t('as_type_villa')}</option>
                <option value="COMMERCIAL">{t('as_type_commercial')}</option>
                <option value="LAND">{t('as_type_land')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t('as_field_budget_max')}</label>
            <input type="number" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder={t('as_budget_ph')} value={budgetMax} onChange={e => setBudgetMax(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('general_cancel')}</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? t('as_creating') : t('as_create_alert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function ActiveSearchPage() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [subs, setSubs] = useState<ActiveSearchSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [addSupplyOpen, setAddSupplyOpen] = useState(false);
  const [addDemandOpen, setAddDemandOpen] = useState(false);

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      setSubs(await getActiveSearchSubscriptions(homatchUser.id));
    } finally {
      setLoading(false);
    }
  }, [homatchUser]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (id: string, active: boolean) => {
    await toggleActiveSearch(id, active).catch(err => toast.error(String(err)));
    setSubs(prev => prev.map(s => s.id === id ? { ...s, is_active: active } : s));
  };

  const handleDelete = async (id: string) => {
    await deleteActiveSearch(id).catch(err => toast.error(String(err)));
    setSubs(prev => prev.filter(s => s.id !== id));
  };

  const demandSubs = subs.filter(s => s.side === 'DEMAND');
  const supplySubs = subs.filter(s => s.side === 'SUPPLY');

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-xl font-bold text-foreground">{t('active_search_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('as_subtitle')}
            </p>
          </div>

          {/* How it works */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { icon: Search, titleKey: 'as_how_buyer_title', descKey: 'as_how_buyer_desc', color: 'text-primary' },
              { icon: TrendingUp, titleKey: 'as_how_seller_title', descKey: 'as_how_seller_desc', color: 'text-green-400' },
            ].map(item => (
              <div key={item.titleKey} className="flex items-start gap-3 p-3 rounded-xl bg-secondary/50 border border-border">
                <item.icon className={`h-5 w-5 ${item.color} shrink-0 mt-0.5`} />
                <div>
                  <p className="text-sm font-medium">{t(item.titleKey)}</p>
                  <p className="text-xs text-muted-foreground">{t(item.descKey)}</p>
                </div>
              </div>
            ))}
          </div>

          <Separator />

          <Tabs defaultValue="demand">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <TabsList>
                <TabsTrigger value="demand">
                  {t('as_tab_looking')} {demandSubs.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{demandSubs.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="supply">
                  {t('as_tab_my_properties')} {supplySubs.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{supplySubs.length}</Badge>}
                </TabsTrigger>
              </TabsList>
              <div className="flex gap-2">
                {/* Add buttons rendered per tab below */}
              </div>
            </div>

            <TabsContent value="demand" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={() => setAddDemandOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t('as_dialog_demand_title')}
                </Button>
              </div>
              {loading
                ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
                : demandSubs.length === 0
                  ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">{t('active_search_empty')}</p>
                      <p className="text-xs mt-1">{t('as_empty_demand_hint')}</p>
                    </div>
                  )
                  : demandSubs.map(s => (
                    <SubCard key={s.id} sub={s as ActiveSearchSubscription & { properties?: { title?: string; city?: string } }} onToggle={handleToggle} onDelete={handleDelete} />
                  ))
              }
            </TabsContent>

            <TabsContent value="supply" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={() => setAddSupplyOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t('as_enable_for_property')}
                </Button>
              </div>
              {loading
                ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
                : supplySubs.length === 0
                  ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Home className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">{t('active_search_empty')}</p>
                      <p className="text-xs mt-1">{t('as_empty_supply_hint')}</p>
                    </div>
                  )
                  : supplySubs.map(s => (
                    <SubCard key={s.id} sub={s as ActiveSearchSubscription & { properties?: { title?: string; city?: string } }} onToggle={handleToggle} onDelete={handleDelete} />
                  ))
              }
            </TabsContent>
          </Tabs>
        </div>

        <AddSupplyDialog open={addSupplyOpen} onClose={() => setAddSupplyOpen(false)} onCreated={load} />
        <AddDemandDialog open={addDemandOpen} onClose={() => setAddDemandOpen(false)} onCreated={load} />
      </AppLayout>
    </RouteGuard>
  );
}
