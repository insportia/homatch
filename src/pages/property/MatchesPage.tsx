import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Zap, Lock, Unlock, ExternalLink, User, Globe, MapPin, DollarSign,
  BedDouble, Clock, ChevronRight, Loader2, Play, Pause, AlertCircle,
  MessageSquare, Bot, CalendarDays,
} from 'lucide-react';
import { MatchingJobProgress } from '@/components/matching/MatchingJobProgress';
import { ExternalContactUnlockModal } from '@/components/matching/ExternalContactUnlockModal';
import { ExternalSitesCard } from '@/components/matching/ExternalSitesCard';
import { CommunityOutreachPanel } from '@/components/matching/CommunityOutreachPanel';
import {
  getMatches, getMatchCounts, unlockMatch, markMatchPreviewed,
  getUnlockedMatch, startMatchingCampaign, pauseMatchingCampaign,
  getCreditAccount,
} from '@/services/api';
import type { Match, MatchUnlock, CreditAccount } from '@/types/types';
import { toast } from 'sonner';

// ── CONSTANTS ─────────────────────────────────────────────────

// Presentation labels are localized via `labelKey` at render time; the
// object's own keys (EXCEPTIONAL, VERY_STRONG, …) are the stable machine
// enum values used for lookups and never change with language.
const STRENGTH_CONFIG = {
  EXCEPTIONAL:  { labelKey: 'matches_strength_exceptional',  color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30', bars: 5 },
  VERY_STRONG:  { labelKey: 'matches_strength_very_strong',  color: 'text-primary',    bg: 'bg-primary/10 border-primary/30',       bars: 4 },
  STRONG:       { labelKey: 'matches_strength_strong',        color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/30',   bars: 3 },
  GOOD:         { labelKey: 'matches_strength_good',          color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/30',     bars: 2 },
  POTENTIAL:    { labelKey: 'matches_strength_potential',     color: 'text-muted-foreground', bg: 'bg-secondary border-border',      bars: 1 },
} as const;

const PLATFORM_ICONS: Record<string, string> = {
  TELEGRAM: '✈',
  FACEBOOK: 'f',
  INSTAGRAM: '◎',
  VK: 'vk',
  GOOGLE: 'G',
  BING: 'B',
  FORUM: '♠',
  WEBSITE: '⊕',
  OTHER: '·',
};

function StrengthBars({ strength }: { strength: keyof typeof STRENGTH_CONFIG }) {
  const cfg = STRENGTH_CONFIG[strength];
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className={`w-1 rounded-sm transition-all ${i <= cfg.bars ? cfg.color.replace('text-', 'bg-') : 'bg-muted-foreground/20'}`}
          style={{ height: `${6 + i * 2}px` }}
        />
      ))}
    </div>
  );
}

