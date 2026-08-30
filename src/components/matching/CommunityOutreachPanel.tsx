import React, { useCallback, useEffect, useState } from 'react';
import {
  Users, ExternalLink, Sparkles, Loader2, Copy, CheckCircle2, Lock,
  ChevronDown, ChevronUp, Image as ImageIcon, Send,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/types/types';
import { toast } from 'sonner';

interface RankedCommunity {
  community_id: string;
  score: number;
  rationale?: { summary?: string };
  community: {
    id: string;
    platform: string;
    name: string;
    canonical_url: string;
    member_count?: number | null;
    city?: string | null;
    country?: string | null;
    posting_policy?: string;
    posting_allowed?: boolean | null;
    housing_focus?: 'primary' | 'secondary';
  } | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  TELEGRAM: 'text-sky-400 bg-sky-400/10 border-sky-400/20',
  FACEBOOK: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  VK: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20',
  REDDIT: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  LINKEDIN: 'text-blue-700 bg-blue-700/10 border-blue-700/20',
  THREADS: 'text-foreground bg-foreground/10 border-foreground/20',
  WHATSAPP: 'text-green-500 bg-green-500/10 border-green-500/20',
};

export function CommunityOutreachPanel({ propertyId }: { propertyId: string }) {
  const { t, lang } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<RankedCommunity[]>([]);
  const [lockedCount, setLockedCount] = useState(0);
  const [plan, setPlan] = useState<'FREE' | 'PLUS' | 'PRO'>('FREE');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [postLang, setPostLang] = useState<SupportedLanguage>(lang);
  const [drafts, setDrafts] = useState<Record<string, { content: string; generating: boolean }>>({});
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [postedIds, setPostedIds] = useState<Set<string>>(new Set());
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from('properties').select('cover_photo_url').eq('id', propertyId).maybeSingle()
      .then(({ data }) => setCoverPhotoUrl(data?.cover_photo_url ?? null));
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('community-recommend', {
        body: { property_id: propertyId },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      setItems(Array.isArray(data?.ranked) ? data.ranked : []);
      setLockedCount(data?.locked_count ?? 0);
      setPlan(data?.plan ?? 'FREE');
      setLoaded(true);
    } catch {
      toast.error(t('community_load_error'));
    } finally {
      setLoading(false);
    }
  }, [propertyId, t]);

  const generatePost = async (communityId: string) => {
    setDrafts((d) => ({ ...d, [communityId]: { content: d[communityId]?.content ?? '', generating: true } }));
    try {
      const { data, error } = await supabase.functions.invoke('social-post-generate', {
        body: { property_id: propertyId, community_id: communityId, language: postLang, mode: 'ai_draft' },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      setDrafts((d) => ({ ...d, [communityId]: { content: data?.content ?? '', generating: false } }));
    } catch {
      toast.error(t('community_post_error'));
      setDrafts((d) => ({ ...d, [communityId]: { content: d[communityId]?.content ?? '', generating: false } }));
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('community_copied'));
    } catch {
      toast.error(t('community_copy_error'));
    }
  };

  const markPosted = async (communityId: string) => {
    setMarkingId(communityId);
    try {
      const { error } = await supabase.from('property_community_recommendations')
        .update({ status: 'POSTED', posted_at: new Date().toISOString() })
        .eq('property_id', propertyId).eq('community_id', communityId);
      if (error) throw error;
      setPostedIds((s) => new Set(s).add(communityId));
      toast.success(t('community_marked_posted'));
    } catch {
      toast.error(t('community_status_error'));
    } finally {
      setMarkingId(null);
    }
  };

  if (!loaded) {
    return (
      <Card className="bg-card border-border border-dashed">
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{t('community_panel_title')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('community_panel_subtitle')}</p>
            </div>
            <Button size="sm" onClick={load} disabled={loading} className="shrink-0 gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t('community_find_button')}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">{t('community_panel_title')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('community_post_language')}</span>
            <Select value={postLang} onValueChange={(v) => setPostLang(v as SupportedLanguage)}>
              <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code} className="text-xs">{l.nativeLabel}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">{t('community_none_found')}</p>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => {
              const c = item.community;
              if (!c) return null;
              const isOpen = expandedId === c.id;
              const draft = drafts[c.id];
              const isPosted = postedIds.has(c.id);
              return (
                <div key={c.id} className="rounded-xl border border-border overflow-hidden">
                  <div
                    role="button" tabIndex={0}
                    onClick={() => setExpandedId(isOpen ? null : c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setExpandedId(isOpen ? null : c.id); }}
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-secondary/40 transition-colors"
                  >
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${PLATFORM_COLORS[c.platform] ?? ''}`}>{c.platform}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                        {c.housing_focus === 'secondary' && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground shrink-0">{t('community_general_badge')}</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[c.city, c.country].filter(Boolean).join(', ')}
                        {c.member_count ? ` · ${c.member_count.toLocaleString()} ${t('community_members')}` : ''}
                      </p>
                    </div>
                    {isPosted && <Badge className="text-[10px] bg-green-500/15 text-green-400 border-green-500/30 shrink-0">{t('community_status_posted')}</Badge>}
                    {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                  </div>
                  {isOpen && (
                    <div className="p-3 pt-0 space-y-3 border-t border-border">
                      {c.posting_allowed === false && (
                        <p className="text-[11px] text-muted-foreground italic pt-3">{t('community_no_direct_post')}</p>
                      )}
                      {c.housing_focus === 'secondary' && (
                        <p className="text-[11px] text-muted-foreground italic pt-3">{t('community_secondary_note')}</p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-3">
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => generatePost(c.id)} disabled={draft?.generating}>
                          {draft?.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {t('community_generate_post')}
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" asChild>
                          <a href={c.canonical_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />{t('community_open_group')}
                          </a>
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => markPosted(c.id)} disabled={markingId === c.id || isPosted}>
                          {markingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          {isPosted ? t('community_status_posted') : t('community_mark_posted')}
                        </Button>
                      </div>
                      {draft?.content && (
                        <div className="space-y-2">
                          <Textarea readOnly rows={4} value={draft.content} className="text-xs bg-secondary/40" />
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" onClick={() => copyText(draft.content)}>
                              <Copy className="h-3 w-3" />{t('community_copy_text')}
                            </Button>
                            {coverPhotoUrl && (
                              <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" asChild>
                                <a href={coverPhotoUrl} target="_blank" rel="noopener noreferrer">
                                  <ImageIcon className="h-3 w-3" />{t('community_view_photo')}
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {lockedCount > 0 && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center gap-3">
            <Lock className="h-4 w-4 text-primary shrink-0" />
            <p className="text-xs text-foreground flex-1">
              {t('community_upsell').replace('{count}', String(lockedCount))}
            </p>
          </div>
        )}
        {plan === 'FREE' && lockedCount === 0 && items.length > 0 && (
          <p className="text-[11px] text-muted-foreground text-center">{t('community_free_plan_note')}</p>
        )}
      </CardContent>
    </Card>
  );
}
