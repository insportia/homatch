// The switch that could not be seen: Georgian into an English socket.
//
// From 73 real turns on production: the EN -> KA failure leaves NO trace it
// can be told apart by. Georgian spoken into an en-US-pinned socket comes back
// as Latin letters with the label "en-US", resolves PROVIDER_LATIN 0.7 -> en,
// and the reply is English. Same fields as a real English turn.
//
// The words are different. English holds a sentence together with "the",
// "and", "what", "how much"; a Georgian sentence transliterated into Latin
// letters has none of those. That difference earns ONE recovery of the same
// captured audio through the batch recogniser.
//
// WITH NO LANGUAGE HINT. The first version asked for one, and on 2026-09-18
// the batch recogniser was measured TRANSLATING English and Hindi speech into
// Georgian when hinted "ka" -- fluent Georgian, nothing the visitor said. Asked
// with no language it kept the language every time. So the plan names why it
// fired and never what to ask for; the script of the answer says what it was.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planRecovery, functionWordRatio, consistentWith,
  RECOVERY_MIN_SPEECH_MS, RECOVERY_MIN_WORDS, RECOVERY_MAX_PER_SESSION,
} from '../sameTurnRecovery.ts';

// What chirp_3 pinned to en-US writes when it hears Georgian: Latin letters,
// no English in them. (Measured: "Gamarjoba, me Tarieli mkhvia da Vake-shi or
// sadzineblian binas vedzeb." -- transliteration, not translation.)
const GEORGIAN_AS_LATIN = 'gamarjoba me minda ortotakhiani bina vakeshi ramdeni ghirs kvadratuli metri';
const REAL_ENGLISH = 'Okay, and how much does a square metre cost in Vake right now?';
const RUSSIAN_AS_LATIN = 'skolko stoit kvadratny metr v vake seychas';
const GEORGIAN_AS_CYRILLIC = 'гамарджоба ме минда ортотахиани бина вакеши рамдени гирс';
const REAL_RUSSIAN = 'Хорошо, а сколько стоит квадратный метр в Ваке сейчас?';
const REAL_TURKISH = 'Tamam, peki Vake\'de bir dairenin metrekare fiyatı ne kadar?';
// What a ka-GE socket wrote for Turkish speech (measured): Arabic letters.
const TURKISH_AS_ARABIC = 'مرحبا. بنم ادم تارك وواكه سيمتندي 2 ياتاك اودالي بير دايري اريورم.';

const base = { speechMs: 2400, spent: 0 };

test('function words are what tell a transliteration from a sentence', () => {
  assert.ok(functionWordRatio(REAL_ENGLISH, 'en').ratio > 0.3);
  assert.equal(functionWordRatio(GEORGIAN_AS_LATIN, 'en').ratio, 0);
  assert.ok(functionWordRatio(REAL_RUSSIAN, 'ru').ratio > 0.3);
  assert.equal(functionWordRatio(GEORGIAN_AS_CYRILLIC, 'ru').ratio, 0);
});

test('Georgian transliterated by an en-US socket earns one recovery, with no language asked for', () => {
  const plan = planRecovery({ ...base, pinned: 'en', transcript: GEORGIAN_AS_LATIN });
  assert.ok(plan, 'a recovery is planned');
  assert.equal(plan.hint, null, 'never a hint: a hint made the recogniser translate');
  assert.equal(plan.reason, 'NO_FUNCTION_WORDS');
  assert.equal(plan.ratio, 0);
});

test('real English into an en-US socket is left alone', () => {
  assert.equal(planRecovery({ ...base, pinned: 'en', transcript: REAL_ENGLISH }), null);
});

test('Russian spoken into an en-US socket recovers too, and the answer decides what it was', () => {
  const plan = planRecovery({ ...base, pinned: 'en', transcript: RUSSIAN_AS_LATIN });
  assert.ok(plan);
  assert.equal(plan.hint, null);
});

test('Georgian into a ru-RU socket (Cyrillic garbage) recovers too', () => {
  const plan = planRecovery({ ...base, pinned: 'ru', transcript: GEORGIAN_AS_CYRILLIC });
  assert.ok(plan);
  assert.equal(plan.reason, 'NO_FUNCTION_WORDS');
  assert.equal(planRecovery({ ...base, pinned: 'ru', transcript: REAL_RUSSIAN }), null, 'real Russian stays');
});

test('a Turkish socket hearing Turkish is left alone', () => {
  assert.equal(planRecovery({ ...base, pinned: 'tr', transcript: REAL_TURKISH }), null);
});

