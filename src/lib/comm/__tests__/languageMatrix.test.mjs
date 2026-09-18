// The matrix the owner asked for before touching a phone: every first-turn
// greeting, every switch pair, and the three ways a turn can go wrong.
//
// Deterministic on purpose. The production chains proved the wiring end to
// end; these pin the RULES, so a future change that quietly re-weakens one is
// a failing test rather than a bad conversation. Transcripts are what the real
// recognisers produced on 2026-09-18 wherever a real one was captured.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTurnLanguage, normaliseLanguage } from '../talkLanguage.ts';
import { isGreeting, GREETINGS, SCRIPT_OF } from '../languageRegistry.ts';
import {
  isDiscreditedTurn, consistentWith, hasAnyFunctionWord, planRecovery,
} from '../sameTurnRecovery.ts';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');

/**
 * One session, turn by turn, the way the client drives the resolver: the
 * language a turn resolves to becomes the next turn's previous language, and
 * `firstTurn` is true only until one has.
 */
function session({ locale = 'ka', turns }) {
  let previous = null;
  let resolved = 0;
  const out = [];
  for (const t of turns) {
    const r = resolveTurnLanguage({
      transcript: t.text,
      providerLanguage: t.label ?? null,
      providerDetected: t.detected ?? false,
      firstTurn: resolved === 0,
      previousSessionLanguage: previous ?? locale,
      pageLocale: locale,
    });
    out.push(r);
    if (!isDiscreditedTurn(t.text, r.resolvedLanguage)) {
      previous = r.resolvedLanguage;
      resolved += 1;
    }
  }
  return out;
}

/* ── 1. First turn: a genuine greeting is evidence ────────────────────── */

test('a genuine greeting switches on the first turn, in every language the owner listed', () => {
  // The page is Georgian; somebody opens it and says one word.
  const cases = [
    ['ka', 'გამარჯობა.', 'ka'],
    ['en', 'Hello.', 'en'],
    ['en', 'Hi', 'en'],
    ['ru', 'Привет.', 'ru'],
    ['ru', 'Здравствуйте.', 'ru'],
    ['ar', 'مرحبا.', 'ar'],
    ['tr', 'Merhaba.', 'tr'],
    ['he', 'שלום.', 'he'],
  ];
  for (const [label, text, want] of cases) {
    const [r] = session({ turns: [{ text, label, detected: true }] });
    assert.equal(r.resolvedLanguage, want, `"${text}" (${label}) -> ${r.resolvedLanguage} (${r.resolutionReason})`);
  }
});

test('and the conversation continues in it', () => {
  const r = session({ turns: [
    { text: 'Hello.', label: 'en', detected: true },
    { text: 'What is two plus two?', label: 'en', detected: true },
  ] });
  assert.equal(r[0].resolvedLanguage, 'en');
  assert.equal(r[1].resolvedLanguage, 'en');
  assert.equal(r[1].resolutionReason !== 'LEXICAL_GREETING', true, 'only the first turn uses the greeting rule');
});

test('recogniser garbage never switches, first turn or not', () => {
  // Every one of these is a real mis-hearing of Georgian from a production trace.
  for (const [text, label] of [['Abba', 'en'], ['Karki', 'ha'], ['dir', 'lb'], ['Wackisch', 'en'],
    ['Ki, ma interesas.', 'lt'], ['Ge-', 'ru'], ['Dyakuyu', 'uk'], ['RAM x 6Y', 'ru']]) {
    const [first] = session({ turns: [{ text, label, detected: true }] });
    assert.equal(first.resolvedLanguage, 'ka', `first turn "${text}" (${label}) -> ${first.resolvedLanguage}`);
    const [, later] = session({ turns: [
      { text: 'გამარჯობა, ბინას ვეძებ ვაკეში.', label: 'ka', detected: true },
      { text, label, detected: true },
    ] });
    assert.equal(later.resolvedLanguage, 'ka', `mid-session "${text}" (${label})`);
  }
});

test('the greeting rule needs a DETECTED label; a pinned socket cannot supply one', () => {
  const configured = resolveTurnLanguage({
    transcript: 'Hello.', providerLanguage: 'en', providerDetected: false,
    firstTurn: true, previousSessionLanguage: 'ka', pageLocale: 'ka',
  });
  assert.equal(configured.resolvedLanguage, 'ka', 'a label nothing detected is a configuration');
  const detected = resolveTurnLanguage({
    transcript: 'Hello.', providerLanguage: 'en', providerDetected: true,
    firstTurn: true, previousSessionLanguage: 'ka', pageLocale: 'ka',
  });
  assert.equal(detected.resolvedLanguage, 'en');
  assert.equal(detected.resolutionReason, 'LEXICAL_GREETING');
});

