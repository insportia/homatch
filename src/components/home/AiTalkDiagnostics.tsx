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

export function AiTalkDiagnostics(
  { d, onDownloadSentAudio }: { d: VoiceDiagnostics | null; onDownloadSentAudio?: () => void },
) {
  if (!d) return null;

  /*
   * A REAL DEVICE CANNOT BE READ OVER SOMEBODY'S SHOULDER.
   *
   * Every latency number this project has is from synthetic speech played
   * into the stack. The questions a phone raises -- was the first syllable
   * captured, how fast did it stop when interrupted, what did it actually
   * hear in a noisy room -- can only be answered by the person holding it,
   * and only if they can get the answer back off the phone.
   *
   * So the turn trace is copyable. Durations, counts, and the transcript the
   * speaker just watched appear on their own screen; nothing is recorded,
   * nothing is uploaded, and this whole panel is behind ?debugAiTalk=1.
   */
  const copyTrace = () => {
    const payload = JSON.stringify({
      device: navigator.userAgent,
      liveMode: d.liveMode ?? null,
      liveProvider: d.liveProvider ?? null,
      voicedBeforeReadyMs: d.voicedBeforeReadyMs ?? null,
      droppedPreReadyBytes: d.droppedPreReadyBytes ?? null,
      // The actual format, so the next trace proves what Android delivered
      // rather than what a laptop did.
      contextSampleRate: d.contextSampleRate ?? null,
      sendSampleRate: d.sendSampleRate ?? null,
      resampling: d.resampling ?? null,
      lastBargeStopMs: d.lastBargeStopMs ?? null,
      languageSwitches: d.languageSwitches ?? null,
      languageProbes: d.languageProbes ?? null,
      // The socket's lifecycle, so the next trace diagnoses itself.
      livePhase: d.livePhase ?? null,
      socketReadyMs: d.socketReadyMs ?? null,
      socketFailures: d.socketFailures ?? null,
      socketReconnects: d.socketReconnects ?? null,
      liveFellBack: d.liveFellBack ?? null,
      // All canonical outgoing PCM. bufferFormat names the unit.
      bufferFormat: d.bufferFormat ?? null,
      postResampleBytes: d.postResampleBytes ?? null,
      sentLiveBytes: d.sentLiveBytes ?? null,
      flushedBufferedBytes: d.flushedBufferedBytes ?? null,
      bufferedPcmBytes: d.bufferedPcmBytes ?? null,
      maxPreReadyBufferBytes: d.maxPreReadyBufferBytes ?? null,
      bufferDurationMs: d.bufferDurationMs ?? null,
      bytesAccountedFor: d.bytesAccountedFor ?? null,
      // Why a session stopped answering, and whether the last answer finished.
      sessionElapsedMs: d.sessionElapsedMs ?? null,
      sessionRemainingMs: d.sessionRemainingMs ?? null,
      sessionMaxMs: d.sessionMaxMs ?? null,
      turnCount: d.turnCount ?? null,
      newTurnsBlocked: d.newTurnsBlocked ?? null,
      sessionEndReason: d.sessionEndReason ?? null,
      llmTextChars: d.llmTextChars ?? null,
      ttsTextChars: d.ttsTextChars ?? null,
      ttsRequests: d.ttsRequests ?? null,
      assistantResponseCompleted: d.assistantResponseCompleted ?? null,
      responseInterruptReason: d.responseInterruptReason ?? null,
      finalTextTail: d.finalTextTail ?? null,
      playbackQueuedChunks: d.playbackQueuedChunks ?? null,
      playbackCompletedChunks: d.playbackCompletedChunks ?? null,
      // Per-response completeness: did the model, the voice and the speaker agree?
      responseId: d.responseId ?? null,
      playbackStartedChunks: d.playbackStartedChunks ?? null,
      playbackStoppedChunks: d.playbackStoppedChunks ?? null,
      playbackQueueDrained: d.playbackQueueDrained ?? null,
      playbackLastChunkEndedAt: d.playbackLastChunkEndedAt ?? null,
      assistantAudibleResponseCompleted: d.assistantAudibleResponseCompleted ?? null,
      playbackInterruptReason: d.playbackInterruptReason ?? null,
      ttsCompletedRequests: d.ttsCompletedRequests ?? null,
      ttsFinalTail: d.ttsFinalTail ?? null,
      usageTier: d.usageTier ?? null,
      configuredSessionSeconds: d.configuredSessionSeconds ?? null,
      effectiveSessionSeconds: d.effectiveSessionSeconds ?? null,
      adminTechnicalCeilingSeconds: d.adminTechnicalCeilingSeconds ?? null,
      // Same-turn language recovery: the audio was re-heard in a named language.
      sameTurnRecoveries: d.sameTurnRecoveries ?? null,
      lastRecovery: d.lastRecovery ?? null,
      // Streaming overlap and the technical silences between segments.
      echoCancellation: d.echoCancellation ?? null,
      playbackGapsMs: d.playbackGapsMs ?? [],
      segments: d.segments ?? null,
      overlap: d.overlap ?? null,
      gateReleases: d.gateReleases ?? null,
      // The final that never came, and what was done about it.
      noFinalCount: d.noFinalCount ?? null,
      consecutiveNoFinals: d.consecutiveNoFinals ?? null,
      noFinalRecoveries: d.noFinalRecoveries ?? null,
      lastNoFinalReason: d.lastNoFinalReason ?? null,
      lastNoFinalAt: d.lastNoFinalAt ?? null,
      socketCloseReason: d.socketCloseReason ?? null,
      socketCloseHadFinal: d.socketCloseHadFinal ?? null,
      turns: d.turnTrace ?? [],
    }, null, 1);
    void navigator.clipboard?.writeText(payload).catch(() => {});
  };

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
        label="TTS transport"
        value={d.streamedTts === null ? '—' : d.streamedTts ? 'streamed' : 'whole clip'}
        tone={d.streamedTts ? 'good' : d.streamedTts === false ? 'bad' : 'idle'}
      />
      <Row
        label="Transcription"
        value={d.liveMode === 'live'
          ? `live${d.liveProvider ? ` · ${d.liveProvider}` : ''}`
            + `${d.liveModel ? ` (${d.liveModel})` : ''}`
            + `${d.liveKeyterms ? ` · ${d.liveKeyterms} keyterms` : ''}`
          : `batch${d.liveFellBack ? ` — fell back: ${d.liveFellBack}` : ''}`}
        tone={d.liveMode === 'live' ? 'good' : 'idle'}
      />
      <Row
        label="Voice refused"
        value={d.voiceFailure ?? '—'}
        tone={d.voiceFailure ? 'bad' : 'idle'}
      />
      {/*
        * THE TURN, STAGE BY STAGE.
        *
        * T0 the caller stops, T1 the endpointer commits, T2 words exist, T3
        * we ask, T4 first token, T5 synthesis starts, T6 first audio byte,
        * T7 a sound comes out. The server's stages arrive as offsets from T3
        * because the two machines do not share a clock.
        */}
      <Row label="— endpoint (T1-T0)" value={ms(d.stages?.endpointingMs ?? null)} />
      <Row label="— transcript (T2-T1)" value={ms(d.stages?.transcriptionMs ?? null)} />
      <Row label="— dispatch (T3-T2)" value={ms(d.stages?.dispatchMs ?? null)} />
      <Row label="— LLM first token (T4-T3)" value={ms(d.stages?.llmTtftMs ?? null)} />
      <Row label="— handoff (T5-T4)" value={ms(d.stages?.handoffMs ?? null)} />
      <Row label="— TTS first audio (T6-T5)" value={ms(d.stages?.ttsFirstAudioMs ?? null)} />
      <Row label="— playback (T7-T6)" value={ms(d.stages?.playbackMs ?? null)} />
      <Row
        label="SPEECH TO SPEECH (T7-T0)"
        value={ms(d.stages?.perceivedMs ?? null)}
        tone={d.stages?.perceivedMs == null ? 'idle'
          : d.stages.perceivedMs < 2000 ? 'good'
          : d.stages.perceivedMs < 2500 ? 'idle' : 'bad'}
      />
      <Row label="Last error" value={d.lastError ?? 'none'} tone={d.lastError ? 'bad' : 'good'} />

      {d.lastTranscript ? (
        <div className="mt-1.5 border-t border-white/10 pt-1.5">
          <div className="text-white/40">Last transcript</div>
          <div className="[overflow-wrap:anywhere] text-white">{d.lastTranscript}</div>
        </div>
      ) : null}

      {/* The three answers only a real device can give. */}
      <div className="mt-1.5 border-t border-white/10 pt-1.5">
        <Row
          label="Voice before socket ready"
          value={`${d.voicedBeforeReadyMs ?? 0} ms`}
          tone={(d.voicedBeforeReadyMs ?? 0) > 0 ? 'bad' : 'good'}
        />
        <Row
          label="Barge-in stop"
          value={d.lastBargeStopMs === null || d.lastBargeStopMs === undefined
            ? 'not interrupted yet' : `${d.lastBargeStopMs} ms`}
        />
        <Row label="Turns traced" value={String(d.turnTrace?.length ?? 0)} />
        {/* The pinned recogniser heard the wrong language and the same audio
            was heard again in a named one. Counted; never `auto`. */}
        <Row
          label="Language state"
          value={`socket ${d.languageState?.socket ?? '—'} · turn ${d.languageState?.turn ?? '—'} · prev ${d.languageState?.previous ?? '—'} · reply ${d.languageState?.response ?? '—'}${d.languageState?.recovery ? ` · recovered ${d.languageState.recovery}` : ''}`}
        />
        <Row
          label="Second opinion"
          value={d.secondOpinion
            ? `${d.secondOpinion.language ?? '?'} · ${d.secondOpinion.used ? 'used' : 'not used'} (${d.secondOpinion.why}, ${d.secondOpinion.waitMs} ms, ${d.secondOpinion.chars} chars)${d.secondOpinionFailures ? ` · ${d.secondOpinionFailures} failed` : ''}${d.lateFinalsDropped ? ` · ${d.lateFinalsDropped} late finals dropped` : ''}`
            : (d.secondOpinionFailures ? `${d.secondOpinionFailures} failed` : '—')}
        />
        <Row
          label="Same-turn recovery"
          value={d.lastRecovery
            ? `${d.sameTurnRecoveries ?? 0} · last ${d.lastRecovery.reason} → ${d.lastRecovery.language ?? '?'} in ${d.lastRecovery.ms} ms, ${d.lastRecovery.used ? 'used' : 'not used'}`
            : String(d.sameTurnRecoveries ?? 0)}
          tone={(d.sameTurnRecoveries ?? 0) > 0 ? 'idle' : 'good'}
        />
        {/* Every socket that asked Google to guess. The prior is the
            configuration now, so this should stay at zero unless sustained
            speech repeatedly failed to resolve against it. */}
        <Row
          label="Language probes"
          value={String(d.languageProbes ?? 0)}
          tone={(d.languageProbes ?? 0) > 0 ? 'bad' : 'good'}
        />
      </div>

      <Row
        label="Socket"
        value={`${d.livePhase ?? '—'}`
          + `${d.socketReadyMs !== null && d.socketReadyMs !== undefined ? ` · ready in ${d.socketReadyMs} ms` : ''}`}
        tone={d.livePhase === 'READY' ? 'good' : d.livePhase === 'FAILED' ? 'bad' : 'idle'}
      />
      <Row
        label="  failures / reconnects"
        value={`${d.socketFailures ?? 0} / ${d.socketReconnects ?? 0}`}
        tone={(d.socketFailures ?? 0) > 0 ? 'bad' : 'good'}
      />
      <Row label="Held across rotation" value={`${d.preReadyFlushBytes ?? 0} B in ${d.preReadyFlushMs ?? 0} ms`} />
      <Row label="Buffer now" value={`${d.bufferedPcmBytes ?? 0} B (${d.bufferDurationMs ?? 0} ms), peak ${kb(d.maxPreReadyBufferBytes)}`} />
      <Row label="Buffer format" value={d.bufferFormat ?? '—'} />
      {/* A socket that ended without a transcript used to end the session.
          Now it is a counted, recovered event -- or an explicit failure. */}
      <Row
        label="No-final"
        value={`${d.noFinalCount ?? 0} (${d.consecutiveNoFinals ?? 0} in a row), recovered ${d.noFinalRecoveries ?? 0}`
          + `${d.lastNoFinalReason ? ` · last ${d.lastNoFinalReason}` : ''}`}
        tone={(d.consecutiveNoFinals ?? 0) >= 3 ? 'bad' : (d.noFinalCount ?? 0) > 0 ? 'idle' : 'good'}
      />
      <Row
        label="Last socket close"
        value={d.socketCloseHadFinal === null || d.socketCloseHadFinal === undefined
          ? '—' : `${d.socketCloseHadFinal ? 'after final' : 'WITHOUT final'}${d.socketCloseReason ? ` · ${d.socketCloseReason}` : ''}`}
        tone={d.socketCloseHadFinal === false ? 'bad' : 'good'}
      />
      {/* A session that looks like it is listening and is consuming nothing. */}
      <Row
        label="Consumer blocked by"
        value={d.micGated ? 'assistant speaking' : d.transcribing ? 'transcription in flight' : 'nothing'}
        tone={d.micGated || d.transcribing ? 'bad' : 'good'}
      />
      {/* Every byte in exactly one category, or every number above is
          suspect. Computed on the device, reported rather than asserted. */}
      <Row
        label="Bytes accounted for"
        value={d.bytesAccountedFor === undefined || d.bytesAccountedFor === null
          ? '—' : d.bytesAccountedFor ? 'YES' : 'NO — counter bug'}
        tone={d.bytesAccountedFor === false ? 'bad' : 'good'}
      />
      <Row
        label="Dropped pre-ready"
        value={`${d.droppedPreReadyBytes ?? 0} B`}
        tone={(d.droppedPreReadyBytes ?? 0) > 0 ? 'bad' : 'good'}
      />

      {/* THE SESSION'S CLOCK. A conversation that stops answering must be
          able to say whether its two minutes ran out. */}
      <div className="mt-1.5 border-t border-white/10 pt-1.5">
        <Row
          label="Session"
          value={`${Math.round((d.sessionElapsedMs ?? 0) / 1000)}s of `
            + `${Math.round((d.sessionMaxMs ?? 0) / 1000)}s · ${d.turnCount ?? 0} turns`}
        />
        <Row
          label="  tier"
          value={`${d.usageTier ?? '—'} · configured ${d.configuredSessionSeconds ?? '—'}s`
            + ` · effective ${d.effectiveSessionSeconds ?? '—'}s`
            + `${d.usageTier === 'ADMIN_UNLIMITED' ? ` (admin ceiling ${d.adminTechnicalCeilingSeconds}s)` : ''}`}
        />
        <Row
          label="Ended because"
          value={d.sessionEndReason ?? (d.newTurnsBlocked ? 'time up, finishing reply' : '—')}
          tone={d.sessionEndReason ? 'bad' : 'good'}
        />
        {/* A long answer that stopped early looks exactly like a short one
            from the outside. This is the difference, stated. */}
        <Row
          label="Answer finished"
          value={d.assistantResponseCompleted === null || d.assistantResponseCompleted === undefined
            ? '—'
            : d.assistantResponseCompleted ? 'YES' : `NO — ${d.responseInterruptReason ?? 'cut off'}`}
          tone={d.assistantResponseCompleted === false ? 'bad' : 'good'}
        />
        <Row
          label="  text → speech"
          value={`${d.llmTextChars ?? 0} → ${d.ttsTextChars ?? 0} chars, ${d.ttsRequests ?? 0} req`}
        />
        {/* The verdict a person's ears give, computed instead of assumed. */}
        <Row
          label="Heard to the end"
          value={d.assistantAudibleResponseCompleted === null || d.assistantAudibleResponseCompleted === undefined
            ? '—'
            : d.assistantAudibleResponseCompleted ? 'YES'
              : `NO — ${d.playbackInterruptReason ?? (d.playbackQueueDrained === false ? 'not drained' : 'unknown')}`}
          tone={d.assistantAudibleResponseCompleted === false ? 'bad'
            : d.assistantAudibleResponseCompleted ? 'good' : 'idle'}
        />
        <Row
          label="  tts requests"
          value={`${d.ttsCompletedRequests ?? '—'} / ${d.ttsRequests ?? 0} completed`}
        />
        <Row
          label="  audio chunks"
          value={`${d.playbackCompletedChunks ?? 0} / ${d.playbackQueuedChunks ?? 0} played`
            + `${(d.playbackStoppedChunks ?? 0) > 0 ? `, ${d.playbackStoppedChunks} stopped` : ''}`}
          tone={(d.playbackQueuedChunks ?? 0) > 0
            && d.playbackCompletedChunks === d.playbackQueuedChunks ? 'good' : 'idle'}
        />
        {d.finalTextTail ? <Row label="  last words" value={d.finalTextTail} /> : null}
        {/* Did the model, the voice and the speaker overlap, or wait for each other? */}
        <Row
          label="  overlap"
          value={d.overlap
            ? `luna+tts ${d.overlap.lunaAndTts ? 'YES' : 'no'} · luna+play ${d.overlap.lunaAndPlayback ? 'YES' : 'no'} · tts+play ${d.overlap.ttsAndPlayback ? 'YES' : 'no'} · first phrase ${d.overlap.firstSpeakablePhraseMs ?? '—'} ms · ${d.overlap.segments} seg`
            : '—'}
          tone={d.overlap ? (d.overlap.lunaAndTts && d.overlap.lunaAndPlayback ? 'good' : 'bad') : 'idle'}
        />
        <Row
          label="  segment gaps"
          value={(d.playbackGapsMs ?? []).length
            ? `${d.playbackGapsMs.length} · max ${Math.max(...d.playbackGapsMs)} ms`
            : 'none'}
          tone={(d.playbackGapsMs ?? []).some((g) => g > 250) ? 'bad' : 'good'}
        />
      </div>

      <button
        type="button"
        onClick={copyTrace}
        className="mt-2 w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-white/80"
      >
        Copy turn trace
      </button>
      {onDownloadSentAudio ? (
        /* The recording the ear needs: exactly what the recogniser was sent. */
        <button
          type="button"
          onClick={onDownloadSentAudio}
          className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-white/80"
        >
          Download audio sent to STT
        </button>
      ) : null}
    </div>
  );
}
