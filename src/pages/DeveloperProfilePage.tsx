import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  ArrowLeft, ExternalLink, Shield, AlertTriangle, CheckCircle,
  Building2, Calendar, Hash, Globe, Star, Info,
} from 'lucide-react';
import { getDeveloperProfile } from '@/services/api3';
import type { DeveloperProfile, DeveloperProject } from '@/types/phase3';

// ── Score Ring ────────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const color = score >= 75 ? '#4ade80' : score >= 50 ? '#F5A623' : '#ef4444';
  const radius = 40;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="104" height="104" className="-rotate-90">
        <circle cx="52" cy="52" r={radius} fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" />
        <circle
          cx="52" cy="52" r={radius} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <span className="text-2xl font-bold text-foreground">{score}</span>
        <span className="text-xs text-muted-foreground block -mt-1">/100</span>
      </div>
    </div>
  );
}

// ── Project Row ───────────────────────────────────────────────
function ProjectRow({ project }: { project: DeveloperProject }) {
  const { t } = useLanguage();
  const statusColors: Record<string, string> = {
    COMPLETED: 'text-green-400 bg-green-400/10 border-green-400/30',
    ACTIVE: 'text-primary bg-primary/10 border-primary/30',
    CANCELLED: 'text-muted-foreground bg-secondary border-border',
  };
  const cls = statusColors[project.status] ?? statusColors.CANCELLED;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{project.name}</p>
        <p className="text-xs text-muted-foreground">
          {[project.city, project.units ? `${project.units} ${t('dev_units')}` : '', project.floors ? `${project.floors} ${t('dev_floors')}` : '', project.completion_year ? `${project.completion_year}` : ''].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {project.commissioned && (
          <Badge className="text-[10px] h-4 px-1 bg-green-500/15 text-green-400 border-green-500/30 border">
            <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> {t('dev_commissioned')}
          </Badge>
        )}
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${cls}`}>{project.status}</span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function DeveloperProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [dev, setDev] = useState<DeveloperProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [wasStale, setWasStale] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getDeveloperProfile(id)
      .then(d => {
        setDev(d);
        if (d && 'was_stale' in d) setWasStale((d as DeveloperProfile & { was_stale: boolean }).was_stale);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <RouteGuard>
        <AppLayout>
          <div className="max-w-2xl mx-auto space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </AppLayout>
      </RouteGuard>
    );
  }

  if (!dev) {
    return (
      <RouteGuard>
        <AppLayout>
          <div className="max-w-2xl mx-auto text-center py-16">
            <Building2 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">{t('developer_not_found')}</p>
            <Button variant="secondary" className="mt-4" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> {t('dev_go_back')}
            </Button>
          </div>
        </AppLayout>
      </RouteGuard>
    );
  }

  const scoreColor = dev.score >= 75 ? 'text-green-400' : dev.score >= 50 ? 'text-primary' : 'text-red-400';
  const riskItems = Array.isArray(dev.public_risk_evidence) ? dev.public_risk_evidence as { title?: string; summary?: string; url?: string }[] : [];
  const breakdown = dev.score_breakdown as Record<string, number | boolean | null | undefined>;

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Back + title */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-foreground truncate">{dev.name}</h1>
              <p className="text-xs text-muted-foreground">
                {[dev.city, dev.country].filter(Boolean).join(', ')}
              </p>
            </div>
            {dev.is_sponsored && (
              <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground border-border">
                <Star className="h-3 w-3 mr-1" />{t('developer_sponsored')}
              </Badge>
            )}
          </div>

          {dev.is_sponsored && (
            <div className="text-xs text-muted-foreground bg-secondary/50 border border-border rounded-lg px-3 py-2 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              {t('developer_sponsored_note')}
            </div>
          )}

          {wasStale && (
            <div className="text-xs text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              {t('developer_stale_note')}
            </div>
          )}

          {/* Score card */}
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-center gap-6 flex-wrap">
                <ScoreRing score={dev.score} />
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('developer_score')}</p>
                    <p className={`text-2xl font-bold ${scoreColor}`}>{dev.score}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: t('developer_completed'), value: dev.completed_projects },
                      { label: t('developer_active'), value: dev.active_projects },
                      { label: t('developer_years'), value: dev.years_active ?? '—' },
                    ].map(item => (
                      <div key={item.label} className="text-center p-2 bg-secondary rounded-lg">
                        <p className="text-base font-bold text-foreground">{item.value}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{item.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Score breakdown */}
          {breakdown && Object.keys(breakdown).length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t('developer_score_breakdown')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: 'completed_projects', label: t('dev_completed_projects'), max: 5, value: Number(breakdown.completed_projects ?? 0) },
                  { key: 'commissioned', label: t('dev_commissioned_projects'), max: 5, value: Number(breakdown.commissioned ?? 0) },
                ].map(item => (
                  <div key={item.key}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium text-foreground">{item.value}</span>
                    </div>
                    <Progress value={Math.min((item.value / item.max) * 100, 100)} className="h-1.5" />
                  </div>
                ))}
                {breakdown.has_restrictions && (
                  <div className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-2 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {t('developer_has_restrictions_note')}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Risk indicators */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                {t('developer_risk_title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {riskItems.length === 0
                ? (
                  <div className="flex items-center gap-2 text-sm text-green-400">
                    <CheckCircle className="h-4 w-4" />
                    {t('developer_no_risk')}
                  </div>
                )
                : (
                  <div className="space-y-2">
                    {riskItems.map((risk, i) => (
                      <div key={i} className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            {risk.title && <p className="text-sm font-medium text-foreground">{risk.title}</p>}
                            {risk.summary && <p className="text-xs text-muted-foreground mt-0.5">{risk.summary}</p>}
                            {risk.url && (
                              <a href={risk.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 mt-1 hover:underline">
                                {t('matches_full_source')} <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }
              <p className="text-[10px] text-muted-foreground mt-3 border-t border-border pt-3">
                {t('trust_disclaimer')}
              </p>
            </CardContent>
          </Card>

          {/* Projects */}
          {dev.projects && dev.projects.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  {t('developer_projects')} ({dev.projects.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="px-4 pb-2">
                  {dev.projects.map(p => <ProjectRow key={p.id} project={p} />)}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Meta */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pb-4">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {t('developer_last_checked')}: {new Date(dev.last_checked_at).toLocaleDateString()}
            </span>
            {dev.website && (
              <a href={dev.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                <Globe className="h-3 w-3" /> {t('developer_website')}
              </a>
            )}
          </div>
        </div>
      </AppLayout>
    </RouteGuard>
  );
}