function LockedMatchCard({
  match,
  onUnlock,
  unlocking,
  onAskAI,
  onChat,
  onRequestViewing,
}: {
  match: Match;
  onUnlock: (m: Match) => void;
  unlocking: boolean;
  onAskAI: (m: Match) => void;
  onChat: (m: Match) => void;
  onRequestViewing: (m: Match) => void;
}) {
  const { t } = useLanguage();
  const cfg = STRENGTH_CONFIG[match.signal_strength] ?? STRENGTH_CONFIG.POTENTIAL;
  const platformIcon = PLATFORM_ICONS[match.preview_platform ?? 'OTHER'] ?? '·';
  const budgetStr =
    match.preview_budget_min || match.preview_budget_max
      ? `${match.preview_currency ?? '$'}${Number(match.preview_budget_min ?? 0).toLocaleString()}–${Number(match.preview_budget_max ?? 0).toLocaleString()}`
      : null;

  return (
    <div className={`rounded-xl border ${cfg.bg} p-4 space-y-3`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <StrengthBars strength={match.signal_strength} />
          <span className={`text-xs font-semibold ${cfg.color}`}>{t(cfg.labelKey)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {match.status === 'NEW' && (
            <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded">{t('matches_new_badge')}</span>
          )}
          {match.status === 'UNLOCKED' && (
            <span className="text-[10px] font-bold bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30">{t('matches_unlocked_badge')}</span>
          )}
        </div>
      </div>

      {/* Preview chips */}
      <div className="flex flex-wrap gap-2">
        {match.preview_platform && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {match.preview_platform}
          </span>
        )}
        {match.preview_language && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">
            {match.preview_language.toUpperCase()}
          </span>
        )}
        {match.preview_city && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {match.preview_city}
          </span>
        )}
        {budgetStr && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            {budgetStr}
          </span>
        )}
        {match.preview_bedrooms && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <BedDouble className="h-3 w-3" />
            {match.preview_bedrooms} {t('matches_bedrooms')}
          </span>
        )}
        {match.preview_recency && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {match.preview_recency}
          </span>
        )}
      </div>

      {/* Excerpt */}
      {match.preview_excerpt && (
        <div className="rounded-lg bg-background/50 border border-border/50 px-3 py-2">
          <p className="text-xs text-muted-foreground italic line-clamp-2 blur-[1.5px] select-none">
            {match.preview_excerpt}
          </p>
          <div className="flex items-center gap-1 mt-1">
            <Lock className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/50">{t('matches_unlock_hint')}</span>
          </div>
        </div>
      )}

      {/* Mock badge — dev only */}
      {match.mock_mode && import.meta.env.DEV && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-2 py-0.5 rounded-full">
            {t('matches_dev_signal')}
          </span>
        </div>
      )}

      {/* Score + Unlock CTA */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">{t('matches_score')}</p>
            <p className={`text-sm font-semibold ${cfg.color}`}>{Math.round(match.match_score)}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">{t('matches_confidence')}</p>
            <p className="text-sm font-semibold text-foreground">
              {Math.round((match.intent_confidence ?? 0) * 100)}%
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Ask AI why — always available */}
          <Button
            size="sm"
            variant="ghost"
            className="border border-border text-xs h-8 gap-1 text-muted-foreground hover:text-primary"
            onClick={() => onAskAI(match)}
            title={t('matches_ask_ai_title')}
          >
            <Bot className="h-3 w-3" />
            <span className="hidden md:inline">{t('matches_why')}</span>
          </Button>
          {match.status !== 'UNLOCKED' ? (
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-8 px-4 text-xs gap-1.5"
              onClick={() => onUnlock(match)}
              disabled={unlocking}
            >
              {unlocking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
              <span dir="ltr">{t('matches_unlock_btn')} · {match.unlock_price_credits.toFixed(2)} CR</span>
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="border border-border text-xs h-8 gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => onChat(match)}
                title={t('matches_chat_title')}
              >
                <MessageSquare className="h-3 w-3" />
                <span className="hidden md:inline">{t('matches_chat_btn')}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="border border-border text-xs h-8 gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => onRequestViewing(match)}
                title={t('matches_viewing_title')}
              >
                <CalendarDays className="h-3 w-3" />
                <span className="hidden md:inline">{t('matches_viewing_btn')}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="border border-border text-xs h-8 gap-1.5"
                onClick={() => onUnlock(match)}
              >
                <ChevronRight className="h-3 w-3" />
                <span className="hidden md:inline">{t('matches_details_btn')}</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UnlockedMatchDialog({
  match,
  unlock,
  onClose,
}: {
  match: Match;
  unlock: MatchUnlock;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const cfg = STRENGTH_CONFIG[match.signal_strength] ?? STRENGTH_CONFIG.POTENTIAL;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border overflow-y-auto max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlock className="h-4 w-4 text-primary" />
            {t('matches_unlocked_dialog_title')}
          </DialogTitle>
          <DialogDescription>
            <span className={`font-medium ${cfg.color}`}>{t(cfg.labelKey)}</span>
            {' · '}{t('matches_score')}: {Math.round(match.match_score)}%
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Full signal text */}
          {unlock.full_signal_text && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_full_signal')}</p>
              <div className="rounded-lg bg-secondary/50 border border-border p-3">
                <p className="text-sm text-foreground whitespace-pre-wrap">{unlock.full_signal_text}</p>
              </div>
            </div>
          )}

          {/* Translation */}
          {unlock.full_intent_json?.translated_text && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_translation')}</p>
              <p className="text-sm text-muted-foreground italic">{unlock.full_intent_json.translated_text}</p>
            </div>
          )}

          {/* Intent details */}
          {unlock.full_intent_json && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_intent_details')}</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  [t('matches_intent_label'), unlock.full_intent_json.intent_type],
                  [t('matches_city'), unlock.full_intent_json.city],
                  [t('matches_district_label'), unlock.full_intent_json.district],
                  [t('matches_transaction_label'), unlock.full_intent_json.transaction_type],
                  [t('matches_types_label'), unlock.full_intent_json.property_types?.join(', ')],
                  [t('matches_budget'), unlock.full_intent_json.budget_min || unlock.full_intent_json.budget_max
                    ? `${unlock.full_intent_json.currency ?? '$'}${Number(unlock.full_intent_json.budget_min ?? 0).toLocaleString()}–${Number(unlock.full_intent_json.budget_max ?? 0).toLocaleString()}`
                    : null],
                  [t('matches_bedrooms'), unlock.full_intent_json.bedrooms_min != null
                    ? `${unlock.full_intent_json.bedrooms_min}+`
                    : null],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={String(k)} className="rounded-lg bg-secondary/30 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{k}</p>
                    <p className="text-sm text-foreground font-medium">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Match reasons */}
          {match.match_reasons?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_reasons')}</p>
              <div className="flex flex-wrap gap-1.5">
                {match.match_reasons.map((r, i) => (
                  <span key={i} className="text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            {unlock.full_source_url && (
              <Button
                variant="ghost"
                size="sm"
                className="border border-border gap-1.5 text-sm h-8"
                onClick={() => window.open(unlock.full_source_url!, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('matches_full_source')}
              </Button>
            )}
            {unlock.full_profile_url && (
              <Button
                variant="ghost"
                size="sm"
                className="border border-border gap-1.5 text-sm h-8"
                onClick={() => window.open(unlock.full_profile_url!, '_blank')}
              >
                <User className="h-3.5 w-3.5" />
                {t('matches_full_profile')}
              </Button>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground/50">
            {t('matches_charged_credits', { credits: String(unlock.credits_charged) })} · {t('matches_unlocked_on', { date: new Date(unlock.created_at).toLocaleString() })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────

function MatchesContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const { id: propertyId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ total: 0, newCount: 0, strongCount: 0 });
  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(null);
  const [filter, setFilter] = useState<'all' | 'new' | 'strong' | 'unlocked'>('all');

  // Unlock flow
  const [pendingUnlock, setPendingUnlock] = useState<Match | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState<{ msg: string; code?: string } | null>(null);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  // External contact unlock (Phase 3)
  const [externalUnlockMatch, setExternalUnlockMatch] = useState<Match | null>(null);

  // Reveal dialog
  const [revealMatch, setRevealMatch] = useState<{ match: Match; unlock: MatchUnlock } | null>(null);

  // Campaign
  const [campaignActive, setCampaignActive] = useState(false);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!propertyId || !homatchUser) return;
    setLoading(true);
    const [matchData, countData, credits] = await Promise.all([
      getMatches(propertyId),
      getMatchCounts(propertyId),
      getCreditAccount(homatchUser.id),
    ]);
    setMatches(matchData);
    setCounts(countData);
    setCreditAccount(credits);
    // Detect campaign status from match data
    setCampaignActive(matchData.some(m => m.status !== 'ARCHIVED'));
    setLoading(false);
  }, [propertyId, homatchUser]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredMatches = matches.filter(m => {
    if (filter === 'new') return m.status === 'NEW';
    if (filter === 'strong') return ['STRONG', 'VERY_STRONG', 'EXCEPTIONAL'].includes(m.signal_strength);
    if (filter === 'unlocked') return m.status === 'UNLOCKED';
    return m.status !== 'REJECTED';
  });

  const handleUnlockClick = async (match: Match) => {
    // External signals → Phase 3 ExternalContactUnlockModal
    if (match.is_external && !match.is_homatch_user) {
      setExternalUnlockMatch(match);
      return;
    }
    if (match.status === 'UNLOCKED') {
      // Load existing unlock and reveal
      const existing = await getUnlockedMatch(match.id);
      if (existing) {
        setRevealMatch({ match, unlock: existing });
      }
      return;
    }
    setPendingUnlock(match);
    setUnlockError(null);
    setShowUnlockConfirm(true);
    if (match.status === 'NEW') {
      await markMatchPreviewed(match.id);
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: 'PREVIEWED' } : m));
    }
  };

  const handleConfirmUnlock = async () => {
    if (!pendingUnlock) return;
    setUnlockLoading(true);
    setUnlockError(null);

    const result = await unlockMatch(pendingUnlock.id);
    setUnlockLoading(false);

    if (!result.success) {
      setUnlockError({ msg: result.error ?? t('matches_unlock_failed'), code: result.errorCode });
      if (result.errorCode === 'INSUFFICIENT_CREDITS') {
        setShowUnlockConfirm(false);
      }
      return;
    }

    setShowUnlockConfirm(false);
    setMatches(prev => prev.map(m => m.id === pendingUnlock.id ? { ...m, status: 'UNLOCKED' } : m));
    if (result.newBalance !== undefined) {
      setCreditAccount(prev => prev ? { ...prev, balance: result.newBalance! } : prev);
    }
    toast.success(t('matches_toast_unlocked'));

    // Open reveal dialog
    if (result.unlock) {
      setRevealMatch({ match: { ...pendingUnlock, status: 'UNLOCKED' }, unlock: result.unlock });
    }
    setPendingUnlock(null);
  };

  // AI match explanation handler. The prompt text itself is sent to the AI
  // and shown in the chat UI, so it's built from translated fragments —
  // never hardcoded English — using the user's currently selected locale.
  const handleAskAI = useCallback((match: Match) => {
    const reasons = match.match_reasons?.join(', ') || t('matches_ai_reasons_fallback');
    const strengthCfg = STRENGTH_CONFIG[match.signal_strength] ?? STRENGTH_CONFIG.POTENTIAL;
    const strengthLabel = t(strengthCfg.labelKey);
    const cityPart = match.preview_city ? t('matches_ai_prompt_in_city', { city: match.preview_city }) : '';
    const budgetPart = match.preview_budget_min || match.preview_budget_max
      ? t('matches_ai_prompt_with_budget', { budget: `${match.preview_currency ?? '$'}${Number(match.preview_budget_min ?? 0).toLocaleString()}–${Number(match.preview_budget_max ?? 0).toLocaleString()}` })
      : '';
    const platformPart = match.preview_platform ? t('matches_ai_prompt_from_platform', { platform: match.preview_platform }) : '';
    navigate('/ai', {
      state: {
        context: {
          type: 'match',
          data: {
            match_id: match.id,
            match_score: match.match_score,
            signal_strength: match.signal_strength,
            match_reasons: match.match_reasons,
            mismatch_reasons: match.mismatch_reasons,
            preview_city: match.preview_city,
            preview_budget_min: match.preview_budget_min,
            preview_budget_max: match.preview_budget_max,
            preview_currency: match.preview_currency,
            preview_language: match.preview_language,
            preview_platform: match.preview_platform,
            intent_confidence: match.intent_confidence,
          },
        },
        prompt: t('matches_ai_prompt_base', {
          score: String(Math.round(match.match_score)),
          strength: strengthLabel,
          extra: `${cityPart}${budgetPart}${platformPart}`,
          reasons,
          strengthLower: strengthLabel.toLowerCase(),
        }),
      },
    });
  }, [navigate, t]);

  // Start chat with unlocked match buyer
  const handleChat = useCallback((match: Match) => {
    navigate('/chat', {
      state: {
        prefill: {
          platform: match.preview_platform,
          matchId: match.id,
          propertyId,
          matchScore: match.match_score,
        },
      },
    });
  }, [navigate, propertyId]);

  // Request viewing from a match
  const handleRequestViewing = useCallback((match: Match) => {
    navigate('/viewings', {
      state: {
        openNew: true,
        preselectedPropertyId: propertyId,
        matchContext: { matchId: match.id, matchScore: match.match_score },
      },
    });
  }, [navigate, propertyId]);

  // Start matching campaign
  const handleStartMatching = async () => {
    if (!propertyId || !homatchUser) return;
    setCampaignLoading(true);
    try {
      const result = await startMatchingCampaign(propertyId, homatchUser.id);
      if (!result?.jobId) throw new Error('No job ID returned from match-campaign');
      setCampaignActive(true);
      setActiveJobId(result.jobId);
      toast.success(t('matches_campaign_started_toast'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('matches_start_failed'));
    } finally {
      setCampaignLoading(false);
    }
  };

  const handlePauseMatching = async () => {
    if (!propertyId || !homatchUser) return;
    setCampaignLoading(true);
    await pauseMatchingCampaign(propertyId, homatchUser.id);
    setCampaignActive(false);
    setCampaignLoading(false);
    setShowPauseConfirm(false);
    toast.success(t('matches_paused_toast'));
  };

  const balance = Number(creditAccount?.balance ?? 0);
  const unlockPrice = pendingUnlock?.unlock_price_credits ?? 0;
  const balanceAfter = balance - unlockPrice;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('matches_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('matches_header_summary', { total: String(counts.total), new: String(counts.newCount), strong: String(counts.strongCount) })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Credits balance chip */}
            <button
              onClick={() => navigate('/credits')}
              className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-3 py-1 hover:bg-primary/20 transition-colors"
            >
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary">{balance.toFixed(2)} CR</span>
            </button>
            {/* Campaign toggle */}
            {campaignActive ? (
              <Button
                size="sm"
                variant="ghost"
                className="border border-border text-xs h-8 gap-1.5 text-muted-foreground"
                onClick={() => setShowPauseConfirm(true)}
                disabled={campaignLoading}
              >
                {campaignLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                <span className="hidden md:inline">{t('matches_pause_matching')}</span>
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-8 gap-1.5 font-semibold"
                onClick={handleStartMatching}
                disabled={campaignLoading}
              >
                {campaignLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                {t('matches_start_matching')}
              </Button>
            )}
          </div>
        </div>

        {/* Campaign status banner */}
        {campaignActive && (
          <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-primary font-medium">{t('matches_matching_active')}</span>
            <span className="text-xs text-muted-foreground ml-auto hidden md:block">{t('matches_start_desc')}</span>
          </div>
        )}

        {/* Live job progress panel */}
        {activeJobId && (
          <MatchingJobProgress
            jobId={activeJobId}
            propertyId={propertyId}
            onComplete={(job) => {
              if (job.matches_created > 0) {
                toast.success(t('matches_job_complete_toast', { count: String(job.matches_created) }));
                loadData();
              } else if (job.status === 'partially_completed') {
                toast.warning(t('matches_job_partial_toast'));
              }
            }}
          />
        )}

        {/* Filters */}
        <Tabs value={filter} onValueChange={v => setFilter(v as typeof filter)}>
          <TabsList className="bg-secondary">
            <TabsTrigger value="all">{t('matches_filter_all')} ({counts.total})</TabsTrigger>
            <TabsTrigger value="new">{t('matches_filter_new')} ({counts.newCount})</TabsTrigger>
            <TabsTrigger value="strong">{t('matches_filter_strong')} ({counts.strongCount})</TabsTrigger>
            <TabsTrigger value="unlocked">{t('matches_filter_unlocked')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Surface relevant communities to post the property in, with AI-drafted, translated post copy */}
        {propertyId && <CommunityOutreachPanel propertyId={propertyId} />}

        {/* Broaden the search: outbound links to major Georgian real-estate sites */}
        <ExternalSitesCard propertyId={propertyId} />

        {/* Match list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 animate-pulse">
                <div className="h-4 bg-muted rounded w-1/3 mb-3" />
                <div className="h-3 bg-muted rounded w-2/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredMatches.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{t('matches_empty')}</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">{t('matches_empty_desc')}</p>
              {!campaignActive && (
                <Button
                  className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleStartMatching}
                >
                  <Play className="h-4 w-4 mr-2" />
                  {t('matches_start_matching')}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredMatches.map(m => (
              <LockedMatchCard
                key={m.id}
                match={m}
                onUnlock={handleUnlockClick}
                unlocking={unlockLoading && pendingUnlock?.id === m.id}
                onAskAI={handleAskAI}
                onChat={handleChat}
                onRequestViewing={handleRequestViewing}
              />
            ))}
          </div>
        )}
      </div>

      {/* Unlock Confirmation Dialog */}
      {showUnlockConfirm && pendingUnlock && (
        <Dialog open onOpenChange={open => { if (!open) { setShowUnlockConfirm(false); setPendingUnlock(null); } }}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Unlock className="h-4 w-4 text-primary" />
                {t('matches_unlock_confirm')}
              </DialogTitle>
              <DialogDescription>
                {t('matches_unlock_confirm_desc').replace('{credits}', pendingUnlock.unlock_price_credits.toFixed(2))}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="rounded-lg bg-secondary/50 border border-border p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('matches_current_balance')}</span>
                  <span className="font-medium text-foreground" dir="ltr">{balance.toFixed(2)} CR</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('matches_unlock_price')}</span>
                  <span className="font-medium text-destructive" dir="ltr">−{unlockPrice.toFixed(2)} CR</span>
                </div>
                <div className="border-t border-border pt-1.5 flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('credits_balance_after')}</span>
                  <span className={`font-semibold ${balanceAfter < 0 ? 'text-destructive' : 'text-foreground'}`} dir="ltr">
                    {balanceAfter.toFixed(2)} CR
                  </span>
                </div>
              </div>
              {unlockError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{unlockError.msg}</p>
                </div>
              )}
              {balanceAfter < 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-destructive font-medium">{t('matches_insufficient_credits')}</p>
                    <p className="text-xs text-destructive/80 mt-0.5">
                      {t('matches_insufficient_desc')
                        .replace('{required}', unlockPrice.toFixed(2))}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                className="border border-border"
                onClick={() => { setShowUnlockConfirm(false); setPendingUnlock(null); }}
              >
                {t('general_cancel')}
              </Button>
              {balanceAfter < 0 ? (
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => navigate('/credits')}
                >
                  <Zap className="h-4 w-4 mr-1.5" />
                  {t('matches_topup_btn')}
                </Button>
              ) : (
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleConfirmUnlock}
                  disabled={unlockLoading}
                >
                  {unlockLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Unlock className="h-4 w-4 mr-1.5" />
                  )}
                  <span dir="ltr">{t('matches_confirm_unlock_btn', { price: unlockPrice.toFixed(2) })}</span>
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Unlocked reveal dialog */}
      {revealMatch && (
        <UnlockedMatchDialog
          match={revealMatch.match}
          unlock={revealMatch.unlock}
          onClose={() => setRevealMatch(null)}
        />
      )}

      {/* External contact unlock modal (Phase 3) */}
      {externalUnlockMatch && (
        <ExternalContactUnlockModal
          open={true}
          matchId={externalUnlockMatch.id}
          creditBalance={Number(creditAccount?.balance ?? 0)}
          onClose={() => setExternalUnlockMatch(null)}
          onUnlocked={() => {
            setMatches(prev =>
              prev.map(m => m.id === externalUnlockMatch!.id ? { ...m, status: 'UNLOCKED' } : m)
            );
            setExternalUnlockMatch(null);
            toast.success(t('matches_toast_contact_unlocked'));
          }}
        />
      )}

      {/* Pause confirm */}
      <AlertDialog open={showPauseConfirm} onOpenChange={setShowPauseConfirm}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('matches_pause_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('matches_pause_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">{t('general_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handlePauseMatching} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('matches_pause_campaign_btn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

export default function MatchesPage() {
  return (
    <RouteGuard>
      <MatchesContent />
    </RouteGuard>
  );
}
