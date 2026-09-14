// HOMATCH — the Agent builder, and Voice Studio.
//
// §11's bar: "A non-technical real-estate agent must be able to create a
// professional AI agent." So the seven steps are seven plain questions, and
// §106's forbidden list is absent — no model name, no endpointing millisecond,
// no provider, no fallback order. Those are Admin's, and the agent works
// without their owner ever hearing of them.
//
// THE TWO STEPS THAT ARE NOT FORM FIELDS
//
// Voice (§12) is a catalogue of voices with a live test, not a dropdown of
// identifiers. Test (§11 step 6) opens a real conversation with the real
// assembled prompt, before the agent is allowed to be READY — because an agent
// nobody has ever heard is an agent nobody should point at 2,000 strangers.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, Loader2, Mic, Mic2, MicOff, Sparkles, Play, Square,
  Bot, MessageSquareText, BookOpen, AudioLines, ClipboardCheck,
} from 'lucide-react';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { AddVoiceDialog } from '@/components/communications/AddVoiceDialog';
import { useAssistantContext } from '@/components/assistant/AssistantContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { PhoneTestCard } from '@/components/communications/PhoneTestCard';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  LoadingBlock, ErrorState, StatusBadge, PageHeader,
} from '@/components/communications/primitives';
import {
  getAgent, updateAgent, generateAgentCopy, publishAgent, previewAgent,
  requestAgentTestGrant, runAgentTestTurn, listVoices, previewVoice, listMyVoices, deleteCustomVoice,
  type PickableVoice,
  runAgentTranscribe,
} from '@/services/communications';
import type { CommAgent } from '@/types/communications';
import type { VoiceSession, VoiceState, VoiceMilestone } from '@/lib/comm/voiceClient';
import type { TranscriptTurn } from '@/lib/comm/transcript';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

const STEPS = [
  { id: 'identity',  icon: Bot,             labelKey: 'comm_step_identity' },
  { id: 'behavior',  icon: MessageSquareText, labelKey: 'comm_step_behavior' },
  { id: 'knowledge', icon: BookOpen,        labelKey: 'comm_step_knowledge' },
  { id: 'voice',     icon: AudioLines,      labelKey: 'comm_step_voice' },
  { id: 'test',      icon: Mic,             labelKey: 'comm_step_test' },
  { id: 'review',    icon: ClipboardCheck,  labelKey: 'comm_step_review' },
] as const;

const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
const TONES = ['PROFESSIONAL', 'WARM', 'DIRECT', 'FORMAL'] as const;

