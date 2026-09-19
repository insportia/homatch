// The final browser AI TALK hardening pass, proven on the real code.
//
// Four things this pins, each from a real trace or a real reading:
//
//   the public page must never render the engineering panel -- it did, on
//   the plain address, because sessionStorage remembered ?debugAiTalk=1;
//   30 of 53 audio chunks on a real turn were STOPPED with no named reason --
//   the session was ended mid-reply and the trace could not say so;
//   "queued -> audible" read 1793 ms on a real turn that was 170 ms, because
//   the stamp was taken only after the stream finished;
//   the pipeline already overlaps (first phrase to the voice ~97 ms after the
//   first token, real p50), and nothing said so.
//
// And the language registry: six became forty-four, every one checked
// against the live recogniser and the voice's own list.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LANGUAGE_REGISTRY, LANGUAGE_CODES, STT_TAGS, LANGUAGE_NAMES, SCRIPT_FAMILIES, SCRIPT_OF, LATIN_CODES,
  guessLatinLanguage,
} from '../languageRegistry.ts';
import { resolveTurnLanguage, normaliseLanguage, TALK_LANGUAGES } from '../talkLanguage.ts';
import { judgeOverlap, summariseGaps } from '../streamingOverlap.ts';
import { PcmStreamPlayer } from '../pcmPlayer.ts';
import { planRecovery } from '../sameTurnRecovery.ts';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 1. Nothing technical for a normal visitor ─────────────────────────── */

test('the engineering panel is gated by the URL on THIS load, never by storage', () => {
  const panel = strip(readFileSync('src/components/home/AiTalkPanel.tsx', 'utf8'));
  const fn = panel.slice(panel.indexOf('function debugRequested'), panel.indexOf('const FUNCTIONS_URL'));
  assert.doesNotMatch(fn, /getItem\('homatch_debug_ai_talk'\)/, 'a remembered flag is how the panel leaked onto the public address');
  assert.match(fn, /removeItem\('homatch_debug_ai_talk'\)/, 'and whatever an older build stored is cleared');
  assert.match(fn, /get\('debugAiTalk'\)/, 'the explicit flag still works');
  assert.match(panel, /\{debug \? \(\s*<AiTalkDiagnostics/, 'the panel renders only behind that flag');
});

/* ── 2. Every stop has a name, even when the verdict never ran ─────────── */

test('the trace names who stopped playback even if the session closed mid-reply', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.match(c, /playbackInterruptReason: this\.diag\.playbackInterruptReason \?\? this\.player\?\.turnStats\(\)\.stopReason \?\? null/,
    'the player knows the reason; 30 stopped chunks must not read as "null"');
  assert.match(c, /this\.stopPlayback\(reason === 'allowance' \? 'SESSION_END' : 'SESSION_STOP'\)/,
    'a user Stop is a SESSION_STOP, not a mystery');
});

test('first-audible is stamped on the session clock, not after the stream ends', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  const tick = c.slice(c.indexOf('this.tickHandle = window.setInterval('), c.indexOf('this.diagHandle = window.setInterval('));
  assert.match(tick, /firstAudibleAtMs = Date\.now\(\)/, 'the 250 ms tick stamps it while audio is still flowing');
});

test('echo cancellation is read from the microphone track, not assumed', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.doesNotMatch(c, /echoCancelled: true,/, 'hard-coding true disabled the echo guard for every laptop speaker');
  assert.match(c, /getSettings\?\.\(\)\.echoCancellation/, 'the browser says whether it applied it');
});

/* ── 3. Segment gaps are measured on the real player ──────────────────── */

class FakeContext {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.sources = []; }
  createBuffer(_c, n, r) { const d = new Float32Array(n); return { length: n, sampleRate: r, duration: n / r, copyToChannel: (a) => d.set(a) }; }
  createBufferSource() { const s = { buffer: null, onended: null, _at: null, connect() {}, disconnect() {}, start(at) { s._at = at; this._ctx.sources.push(s); }, stop() { s._stopped = true; }, _ctx: this }; return s; }
  advance(sec) { this.currentTime += sec; for (const s of this.sources) if (!s._done && !s._stopped && s._at !== null && this.currentTime >= s._at + s.buffer.duration) { s._done = true; s.onended?.(); } }
}
const pcm = (ms) => { const n = Math.round(ms * 48); const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 7) * 5000), i * 2); return b.toString('base64'); };

