// HOMATCH — Agents.
//
// §10. An agent is presented as a reusable real-estate worker, not as a
// configuration object. The list answers: what do I have, is it ready, what is
// using it, and is it any good.
//
// §106 decides what is NOT here. No model name, no endpointing threshold, no
// provider, no orchestration setting. A real-estate professional chooses a
// purpose, a voice and a language; which vendor serves that voice is resolved
// at call time from admin routing and is none of their business.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Copy, MoreHorizontal, Pause, Play, Plus, Search, Archive, Mic } from 'lucide-react';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  PageHeader, LoadingBlock, EmptyState, ErrorState, StatusBadge, relativeTime,
} from '@/components/communications/primitives';
import { listAgents, createAgent, updateAgent, archiveAgent } from '@/services/communications';
import type { AgentListRow } from '@/types/communications';
import { AGENT_TEMPLATES, type AgentTemplate } from '@/lib/comm/vocabulary';
import { cn } from '@/lib/utils';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/** §11 step 1. Every one of these is a real-estate job, which is why the domain gate treats them as structural evidence. */
const TEMPLATE_ICONS: Record<string, string> = {
  BUYER_QUALIFICATION: '🏠', SELLER_QUALIFICATION: '🔑', PROPERTY_FOLLOWUP: '📋',
  VIEWING_CONFIRMATION: '📅', COLD_REACTIVATION: '🔄', DEVELOPER_SALES: '🏗️',
  RENTAL_INQUIRY: '🗝️', MORTGAGE_FOLLOWUP: '🏦', INVESTOR_QUALIFICATION: '📈', CUSTOM: '✨',
};