export default function AgentBuilderPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();

  const [agent, setAgent] = useState<CommAgent | null>(null);
  const [draft, setDraft] = useState<Partial<CommAgent>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [rough, setRough] = useState('');
  const [preview, setPreview] = useState<{ summary: Record<string, unknown>; systemPrompt: string } | null>(null);
  const [hasTested, setHasTested] = useState(false);
  const [published, setPublished] = useState(false);

  const step = (params.get('step') ?? 'identity') as typeof STEPS[number]['id'];
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.id === step));

  /*
   * Tell the assistant what this page is, so "what should I write here?" has
   * something to answer about — and so its answer has somewhere to go.
   *
   * Only the wizard's own state travels: which step, which template, how many
   * languages. No contact, no transcript, no credential.
   */
  const patchRef = useRef<(p: Partial<CommAgent>) => void>(() => {});
  useAssistantContext({
    surface: 'agent-builder',
    title: t('comm_agents_title'),
    step: t(STEPS[stepIndex]?.labelKey as TKey),
    facts: {
      template: draft.template_code ?? null,
      languages: (draft.languages ?? []).join(',') || null,
      hasPurpose: draft.purpose?.trim() ? 'yes' : 'no',
      voiceChosen: draft.voice_id ? 'yes' : 'no',
    },
    fields: [
      { key: 'purpose', label: t('comm_agent_purpose'), apply: (v) => patchRef.current({ purpose: v }) },
      { key: 'introduction', label: t('comm_agent_intro'), apply: (v) => patchRef.current({ introduction: v }) },
    ],
  });

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const a = await getAgent(id);
      if (!a) { setError('comm_agent_not_found'); return; }
      setAgent(a);
      setDraft(a);
    } catch {
      setError('comm_agents_load_failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback((next: Partial<CommAgent>) => {
    setDraft((d) => ({ ...d, ...next }));
  }, []);

  /* The assistant's Insert actions are registered above `patch` exists, so
   * they go through a ref rather than capturing a stale closure. */
  patchRef.current = patch;

  const save = useCallback(async (): Promise<boolean> => {
    if (!id) return false;
    setSaving(true);
    try {
      const ok = await updateAgent(id, draft);
      if (!ok) { toast.error(t('comm_save_failed')); return false; }
      setAgent((a) => (a ? { ...a, ...draft } as CommAgent : a));
      return true;
    } finally {
      setSaving(false);
    }
  }, [id, draft, t]);

  const goTo = useCallback(async (nextStep: string) => {
    // Every step change persists. A wizard that loses six fields because
    // somebody pressed Back is a wizard people stop trusting.
    await save();
    setParams({ step: nextStep }, { replace: true });
  }, [save, setParams]);

  const onGenerate = useCallback(async () => {
    if (rough.trim().length < 8) { toast.error(t('comm_generate_too_short')); return; }
    setGenerating(true);
    try {
      const result = await generateAgentCopy({
        rough,
        template: draft.template_code ?? 'CUSTOM',
        languages: draft.languages ?? ['ka'],
        locale: language,
      });
      if (!result.ok) {
        // §6's boundary, surfaced as product copy rather than an error code.
        const code = result.error;
        toast.error(t(code === 'OUT_OF_SCOPE' ? 'comm_generate_out_of_scope'
          : code === 'GENERATION_UNAVAILABLE' ? 'comm_generate_unavailable'
          : 'comm_generate_failed'));
        return;
      }
      /*
       * GENERATION MUST NOT QUIETLY EAT WHAT SOMEBODY WROTE.
       *
       * This used to patch straight over purpose, introduction, goal and
       * questions. If the customer had already written a purpose and then
       * pressed Generate to improve one OTHER field, their sentence was gone
       * with nothing to bring it back.
       *
       * The replacement still happens — that is what the button is for — but
       * it is announced when it destroyed something, and it is reversible.
       */
      const previous = {
        purpose: draft.purpose,
        introduction: draft.introduction,
        primary_goal: draft.primary_goal,
        qualification_questions: draft.qualification_questions,
      };
      const replacedSomething = Boolean(
        (result.data.purpose && draft.purpose?.trim())
        || (result.data.introduction && draft.introduction?.trim())
        || (result.data.primaryGoal && draft.primary_goal?.trim())
        || (result.data.questions?.length && draft.qualification_questions?.length),
      );

      patch({
        purpose: result.data.purpose ?? draft.purpose,
        introduction: result.data.introduction ?? draft.introduction,
        primary_goal: result.data.primaryGoal ?? draft.primary_goal,
        qualification_questions: result.data.questions?.length
          ? result.data.questions
          : draft.qualification_questions,
      });

      if (replacedSomething) {
        toast.success(t('comm_generate_done'), {
          description: t('comms_generate_replaced'),
          duration: 12_000,
          action: {
            label: t('comms_generate_undo'),
            onClick: () => { patch(previous); toast.success(t('comms_generate_restored')); },
          },
        });
      } else {
        toast.success(t('comm_generate_done'));
      }
    } finally {
      setGenerating(false);
    }
  }, [rough, draft, language, patch, t]);

  const onPublish = useCallback(async () => {
    if (!id) return;
    setPublishing(true);
    try {
      const saved = await save();
      if (!saved) return;
      const result = await publishAgent(id);
      if (!result.ok) {
        const code = result.error;
        toast.error(t(code === 'OUT_OF_SCOPE' ? 'comm_generate_out_of_scope'
          : code === 'INCOMPLETE' ? 'comm_publish_incomplete'
          : 'comm_publish_failed'));
        return;
      }
      toast.success(t('comm_publish_done').replace('{v}', String(result.data.version)));
      await load();
      /*
       * Publishing used to end at /outreach/agents — a list, with no
       * indication of what the agent was for or what to do with it next. An
       * agent exists in order to call a list of people, and the two things
       * standing between here and that are a test and a campaign. So say so,
       * rather than returning the customer to a table and letting them work it
       * out.
       */
      setPublished(true);
    } finally {
      setPublishing(false);
    }
  }, [id, save, load, navigate, t]);

  useEffect(() => {
    if (step !== 'review' || !id) return;
    void (async () => {
      await save();
      const result = await previewAgent(id);
      if (result.ok) setPreview({ summary: result.data.summary, systemPrompt: result.data.systemPrompt });
    })();
    // `save` changes identity on every draft edit; running this on step change
    // only is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, id]);

  if (loading) {
    return (
      <CommsWorkspace><div><LoadingBlock rows={6} /></div></CommsWorkspace>
    );
  }
  if (error || !agent) {
    return (
      <CommsWorkspace><div>
        <ErrorState messageKey={error ?? 'comm_agent_not_found'} onRetry={() => { setLoading(true); void load(); }} />
      </div></CommsWorkspace>
    );
  }

  return (
    <CommsWorkspace>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/outreach/agents')}>
              <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_agents_title')}
            </Button>
          </div>

          <PageHeader
            title={draft.name || t('comm_agent_untitled')}
            subtitle={t('comm_agent_builder_subtitle')}
          >
            <StatusBadge status={agent.status} />
            {agent.current_version ? (
              <Badge variant="outline" className="text-[13px]">v{agent.current_version}</Badge>
            ) : null}
          </PageHeader>

          <StepRail steps={STEPS} current={stepIndex} onSelect={(s) => void goTo(s)} />

          {step === 'identity' ? (
            <IdentityStep
              draft={draft} patch={patch} rough={rough} setRough={setRough}
              onGenerate={() => void onGenerate()} generating={generating}
            />
          ) : null}

          {step === 'behavior' ? <BehaviorStep draft={draft} patch={patch} /> : null}
          {step === 'knowledge' ? <KnowledgeStep draft={draft} patch={patch} /> : null}
          {step === 'voice' ? <VoiceStudio draft={draft} patch={patch} /> : null}
          {step === 'test' ? (
            <TestStep agentId={agent.id} onTested={() => setHasTested(true)} tested={hasTested} onSave={save} />
          ) : null}
          {step === 'review' ? <ReviewStep preview={preview} tested={hasTested || Boolean(agent.current_version)} /> : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <Button
              variant="outline" size="sm"
              disabled={stepIndex === 0}
              onClick={() => void goTo(STEPS[Math.max(0, stepIndex - 1)].id)}
            >
              <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_back')}
            </Button>

            <div className="flex items-center gap-2">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
              {step === 'review' ? (
                <Button size="sm" onClick={() => void onPublish()} disabled={publishing}>
                  {publishing ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="me-1.5 h-3.5 w-3.5" />}
                  {t('comm_publish')}
                </Button>
              ) : (
                <Button size="sm" onClick={() => void goTo(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].id)}>
                  {t('comm_continue')}<ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" />
                </Button>
              )}
            </div>
          </div>

          {/* Publishing is not the end of a task, it is the middle of one. */}
          <Dialog open={published} onOpenChange={setPublished}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Check className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  {t('comms_agent_ready_title')}
                </DialogTitle>
                <DialogDescription className="text-[13px] leading-snug [overflow-wrap:anywhere]">
                  {t('comms_agent_ready_body')}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Button
                  className="w-full justify-start gap-2"
                  onClick={() => { setPublished(false); setParams({ step: 'test' }, { replace: true }); }}
                >
                  <Mic className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('comms_next_test')}
                </Button>
                <Button
                  variant="outline" className="w-full justify-start gap-2"
                  onClick={() => navigate(`/outreach/campaigns/new?agent=${id}&channel=AI_CALL`)}
                >
                  <MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('comms_next_campaign')}
                </Button>
                <Button
                  variant="outline" className="w-full justify-start gap-2"
                  onClick={() => navigate('/outreach/contacts')}
                >
                  <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('comms_next_contacts')}
                </Button>
                <Button
                  variant="ghost" size="sm" className="w-full"
                  onClick={() => { setPublished(false); navigate('/outreach/agents'); }}
                >
                  {t('comms_next_later')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
    </CommsWorkspace>
  );
}