test('a continuous stream schedules back to back: no technical gap between segments', () => {
  const ctx = new FakeContext(); const p = new PcmStreamPlayer(ctx, {}); p.startTurn(1);
  for (let i = 0; i < 40; i++) { p.push(pcm(200), 48000, 1); ctx.advance(0.09); }   // arrives faster than it plays
  p.endOfTurn(); ctx.advance(20);
  const t = p.turnStats();
  assert.equal(t.gapsMs.length, 0, 'segments from separate TTS requests must sound like one answer');
  assert.equal(t.drained, true);
});

test('a starved stream records the silence the listener actually heard', () => {
  const ctx = new FakeContext(); const p = new PcmStreamPlayer(ctx, {}); p.startTurn(1);
  for (let i = 0; i < 5; i++) { p.push(pcm(200), 48000, 1); ctx.advance(0.1); }
  ctx.advance(1.5);                                   // the next phrase arrived 1.5 s late
  for (let i = 0; i < 5; i++) { p.push(pcm(200), 48000, 1); ctx.advance(0.1); }
  p.endOfTurn(); ctx.advance(20);
  const g = summariseGaps(p.turnStats().gapsMs);
  assert.equal(g.count, 1, 'one gap, at the segment boundary');
  assert.ok(g.max >= 1000 && g.max <= 1700, `measured ${g.max} ms`);
});

/* ── 3b. The first word is never clipped ───────────────────────────────── */

test('the first word is scheduled whole, ahead of the clock, with every sample', () => {
  // A source that starts before the clock has its first milliseconds dropped
  // by the browser, which is heard as a word beginning mid-syllable. So the
  // first piece must start strictly at or after "now", and nothing may trim
  // its leading samples: the player gathers ~120 ms before scheduling, and
  // what it gathers it keeps.
  for (const lead of ['კი, რა თქმა უნდა', 'Sure, of course', 'Да, конечно', 'نعم', 'नमस्ते']) {
    const ctx = new FakeContext(); ctx.currentTime = 3.21;
    const p = new PcmStreamPlayer(ctx, {}); p.startTurn(1);
    const pieces = [20, 20, 40, 60];                          // provider chunks, as small as they come
    for (const ms of pieces) p.push(pcm(ms), 48000, 1);
    const first = ctx.sources[0];
    assert.ok(first, `${lead}: the first piece is scheduled once enough has arrived`);
    assert.ok(first._at >= ctx.currentTime, `${lead}: starts at ${first._at}, clock ${ctx.currentTime}`);
    assert.equal(first.buffer.length, pieces.reduce((a, b) => a + b, 0) * 48, `${lead}: every sample of the first word is played`);
  }
});

test('a one-word reply shorter than a batch is still played, at end of turn', () => {
  const ctx = new FakeContext(); ctx.currentTime = 1;
  const p = new PcmStreamPlayer(ctx, {}); p.startTurn(1);
  p.push(pcm(70), 48000, 1);                                  // "კი." -- less than one batch
  assert.equal(ctx.sources.length, 0, 'held for more');
  p.endOfTurn();
  assert.equal(ctx.sources.length, 1, 'and released whole when the turn ends');
  assert.equal(ctx.sources[0].buffer.length, 70 * 48);
  assert.ok(ctx.sources[0]._at >= 1);
});

/* ── 4. Overlap is judged from the server's own stamps ───────────────── */

test('the real p50 turn overlaps at every stage', () => {
  // From 73 production turns: first token 1009, first TTS request 1107,
  // first byte 1233, model finished 2865, audio kept coming after that.
  const v = judgeOverlap({
    llmFirstTokenMs: 1009, llmFinalMs: 2865, firstAudioSentMs: 1300,
    segments: [
      { index: 0, requestMs: 1107, firstByteMs: 1233, doneMs: 2400, textChars: 40 },
      { index: 1, requestMs: 1900, firstByteMs: 2050, doneMs: 3300, textChars: 60 },
      { index: 2, requestMs: 2865, firstByteMs: 3010, doneMs: 4300, textChars: 50 },
    ],
  });
  assert.equal(v.lunaAndTts, true, 'LUNA_GENERATION_AND_TTS_OVERLAP');
  assert.equal(v.lunaAndPlayback, true, 'LUNA_GENERATION_AND_PLAYBACK_OVERLAP');
  assert.equal(v.ttsAndPlayback, true, 'TTS_AND_PLAYBACK_OVERLAP');
  assert.equal(v.firstSpeakablePhraseMs, 1107);
});

