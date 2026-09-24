// HOMATCH Admin — how a call behaves, in two vocabularies.
//
// ONE OBJECT, TWO VIEWS, NO CLOBBERING
//
// `comm_voice_tuning` is a single settings row with ten fields, read by
// decideEndpoint() and decideBargeIn() in AI TALK and by agentPrompt.ts
// on the way to every Vapi call. Two screens now edit it: the Call Center
// page shows the three an owner understands, Advanced shows all ten.
//
// Both load the WHOLE object and save the WHOLE object, patching only the
// fields they display. That is the part that matters: a simple view that
// wrote only its own three fields would silently reset the seven it never
// showed, which is how a "simplified" admin screen destroys tuning nobody
// realised it owned.
//
// EVERY FIELD HERE IS READ BY SOMETHING
//
// §55 again: no placebo controls. The mapping is documented on
// CommunicationsVoicePanel and has not changed — this file only decides
// which of those fields a given reader sees, and what to call them in
// words that are not the variable name.

import { Loader2, Save } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCommVoiceTuning, saveCommVoiceTuning } from '@/services/communications';
import type { CommVoiceTuning } from '@/types/communications';

/** Mirrors DEFAULT_ENDPOINTING, so a missing row renders the shipped behaviour. */
const DEFAULTS: CommVoiceTuning = {
  min_silence_ms: 260,
  complete_silence_ms: 520,
  continuation_grace_ms: 900,
  max_silence_ms: 1600,
  semantic_endpointing: true,
  interruption_enabled: true,
  interruption_threshold_ms: 320,
  georgian_lock_threshold: 0.6,
  max_call_duration_sec: 600,
  recording_default: false,
};

export function VoiceTuningControl() {
  const { t } = useLanguage();
  const [saved, setSaved] = React.useState<CommVoiceTuning | null>(null);
  const [draft, setDraft] = React.useState<CommVoiceTuning>(DEFAULTS);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void getCommVoiceTuning().then((stored) => {
      if (!live) return;
      const merged = { ...DEFAULTS, ...(stored ?? {}) };
      setSaved(merged);
      setDraft(merged);
    });
    return () => { live = false; };
  }, []);

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft);

  const onSave = React.useCallback(async () => {
    setSaving(true);
    try {
      /* The whole object, including the fields this view never showed. */
      const ok = await saveCommVoiceTuning(draft);
      if (ok) { setSaved(draft); toast.success(t('admin_voice_saved')); }
      else toast.error(t('comm_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [draft, t]);

  if (saved === null) {
    return <div className="space-y-3"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>;
  }

  return (
    <div className="space-y-5" data-testid="voice-tuning-control">
      {/* Pause before answering — complete_silence_ms, in words. */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="tuning-pause" className="text-sm font-medium">{t('voice_pause_label')}</Label>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {(draft.complete_silence_ms / 1000).toFixed(2)}s
          </span>
        </div>
        <Slider
          id="tuning-pause"
          min={200} max={1500} step={20}
          value={[draft.complete_silence_ms]}
          onValueChange={([v]) => setDraft((d) => ({
            ...d,
            complete_silence_ms: v,
            /* Keep the ordering the saver enforces: min < complete <=
               grace <= max. Moving one handle must not create a state
               the save will refuse. */
            min_silence_ms: Math.min(d.min_silence_ms, v - 20),
            continuation_grace_ms: Math.max(d.continuation_grace_ms, v),
            max_silence_ms: Math.max(d.max_silence_ms, Math.max(d.continuation_grace_ms, v)),
          }))}
          aria-describedby="tuning-pause-help"
        />
        <p id="tuning-pause-help" className="text-2xs leading-relaxed text-muted-foreground">
          {t('voice_pause_help')}
        </p>
      </div>

      {/* Allow interruptions — interruption_enabled. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="tuning-interrupt" className="text-sm font-medium">{t('voice_interrupt_label')}</Label>
          <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{t('voice_interrupt_help')}</p>
        </div>
        <Switch
          id="tuning-interrupt"
          checked={draft.interruption_enabled}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, interruption_enabled: v }))}
        />
      </div>

      {/* Maximum call length — max_call_duration_sec. */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="tuning-maxcall" className="text-sm font-medium">{t('voice_maxcall_label')}</Label>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {t('voice_minutes_short', { n: Math.round(draft.max_call_duration_sec / 60) })}
          </span>
        </div>
        <Slider
          id="tuning-maxcall"
          min={60} max={1800} step={60}
          value={[draft.max_call_duration_sec]}
          onValueChange={([v]) => setDraft((d) => ({ ...d, max_call_duration_sec: v }))}
          aria-describedby="tuning-maxcall-help"
        />
        <p id="tuning-maxcall-help" className="text-2xs leading-relaxed text-muted-foreground">
          {t('voice_maxcall_help')}
        </p>
      </div>

      {/* Recording — recording_default. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="tuning-recording" className="text-sm font-medium">{t('voice_recording_label')}</Label>
          <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{t('voice_recording_help')}</p>
        </div>
        <Switch
          id="tuning-recording"
          checked={draft.recording_default}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, recording_default: v }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void onSave()} disabled={saving || !dirty} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <Save className="h-4 w-4" aria-hidden="true" />}
          {t('voice_save')}
        </Button>
        {dirty && <Badge variant="outline" className="text-2xs">{t('voice_unsaved')}</Badge>}
      </div>
    </div>
  );
}
