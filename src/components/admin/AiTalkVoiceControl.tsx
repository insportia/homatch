// HOMATCH Admin — the voice AI TALK speaks with.
//
// THE ONE PLACE THIS IS CHANGED
//
// There is exactly one editable AI TALK voice surface in the product, and
// this is it. The setting behind it — `ai_talk_voice` — is read by
// aiTalkVoice() in ai-talk-session on the way to every spoken phrase, so
// changing it here changes production with no deployment. Nothing on this
// screen writes a second key, and no other screen writes this one.
//
// It used to live near the bottom of /admin/settings, below a routing
// panel, under a heading called Communications. Everything worked; nobody
// could find it. The control moved, the setting did not.
//
// WHAT THE THREE BUTTONS ACTUALLY DO
//
//   Test    sends the id CURRENTLY IN THE BOX to ai-talk-session, which
//           synthesises it through the same function a real reply goes
//           through and returns raw PCM. Nothing is written: the live
//           voice is whatever the setting says until Save.
//   Save    writes the setting and an audit row naming who changed it and
//           what it was before.
//   Restore puts back the id that was live before the last save made in
//           this session. It is a convenience, not a history: reloading
//           the page forgets it, because the audit log is the record.

import { AudioLines, Loader2, Play, RotateCcw, Save } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AiTalkVoiceLibrary } from '@/components/admin/AiTalkVoiceLibrary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  getAiTalkVoice, previewAiTalkVoice, saveAiTalkVoice, VOICE_ID_SHAPE,
} from '@/services/communications';

/**
 * Play raw PCM, because raw PCM is what the product plays.
 *
 * The preview comes back as signed 16-bit samples at the rate the
 * synthesiser produced, which is what AI TALK streams to a visitor. An
 * mp3 would be easier to play here and would be a different thing to
 * listen to.
 */