function StepRail({
  steps, current, onSelect,
}: {
  steps: readonly { id: string; icon: React.ComponentType<{ className?: string }>; labelKey: string }[];
  current: number;
  onSelect: (id: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <ol className="flex w-full overflow-x-auto rounded-lg border bg-card p-1" role="tablist">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const active = i === current;
        return (
          <li key={s.id} className="min-w-0 flex-1">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(s.id)}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden truncate sm:inline">{t(s.labelKey as TKey)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  labelKey, hintKey, children,
}: { labelKey: string; hintKey?: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t(labelKey as TKey)}</Label>
      {children}
      {hintKey ? <p className="text-[13px] text-muted-foreground">{t(hintKey as TKey)}</p> : null}
    </div>
  );
}

function IdentityStep({
  draft, patch, rough, setRough, onGenerate, generating,
}: {
  draft: Partial<CommAgent>;
  patch: (p: Partial<CommAgent>) => void;
  rough: string;
  setRough: (v: string) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Card><CardContent className="space-y-4 p-4">
      <Field labelKey="comm_agent_name">
        <Input
          value={draft.name ?? ''}
          onChange={(e) => patch({ name: e.target.value })}
          maxLength={80} className="h-9 text-sm"
        />
      </Field>

      <div className="rounded-lg border border-gold/30 bg-gold/[0.04] p-3">
        <Label className="text-xs font-medium">{t('comm_generate_title')}</Label>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t('comm_generate_help')}</p>
        <Textarea
          value={rough}
          onChange={(e) => setRough(e.target.value)}
          placeholder={t('comm_generate_placeholder')}
          rows={2}
          maxLength={600}
          className="mt-2 text-sm"
        />
        <Button size="sm" variant="outline" className="mt-2" onClick={onGenerate} disabled={generating}>
          {generating ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="me-1.5 h-3.5 w-3.5" />}
          {t('comm_generate_button')}
        </Button>
      </div>

      <Field labelKey="comm_agent_purpose" hintKey="comm_agent_purpose_hint">
        <Textarea
          value={draft.purpose ?? ''}
          onChange={(e) => patch({ purpose: e.target.value })}
          rows={3} maxLength={1200} className="text-sm"
        />
      </Field>

      <Field labelKey="comm_agent_languages" hintKey="comm_agent_languages_hint">
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGES.map((l) => {
            const on = (draft.languages ?? []).includes(l);
            return (
              <button
                key={l}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const current = draft.languages ?? [];
                  // The first selected language is the one the agent opens in,
                  // so order is meaningful and deselecting the only one is
                  // refused rather than silently producing a mute agent.
                  const next = on ? current.filter((x) => x !== l) : [...current, l];
                  patch({ languages: next.length ? next : current });
                }}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs uppercase transition-colors',
                  on ? 'border-gold bg-gold/10 text-gold-ink' : 'text-muted-foreground hover:border-foreground/20',
                )}
              >
                {l}
              </button>
            );
          })}
        </div>
      </Field>
    </CardContent></Card>
  );
}

