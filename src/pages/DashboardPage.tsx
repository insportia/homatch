import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  PlusCircle, MapPin, DollarSign, Maximize2, BedDouble,
  Zap, Trash2, ExternalLink, LayoutGrid, Building2, Lock
} from 'lucide-react';
import { getProperties, softDeleteProperty } from '@/services/api';
import type { Property } from '@/types/types';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';

function StatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') return <span className="status-active">MATCHING ACTIVE</span>;
  if (status === 'PAUSED') return <span className="status-paused">PAUSED</span>;
  return <span className="status-paused">DRAFT</span>;
}

function PropertyCard({ prop, onDelete }: { prop: Property; onDelete: (id: string) => void }) {
  const navigate = useNavigate();
  const { t, isRTL } = useLanguage();
  const facts = prop.facts;
  const isPrivate = prop.source_type === 'PRIVATE_LISTING';

  const locationParts = [facts?.district, facts?.city, facts?.country]
    .filter(Boolean).join(', ');

  const score = prop.matchability_score ?? 0;
  const scoreColor = score >= 70 ? 'text-green-400' : score >= 40 ? 'text-primary' : 'text-muted-foreground';

  return (
    <div
      className="group relative rounded-xl border border-border bg-card card-hover cursor-pointer overflow-hidden"
      onClick={() => navigate(`/property/${prop.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(`/property/${prop.id}`)}
    >
      {/* Cover image */}
      <div className="aspect-[16/9] bg-secondary relative overflow-hidden">
        {prop.cover_photo_url ? (
          <img
            src={prop.cover_photo_url}
            alt={prop.title ?? 'Property'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Building2 className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        {/* Badges overlay */}
        <div className={`absolute top-2 ${isRTL ? 'right-2' : 'left-2'} flex flex-col gap-1`}>
          {isPrivate && <span className="status-private">{t('prop_private_badge')}</span>}
        </div>
        {/* Delete btn */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(prop.id); }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 bg-background/80 rounded-md flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
          aria-label="Delete property"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-foreground truncate">
              {prop.title ?? (isPrivate ? 'Private Listing' : 'Imported Property')}
            </h3>
            {locationParts && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{locationParts}</span>
              </p>
            )}
          </div>
          <StatusBadge status={prop.matching_status} />
        </div>

        {/* Price / area row */}
        <div className="flex items-center gap-3 flex-wrap">
          {facts?.total_price && (
            <span className="text-sm font-semibold text-foreground flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5 text-primary" />
              {Number(facts.total_price).toLocaleString()} {facts?.currency ?? ''}
            </span>
          )}
          {facts?.area && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Maximize2 className="h-3 w-3" />
              {facts.area} m²
            </span>
          )}
          {facts?.bedrooms && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <BedDouble className="h-3 w-3" />
              {facts.bedrooms} {t('prop_bedrooms')}
            </span>
          )}
        </div>

        {/* Matchability */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">{t('match_score_label')}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Mini bar */}
            <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${score}%` }}
              />
            </div>
            <span className={`text-xs font-semibold ${scoreColor}`}>{score}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsCard({ label, value, icon: Icon, accent = false }: {
  label: string; value: string | number; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Icon className={`h-4 w-4 ${accent ? 'text-primary' : 'text-muted-foreground/50'}`} />
      </div>
      <p className={`text-2xl font-semibold ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}

function DashboardContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!homatchUser) return;
    getProperties(homatchUser.id).then(data => {
      setProperties(data);
      setLoading(false);
    });
  }, [homatchUser]);

  const handleDelete = async () => {
    if (!deleteId) return;
    await softDeleteProperty(deleteId);
    setProperties(prev => prev.filter(p => p.id !== deleteId));
    setDeleteId(null);
    toast.success('Property deleted.');
  };

  const activeCount = properties.filter(p => p.matching_status === 'ACTIVE').length;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-foreground">{t('dash_title')}</h1>
            {homatchUser?.full_name && (
              <p className="text-sm text-muted-foreground mt-0.5">
                Welcome back, {homatchUser.full_name.split(' ')[0]}
              </p>
            )}
          </div>
          <Button
            onClick={() => navigate('/property/add')}
            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-sm h-9 px-4"
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            {t('dash_add_property')}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatsCard label={t('dash_total_properties')} value={properties.length} icon={LayoutGrid} />
          <StatsCard label={t('dash_active_matching')} value={activeCount} icon={Zap} accent />
          <StatsCard label={t('dash_credit_balance')} value="—" icon={DollarSign} />
          <StatsCard label="New Matches" value="—" icon={ExternalLink} />
        </div>

        {/* Properties */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            {t('dash_your_properties')}
          </h2>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="aspect-[16/9] bg-muted animate-pulse" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                    <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : properties.length === 0 ? (
            /* Empty state */
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2">{t('dash_empty_title')}</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-6">{t('dash_empty_desc')}</p>
              <Button
                onClick={() => navigate('/property/add')}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                {t('dash_add_property')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {properties.map(prop => (
                <PropertyCard key={prop.id} prop={prop} onDelete={setDeleteId} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('prop_delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {t('prop_delete_confirm_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">{t('prop_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('prop_confirm_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

export default function DashboardPage() {
  return (
    <RouteGuard>
      <DashboardContent />
    </RouteGuard>
  );
}