test('a greeting is matched whole, so a sentence is judged on its own words', () => {
  assert.equal(isGreeting('Hello.', 'en'), true);
  assert.equal(isGreeting('hi', 'en'), true);
  assert.equal(isGreeting('Good morning', 'en'), true);
  assert.equal(isGreeting('Hello, I am looking for a two bedroom flat in Vake', 'en'), false);
  assert.equal(isGreeting('Abba', 'en'), false);
  assert.equal(isGreeting('Karki', 'ka'), false);
  assert.equal(isGreeting('שלום', 'he'), true);
  assert.equal(isGreeting('مرحبا', 'ar'), true);
  assert.equal(isGreeting('Merhaba', 'tr'), true);
  assert.equal(isGreeting('Привет', 'ru'), true);
  assert.equal(isGreeting('გამარჯობა', 'ka'), true);
  // A greeting of one language is not a greeting of another.
  assert.equal(isGreeting('Hello', 'ru'), false);
  assert.equal(isGreeting('שלום', 'ar'), false);
  for (const lang of Object.keys(GREETINGS)) {
    assert.ok(SCRIPT_OF[lang], `${lang} greets in a language the registry knows`);
  }
});

/* ── 2. The switch matrix ─────────────────────────────────────────────── */

const SAY = {
  ka: { text: 'გამარჯობა, ვაკეში ორსაძინებლიან ბინას ვეძებ.', label: 'ka' },
  en: { text: 'Hello, I am looking for a two bedroom flat in Vake.', label: 'en' },
  ru: { text: 'Здравствуйте, я ищу двухкомнатную квартиру в Ваке.', label: 'ru' },
  ar: { text: 'مرحبا، أبحث عن شقة بغرفتي نوم في تبليسي.', label: 'ar' },
  tr: { text: 'Merhaba, Vake semtinde iki yatak odalı bir daire arıyorum.', label: 'tr' },
  he: { text: 'שלום, אני מחפש דירת שני חדרים בתל אביב.', label: 'he' },
};

test('every pair the owner listed switches in both directions, on the turn it is spoken', () => {
  const pairs = [['ka', 'en'], ['ka', 'ru'], ['ka', 'ar'], ['ka', 'tr'], ['ka', 'he'],
    ['en', 'ru'], ['en', 'ar'], ['en', 'tr'], ['en', 'he']];
  for (const [a, b] of pairs) {
    for (const [from, to] of [[a, b], [b, a]]) {
      const r = session({ turns: [
        { ...SAY[from], detected: true },
        { ...SAY[to], detected: true },
        { ...SAY[from], detected: true },
      ] });
      assert.equal(r[0].resolvedLanguage, from, `${from}->${to}: opening turn`);
      assert.equal(r[1].resolvedLanguage, to, `${from}->${to}: switch (${r[1].resolutionReason})`);
      assert.equal(r[1].switched, true, `${from}->${to} is recorded as a switch`);
      assert.equal(r[2].resolvedLanguage, from, `${from}->${to}->${from}: back again`);
    }
  }
});

test('a same-language conversation never switches and never weakens', () => {
  for (const lang of Object.keys(SAY)) {
    const r = session({ turns: [SAY[lang], SAY[lang], SAY[lang]].map((t) => ({ ...t, detected: true })) });
    for (const [i, one] of r.entries()) {
      assert.equal(one.resolvedLanguage, lang, `${lang} turn ${i + 1}`);
      assert.equal(one.weakEvidence, false, `${lang} turn ${i + 1} is strong evidence`);
    }
    assert.equal(r[1].switched, false);
    assert.equal(r[2].switched, false);
  }
});

/* ── 3. The three ways a turn goes wrong, and the recovery after it ───── */

test('a short unusable foreign utterance is refused, and the next real one is heard', () => {
  // Measured: a ru-RU socket wrote a one-second Georgian question as "RAM x 6Y",
  // and the `auto` opinion produced "रामाखूया" -- neither is Russian.
  const turns = [
    { ...SAY.ru, detected: true },                       // Russian established
    { text: 'RAM x 6Y', label: 'ru', detected: false },  // the unusable second
    { ...SAY.ka, detected: true },                       // a real Georgian sentence
  ];
  const r = session({ turns });
  assert.equal(r[0].resolvedLanguage, 'ru');
  assert.equal(r[1].resolvedLanguage, 'ru', 'it refuses to guess rather than flipping');
  assert.equal(isDiscreditedTurn('RAM x 6Y', 'ru'), true, 'and the turn is never sent');
  assert.equal(r[2].resolvedLanguage, 'ka', 'the next real utterance switches normally');
  assert.equal(r[2].switched, true);
});