async function playPcm(pcmBase64: string, sampleRate: number): Promise<void> {
  const binary = atob(pcmBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const samples = new Int16Array(bytes.buffer);
  const AudioCtx = window.AudioContext
    ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error('no audio');
  const ctx = new AudioCtx();
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 32768;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  await new Promise<void>((resolve) => { source.onended = () => resolve(); });
  await ctx.close().catch(() => undefined);
}

export function AiTalkVoiceControl() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [savedVoiceId, setSavedVoiceId] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState('');
  /* 1.0 is the voice's own pace. Cartesia accepts 0.6 to 1.5 and the
     service refuses anything outside it rather than clamping, so the
     slider cannot produce a value the save will reject. */
  const [speed, setSpeed] = useState(1);
  const [savedSpeed, setSavedSpeed] = useState(1);
  const [previousVoiceId, setPreviousVoiceId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void getAiTalkVoice().then((stored) => {
      if (!live) return;
      const active = typeof stored?.voice_id === 'string' ? stored.voice_id : null;
      const storedSpeed = typeof stored?.speed === 'number' ? stored.speed : 1;
      setSavedVoiceId(active);
      setVoiceId(active ?? '');
      setSpeed(storedSpeed);
      setSavedSpeed(storedSpeed);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const trimmed = voiceId.trim();
  const shapeOk = VOICE_ID_SHAPE.test(trimmed);
  const dirty = trimmed !== (savedVoiceId ?? '') || speed !== savedSpeed;

  const onTest = useCallback(async () => {
    if (!shapeOk) { toast.error(t('voice_id_invalid')); return; }
    setPreviewing(true);
    try {
      /* Georgian, because Georgian is the language this product lives or
         dies on and the one a wrong voice mangles first. */
      const out = await previewAiTalkVoice(trimmed, 'ka');
      if (!out.ok) { toast.error(t('voice_test_failed')); return; }
      await playPcm(out.pcmBase64, out.sampleRate);
    } catch {
      toast.error(t('voice_test_failed'));
    } finally {
      setPreviewing(false);
    }
  }, [shapeOk, trimmed, t]);

  const onSave = useCallback(async () => {
    if (!shapeOk) { toast.error(t('voice_id_invalid')); return; }
    setSaving(true);
    try {
      const ok = await saveAiTalkVoice(trimmed, savedVoiceId, speed);
      if (ok) {
        if (savedVoiceId && savedVoiceId !== trimmed) setPreviousVoiceId(savedVoiceId);
        setSavedVoiceId(trimmed);
        setSavedSpeed(speed);
        toast.success(t('voice_saved_toast'));
      } else {
        toast.error(t('voice_save_failed'));
      }
    } finally {
      setSaving(false);
    }
  }, [shapeOk, trimmed, savedVoiceId, speed, t]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="ai-talk-voice-control">
      {/* What is live right now, before anything else. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AudioLines className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs text-muted-foreground">{t('voice_current')}</span>
        <code
          data-testid="ai-talk-active-voice"
          className="min-w-0 break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
        >
          {savedVoiceId ?? t('admin_no_data')}
        </code>
        {dirty && <Badge variant="outline" className="text-2xs">{t('voice_unsaved')}</Badge>}
      </div>

      {/* Voice ID */}
      <div className="space-y-1.5">
        <Label htmlFor="ai-talk-voice-id" className="text-sm font-medium">{t('voice_id_label')}</Label>
        <Input
          id="ai-talk-voice-id"
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
          placeholder="794f9389-aac1-45b6-b726-9d9369183238"
          spellCheck={false}
          autoComplete="off"
          dir="ltr"
          className="font-mono text-sm"
          aria-describedby="ai-talk-voice-id-help"
        />
        <p id="ai-talk-voice-id-help" className="text-2xs leading-relaxed text-muted-foreground">
          {t('voice_id_help')}
        </p>
        {trimmed !== '' && !shapeOk && (
          <p role="alert" className="text-2xs leading-relaxed text-destructive">{t('voice_id_invalid')}</p>
        )}
      </div>

      {/* The model, read-only on purpose.
          It comes from the TTS route's own config and the synthesiser
          walks its own ladder, so an editable box here would write a
          value nothing reads — the placebo control §55 forbids. Showing
          it still earns its place: "which model is this" is a real
          question, and the honest answer is a fact rather than a field. */}
      <div className="space-y-1.5">
        <Label htmlFor="ai-talk-voice-model" className="text-sm font-medium">
          {t('admin_talk_voice_model')}
        </Label>
        <Input
          id="ai-talk-voice-model"
          value="sonic-3"
          readOnly
          disabled
          dir="ltr"
          className="font-mono text-sm"
          aria-describedby="ai-talk-voice-model-help"
        />
        <p id="ai-talk-voice-model-help" className="text-2xs leading-relaxed text-muted-foreground">
          {t('admin_talk_voice_model_hint')}
        </p>
      </div>

      {/* Speed */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="ai-talk-speed" className="text-sm font-medium">{t('voice_speed_label')}</Label>
          <span className="font-mono text-sm tabular-nums text-foreground">{speed.toFixed(2)}×</span>
        </div>
        <Slider
          id="ai-talk-speed"
          min={0.6}
          max={1.5}
          step={0.05}
          value={[speed]}
          onValueChange={([next]) => setSpeed(Number(next.toFixed(2)))}
          aria-label={t('voice_speed_label')}
          aria-describedby="ai-talk-speed-help"
        />
        <p id="ai-talk-speed-help" className="text-2xs leading-relaxed text-muted-foreground">
          {t('voice_speed_help')}
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void onTest()}
          disabled={previewing || !shapeOk}
          className="gap-1.5"
        >
          {previewing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <Play className="h-4 w-4" aria-hidden="true" />}
          {t('voice_test')}
        </Button>
        <Button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || !shapeOk || !dirty}
          className="gap-1.5"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <Save className="h-4 w-4" aria-hidden="true" />}
          {t('voice_save')}
        </Button>
        {previousVoiceId && previousVoiceId !== trimmed && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setVoiceId(previousVoiceId)}
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('voice_restore_previous')}
          </Button>
        )}
      </div>
      <p className="text-2xs leading-relaxed text-muted-foreground">{t('voice_test_hint')}</p>

      {/*
        * The shelf of named voices, under the box it removes the need for.
        * It came with the control when the control moved: keeping a list of
        * saved voices on a different page from the field they fill in was
        * half the reason changing a voice felt like an expedition.
        *
        * It writes `ai_talk_voice` through the same saveAiTalkVoice() this
        * component uses, and `ai_talk_voice_library` for the names, which is
        * presentation only and never read by the runtime.
        */}
      <AiTalkVoiceLibrary
        activeVoiceId={savedVoiceId}
        previousVoiceId={previousVoiceId}
        playPcm={playPcm}
        onActivated={(id) => {
          if (savedVoiceId && savedVoiceId !== id) setPreviousVoiceId(savedVoiceId);
          setSavedVoiceId(id);
          setVoiceId(id);
        }}
      />
    </div>
  );
}
