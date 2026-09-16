// The brand is spelled one way and said another, and the spelling never moves.
//
// Every assertion here is about a sentence a visitor would actually hear, and
// the one rule that outranks all of them: whatever this does to the audio, the
// text Luna wrote is the text that gets stored and shown.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { speechText, mentionsBrand } from '../speechText.ts';

const SPOKEN_KA = 'ჰოუმეჩ';

// ── HOMATCH_PRONUNCIATION_KA ───────────────────────────────────────────────

test('Georgian speech gets the name in Georgian letters, never the Latin stem', () => {
  const out = speechText('გამარჯობა, მე ვარ Homatch.', 'ka');
  assert.ok(out.includes(SPOKEN_KA), out);
  assert.ok(!/homatch/i.test(out), 'a Latin stem is what makes sonic-3 spell the letters');
});

test('a Georgian case ending welds onto the name and loses its hyphen', () => {
  // The hyphen is a convention for writing a Latin stem. It is not a sound.
  assert.equal(speechText('Homatch-ში ვნახე.', 'ka'), `${SPOKEN_KA}ში ვნახე.`);
  assert.equal(speechText('Homatch-ის ბინები', 'ka'), `${SPOKEN_KA}ის ბინები`);
  assert.equal(speechText('Homatchზე', 'ka'), `${SPOKEN_KA}ზე`);
});

test('a Georgian WORD after the name is the next word, not an ending', () => {
  const out = speechText('Homatch-კარგი არჩევანია', 'ka');
  assert.ok(out.startsWith(`${SPOKEN_KA}-კარგი`), out);
});

test('a transliteration Luna invented collapses to the one we chose', () => {
  for (const written of ['ჰომაჩი', 'ჰომაჩ', 'ჰომატჩი']) {
    const out = speechText(`${written} გისურვებთ`, 'ka');
    assert.ok(out.startsWith(SPOKEN_KA), `${written} -> ${out}`);
  }
});

test('the name is not found inside a longer Latin word', () => {
  assert.equal(speechText('homatchers', 'ka'), 'homatchers');
});

test('every mention in a sentence is respelled, not just the first', () => {
  const out = speechText('Homatch გეხმარებათ. Homatch-ში მარტივია.', 'ka');
  assert.ok(!/homatch/i.test(out), out);
  assert.equal(out.split(SPOKEN_KA).length - 1, 2);
});

// ── The spelling never moves ───────────────────────────────────────────────

test('speechText is a pure function of its arguments and returns a copy', () => {
  const written = 'Homatch-ში';
  const spoken = speechText(written, 'ka');
  assert.equal(written, 'Homatch-ში', 'the caller\'s string must be untouched');
  assert.notEqual(spoken, written);
});

test('the respelling is applied on the way to the voice and nowhere else', () => {
  const edge = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  // The only permitted callers are the two that hand text to Cartesia.
  const calls = [...edge.matchAll(/speechText\(/g)].length;
  assert.ok(calls >= 2, 'both the streaming and whole-clip paths must respell');
  // Nothing may write the spoken form into history, the transcript or a row.
  assert.ok(!/history\.push\([^)]*speechText/.test(edge));
  assert.ok(!/reply:\s*speechText/.test(edge), 'the reply returned to the browser stays as written');
});

// ── Per language ───────────────────────────────────────────────────────────

test('each language gets the name in a script its own voice can read', () => {
  assert.equal(speechText('Homatch', 'en'), 'Homatch', 'English already reads it');
  assert.ok(/[Ѐ-ӿ]/.test(speechText('Homatch', 'ru')), 'Russian needs Cyrillic');
  assert.ok(/[؀-ۿ]/.test(speechText('Homatch', 'ar')), 'Arabic needs Arabic letters');
  assert.ok(/[֐-׿]/.test(speechText('Homatch', 'he')), 'Hebrew needs Hebrew letters');
  assert.ok(/ç/.test(speechText('Homatch', 'tr')), 'Turkish spells the affricate ç');
});

test('a language this product does not speak is left completely alone', () => {
  // Better an English-sounding brand than a respelling aimed at some other
  // language's phonology.
  assert.equal(speechText('Homatch', 'ko'), 'Homatch');
  assert.equal(speechText('Homatch', null), 'Homatch');
  assert.equal(speechText('Homatch', undefined), 'Homatch');
});

test('a regional tag resolves to its language', () => {
  assert.ok(speechText('Homatch', 'ka-GE').includes(SPOKEN_KA));
});

// ── Nothing but the brand ──────────────────────────────────────────────────

test('the rest of the sentence is returned byte for byte', () => {
  const s = 'ვაკეში ორსართულიანი ბინა, 120 კვ.მ, ფასი 250,000 ₾.';
  assert.equal(speechText(s, 'ka'), s);
});

test('empty and absent text survive', () => {
  assert.equal(speechText('', 'ka'), '');
});

test('mentionsBrand is repeatable, so the report cannot miscount', () => {
  const s = 'Homatch-ში';
  assert.equal(mentionsBrand(s), true);
  assert.equal(mentionsBrand(s), true, 'a stateful global regex would say false here');
  assert.equal(mentionsBrand('ბინა ვაკეში'), false);
});

// ── A letter of the visitor's language is never deleted ────────────────────

test('a declined Georgian spelling keeps every letter of its ending', () => {
  // ჰოუმეჩის used to come back as ჰოუმეჩს: the stem list contained the
  // nominative ჰოუმეჩი, which swallowed the ი and left ს to be re-welded.
  assert.equal(speechText('ჰოუმეჩის ბინები', 'ka'), `${SPOKEN_KA}ის ბინები`);
  assert.equal(speechText('ჰომაჩის ბინები', 'ka'), `${SPOKEN_KA}ის ბინები`);
  assert.equal(speechText('ჰოუმეჩი გეხმარებათ', 'ka'), `${SPOKEN_KA}ი გეხმარებათ`);
});

test('a text already in the spoken spelling is returned unchanged', () => {
  // Normalising twice must not differ from normalising once, or a retried
  // phrase is spoken differently from the first attempt.
  for (const s of ['ჰოუმეჩი გისმენთ.', 'ჰოუმეჩის AI ასისტენტი გისმენთ.', 'ეს არის ჰოუმეჩ.']) {
    assert.equal(speechText(s, 'ka'), s, s);
  }
});

test('normalising is idempotent for every written form', () => {
  for (const s of ['Homatch-ის AI ასისტენტი.', 'ეს არის Homatch.', 'ჰომაჩის ბინა', 'Homatchზე']) {
    const once = speechText(s, 'ka');
    assert.equal(speechText(once, 'ka'), once, `${s} -> ${once}`);
  }
});