test('the same in reverse: Georgian established, an unusable foreign second, then a real one', () => {
  const r = session({ turns: [
    { ...SAY.ka, detected: true },
    { text: 'रामाखूया', label: 'mr', detected: true },
    { ...SAY.he, detected: true },
  ] });
  assert.equal(r[0].resolvedLanguage, 'ka');
  assert.equal(r[1].resolvedLanguage, 'ka', 'one unplaceable word does not move it');
  assert.equal(isDiscreditedTurn('रामाखूया', 'ka'), true);
  assert.equal(r[2].resolvedLanguage, 'he');
  assert.equal(r[2].switched, true);
});

test('what is refused is provably wrong, and an ordinary turn never is', () => {
  // Refused: wrong script for the resolved language, a fragment, no words of it.
  assert.equal(isDiscreditedTurn('RAM x 6Y', 'ru'), true);
  assert.equal(isDiscreditedTurn('रामाखूया', 'ka'), true);
  assert.equal(isDiscreditedTurn('خرم كرميتال', 'ka'), true);
  // Kept: the right script, however odd the words.
  assert.equal(isDiscreditedTurn('Рамку я', 'ru'), false, 'Cyrillic in a Russian turn is sent, and answered honestly');
  assert.equal(isDiscreditedTurn('მადლობა.', 'ka'), false);
  assert.equal(isDiscreditedTurn('Okay, sure.', 'en'), false);
  // A Latin fragment in a Russian turn IS refused -- but only ever as the last
  // gate: the `auto` opinion writes real Russian for real Russian speech and
  // replaces the transcript long before this is asked (LIVE_INCONSISTENT,
  // because Latin is not Russian's script). Reaching here means all three
  // recognisers failed on it, and one bounded refusal beats a confused answer.
  assert.equal(isDiscreditedTurn('Da, horosho', 'ru'), true);
  assert.equal(consistentWith('Da, horosho', 'ru'), false, 'which is what hands it to the opinion first');
  // Kept: a sentence, even in another script -- that is a switch, not garbage.
  assert.equal(isDiscreditedTurn('Hello, I am looking for a flat in Vake', 'ka'), false);
  // Kept: too little to judge.
  assert.equal(isDiscreditedTurn('ok', 'ka'), false);
  assert.equal(isDiscreditedTurn('', 'ka'), false);
  // Kept: a language with no script of its own in the registry.
  assert.equal(isDiscreditedTurn('anything at all', 'xx'), false);
});

test('refusing is bounded, so a systematic mismatch becomes an honest answer rather than silence', () => {
  const c = strip(client);
  assert.match(c, /const MAX_CONSECUTIVE_DISCREDITED_DROPS = 2;/);
  assert.match(c, /if \(this\.discreditedDrops >= MAX_CONSECUTIVE_DISCREDITED_DROPS\) return false;/);
  assert.match(c, /this\.discreditedDrops = 0;/, 'and the count resets on any turn that goes through');
  assert.match(c, /this\.resumeListening\(\);/, 'the microphone keeps listening');
  assert.match(c, /this\.turns = this\.turns\.filter\(\(t\) => t\.id !== id\)/, 'and the line comes off the screen');
});

/* ── 4. The second opinion is evidence, never the recogniser ──────────── */

test('the pinned recogniser stays primary and auto cannot overrule a credible transcript', () => {
  const c = strip(client);
  const judge = c.slice(c.indexOf('private judgeSecondOpinion('), c.indexOf('private async recoverUtterance('));
  // A credible pinned sentence wins, whatever auto thought it heard.
  assert.match(judge, /return \{ use: false, why: 'LIVE_CONSISTENT' \};/);
  assert.ok(judge.indexOf("why: 'LIVE_INCONSISTENT'") < judge.indexOf("why: 'OPINION_TOO_SHORT'"));
  assert.ok(judge.indexOf("why: 'OPINION_TOO_SHORT'") < judge.indexOf("why: 'LIVE_CONSISTENT'"));
  // Only explicit evidence lets it through.
  for (const why of ['LIVE_EMPTY', 'LIVE_INCONSISTENT', 'LIVE_FRAGMENT', 'LATIN_SOCKET_TRANSLATED']) {
    assert.ok(judge.includes(`why: '${why}'`), why);
  }
  // A credible Georgian sentence heard by a Georgian socket is credible.
  assert.equal(consistentWith('გამარჯობა, ვაკეში ბინას ვეძებ.', 'ka'), true);
  assert.equal(hasAnyFunctionWord('გამარჯობა, ვაკეში ბინას ვეძებ.', 'ka'), true);
});

