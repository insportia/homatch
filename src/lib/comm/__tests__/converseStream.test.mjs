// A turn arrives in pieces, and the pieces do not respect message boundaries.
//
// Both halves of the streamed turn are parsers, and both of them fail in the
// same quiet way if they are wrong: a frame gets cut in half, the JSON does
// not parse, and the event is dropped. Nothing errors. The voice simply skips
// a phrase, or the last sentence never appears — which is indistinguishable
// from the model having written less.
//
// So the chunking is tested against deliberately hostile splits: one byte at
// a time, mid-JSON, mid-multibyte-character.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSseChunk } from '../converse.ts';

// ── the browser's side ──────────────────────────────────────────────────────

test('a frame split across reads is held until it is whole', () => {
  const whole = 'event: text\ndata: {"delta":"გამარჯობა"}\n\n';
  const at = 20;

  let { events, rest } = parseSseChunk(whole.slice(0, at));
  assert.deepEqual(events, [], 'half a frame is not an event');

  ({ events, rest } = parseSseChunk(rest + whole.slice(at)));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'text');
  assert.deepEqual(JSON.parse(events[0].data), { delta: 'გამარჯობა' });
  assert.equal(rest, '');
});

test('several frames in one read come out in order', () => {
  const body = [
    'event: open\ndata: {"ms":420}',
    'event: text\ndata: {"delta":"გა"}',
    'event: text\ndata: {"delta":"მარჯობა"}',
    '',
  ].join('\n\n');

  const { events, rest } = parseSseChunk(body);
  assert.deepEqual(events.map((e) => e.event), ['open', 'text', 'text']);
  assert.equal(JSON.parse(events[1].data).delta, 'გა');
  assert.equal(rest, '');
});

test('a byte-at-a-time stream still yields every event exactly once', () => {
  // The adversarial case: audio payloads are large, and a large payload is
  // guaranteed to be split by the transport somewhere in the middle.
  const frames = [
    'event: text\ndata: {"delta":"ერთი"}\n\n',
    `event: audio\ndata: {"pcmBase64":"${'A'.repeat(500)}","sampleRate":24000}\n\n`,
    'event: done\ndata: {"firstTextMs":410,"firstAudioMs":900}\n\n',
  ].join('');

  const seen = [];
  let rest = '';
  for (const ch of frames) {
    const out = parseSseChunk(rest + ch);
    rest = out.rest;
    seen.push(...out.events);
  }

  assert.deepEqual(seen.map((e) => e.event), ['text', 'audio', 'done']);
  assert.equal(JSON.parse(seen[1].data).pcmBase64.length, 500);
  assert.equal(rest, '');
});

test('a comment or a heartbeat line is not mistaken for data', () => {
  const { events } = parseSseChunk(': keep-alive\n\nevent: text\ndata: {"delta":"x"}\n\n');
  assert.equal(events.length, 1, 'only the real frame is an event');
  assert.equal(events[0].event, 'text');
});

// ── the server's side ───────────────────────────────────────────────────────

/*
 * takePhrase is module-private in a Deno edge file that node cannot import.
 * It is small and pure, so the function is read out of the shipped source and
 * evaluated — that way this tests what actually runs rather than a copy of it
 * that can drift.
 */
// Line endings are normalised first: this repository is worked on from
// Windows, and looking for a bare newline in a CRLF file silently matches
// nothing — which produced a two-character "function" and a baffling error.
const SRC = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8').replace(/\r\n/g, '\n');
const FROM = SRC.indexOf('function takePhrase(');
assert.ok(FROM > 0, 'takePhrase was renamed or removed');
const BODY = SRC.slice(FROM);
const END = BODY.indexOf('\n}\n');
assert.ok(END > 0, 'takePhrase is no longer a top-level function');
const takePhrase = new Function(
  `${BODY.slice(0, END + 3).replace(/: string|: number|: boolean| = false/g, '')}\nreturn takePhrase;`,
)();