test('a document-then-read pipeline would be caught', () => {
  const v = judgeOverlap({
    llmFirstTokenMs: 1000, llmFinalMs: 3000, firstAudioSentMs: 3400,
    segments: [{ index: 0, requestMs: 3100, firstByteMs: 3300, doneMs: 5000, textChars: 200 }],
  });
  assert.equal(v.lunaAndTts, false);
  assert.equal(v.lunaAndPlayback, false);
});

/* ── 5. The registry, and the languages that ride on it ───────────────── */

test('every registry language has a tag, a name, a script and a family', () => {
  assert.ok(LANGUAGE_REGISTRY.length >= 40, `${LANGUAGE_REGISTRY.length} languages`);
  for (const l of LANGUAGE_REGISTRY) {
    assert.match(l.sttTag, /^[a-z]{2,3}(-[A-Za-z]{2,4})?(-[A-Z]{2})?$/, `${l.code} tag ${l.sttTag}`);
    assert.equal(STT_TAGS[l.code], l.sttTag);
    assert.equal(LANGUAGE_NAMES[l.code], l.name);
    assert.equal(SCRIPT_OF[l.code], l.script);
    if (l.script !== 'latin') assert.ok(SCRIPT_FAMILIES[l.script]?.includes(l.code), `${l.code} missing from its ${l.script} family`);
  }
  assert.deepEqual([...TALK_LANGUAGES], LANGUAGE_CODES, 'the resolver runs on the same table');
  assert.ok(!LANGUAGE_CODES.includes('fa'), 'Persian can be heard but not spoken by the voice: honestly absent');
  for (const six of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) assert.ok(LANGUAGE_CODES.includes(six));
  for (const want of ['hi', 'ur', 'uk', 'es', 'fr', 'de', 'ja', 'ko']) assert.ok(LANGUAGE_CODES.includes(want), want);
  // Chinese and Filipino were removed: the live gateway forwards only xx-XX tags (see multilingualRepair).
  assert.ok(!LANGUAGE_CODES.includes('zh') && !LANGUAGE_CODES.includes('tl'));
});

/*
 * THE SIX SUPERSEDED THE FORTY-FOUR ON 2026-09-19.
 *
 * These cases were written when any of the registry's forty-four languages
 * could become the language of a conversation. Production session caeddb62
 * showed what that costs: a Georgian speaker on an English page, a recogniser
 * pinned ka-GE, and a Devanagari transcript labelled `hi` that resolved at
 * confidence 1 and was answered in Hindi, by voice.
 *
 * The registry still knows forty-four languages -- for their scripts, their
 * names and their words -- and that part of these tests is unchanged. What
 * changed is that only the six the microphone can be pinned to may CARRY a
 * conversation, so the cases naming Hindi, Ukrainian, Spanish or Urdu as a
 * session language now assert the allowlist instead.
 */
test('Hindi, Ukrainian, Spanish and Urdu are read but never become the conversation', () => {
  const r = (transcript, providerLanguage, previous) => resolveTurnLanguage({ transcript, providerLanguage, previousSessionLanguage: previous, pageLocale: 'ka' });
  // Held, every one of them, whatever the label and however clear the script.
  assert.equal(r('नमस्ते, मुझे त्बिलिसी में एक फ्लैट चाहिए।', 'hi-IN', 'ka').resolvedLanguage, 'ka');
  assert.equal(r('Привіт, скільки коштує квартира у Ваке?', 'uk-UA', 'ka').resolvedLanguage, 'ka');
  assert.equal(r('Hola, ¿cuánto cuesta un piso en Vake?', 'es-ES', 'ka').resolvedLanguage, 'ka');
  assert.equal(r('مجھے تبلیسی میں ایک فلیٹ چاہیے', 'ur-PK', 'ka').resolvedLanguage, 'ka');
  assert.equal(
    r('नमस्ते, मुझे त्बिलिसी में एक फ्लैट चाहिए।', 'hi-IN', 'ka').resolutionReason,
    'UNSUPPORTED_LANGUAGE', 'the refusal has to say what it refused',
  );
  // The two of these that ARE ours still resolve exactly as before.
  assert.equal(r('Привет, сколько стоит квартира в Ваке?', 'ru-RU', 'ka').resolvedLanguage, 'ru');
  assert.equal(r('مرحبا، أبحث عن شقة في تبليسي', 'ar-XA', 'ka').resolvedLanguage, 'ar');
});