test('a script the pinned language is not written in is a recovery of its own kind', () => {
  // Turkish heard by a Georgian socket came back in Arabic letters.
  const plan = planRecovery({ ...base, pinned: 'ka', transcript: TURKISH_AS_ARABIC });
  assert.ok(plan);
  assert.equal(plan.reason, 'SCRIPT_MISMATCH');
  // and a Latin sentence in a Russian socket the same
  const latin = planRecovery({ ...base, pinned: 'ru', transcript: REAL_ENGLISH });
  assert.ok(latin);
  assert.equal(latin.reason, 'SCRIPT_MISMATCH');
});

test('a pinned language without a word list never recovers on the words alone', () => {
  for (const pinned of ['ja', 'ko', 'th', 'xx', null]) {
    assert.equal(planRecovery({ ...base, pinned, transcript: GEORGIAN_AS_LATIN }), null, String(pinned));
  }
});

test('weak and short utterances can never earn a recovery', () => {
  for (const t of ['ok', 'yes', 'Homatch', 'ki', 'vake', 'da ROI']) {
    assert.equal(planRecovery({ ...base, pinned: 'en', transcript: t }), null, `"${t}"`);
  }
  assert.equal(planRecovery({ ...base, pinned: 'en', transcript: GEORGIAN_AS_LATIN, speechMs: RECOVERY_MIN_SPEECH_MS - 1 }), null);
  assert.ok(RECOVERY_MIN_WORDS >= 4);
});

test('recovery is bounded per session', () => {
  assert.ok(planRecovery({ ...base, pinned: 'en', transcript: GEORGIAN_AS_LATIN, spent: RECOVERY_MAX_PER_SESSION - 1 }));
  assert.equal(planRecovery({ ...base, pinned: 'en', transcript: GEORGIAN_AS_LATIN, spent: RECOVERY_MAX_PER_SESSION }), null,
    'a bad microphone cannot pay for a batch call on every turn for ever');
});

test('consistency is the same judgement, asked the other way round', () => {
  assert.equal(consistentWith(GEORGIAN_AS_LATIN, 'en'), false);
  assert.equal(consistentWith(REAL_ENGLISH, 'en'), true);
  assert.equal(consistentWith(TURKISH_AS_ARABIC, 'ar'), false);
  assert.equal(consistentWith(REAL_TURKISH, 'ja'), true, 'unjudgeable is presumed consistent');
});

/* ── The session uses it, and the personality grew without losing its manners ── */

const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the utterance audio is kept, bounded, and re-transcribed exactly once when the plan says so', () => {
  const c = strip(client);
  assert.match(c, /this\.utterancePcm\.push\(pcm\)/, 'the sent PCM is retained for the turn');
  assert.match(c, /UTTERANCE_KEEP_MS/, 'and bounded');
  assert.match(c, /planRecovery\(recoveryInput\)/, 'the pure decision is what the session consults');
  assert.match(c, /planFragmentRecovery\(recoveryInput\)/, 'including the fragment ground');
  assert.match(c, /this\.cb\.onTranscribe\(wav, null\)/, 'the batch recogniser is reached through the existing path, with no hint');
  assert.match(c, /sameTurnRecoveries/, 'and every recovery is counted in the trace');
});

test('every stage of a turn is stamped, so a slow one can be blamed on a layer', () => {
  const c = strip(client);
  for (const f of ['speechEndAt', 'googleFinalAt', 'converseStartedAt', 'lunaFirstTokenAt', 'firstAudioQueuedAt', 'firstAudibleAt']) {
    assert.ok(c.includes(f), `${f} must be in the per-turn trace`);
  }
});

test('the personality gained emotional range and kept its manners', () => {
  const edge = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  // The range is now stated inside WHO YOU ARE rather than under its own
  // heading, which is a shorter prompt and the same instruction.
  assert.match(edge, /Laugh, be surprised, be amused/);
  assert.match(edge, /by something absurd, disagree plainly, be dry or sarcastic/);
  assert.match(edge, /tease back/, 'and to give it back when it is given');
  assert.match(edge, /sound a little irritated/, 'irritation is allowed when it is earned');
  assert.match(edge, /Never insult/, 'and the boundary is stated, not implied');
  assert.match(edge, /proportional/, 'anger is contextual and proportional');
  assert.match(edge, /WHO YOU ARE/, 'the existing personality is extended, not replaced');
  assert.match(edge, /MATCH THEM/, 'energy matching remains');
});
