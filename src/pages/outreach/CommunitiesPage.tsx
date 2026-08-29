import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Globe, MapPin, Tag, ExternalLink, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { Community, CommunityPlatform } from '@/types/types';
import { toast } from 'sonner';

const PLATFORM_COLORS: Record<CommunityPlatform, string> = {
  TELEGRAM: 'bg-blue-500/10 text-blue-600 border-blue-200',
  FACEBOOK: 'bg-indigo-500/10 text-indigo-600 border-indigo-200',
  VK: 'bg-sky-500/10 text-sky-600 border-sky-200',
  REDDIT: 'bg-orange-500/10 text-orange-600 border-orange-200',
  LINKEDIN: 'bg-blue-700/10 text-blue-700 border-blue-300',
  THREADS: 'bg-purple-500/10 text-purple-600 border-purple-200',
  OTHER: 'bg-muted text-muted-foreground border-border',
};

export default function CommunitiesPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from('communities')
        .select('id,platform,canonical_id,canonical_url,name,description,language,country,city,tags,member_count,posting_policy,is_active,created_at')
        .eq('is_active', true)
        .order('member_count', { ascending: false })
        .limit(100);
      if (platformFilter !== 'all') query = query.eq('platform', platformFilter);
      if (countryFilter !== 'all') query = query.eq('country', countryFilter);
      const { data, error } = await query;
      if (error) throw error;
      setCommunities(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(t('comm_load_error'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [platformFilter, countryFilter, t]);

  useEffect(() => { load(); }, [load]);

  const filtered = communities.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.city ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const countries = [...new Set(communities.map((c) => c.country).filter(Boolean))] as string[];

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                {t('comm_title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">{t('comm_subtitle')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 me-2 ${loading ? 'animate-spin' : ''}`} />
              {t('comm_refresh')}
            </Button>
          </div>

          {/* Discovery disabled banner */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('comm_discovery_disabled')}</AlertDescription>
          </Alert>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="ps-9" placeholder={t('comm_search_placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-full sm:w-40 shrink-0">
                <SelectValue placeholder={t('comm_filter_platform')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('comm_all_platforms')}</SelectItem>
                {(['TELEGRAM','FACEBOOK','VK','REDDIT','LINKEDIN','THREADS','OTHER'] as CommunityPlatform[]).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={countryFilter} onValueChange={setCountryFilter}>
              <SelectTrigger className="w-full sm:w-40 shrink-0">
                <SelectValue placeholder={t('comm_filter_country')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('comm_all_countries')}</SelectItem>
                {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Stats bar */}
          <p className="text-xs text-muted-foreground">{filtered.length} {t('comm_results')}</p>

          {/* Community grid */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}><CardContent className="p-4 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-32" /></CardContent></Card>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Globe className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">{t('comm_empty_title')}</p>
              <p className="text-xs text-muted-foreground max-w-xs">{t('comm_empty_desc')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((c) => (
                <Card key={c.id} className="hover:border-primary/40 transition-colors">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm font-medium text-balance leading-snug">{c.name}</CardTitle>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${PLATFORM_COLORS[c.platform as CommunityPlatform] ?? ''}`}>
                        {c.platform}
                      </Badge>
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{c.description}</p>}
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      {(c.city || c.country) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />{[c.city, c.country].filter(Boolean).join(', ')}
                        </span>
                      )}
                      {c.member_count && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />{c.member_count.toLocaleString()}
                        </span>
                      )}
                      {c.language && <span className="uppercase">{c.language}</span>}
                      <span className={`capitalize ${c.posting_policy === 'OPEN' ? 'text-green-600' : 'text-muted-foreground'}`}>
                        {c.posting_policy?.toLowerCase().replace('_', ' ')}
                      </span>
                    </div>
                    {(c.tags?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {c.tags!.slice(0, 4).map((tag) => (
                          <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                            <Tag className="h-2.5 w-2.5" />{tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" className="text-xs h-7 flex-1"
                        onClick={() => navigate(`/outreach/communities/${c.id}`)}>
                        {t('comm_recommend_btn')}
                      </Button>
                      <Button variant="ghost" size="sm" className="text-xs h-7 px-2"
                        onClick={() => window.open(c.canonical_url, '_blank', 'noopener')}>
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </AppLayout>
    </RouteGuard>
  );
}
