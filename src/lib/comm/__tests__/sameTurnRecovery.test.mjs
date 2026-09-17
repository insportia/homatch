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
// captured audio through the batch recogniser, with an explicit language --
// never `auto`. These drive that decision with realistic text.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planRecovery, functionWordRatio,
  RECOVERY_MIN_SPEECH_MS, RECOVERY_MIN_WORDS, RECOVERY_MAX_PER_SESSION,
} from '../sameTurnRecovery.ts';

// What chirp_3 pinned to en-US writes when it hears Georgian: Latin letters,
// no English in them. (Shape observed on this integration: "Wackisch",
// "Karki", "gamarjoba" -- transliteration, not translation.)
const GEORGIAN_AS_LATIN = 'gamarjoba me minda ortotakhiani bina vakeshi ramdeni ghirs kvadratuli metri';
const REAL_ENGLISH = 'Okay, and how much does a square metre cost in Vake right now?';
const RUSSIAN_AS_LATIN = 'skolko stoit kvadratny metr v vake seychas';
const GEORGIAN_AS_CYRILLIC = 'гамарджоба ме минда ортотахиани бина вакеши рамдени гирс';
const REAL_RUSSIAN = 'Хорошо, а сколько стоит квадратный метр в Ваке сейчас?';
const REAL_TURKISH = 'Tamam, peki Vake\'de bir dairenin metrekare fiyatı ne kadar?';

const base = { speechMs: 2400, pageLocale: 'ka', lastOther: null, spent: 0 };

test('Georgian transliterated by an en-US socket earns one recovery, asked for as Georgian', () => {
  const plan = planRecovery({ ...base, pinned: 'en', transcript: GEORGIAN_AS_LATIN });
  assert.ok(plan, 'a sustained Latin transcript with no English in it is a mismatch');
  assert.equal(plan.hint, 'ka', 'the page language, never auto');
  assert.equal(plan.reason, 'NO_FUNCTION_WORDS');
});

test('real English into an en-US socket is left alone', () => {
  assert.equal(planRecovery({ ...base, pinned: 'en', transcript: REAL_ENGLISH }), null);
  assert.ok(functionWordRatio(REAL_ENGLISH, 'en').ratio > 0.3, 'English is full of English');
});

test('Russian spoken into an en-US socket recovers toward the language the visitor last used', () => {
  const plan = planRecovery({ ...base, pinned: 'en', transcript: RUSSIAN_AS_LATIN, lastOther: 'ru' });
  assert.ok(plan);
  assert.equal(plan.hint, 'ru', 'the session\'s own history outranks the page');
});

test('Georgian into a ru-RU socket (Cyrillic garbage) recovers too', () => {
  const plan = planRecovery({ ...base, pinned: 'ru', transcript: GEORGIAN_AS_CYRILLIC });
  assert.ok(plan);
  assert.equal(plan.hint, 'ka');
  assert.equal(planRecovery({ ...base, pinned: 'ru', transcript: REAL_RUSSIAN }), null, 'real Russian stays');
});

test('a Turkish socket hearing Turkish is left alone', () => {
  assert.equal(planRecovery({ ...base, pinned: 'tr', transcript: REAL_TURKISH }), null);
});

test('a non-checkable pinned language never recovers -- script already decides those', () => {
  for (const pinned of ['ka', 'ar', 'he', null]) {
    assert.equal(planRecovery({ ...base, pinned, transcript: GEORGIAN_AS_LATIN }), null, String(pinned));
  }
});

test('script mismatch is not this mechanism\'s job', () => {
  // Latin text out of a ru socket is handled by the resolver (LATIN_FROM_PINNED).
  assert.equal(planRecovery({ ...base, pinned: 'ru', transcript: REAL_ENGLISH }), null);
});

test('weak and short utterances can never earn a recovery', () => {
  for (const t of ['ok', 'yes', 'no', 'Homatch', 'Vake Saburtalo', 'gamarjoba']) {
    assert.equal(planRecovery({ ...base, pinned: 'en', transcript: t }), null, `"${t}"`);
  }
  // Long enough in words but not in voice: a fast mumble is not a sentence.
  assert.equal(planRecovery({ ...base, pinned: 'en', transcript: GEORGIAN_AS_LATIN, speechMs: RECOVERY_MIN_SPEECH_MS - 1 }), null);
  assert.ok(RECOVERY_MIN_WORDS >= 4);
});

test('recovery is bounded per session', () => {
  assert.ok(planRecovery({ ...base, pinned: 'en', transcript: GEORGIAN_AS_LATIN, spent: RECOVERY_MAX_PER_SESSION - 1 }));
  assert.equal(planRecovery({ ...base, pinned: 'en', transcript: GEORGIAN_AS_LATIN, spent: RECOVERY_MAX_PER_SESSION }), null,
    'a bad microphone cannot pay for a batch call on every turn for ever');
});

/* ── The session uses it, and the personality grew without losing its manners ── */

const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the utterance audio is kept, bounded, and re-transcribed exactly once when the plan says so', () => {
  const c = strip(client);
  assert.match(c, /this\.utterancePcm\.push\(pcm\)/, 'the sent PCM is retained for the turn');
  assert.match(c, /UTTERANCE_KEEP_MS/, 'and bounded');
  assert.match(c, /planRecovery\(\{/, 'the pure decision is what the session consults');
  assert.match(c, /this\.cb\.onTranscribe\(/, 'the batch recogniser is reached through the existing path');
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
  assert.match(edge, /EMOTIONAL RANGE/, 'laugh, tease, be surprised, be irritated when it is earned');
  assert.match(edge, /Never insult/, 'and the boundary is stated, not implied');
  assert.match(edge, /proportional/, 'anger is contextual and proportional');
  assert.match(edge, /WHO YOU ARE/, 'the existing personality is extended, not replaced');
  assert.match(edge, /MATCH THE PERSON/, 'energy matching remains');
});