export default function AgentsPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();

  const [agents, setAgents] = useState<AgentListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAgents(await listAgents());
    } catch {
      setError('comm_agents_load_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => agents.filter((a) => {
    if (status !== 'ALL' && a.status !== status) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return a.name.toLowerCase().includes(q) || (a.purpose ?? '').toLowerCase().includes(q);
  }), [agents, search, status]);

  const onCreate = useCallback(async (template: AgentTemplate, name: string) => {
    setBusy(true);
    try {
      const agent = await createAgent({
        name: name.trim() || t('comm_agent_untitled'),
        template_code: template,
        languages: ['ka'],
        channels: ['AI_CALL'],
      });
      if (!agent) { toast.error(t('comm_agent_create_failed')); return; }
      setCreating(false);
      navigate(`/outreach/agents/${agent.id}`);
    } finally {
      setBusy(false);
    }
  }, [navigate, t]);

  const onToggle = useCallback(async (agent: AgentListRow) => {
    const next = agent.status === 'PAUSED' ? 'READY' : 'PAUSED';
    const ok = await updateAgent(agent.id, { status: next });
    if (ok) { toast.success(t(next === 'PAUSED' ? 'comm_agent_paused' : 'comm_agent_resumed')); void load(); }
    else toast.error(t('comm_save_failed'));
  }, [load, t]);

  const onDuplicate = useCallback(async (agent: AgentListRow) => {
    const copy = await createAgent({
      ...agent,
      name: `${agent.name} (${t('comm_copy')})`,
      status: 'DRAFT',
    });
    if (copy) { toast.success(t('comm_agent_duplicated')); void load(); }
    else toast.error(t('comm_save_failed'));
  }, [load, t]);

  const onArchive = useCallback(async (agent: AgentListRow) => {
    // Archive, not delete: a deleted agent orphans every transcript recorded
    // under it, and §104 requires historical records to stay readable.
    const ok = await archiveAgent(agent.id);
    if (ok) { toast.success(t('comm_agent_archived')); void load(); }
    else toast.error(t('comm_save_failed'));
  }, [load, t]);

  return (
    <CommsWorkspace product="calls">
        <div className="space-y-4">
          <PageHeader
            eyebrow={t('comms_nav_calls')}
            title={t('comm_agents_title')}
            subtitle={t('comm_agents_subtitle')}
            primary={{ label: t('comm_create_agent'), onClick: () => setCreating(true) }}
          />

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {!loading && agents.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('comm_agents_search')}
                  aria-label={t('comm_agents_search')}
                  className="h-8 ps-8 text-xs"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 w-[140px] text-xs" aria-label={t('comm_col_status')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('comm_filter_all')}</SelectItem>
                  <SelectItem value="DRAFT">{t('comm_status_draft')}</SelectItem>
                  <SelectItem value="READY">{t('comm_status_ready')}</SelectItem>
                  <SelectItem value="PAUSED">{t('comm_status_paused')}</SelectItem>
                  <SelectItem value="NEEDS_ATTENTION">{t('comm_status_needs_attention')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {loading ? <LoadingBlock rows={3} /> : !agents.length ? (
            <EmptyState
              icon={Bot}
              titleKey="comm_agents_empty"
              bodyKey="comm_agents_empty_body"
              action={{ labelKey: 'comm_create_agent', onClick: () => setCreating(true) }}
            />
          ) : !filtered.length ? (
            <EmptyState icon={Search} titleKey="comm_no_matches" />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {filtered.map((agent) => (
                <li key={agent.id}>
                  <Card className="h-full transition-colors hover:border-foreground/20">
                    <CardContent className="p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-start"
                          onClick={() => navigate(`/outreach/agents/${agent.id}`)}
                        >
                          <span className="flex items-center gap-2">
                            <span aria-hidden="true">{TEMPLATE_ICONS[agent.template_code] ?? '✨'}</span>
                            <span className="truncate text-sm font-medium">{agent.name}</span>
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                            {agent.purpose || t('comm_agent_no_purpose')}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <StatusBadge status={agent.status} />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('comm_actions')}>
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/outreach/agents/${agent.id}`)}>
                                {t('comm_open')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/outreach/agents/${agent.id}?step=test`)}>
                                <Mic className="me-2 h-3.5 w-3.5" />{t('comm_agent_test')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void onDuplicate(agent)}>
                                <Copy className="me-2 h-3.5 w-3.5" />{t('comm_duplicate')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void onToggle(agent)}>
                                {agent.status === 'PAUSED'
                                  ? <><Play className="me-2 h-3.5 w-3.5" />{t('comm_resume')}</>
                                  : <><Pause className="me-2 h-3.5 w-3.5" />{t('comm_pause')}</>}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void onArchive(agent)}>
                                <Archive className="me-2 h-3.5 w-3.5" />{t('comm_archive')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {agent.languages.slice(0, 4).map((l) => (
                          <Badge key={l} variant="outline" className="text-[13px] uppercase">{l}</Badge>
                        ))}
                        {agent.voice_label ? (
                          <Badge variant="outline" className="text-[13px]">
                            <Mic className="me-1 h-2.5 w-2.5" aria-hidden="true" />{agent.voice_label}
                          </Badge>
                        ) : null}
                      </div>

                      <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-2.5 text-[13px]">
                        <div>
                          <dt className="text-muted-foreground">{t('comm_agent_campaigns')}</dt>
                          <dd className="font-medium tabular-nums">{agent.campaignCount}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t('comm_agent_interactions')}</dt>
                          <dd className="font-medium tabular-nums">{agent.interactionCount}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t('comm_agent_qualified')}</dt>
                          <dd className={cn('font-medium tabular-nums', agent.qualifiedCount > 0 && 'text-gold-ink')}>
                            {agent.qualifiedCount}
                          </dd>
                        </div>
                      </dl>

                      <p className="mt-2 text-[13px] text-muted-foreground">
                        {t('comm_agent_updated')} {relativeTime(agent.updated_at, language)}
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>

        <CreateAgentDialog open={creating} onOpenChange={setCreating} onCreate={onCreate} busy={busy} />
    </CommsWorkspace>
  );
}

/** §11 step 1: choose a starting point. Nine real-estate jobs, plus Custom. */
function CreateAgentDialog({
  open, onOpenChange, onCreate, busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (template: AgentTemplate, name: string) => void;
  busy: boolean;
}) {
  const { t } = useLanguage();
  const [template, setTemplate] = useState<AgentTemplate>('BUYER_QUALIFICATION');
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) { setTemplate('BUYER_QUALIFICATION'); setName(''); }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('comm_create_agent')}</DialogTitle>
          <DialogDescription className="text-xs">{t('comm_agent_template_help')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('comm_agent_template')}</Label>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {AGENT_TEMPLATES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setTemplate(code)}
                  aria-pressed={template === code}
                  className={cn(
                    'flex items-center gap-2 rounded-md border p-2 text-start text-xs transition-colors',
                    template === code ? 'border-gold bg-gold/[0.06]' : 'hover:border-foreground/20',
                  )}
                >
                  <span aria-hidden="true">{TEMPLATE_ICONS[code]}</span>
                  <span className="truncate">{t(`comm_template_${code.toLowerCase()}` as TKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="agent-name" className="text-xs">{t('comm_agent_name')}</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('comm_agent_name_placeholder')}
              className="mt-1.5 h-8 text-xs"
              maxLength={80}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('comm_cancel')}</Button>
          <Button size="sm" disabled={busy} onClick={() => onCreate(template, name)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />{t('comm_continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
