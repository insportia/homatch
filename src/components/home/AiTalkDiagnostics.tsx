/*
 * AI TALK — the live readout. TEMPORARY.
 *
 * WHY IT EXISTS
 *
 * "The microphone is clearly listening and reacting to my voice, but no
 * transcript appears" is one sentence describing four unrelated faults:
 *
 *   no samples reaching the callback at all
 *   samples arriving but nothing captured as speech
 *   speech captured but no request leaving the browser
 *   a request leaving and no words coming back
 *
 * From outside a phone there is no way to tell which. Every value below is a
 * count of something that actually happened inside the voice runtime — none
 * of it is inferred, and none of it is filled in optimistically.
 *
 * The labels are deliberately technical and deliberately untranslated: this
 * is an engineering readout for the product owner while a specific defect is
 * being confirmed on real devices, not product copy. That is why this file is
 * on the i18n audit's allowlist, and why it should be deleted — not
 * translated — once Georgian speech-in is confirmed on physical microphones.
 *
 * It shows the visitor their own last transcript and nothing else. No token,
 * no session id, no provider name, no error body.
 */

import type { VoiceDiagnostics } from '@/lib/comm/voiceClient';

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'idle' }) {
  const colour = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-white/80';
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-white/5 py-0.5 last:border-b-0">
      <span className="shrink-0 text-white/40">{label}</span>
      <span className={`min-w-0 truncate text-right font-medium ${colour}`}>{value}</span>
    </div>
  );
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));
const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v} ms`);

export function AiTalkDiagnostics({ d }: { d: VoiceDiagnostics | null }) {
  if (!d) return null;

  const kb = (bytes: number | null | undefined) =>
    bytes === null || bytes === undefined ? '—' : `${(bytes / 1024).toFixed(1)} kB`;

  return (
    /* dir="ltr" because field names and numbers are not prose: in Arabic or
       Hebrew the page is RTL and "Bytes sent 12.4 kB" would be reordered into
       something that reads as a different number. */
    <div
      dir="ltr"
      className="mt-2 w-full overflow-hidden rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-left font-mono text-[11px] leading-relaxed"
    >
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-gold/70">
        <span>AI Talk diagnostics</span>
        <span className="text-white/30">temporary</span>
      </div>

      <Row label="State" value={d.state} />
      <Row
        label="Mic"
        value={d.micReady ? 'READY' : 'NOT READY'}
        tone={d.micReady ? 'good' : 'bad'}
      />
      <Row
        label="Track"
        value={`${d.trackState ?? '—'}${d.trackMuted ? ' muted' : ''}${d.trackEnabled === false ? ' disabled' : ''}`}
        tone={d.trackState === 'live' && !d.trackMuted ? 'good' : 'bad'}
      />
      {/* The number this whole investigation turned on: what the browser
          actually gave, not what was asked for. */}
      <Row
        label="Input rate"
        value={d.contextSampleRate ? `${d.contextSampleRate} Hz (${d.contextState ?? '?'})` : '—'}
        tone={d.contextState === 'running' ? 'good' : 'bad'}
      />
      <Row
        label="Sent as"
        value={`${d.sendSampleRate} Hz${d.resampling ? ' (resampled)' : ''}`}
      />
      <Row label="Input RMS" value={`${d.rms.toFixed(4)} (peak ${d.peakRms.toFixed(4)})`} tone={d.peakRms > 0.012 ? 'good' : 'idle'} />
      <Row label="Blocks" value={n(d.blocks)} tone={d.blocks > 0 ? 'good' : 'bad'} />
      <Row label="Samples kept" value={n(d.samplesCaptured)} />
      <Row label="Bytes sent" value={kb(d.bytesSent)} tone={d.bytesSent > 0 ? 'good' : 'idle'} />
      <Row label="Capturing" value={d.capturing ? 'YES' : 'no'} />
      <Row label="Silence" value={ms(d.silenceMs)} />
      <Row
        label="Utterances"
        value={`${d.utterances}${d.lastUtteranceMs !== null ? ` (last ${d.lastUtteranceMs} ms, ${kb(d.lastUtteranceBytes)})` : ''}`}
        tone={d.utterances > 0 ? 'good' : 'idle'}
      />
      <Row
        label="STT calls"
        value={`${d.sttRequests} → ok ${d.sttOk} / empty ${d.sttEmpty} / failed ${d.sttFailed}`}
        tone={d.sttFailed > 0 ? 'bad' : d.sttOk > 0 ? 'good' : 'idle'}
      />
      <Row label="STT latency" value={ms(d.lastSttMs)} />
      <Row
        label="STT result"
        value={d.lastSttChars === null ? '—' : `${d.lastSttChars} chars${d.lastSttLanguage ? ` [${d.lastSttLanguage}]` : ''}`}
        tone={d.lastSttChars ? 'good' : 'idle'}
      />
      <Row label="Turns sent" value={`${d.turnsSent}${d.lastTurnMs !== null ? ` (${d.lastTurnMs} ms)` : ''}`} tone={d.turnsSent > 0 ? 'good' : 'idle'} />
      {/* The server's own split of that round trip, so a slow turn can be
          attributed to the half that was slow. */}
      <Row label="  think / speak" value={`${ms(d.lastLlmMs)} / ${ms(d.lastTtsMs)}`} />
      <Row
        label="Last word → sound"
        value={ms(d.lastPlaybackMs)}
        tone={d.lastPlaybackMs !== null && d.lastPlaybackMs < 6000 ? 'good' : d.lastPlaybackMs !== null ? 'bad' : 'idle'}
      />
      <Row label="Reply" value={d.lastReplyChars === null ? '—' : `${d.lastReplyChars} chars, ${kb(d.lastAudioBytes)} audio`} />
      <Row label="Playbacks" value={n(d.playbacks)} tone={d.playbacks > 0 ? 'good' : 'idle'} />
      <Row
        label="Transcription"
        value={d.liveMode === 'live'
          ? `live${d.liveModel ? ` (${d.liveModel})` : ''}`
          : `batch${d.liveFellBack ? ` — fell back: ${d.liveFellBack}` : ''}`}
        tone={d.liveMode === 'live' ? 'good' : 'idle'}
      />
      <Row label="Last error" value={d.lastError ?? 'none'} tone={d.lastError ? 'bad' : 'good'} />

      {d.lastTranscript ? (
        <div className="mt-1.5 border-t border-white/10 pt-1.5">
          <div className="text-white/40">Last transcript</div>
          <div className="[overflow-wrap:anywhere] text-white">{d.lastTranscript}</div>
        </div>
      ) : null}
    </div>
  );
}