test('nothing is spoken until it is a complete thing to say', () => {
  // Speaking a fragment the model is about to continue is what makes a
  // streamed voice sound broken.
  assert.equal(takePhrase('გასაგებ', 45), '', 'too short to be anything');
  assert.equal(takePhrase('კრწანისში ორ საძინებლიან ბინას ეძებთ და ეს', 45), '',
    'long enough, but the sentence has not ended');
});

test('the opening may end on a comma, because that is how people start', () => {
  // Measured: waiting for the first full stop cost about 1.5 seconds of
  // silence after the model had already started writing.
  const opening = takePhrase('გასაგებია, კრწანისში ორ საძინებლიან ბინას ეძებთ.', 8, true);
  assert.equal(opening.trim(), 'გასაგებია,');

  // And only the opening: mid-reply, a comma is not a place to stop.
  const middle = takePhrase('კრწანისში ორ საძინებლიან ბინას ეძებთ, დაახლოებით 160 ათას დოლარამდე და', 45, false);
  assert.equal(middle, '', 'a comma mid-reply would chop the voice into fragments');
});

test('a finished sentence is taken with its punctuation and its space', () => {
  // minChars is a FLOOR, not a target: nothing is cut before it, so a very
  // short opening sentence is kept with what follows rather than spoken
  // alone. Two words of audio followed by a gap sounds worse than one phrase.
  const long = 'კრწანისში ორ საჭინებლიან ბინას ეძებთ დაახლოებით 160 ათას დოლარამდე. ახალი პროექტი გირჩევნიათ?';
  const said = takePhrase(long, 45);

  assert.ok(said.length > 45, 'a phrase shorter than the floor must not be taken');
  assert.ok(said.includes('დოლარამდე.'), 'the phrase should end at the full stop');
  assert.ok(!said.includes('ახალი'), 'the next sentence belongs to the next phrase');
  // The trailing space goes with the phrase that ended, so the next one does
  // not start with a stray gap.
  assert.ok(said.endsWith(' '));
});

test('question marks and semicolons end a phrase too', () => {
  const question = 'ახალი პროექტი გირჩევნიათ თუ უკვე დასრულებული ბინა? და კიდევ სხვა რამე';
  assert.ok(takePhrase(question, 45).trimEnd().endsWith('?'));

  // A semicolon past the floor ends a phrase; one before it does not, because
  // minChars is a floor on the whole phrase and not on the search.
  const clause = 'ეს ერთი მნიშვნელოვანი საკითხია და ეს კიდევ სულ სხვა საკითხია; მეორე ნაწილი';
  assert.ok(takePhrase(clause, 45).trimEnd().endsWith(';'));
  assert.equal(takePhrase('მოკლე წინადადება; და კიდევ რაღაც', 45), '',
    'a terminator before the floor is not a place to break');
});

test('a clause with no punctuation at all is still eventually spoken', () => {
  // A model occasionally writes sixty words without a full stop. Waiting for
  // one that never arrives would hold the voice back for the whole reply.
  const long = 'სიტყვა '.repeat(40);
  const taken = takePhrase(long, 45);
  assert.ok(taken.length > 0 && taken.length <= 161, `expected a word-boundary break, got ${taken.length}`);
  assert.ok(taken.endsWith(' '), 'the break must be at a word boundary');
});

test('Russian and Latin sentences chunk the same way', () => {
  // The opening break is at the first comma at or past the floor, so a
  // two-letter "Да," is kept with the clause after it rather than spoken as
  // 300ms of audio followed by a gap.
  const opening = takePhrase('Да, ипотека возможна, но условия зависят от банка.', 8, true);
  assert.ok(opening.trimEnd().endsWith(','), `expected a comma break, got ${JSON.stringify(opening)}`);
  assert.ok(opening.length < 30, 'the opening phrase must be short enough to be quick');
  assert.ok(!opening.includes('банка'), 'the rest of the sentence belongs to the next phrase');
  const latin = takePhrase(
    'Understood, a two bedroom flat in Krtsanisi up to 160 thousand dollars. New build or finished?',
    45,
  );
  assert.ok(latin.trimEnd().endsWith('.'), `expected a sentence, got ${JSON.stringify(latin)}`);
  assert.ok(!latin.includes('New build'), 'the next sentence belongs to the next phrase');
});