function BehaviorStep({ draft, patch }: { draft: Partial<CommAgent>; patch: (p: Partial<CommAgent>) => void }) {
  const { t } = useLanguage();
  const questions = useMemo(
    () => (Array.isArray(draft.qualification_questions) ? draft.qualification_questions.map(String) : []),
    [draft.qualification_questions],
  );

  return (
    <Card><CardContent className="space-y-4 p-4">
      <Field labelKey="comm_agent_intro" hintKey="comm_agent_intro_hint">
        <Textarea
          value={draft.introduction ?? ''}
          onChange={(e) => patch({ introduction: e.target.value })}
          rows={2} maxLength={600} className="text-sm"
        />
      </Field>

      <Field labelKey="comm_agent_goal">
        <Textarea
          value={draft.primary_goal ?? ''}
          onChange={(e) => patch({ primary_goal: e.target.value })}
          rows={2} maxLength={600} className="text-sm"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field labelKey="comm_agent_audience">
          <Input
            value={draft.target_audience ?? ''}
            onChange={(e) => patch({ target_audience: e.target.value })}
            className="h-9 text-sm" maxLength={200}
          />
        </Field>
        <Field labelKey="comm_agent_tone">
          <Select value={draft.tone ?? 'PROFESSIONAL'} onValueChange={(v) => patch({ tone: v })}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TONES.map((tone) => (
                <SelectItem key={tone} value={tone}>{t(`comm_tone_${tone.toLowerCase()}` as TKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field labelKey="comm_agent_questions" hintKey="comm_agent_questions_hint">
        <div className="space-y-1.5">
          {questions.map((q, i) => (
            <div key={i} className="flex gap-1.5">
              <Input
                value={q}
                onChange={(e) => {
                  const next = [...questions];
                  next[i] = e.target.value;
                  patch({ qualification_questions: next });
                }}
                className="h-8 text-xs" maxLength={240}
              />
              <Button
                variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                aria-label={t('comm_remove')}
                onClick={() => patch({ qualification_questions: questions.filter((_, j) => j !== i) })}
              >
                ×
              </Button>
            </div>
          ))}
          {questions.length < 10 ? (
            <Button
              variant="outline" size="sm"
              onClick={() => patch({ qualification_questions: [...questions, ''] })}
            >
              {t('comm_add_question')}
            </Button>
          ) : null}
        </div>
      </Field>

      <Field labelKey="comm_agent_escalation" hintKey="comm_agent_escalation_hint">
        <Textarea
          value={draft.escalation_instructions ?? ''}
          onChange={(e) => patch({ escalation_instructions: e.target.value })}
          rows={2} maxLength={600} className="text-sm"
        />
      </Field>

      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <Label className="text-xs">{t('comm_agent_disclosure')}</Label>
          {/* §114: the switch exists because disclosure requirements differ by
              jurisdiction. It defaults ON, and the copy says what turning it
              off does rather than presenting it as a neutral preference. */}
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t('comm_agent_disclosure_hint')}</p>
        </div>
        <Switch
          checked={draft.ai_disclosure_enabled !== false}
          onCheckedChange={(v) => patch({ ai_disclosure_enabled: v })}
          aria-label={t('comm_agent_disclosure')}
        />
      </div>
    </CardContent></Card>
  );
}

function KnowledgeStep({ draft, patch }: { draft: Partial<CommAgent>; patch: (p: Partial<CommAgent>) => void }) {
  const { t } = useLanguage();
  return (
    <Card><CardContent className="space-y-4 p-4">
      <Alert>
        <AlertDescription className="text-xs">{t('comm_knowledge_warning')}</AlertDescription>
      </Alert>

      <Field labelKey="comm_agent_context" hintKey="comm_agent_context_hint">
        <Textarea
          value={draft.business_context ?? ''}
          onChange={(e) => patch({ business_context: e.target.value })}
          rows={3} maxLength={2000} className="text-sm"
        />
      </Field>

      <Field labelKey="comm_agent_knowledge" hintKey="comm_agent_knowledge_hint">
        <Textarea
          value={draft.knowledge_notes ?? ''}
          onChange={(e) => patch({ knowledge_notes: e.target.value })}
          rows={8} maxLength={6000} className="font-mono text-xs"
        />
      </Field>
    </CardContent></Card>
  );
}

/**
 * §12's Voice Studio.
 *
 * Voices come from the provider, and only the fields the provider actually
 * supplies are shown. There is deliberately no invented "warm female, 30s"
 * label: §12 forbids inventing demographic characteristics, and a description
 * Homatch made up would be a claim about a person's voice that nobody can
 * stand behind.
 */
/**
 * Play one voice saying one short line.
 *
 * §12 forbids inventing a description of how a speaker sounds, which leaves
 * exactly one honest way to tell a customer what a voice is like: play it.
 *
 * Audio is fetched on first press and replayed from cache afterwards, and only
 * one preview plays at a time — auditioning voices should not turn into three
 * of them talking over each other.
 */
let currentPreview: HTMLAudioElement | null = null;

function VoicePreviewButton({ voiceId, language }: { voiceId: string; language: string }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);

  const stop = useCallback(() => {
    currentPreview?.pause();
    currentPreview = null;
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(async () => {
    if (playing) { stop(); return; }

    setBusy(true);
    let res: Awaited<ReturnType<typeof previewVoice>>;
    try {
      res = await previewVoice(voiceId, language);
    } finally {
      // Busy means "fetching the clip", and the clip has now either arrived or
      // not. It deliberately does NOT cover playback.
      //
      // It used to. play() returns a promise that resolves when playback
      // BEGINS, and on a machine with no usable audio output that promise can
      // simply never settle — so the await never returned, the finally never
      // ran, and the button span for good on audio the server had already
      // delivered and billed for. Nothing after this line is allowed to decide
      // whether the control is responsive.
      setBusy(false);
    }

    if (!res.ok) { toast.error(t('comms_voice_preview_failed')); return; }

    currentPreview?.pause();
    const audio = new Audio(res.url);
    currentPreview = audio;
    audio.onended = () => { setPlaying(false); currentPreview = null; };
    audio.onerror = () => {
      toast.error(t('comms_voice_preview_failed'));
      setPlaying(false);
      currentPreview = null;
    };

    // Optimistic: the click is the gesture autoplay policy asks for, so this
    // is expected to start. A rejection corrects it; a promise that never
    // settles no longer traps anything.
    setPlaying(true);
    void audio.play().catch(() => {
      toast.error(t('comms_voice_preview_failed'));
      setPlaying(false);
      currentPreview = null;
    });
  }, [playing, stop, voiceId, language, t]);

  return (
    <button
      type="button"
      onClick={() => void play()}
      disabled={busy}
      aria-label={playing ? t('comms_voice_stop') : t('comms_voice_play')}
      title={playing ? t('comms_voice_stop') : t('comms_voice_play')}
      className="me-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      {busy
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        : playing
        ? <Square className="h-3.5 w-3.5" aria-hidden="true" />
        : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

function VoiceStudio({ draft, patch }: { draft: Partial<CommAgent>; patch: (p: Partial<CommAgent>) => void }) {
  const { t } = useLanguage();
  const [voices, setVoices] = useState<PickableVoice[]>([]);
  const [mine, setMine] = useState<Array<{ voiceId: string; name: string; status: string; confirmedAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    const [catalogue, own] = await Promise.all([listVoices(), listMyVoices()]);
    setVoices(catalogue);
    setMine(own);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const removeMine = useCallback(async (voiceId: string) => {
    const ok = await deleteCustomVoice(voiceId);
    if (!ok) { toast.error(t('comm_save_failed')); return; }
    // If the agent was pointed at the voice that just went away, stop
    // pointing at it: an agent referencing a deleted voice fails at the call,
    // which is the worst possible moment to find out.
    if (draft.voice_id === voiceId) patch({ voice_id: null, voice_label: null });
    await reload();
  }, [draft.voice_id, patch, reload, t]);

  /*
   * Filtering by a language a voice ACTUALLY lists.
   *
   * The old filter compared against a single language field, so a
   * multilingual voice that covers nine languages was filed under whichever
   * one happened to be first and vanished from the other eight. The provider
   * reports the whole list; this uses it.
   */
  const needle = search.trim().toLowerCase();
  const shown = voices
    .filter((v) => filter === 'ALL' || v.languages.includes(filter))
    .filter((v) => !needle
      || v.name.toLowerCase().includes(needle)
      || (v.description ?? '').toLowerCase().includes(needle)
      || Object.values(v.labels).some((l) => l.toLowerCase().includes(needle)));

  const languagesAvailable = [...new Set(voices.flatMap((v) => v.languages))].sort();

  /*
   * THE VOICE THIS AGENT IS ALREADY USING, WHEN IT IS NOT IN EITHER LIST.
   *
   * An agent chosen before the library moved to ElevenLabs still points at a
   * Cartesia voice, and that voice appears in neither the catalogue nor the
   * cloned-voice list. Without this the voice screen showed nothing selected
   * at all: the customer could not tell what their agent sounded like, and
   * clicking anything replaced a choice they could not see they had made.
   *
   * It is shown as it is, with the label stored alongside it, and it keeps
   * working until they pick something else. Nothing is migrated and nothing
   * is rewritten -- see previewVoice for how it still gets heard.
   */
  const currentIsListed = !draft.voice_id
    || voices.some((v) => v.id === draft.voice_id)
    || mine.some((v) => v.voiceId === draft.voice_id);

  return (
    <Card><CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('comm_voice_title')}</h2>
          <p className="text-[13px] text-muted-foreground">{t('comm_voice_subtitle')}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('comm_voice_search')}
            aria-label={t('comm_voice_search')}
            className="h-8 w-[160px] text-xs"
          />
          {languagesAvailable.length ? (
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={t('comm_agent_languages')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('comm_filter_all')}</SelectItem>
                {languagesAvailable.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setAdding(true)}>
            <Mic2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('voice_add')}
          </Button>
        </div>
      </div>

      <AddVoiceDialog
        open={adding}
        onOpenChange={setAdding}
        defaultLanguage={draft.languages?.[0] ?? 'ka'}
        onCreated={(voiceId, name) => {
          // Select it immediately: somebody who just cloned a voice wants to
          // use it, and making them find it in a list of a hundred is a worse
          // answer than choosing it for them and letting them change it.
          patch({ voice_id: voiceId, voice_label: name });
          void reload();
        }}
      />

      {/*
        * MY VOICES.
        *
        * Listed from the consent records rather than by filtering the
        * provider catalogue, because the consent record is what proves the
        * voice is this account's to use — and it is also the only place that
        * knows a clone was attempted and failed.
        */}
      {mine.length ? (
        <div className="rounded-xl border p-3">
          <h3 className="text-xs font-semibold">{t('voice_my_voices')}</h3>
          <ul className="mt-2 space-y-1.5">
            {mine.map((v) => {
              const selected = draft.voice_id === v.voiceId;
              return (
                <li key={v.voiceId} className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => patch({ voice_id: v.voiceId, voice_label: v.name })}
                    className={cn(
                      'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border p-2.5 text-start transition-colors',
                      selected ? 'border-gold bg-gold/[0.06]' : 'hover:border-foreground/20',
                    )}
                  >
                    <span className="min-w-0 truncate text-xs font-medium">{v.name}</span>
                    {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" /> : null}
                  </button>
                  <VoicePreviewButton voiceId={v.voiceId} language={draft.languages?.[0] ?? 'en'} />
                  <Button
                    variant="ghost" size="sm" className="h-8 shrink-0 text-2xs text-muted-foreground"
                    onClick={() => void removeMine(v.voiceId)}
                  >
                    {t('voice_remove')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!loading && !currentIsListed && draft.voice_id ? (
        <div className="rounded-xl border border-gold bg-gold/[0.06] p-3">
          <h3 className="text-xs font-semibold">{t('comm_voice_current')}</h3>
          <div className="mt-2 flex items-center gap-1">
            <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background p-2.5">
              <Check className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
              <span className="min-w-0 truncate text-xs font-medium">
                {draft.voice_label || draft.voice_id}
              </span>
            </span>
            <VoicePreviewButton
              voiceId={draft.voice_id}
              language={draft.languages?.[0] ?? 'en'}
            />
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">{t('comm_voice_current_hint')}</p>
        </div>
      ) : null}

      {loading ? <LoadingBlock rows={3} /> : !voices.length ? (
        // §92: the catalogue being unavailable is not a broken page. The agent
        // simply uses the platform default voice.
        <Alert><AlertDescription className="text-xs">{t('comm_voice_unavailable')}</AlertDescription></Alert>
      ) : !shown.length ? (
        <Alert><AlertDescription className="text-xs">{t('comm_voice_no_match')}</AlertDescription></Alert>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {shown.map((v) => {
            const selected = draft.voice_id === v.id;
            return (
              <li
                key={v.id}
                className={cn(
                  'flex items-center gap-1 rounded-lg border transition-colors',
                  selected ? 'border-gold bg-gold/[0.06]' : 'hover:border-foreground/20',
                )}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => patch({ voice_id: v.id, voice_label: v.name })}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 p-2.5 text-start"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{v.name}</span>
                    {v.description ? (
                      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{v.description}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {v.recommended ? (
                      <Badge className="bg-gold/15 text-[13px] text-gold hover:bg-gold/15">
                        {t('comm_voice_recommended')}
                      </Badge>
                    ) : null}
                    {/* The languages the PROVIDER says this voice covers, and
                        a count rather than a wall of codes once it is more
                        than a couple. Never a number Homatch decided. */}
                    {v.languages.length > 2 ? (
                      <Badge variant="outline" className="text-[13px]">
                        {t('comm_voice_language_count').replace('{n}', String(v.languages.length))}
                      </Badge>
                    ) : v.languages.map((l) => (
                      <Badge key={l} variant="outline" className="text-[13px] uppercase">{l}</Badge>
                    ))}
                    {selected ? <Check className="h-3.5 w-3.5 text-gold" aria-hidden="true" /> : null}
                  </span>
                </button>
                {/* Hearing the voice is a separate act from choosing it: a
                    customer should be able to audition three before picking. */}
                <VoicePreviewButton
                  voiceId={v.id}
                  language={draft.languages?.[0] ?? v.language ?? 'en'}
                />
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[13px] text-muted-foreground">{t('comm_voice_test_hint')}</p>
    </CardContent></Card>
  );
}

/**
 * §11 step 6: a live browser conversation with the agent, using the real
 * assembled prompt rather than a simplified stand-in.
 */
function TestStep({
  agentId, onTested, tested, onSave,
}: { agentId: string; onTested: () => void; tested: boolean; onSave: () => Promise<boolean> }) {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const [state, setState] = useState<VoiceState>('IDLE');
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [level, setLevel] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [trace, setTrace] = useState<VoiceMilestone[]>([]);
  const sessionRef = useRef<VoiceSession | null>(null);

  useEffect(() => () => { void sessionRef.current?.stop('unmount'); }, []);

  const start = useCallback(async () => {
    setState('CONNECTING');
    setTurns([]);
    setTrace([]);
    // Save first: testing an agent whose latest edits are still in local state
    // tests the wrong agent.
    await onSave();

    const grant = await requestAgentTestGrant(agentId);
    if (!grant.ok) { setState('PROVIDER_ERROR'); toast.error(t('comm_voice_test_failed')); return; }

    const { VoiceSession: Session } = await import('@/lib/comm/voiceClient');
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    const session = new Session(
      {
        primaryLanguage: grant.data.primaryLanguage,
        maxDurationSec: grant.data.maxDurationSec,
        endpointing: grant.data.endpointing,
      },
      {
        onState: setState,
        onTranscript: (next) => setTurns([...next]),
        onLanguage: () => { /* shown by the transcript itself */ },
        onLevel: setLevel,
        onSecondsConsumed: () => { /* the session enforces its own ceiling */ },
        onLatency: (b) => setLatency(b.perceivedMs),
        // Where the session actually got to. A red state alone cannot tell
        // apart "no microphone", "no socket", "socket open but silent" and
        // "heard me but never answered" — and those need different fixes.
        onMilestone: (m) => setTrace((prev) => [...prev, m]),
        /* Words come from the server now. Cartesia's transcription socket
         * cannot write Georgian, and an agent for Georgian callers that
         * cannot be tested in Georgian is not tested. */
        onTranscribe: async (audioBase64, languageHint) => {
          const heard = await runAgentTranscribe(agentId, audioBase64, languageHint);
          if (!heard.ok) return null;
          return { text: heard.data.text, language: heard.data.language, ms: heard.data.ms };
        },
        /* The agent's own prompt and the agent's own voice, assembled server
         * side. Testing a stand-in in someone else's voice tests nothing. */
        onUserTurn: async (text) => {
          const reply = await runAgentTestTurn(agentId, text, history.slice(-8));
          if (!reply.ok) return null;
          history.push({ role: 'user', content: text });
          history.push({ role: 'assistant', content: reply.data.text });
          return {
            text: reply.data.text,
            audioBase64: reply.data.audioBase64 ?? null,
            mime: reply.data.mime,
            voiceId: reply.data.voiceId,
          };
        },
      },
    );
    sessionRef.current = session;
    await session.start();
    onTested();
  }, [agentId, onSave, onTested, t]);

  const stop = useCallback(async () => {
    await sessionRef.current?.stop('user_ended');
    sessionRef.current = null;
    setState('ENDED');
  }, []);

  const live = ['LISTENING', 'UNDERSTANDING', 'RESPONDING', 'INTERRUPTED'].includes(state);

  return (
    <div className="space-y-3">
    <Card><CardContent className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">{t('comm_test_title')}</h2>
        <p className="text-[13px] text-muted-foreground">{t('comm_test_subtitle')}</p>
      </div>

      {state === 'MIC_DENIED' || state === 'MIC_UNAVAILABLE' ? (
        <Alert variant="destructive">
          <MicOff className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {/* Two different problems, two different instructions. "Allow the
                microphone" is useless advice to somebody who has none. */}
            {t(state === 'MIC_DENIED' ? 'comm_test_mic_denied' : 'comm_test_mic_unavailable')}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-3 rounded-lg border p-3">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-transform',
            live ? 'bg-emerald-500/15' : 'bg-muted',
          )}
          style={live ? { transform: `scale(${1 + Math.min(0.3, level * 2)})` } : undefined}
        >
          <Mic className={cn('h-4 w-4', live ? 'text-emerald-600' : 'text-muted-foreground')} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{t(`talk_state_${state.toLowerCase()}` as TKey)}</p>
          {latency !== null ? (
            <p className="text-[13px] text-muted-foreground">{t('comm_test_latency').replace('{ms}', String(latency))}</p>
          ) : null}
        </div>
        {live ? (
          <Button size="sm" variant="outline" onClick={() => void stop()}>
            <Square className="me-1.5 h-3 w-3" />{t('comm_test_stop')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void start()} disabled={state === 'CONNECTING'}>
            {state === 'CONNECTING' ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="me-1.5 h-3 w-3" />}
            {t(tested ? 'comm_test_again' : 'comm_test_start')}
          </Button>
        )}
      </div>

      {turns.length ? (
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border p-3">
          {turns.map((turn) => (
            <p key={turn.id} className={cn('text-xs', !turn.final && 'italic text-muted-foreground')}>
              {turn.text}
            </p>
          ))}
        </div>
      ) : null}
      {/* Shown once a session has been attempted, successful or not. The
          trace is the difference between "it did not work" and knowing which
          of five completely different things went wrong. */}
      {trace.length ? (
        <details className="rounded-lg border p-2.5">
          <summary className="cursor-pointer text-xs font-medium">{t('voice_trace_title')}</summary>
          <p className="mt-1 text-2xs text-muted-foreground [overflow-wrap:anywhere]">
            {t('voice_trace_hint')}
          </p>
          <ul className="mt-2 space-y-0.5">
            {trace.map((m, i) => (
              <li key={`${m.event}-${i}`} className="flex items-baseline gap-2 font-mono text-2xs">
                <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
                  {(m.atMs / 1000).toFixed(2)}s
                </span>
                <span className={cn('min-w-0 [overflow-wrap:anywhere]', m.event === 'failed' && 'text-destructive')}>
                  {m.event}
                  {m.detail !== null && m.detail !== undefined ? ` · ${m.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </CardContent></Card>

    {/* The other way to test the same agent: a real phone, one number, every
        gate a campaign would pass. Browser first because it needs nothing but
        a microphone; phone second because it costs money and needs telephony
        actually activated. */}
    <PhoneTestCard agentId={agentId} isAdmin={homatchUser?.is_admin === true} />
    </div>
  );
}

function ReviewStep({
  preview, tested,
}: { preview: { summary: Record<string, unknown>; systemPrompt: string } | null; tested: boolean }) {
  const { t } = useLanguage();
  if (!preview) return <LoadingBlock rows={5} />;

  const s = preview.summary;
  const rows: Array<[string, React.ReactNode]> = [
    ['comm_agent_name', String(s.name ?? '')],
    ['comm_agent_languages', (Array.isArray(s.languages) ? s.languages : []).join(', ').toUpperCase()],
    ['comm_step_voice', String(s.voice ?? t('comm_voice_default'))],
    ['comm_agent_disclosure', s.aiDisclosure ? t('comm_yes') : t('comm_no')],
    ['comm_agent_opens_with', String(s.opensWith ?? '')],
    ['comm_agent_max_duration', `${Math.round(Number(s.maxDurationSec ?? 0) / 60)} min`],
    ['comm_agent_recording', s.recordingEnabled ? t('comm_yes') : t('comm_no')],
  ];

  return (
    <Card><CardContent className="space-y-3 p-4">
      {!tested ? (
        <Alert>
          <AlertDescription className="text-xs">{t('comm_review_untested')}</AlertDescription>
        </Alert>
      ) : null}

      <dl className="divide-y text-xs">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 py-2">
            <dt className="shrink-0 text-muted-foreground">{t(key as TKey)}</dt>
            <dd className="text-end font-medium">{value || '·'}</dd>
          </div>
        ))}
      </dl>

      {Array.isArray(s.questions) && s.questions.length ? (
        <div>
          <p className="text-xs font-medium">{t('comm_agent_questions')}</p>
          <ol className="mt-1 list-inside list-decimal space-y-0.5 text-[13px] text-muted-foreground">
            {(s.questions as string[]).map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </div>
      ) : null}

      {/* The owner's own instructions, shown to the owner. §106 keeps provider
          settings out of this view; the agent's behaviour is not a provider
          setting and hiding it would make the agent unauditable by the person
          responsible for it. */}
      <details className="rounded-lg border p-2">
        <summary className="cursor-pointer text-xs font-medium">{t('comm_review_instructions')}</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[13px] text-muted-foreground">
          {preview.systemPrompt}
        </pre>
      </details>
    </CardContent></Card>
  );
}
