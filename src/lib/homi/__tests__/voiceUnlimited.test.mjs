// HOMI voice feels genuinely unlimited (owner, 2026-10-29): free in every
// plan, no price, no consent popup, no balance popup, and the two minute
// per-request cap never ends a message. Long dictation is cut into parts that
// are transcribed in the background and joined into ONE message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinTranscripts, PART_CUT_MS, partDue, RECORDER_SEGMENT_MS, totalSeconds } from '../../../components/ai/voiceParts.ts';

const root = new URL('../../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const button = strip(read('src/components/ai/VoiceMessageButton.tsx'));
const hook = strip(read('src/components/ai/useVoiceRecorder.ts'));
const service = strip(read('src/services/homiVoice.ts'));
const limits = read('supabase/functions/homi-voice-transcribe/voiceLimits.ts');

test('a part is always inside the server\'s per-request cap (two segments, two minutes)', () => {
  assert.equal(RECORDER_SEGMENT_MS, Number(hook.match(/export const SEGMENT_MS = ([\d_]+);/)[1].replace(/_/g, '')), 'voiceParts and the recorder agree on the segment length');
  assert.ok(PART_CUT_MS < 2 * RECORDER_SEGMENT_MS, 'cut before a third segment starts');
  assert.ok(PART_CUT_MS <= Number(limits.match(/MAX_MESSAGE_SECONDS = (\d+)/)[1]) * 1000, 'inside the server cap');
  assert.ok(PART_CUT_MS > 100_000, 'parts are long, so a dictation is a few requests, not many');
  assert.equal(partDue(PART_CUT_MS - 1, 0), false);
  assert.equal(partDue(PART_CUT_MS, 0), true);
  assert.equal(partDue(2 * PART_CUT_MS, PART_CUT_MS), true, 'measured from the start of the current part');
});

test('the parts become one message, in the order spoken, silent parts left out', () => {
  assert.equal(joinTranscripts([
    { transcript: 'I am looking for a flat in Vake ', noSpeech: false, durationSeconds: 114 },
    { transcript: '', noSpeech: true, durationSeconds: 114 },
    { transcript: ' with three rooms and a balcony.', noSpeech: false, durationSeconds: 40 },
  ]), 'I am looking for a flat in Vake with three rooms and a balcony.');
  assert.equal(joinTranscripts([{ transcript: '', noSpeech: true, durationSeconds: 3 }]), '');
  assert.equal(totalSeconds([{ durationMs: 114500, result: { transcript: 'a', noSpeech: false, durationSeconds: 114 } }, { durationMs: 20000, result: null }]), 134);
});

test('reaching the cap continues recording: the finished part goes, the microphone stays open', () => {
  assert.match(hook, /const takePart = useCallback/);
  // On a part boundary the recorder starts the next segment on the same stream before handing the part over.
  const cut = hook.slice(hook.indexOf('if (cutting.current && !finishing.current)'), hook.indexOf('} else if (finishing.current)'));
  assert.match(cut, /if \(stream\.current\) startSegment\(\);/);
  assert.ok(cut.indexOf('startSegment()') < cut.indexOf('done(part)'), 'recording resumes before the part is processed');
  assert.match(button, /partDue\(rec\.elapsedMs, partStartedAt\.current\)\) void cutPart\(\)/);
  assert.match(button, /await rec\.takePart\(\)/);
  assert.match(button, /void sendPart\(part\)/, 'each finished part is transcribed in the background');
  assert.match(button, /for \(const part of list\) results\.push\(await sendPart\(part\)\)/, 'send joins every part in order');
  assert.match(button, /onTranscript\(text, note\)/);
  // The cap never finishes the message on its own.
  assert.doesNotMatch(button, /elapsedSeconds >= limitSeconds|limitSeconds/);
});

test('no charge, no popup, no countdown and no limit on screen', () => {
  for (const gone of ['voice_consent_', 'voice_topup_', 'voice_price_chip', 'voice_time_left', 'Wallet', "navigate('/credits')", 'INSUFFICIENT_CREDITS', 'CONSENT_REQUIRED', 'acceptVoiceConsent', 'chargedCredits']) {
    assert.ok(!button.includes(gone), `VoiceMessageButton still has ${gone}`);
  }
  for (const gone of ['consent', 'creditsPerMinute', 'affordableSeconds', 'balance', 'chargedCredits', 'INSUFFICIENT_CREDITS']) {
    assert.ok(!service.includes(gone), `homiVoice.ts still has ${gone}`);
  }
  // The only dialog left is the microphone or availability notice.
  assert.equal((button.match(/<Dialog /g) ?? []).length, 1);
  assert.match(button, /t\('voice_keep_talking'\)/, 'a subtle indicator only');
  assert.doesNotMatch(button, /formatClock\(limit/);
});