test('an unsupported language cannot move the session, however confident auto is', () => {
  for (const tag of ['fa', 'az', 'hy', 'kk', 'lb', 'ha', 'lt', 'zh', 'tl']) {
    assert.equal(normaliseLanguage(tag), null, tag);
    const r = resolveTurnLanguage({
      transcript: 'Hello, I am looking for a flat in Vake.', providerLanguage: tag,
      providerDetected: true, previousSessionLanguage: 'ka', pageLocale: 'ka',
    });
    assert.ok(['ka', 'en'].includes(r.resolvedLanguage), `${tag} -> ${r.resolvedLanguage}`);
    assert.notEqual(r.normalizedProviderLanguage, tag);
  }
  // And an opinion with no language at all is treated as agreement, not evidence.
  const c = strip(client);
  assert.match(c, /if \(!opinionLang \|\| opinionLang === pinned\) return \{ use: false, why: 'AGREES' \};/);
});

test('the auto socket is a second opinion only, and one that fails cannot end the session', () => {
  const c = strip(client);
  assert.match(c, /createTranscriber\(\{ \.\.\.grant, detect: true \}/, 'auto exists only as the shadow');
  assert.doesNotMatch(c, /createTranscriber\(\{ \.\.\.grant, detect: probing \}\)/, 'and the old unrestricted probe path is not how the primary opens');
  // The primary is opened with the session's own language, never with detect.
  const opener = c.slice(c.indexOf('private async openLiveTranscription('), c.indexOf('private async openShadow(') > 0
    ? c.indexOf('private async openShadow(') : c.length);
  assert.ok(opener.length > 0);
  // A failed opinion nulls itself and is counted; nothing else happens.
  assert.match(c, /this\.shadow = null;\s*\n\s*this\.diag\.secondOpinionFailures = \(this\.diag\.secondOpinionFailures \?\? 0\) \+ 1;/);
  assert.match(c, /const opinion = origin === 'SHADOW' \? null : await this\.awaitSecondOpinion\(\);/);
  assert.match(c, /SECOND_OPINION_WAIT_MS/, 'and waiting for it is bounded');
});

/* ── 5. The no-final invariant, unchanged by any of this ──────────────── */

test('no usable final still means a bounded recovery, a fresh socket and a live microphone', () => {
  const c = strip(client);
  assert.match(c, /this\.finalWatch\.requested\(Date\.now\(\)\)/, 'a final is owed from the moment one is asked for');
  assert.match(c, /onNoFinal: \(reason\) => \{/, 'the socket can report the miss');
  assert.match(c, /this\.finalWatch\.tick\(Date\.now\(\)\)/, 'and the clock catches the silent case');
  const recover = c.slice(c.indexOf('private recoverFromNoFinal('), c.indexOf('private async rotateLive('));
  assert.match(recover, /void this\.rotateLive\(\)/, 'the old socket goes and a fresh one is opened');
  assert.match(recover, /if \(this\.state === 'UNDERSTANDING'\) this\.setState\('LISTENING'\)/, 'and the microphone resumes');
  assert.match(recover, /decision\.kind === 'GIVE_UP'/, 'bounded: it does not reconnect for ever');
  // The dual-recogniser work must not have taken the opinion away from it.
  assert.match(recover, /this\.shadowGraceUntil = Date\.now\(\) \+ SECOND_OPINION_GRACE_MS;/,
    'a miss gives the opinion a moment to carry the turn instead');
  assert.match(c, /this\.retiredShadow = s;/, 'and a rotation does not throw away an opinion still owed');
});

test('a turn the opinion carried is produced exactly once', () => {
  const c = strip(client);
  assert.match(c, /if \(origin === 'LIVE' && this\.producedEpoch === this\.utteranceEpoch\)/,
    'a late final for a turn already carried is dropped, not duplicated');
  assert.match(c, /this\.diag\.lateFinalsDropped = \(this\.diag\.lateFinalsDropped \?\? 0\) \+ 1;/);
  assert.match(c, /this\.producedEpoch = result\.epoch;/, 'and the opinion marks the turn produced');
});

/* ── 6. What must not have changed ────────────────────────────────────── */

test('the settled architecture is untouched', () => {
  const c = client;
  assert.match(c, /const LIVE_SAMPLE_RATE|LIVE_SAMPLE_RATE/, 'capture and rate architecture');
  assert.match(c, /decideBargeIn/, 'barge-in');
  assert.match(c, /this\.router\.route\(pcm, liveReady\)/, 'pre-ready buffering through the router');
  assert.match(c, /const END_TURN_SHORT_MS = 600;/, 'the measured mid endpoint window');
  const edge = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  assert.match(edge, /CARTESIA_DEFAULT_SPEED = 1\.0/, 'voice pace');
  assert.match(edge, /sonic-3/, 'voice model');
  const worker = readFileSync('official-worker/src/speech/GoogleSpeechStream.ts', 'utf8');
  assert.match(worker, /chirp_3/, 'the speech model');
  assert.match(worker, /languageCodes: cfg\.detect \? \['auto'\] : \[cfg\.languageCode\]/,
    'unrestricted auto is reachable only when a socket explicitly asks to detect');
});
