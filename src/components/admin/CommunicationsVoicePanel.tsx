// HOMATCH Admin — voice tuning and the AI Talk allowance.
//
// §55: "Only implement settings providers actually support. Do not add placebo
// controls." Every control on this screen writes a key that a specific piece
// of server code reads. The mapping, so it can be checked rather than trusted:
//
//   min_silence_ms           decideEndpoint() floor, and Vapi's
//                            startSpeakingPlan.waitSeconds
//   complete_silence_ms      decideEndpoint() when the utterance reads as
//                            finished; Vapi's onPunctuationSeconds
//   continuation_grace_ms    decideEndpoint() when it ends on "და" or a bare
//                            number; Vapi's onNoPunctuationSeconds
//   max_silence_ms           the hard ceiling: a turn ends eventually
//   semantic_endpointing     Vapi's smartEndpointingEnabled
//   interruption_enabled     stopSpeakingPlan.numWords
//   interruption_threshold   decideBargeIn() sustainMs, and
//                            stopSpeakingPlan.voiceSeconds
//   georgian_lock_threshold  stabiliseLanguage()'s lock confidence
//   max_call_duration_sec    Vapi's maxDurationSeconds, capped per agent
//   recording_default        whether a call is recorded at all (§73)
//
//   ai_talk_* keys           ai-talk-session's allowance (§28, §59)
//   authenticated_daily_*    loadLimits() in ai-talk-session, read on every
//                            grant, so an edit here changes what a signed-in
//                            person is granted without a deployment
//
// Anything a provider does not expose is absent from this file. There is no
// "voice warmth" slider and no "AI creativity" dial.
//
// admin_settings EXISTS in production today, so unlike the routing panel this
// one is fully functional before the communications migration is applied.

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, RotateCcw, AudioLines, Mic, Radio } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { getCommVoiceTuning, saveCommVoiceTuning, getAiTalkLimits, saveAiTalkLimits } from '@/services/communications';
import type { CommVoiceTuning, AiTalkLimits } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/**
 * The shipped defaults, mirroring DEFAULT_ENDPOINTING and DEFAULT_TALK_LIMITS.
 * Repeated here so Reset works without a round trip, and so a missing settings
 * row renders the tuned behaviour rather than a blank form.
 */
const DEFAULT_TUNING: CommVoiceTuning = {
  min_silence_ms: 260,
  complete_silence_ms: 620,
  continuation_grace_ms: 900,
  max_silence_ms: 1900,
  semantic_endpointing: true,
  interruption_enabled: true,
  interruption_threshold_ms: 180,
  georgian_lock_threshold: 0.72,
  max_call_duration_sec: 600,
  recording_default: false,
};

/*
 * These must equal DEFAULT_TALK_LIMITS, because Reset WRITES them.
 *
 * session_seconds sat at 75 here long after the shipped default became 120,
 * so the button labelled Reset would have quietly halved a live session
 * length -- a control that does something other than what it says. The two
 * authenticated figures are the shipped defaults for the same reason: an
 * operator who has never opened this screen is already being granted them.
 */
const DEFAULT_LIMITS: AiTalkLimits = {
  session_seconds: 120,
  daily_seconds: 240,
  global_concurrent: 25,
  per_visitor_concurrent: 1,
  daily_sessions: 6,
  authenticated_daily_seconds: 600,
  authenticated_daily_sessions: 12,
  enabled: true,
};

