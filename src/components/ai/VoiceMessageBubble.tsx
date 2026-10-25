/*
 * A voice message the person sent to HOMI: their recording, playable, with
 * the text HOMI understood written underneath. Sits on the person's side of
 * the conversation (`justify-end` follows the text direction, so it is on the
 * left in Arabic and Hebrew), in the same gold as their typed messages.
 */
import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export interface VoiceNote {
  /** Object URLs of the recorded segments, played in order. */
  audioUrls: string[];
  durationSeconds: number;
  /** Peaks of what was said, 0..1, for the drawn waveform. */
  shape: number[];
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VoiceMessageBubble({ note, transcript }: { note: VoiceNote; transcript: string }) {
  const { t } = useLanguage();
  const audio = useRef<HTMLAudioElement | null>(null);
  const index = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => () => { audio.current?.pause(); }, []);

  const playFrom = (i: number) => {
    const url = note.audioUrls[i];
    if (!url) { setPlaying(false); setProgress(0); index.current = 0; return; }
    index.current = i;
    const el = audio.current ?? new Audio();
    audio.current = el;
    el.src = url;
    el.onended = () => playFrom(i + 1);
    el.ontimeupdate = () => {
      const before = (i * note.durationSeconds) / Math.max(1, note.audioUrls.length);
      const span = note.durationSeconds / Math.max(1, note.audioUrls.length);
      const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : span;
      setProgress(Math.min(1, (before + Math.min(el.currentTime, d) * (span / d)) / Math.max(0.1, note.durationSeconds)));
    };
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const toggle = () => {
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    if (audio.current && audio.current.src && !audio.current.ended && audio.current.currentTime > 0) {
      void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      return;
    }
    playFrom(0);
  };

  const bars = note.shape.length ? note.shape : Array.from({ length: 28 }, () => 0.2);

  return (
    <div className="flex justify-end gap-3" data-voice-message>
      <div className="max-w-[85%] min-w-0 sm:max-w-[80%]">
        <div className="rounded-2xl rounded-se-sm bg-primary px-3 py-2.5 text-primary-foreground shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? t('voice_pause') : t('voice_play')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0C1119] text-[hsl(38_92%_60%)] ring-1 ring-inset ring-white/10 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4 translate-x-px rtl:-scale-x-100" aria-hidden="true" />}
            </button>
            <div className="flex h-8 min-w-0 flex-1 items-center gap-[3px]" aria-hidden="true">
              {bars.map((v, i) => (
                <span
                  key={i}
                  className={`w-[3px] shrink-0 rounded-full ${i / bars.length <= progress && progress > 0 ? 'bg-[#0C1119]' : 'bg-[#0C1119]/35'}`}
                  style={{ height: `${Math.round(18 + v * 82)}%` }}
                />
              ))}
            </div>
            <span className="shrink-0 text-[13px] font-medium tabular-nums opacity-80">{formatClock(note.durationSeconds)}</span>
          </div>
        </div>
        <div className="mt-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
            <Mic className="h-3.5 w-3.5 text-gold-ink" aria-hidden="true" />
            <span>{t('voice_transcript_label')}</span>
          </div>
          <p className="text-[15px] leading-[1.6] text-foreground break-words">{transcript}</p>
        </div>
      </div>
    </div>
  );
}