test('short answers in any of the new languages do not flip a session', () => {
  // Sessions are one of the six now, so the short-token cases are too.
  for (const [session, token, label] of [['ar', 'نعم', 'ar-XA'], ['ar', 'لا', 'ar-XA'],
    ['ka', 'ok', 'en-US'], ['he', 'כן', 'iw-IL'], ['tr', 'evet', 'tr-TR'], ['ru', 'да', 'ru-RU']]) {
    const r = resolveTurnLanguage({ transcript: token, providerLanguage: label, previousSessionLanguage: session, pageLocale: 'ka' });
    assert.equal(r.resolvedLanguage, session, `"${token}" moved a ${session} session to ${r.resolvedLanguage}`);
  }
});

test('the Latin guess tells the major Latin languages apart and defaults to English', () => {
  assert.equal(guessLatinLanguage('Tamam, peki Vake\'de bir dairenin fiyatı ne kadar?'), 'tr');
  assert.equal(guessLatinLanguage('Wie viel kostet eine Wohnung in Vake und ist das nicht zu teuer?'), 'de');
  assert.equal(guessLatinLanguage('Combien coûte un appartement à Vake, est-ce que vous savez?'), 'fr');
  assert.equal(guessLatinLanguage('Okay, and how much does a square metre cost in Vake right now?'), 'en');
});

test('same-turn recovery reaches beyond the six, and asks for no language', () => {
  assert.equal(normaliseLanguage('cmn-Hans-CN'), null, 'a tag the gateway cannot forward is not a language we claim');
  assert.equal(normaliseLanguage('uk-UA'), 'uk');
  const plan = planRecovery({ pinned: 'es', transcript: 'gamarjoba me minda ortotakhiani bina vakeshi ramdeni ghirs', speechMs: 2000, spent: 0 });
  assert.ok(plan && plan.hint === null && plan.reason === 'NO_FUNCTION_WORDS', 'Georgian into a Spanish socket recovers, hint-free');
  assert.equal(planRecovery({ pinned: 'es', transcript: 'Hola, ¿cuánto cuesta un piso en Vake para comprar ahora?', speechMs: 2000, spent: 0 }), null, 'real Spanish stays');
});

/* ── 6. The voice and the character ──────────────────────────────────── */

test('the voice runs at its natural pace and the character grew without losing its manners', () => {
  const edge = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  assert.match(edge, /const CARTESIA_DEFAULT_SPEED = 1\.0;/);
  // The three sections that described this character in different words were
  // merged into one, because the model reads all of it on every turn. Every
  // rule they carried is still here, under the heading that replaced them.
  assert.match(edge, /WHO YOU ARE\. A sharp, well-read person/);
  // Swearing is answered under its own heading now, and the rule grew rather
  // than moved: a comeback, no lecture, and no call ended over language.
  assert.match(edge, /WHEN THEY SWEAR, JOKE OR COME AT YOU/);
  assert.match(edge, /Mild profanity of your/);
  assert.match(edge, /NEVER a line about staying respectful/);
  assert.match(edge, /ending a call because somebody swore/);
  assert.match(edge, /Never insult,\s*'?,?\s*'?belittle, threaten or abuse anyone/);
  assert.match(edge, /Humour must be native to the language/);
  assert.match(edge, /Do not perform emotion you do not have/, 'moods come from context, not a generator');
  assert.match(edge, /Do not laugh at your own lines/);
  assert.match(edge, /LANGUAGE_NAMES: Record<string, string> = REGISTRY_LANGUAGE_NAMES/, 'reply names come from the shared registry');
  assert.match(edge, /overlap: judgeOverlap\(/, 'the done event carries the overlap verdict');
});