export function CommunicationsVoicePanel() {
  const { t } = useLanguage();

  const [tuning, setTuning] = useState<CommVoiceTuning>(DEFAULT_TUNING);
  const [limits, setLimits] = useState<AiTalkLimits>(DEFAULT_LIMITS);
  const [loading, setLoading] = useState(true);
  const [savingTuning, setSavingTuning] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);

  const load = useCallback(async () => {
    const [storedTuning, storedLimits] = await Promise.all([getCommVoiceTuning(), getAiTalkLimits()]);
    setTuning({ ...DEFAULT_TUNING, ...(storedTuning ?? {}) });
    setLimits({ ...DEFAULT_LIMITS, ...(storedLimits ?? {}) });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSaveTuning = useCallback(async () => {
    // Ordering is a real constraint, not a nicety: a complete-silence longer
    // than the max means the max fires first and the "complete" branch is
    // dead code, which would look like the setting doing nothing.
    if (!(tuning.min_silence_ms < tuning.complete_silence_ms
      && tuning.complete_silence_ms <= tuning.continuation_grace_ms
      && tuning.continuation_grace_ms <= tuning.max_silence_ms)) {
      toast.error(t('admin_voice_order_invalid'));
      return;
    }
    setSavingTuning(true);
    try {
      const ok = await saveCommVoiceTuning(tuning);
      toast[ok ? 'success' : 'error'](t(ok ? 'admin_voice_saved' : 'comm_save_failed'));
    } finally {
      setSavingTuning(false);
    }
  }, [tuning, t]);

  const onSaveLimits = useCallback(async () => {
    /*
     * SIGNING IN MUST NEVER TAKE TIME AWAY.
     *
     * The anonymous figures are abuse protection on a shared network address;
     * the authenticated ones are an entitlement attached to an account. An
     * authenticated allowance BELOW the anonymous one inverts that -- a
     * person would be punished for identifying themselves, and would have no
     * way to understand why the demo got shorter after they signed in. The
     * fields are clamped to their own range as they are typed; this is the
     * relationship between them, which only a save can check.
     */
    if (limits.authenticated_daily_seconds < limits.daily_seconds
      || limits.authenticated_daily_sessions < limits.daily_sessions) {
      toast.error(t('admin_talk_auth_below_anon'));
      return;
    }
    setSavingLimits(true);
    try {
      const ok = await saveAiTalkLimits(limits);
      toast[ok ? 'success' : 'error'](t(ok ? 'admin_voice_saved' : 'comm_save_failed'));
    } finally {
      setSavingLimits(false);
    }
  }, [limits, t]);

  if (loading) {
    return (
      <Card><CardContent className="space-y-2 p-4">
        <Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" />
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AudioLines className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t('admin_voice_title')}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('admin_voice_subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setTuning(DEFAULT_TUNING)}>
              <RotateCcw className="me-1.5 h-3.5 w-3.5" />{t('admin_voice_reset')}
            </Button>
            <Button size="sm" onClick={() => void onSaveTuning()} disabled={savingTuning}>
              {savingTuning ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="me-1.5 h-3.5 w-3.5" />}
              {t('comm_save')}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription className="text-[13px]">{t('admin_voice_endpointing_help')}</AlertDescription>
          </Alert>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              labelKey="admin_voice_min_silence" hintKey="admin_voice_min_silence_hint"
              value={tuning.min_silence_ms} min={80} max={800} step={20}
              onChange={(v) => setTuning((s) => ({ ...s, min_silence_ms: v }))}
            />
            <NumberField
              labelKey="admin_voice_complete_silence" hintKey="admin_voice_complete_silence_hint"
              value={tuning.complete_silence_ms} min={200} max={2000} step={20}
              onChange={(v) => setTuning((s) => ({ ...s, complete_silence_ms: v }))}
            />
            <NumberField
              labelKey="admin_voice_grace" hintKey="admin_voice_grace_hint"
              value={tuning.continuation_grace_ms} min={300} max={3000} step={50}
              onChange={(v) => setTuning((s) => ({ ...s, continuation_grace_ms: v }))}
            />
            <NumberField
              labelKey="admin_voice_max_silence" hintKey="admin_voice_max_silence_hint"
              value={tuning.max_silence_ms} min={800} max={5000} step={100}
              onChange={(v) => setTuning((s) => ({ ...s, max_silence_ms: v }))}
            />
          </div>

          <ToggleRow
            labelKey="admin_voice_semantic" hintKey="admin_voice_semantic_hint"
            checked={tuning.semantic_endpointing}
            onChange={(v) => setTuning((s) => ({ ...s, semantic_endpointing: v }))}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleRow
              labelKey="admin_voice_interruption" hintKey="admin_voice_interruption_hint"
              checked={tuning.interruption_enabled}
              onChange={(v) => setTuning((s) => ({ ...s, interruption_enabled: v }))}
            />
            <NumberField
              labelKey="admin_voice_interruption_threshold" hintKey="admin_voice_interruption_threshold_hint"
              value={tuning.interruption_threshold_ms} min={80} max={800} step={20}
              disabled={!tuning.interruption_enabled}
              onChange={(v) => setTuning((s) => ({ ...s, interruption_threshold_ms: v }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              labelKey="admin_voice_georgian_lock" hintKey="admin_voice_georgian_lock_hint"
              value={tuning.georgian_lock_threshold} min={0.4} max={0.95} step={0.01}
              onChange={(v) => setTuning((s) => ({ ...s, georgian_lock_threshold: v }))}
            />
            <NumberField
              labelKey="admin_voice_max_duration" hintKey="admin_voice_max_duration_hint"
              value={tuning.max_call_duration_sec} min={60} max={1800} step={30}
              onChange={(v) => setTuning((s) => ({ ...s, max_call_duration_sec: v }))}
            />
            <ToggleRow
              labelKey="admin_voice_recording" hintKey="admin_voice_recording_hint"
              checked={tuning.recording_default}
              onChange={(v) => setTuning((s) => ({ ...s, recording_default: v }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mic className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t('admin_talk_title')}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('admin_talk_subtitle')}</p>
          </div>
          <Button size="sm" onClick={() => void onSaveLimits()} disabled={savingLimits}>
            {savingLimits ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="me-1.5 h-3.5 w-3.5" />}
            {t('comm_save')}
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          <ToggleRow
            labelKey="admin_talk_enabled" hintKey="admin_talk_enabled_hint"
            checked={limits.enabled}
            onChange={(v) => setLimits((s) => ({ ...s, enabled: v }))}
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              labelKey="admin_talk_session_seconds" hintKey="admin_talk_session_seconds_hint"
              value={limits.session_seconds} min={20} max={300} step={5}
              onChange={(v) => setLimits((s) => ({ ...s, session_seconds: v }))}
            />
            <NumberField
              labelKey="admin_talk_daily_seconds" hintKey="admin_talk_daily_seconds_hint"
              value={limits.daily_seconds} min={30} max={3600} step={30}
              onChange={(v) => setLimits((s) => ({ ...s, daily_seconds: v }))}
            />
            <NumberField
              labelKey="admin_talk_daily_sessions" hintKey="admin_talk_daily_sessions_hint"
              value={limits.daily_sessions} min={1} max={50} step={1}
              onChange={(v) => setLimits((s) => ({ ...s, daily_sessions: v }))}
            />
            <NumberField
              labelKey="admin_talk_global_concurrent" hintKey="admin_talk_global_concurrent_hint"
              value={limits.global_concurrent} min={1} max={500} step={1}
              onChange={(v) => setLimits((s) => ({ ...s, global_concurrent: v }))}
            />
          </div>

          {/*
            * The signed-in allowance, kept visibly apart from the anonymous
            * one above. They are different things -- one is counted against a
            * hashed network address and is shared with strangers, the other
            * against the account and follows the person between devices --
            * and putting them in one undifferentiated grid of numbers is how
            * an operator ends up tuning the wrong limit.
            */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium">{t('admin_talk_auth_group')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                labelKey="admin_talk_auth_seconds" hintKey="admin_talk_auth_seconds_hint"
                value={limits.authenticated_daily_seconds} min={60} max={7200} step={30}
                note={t('admin_talk_minutes', { minutes: minutesOf(limits.authenticated_daily_seconds) })}
                onChange={(v) => setLimits((s) => ({ ...s, authenticated_daily_seconds: v }))}
              />
              <NumberField
                labelKey="admin_talk_auth_sessions" hintKey="admin_talk_auth_sessions_hint"
                value={limits.authenticated_daily_sessions} min={1} max={100} step={1}
                onChange={(v) => setLimits((s) => ({ ...s, authenticated_daily_sessions: v }))}
              />
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
            <Radio className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {t('admin_talk_note')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Seconds, read back as minutes.
 *
 * The stored value is seconds and stays seconds -- it is what decideGrant
 * subtracts and what every telemetry row is denominated in, and rounding a
 * setting to whole minutes on the way to the database would make the number
 * an operator typed and the number the server enforces two different things.
 * One decimal, so 90 reads as 1.5 rather than as 2.
 */
function minutesOf(seconds: number): string {
  return String(Math.round((seconds / 60) * 10) / 10);
}

function NumberField({
  labelKey, hintKey, value, min, max, step, disabled, note, onChange,
}: {
  labelKey: string; hintKey: string; value: number;
  min: number; max: number; step: number; disabled?: boolean;
  /** A read-only restatement of the same value in friendlier units. */
  note?: string;
  onChange: (v: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1">
      <Label className="text-xs">{t(labelKey as TKey)}</Label>
      <Input
        type="number" value={value} min={min} max={max} step={step} disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="h-8 text-xs"
      />
      <p className="text-[13px] leading-snug text-muted-foreground">
        {t(hintKey as TKey)}
        {note ? <span className="ms-1 font-medium text-foreground">{note}</span> : null}
      </p>
    </div>
  );
}

function ToggleRow({
  labelKey, hintKey, checked, onChange,
}: { labelKey: string; hintKey: string; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <Label className="text-xs">{t(labelKey as TKey)}</Label>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t(hintKey as TKey)}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={t(labelKey as TKey)} />
    </div>
  );
}
