// `auto` must not be reachable except one socket at a time.
//
// The first real Android microphone trace came back with Georgian speech
// transcribed as the single English token "Abba", and the whole session
// followed it into English. Two things put that recogniser into unrestricted
// detection, and only one of them was visible:
//
//   the per-socket `detect` flag, which the browser sent on every session
//   that had not yet locked a language -- i.e. every first turn; and
//
//   GOOGLE_SPEECH_MULTILANG, a global environment flag that forced `auto`
//   for EVERY socket regardless of what the caller asked for. Its value is
//   redacted from the deploy API and appeared in no health output, so from
//   outside the service there was no way to tell whether production was in
//   that mode at all.
//
// The measurement in GoogleSpeechStream's own comments says `auto` damages
// short Georgian. A setting that can silently impose it, and that cannot be
// read back, is not a setting worth having.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/speech/GoogleSpeechStream.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(src);

test('the recogniser takes `auto` only from the per-socket flag', () => {
  assert.match(code, /languageCodes: cfg\.detect \? \['auto'\] : \[cfg\.languageCode\]/,
    'the language config must depend on nothing but this socket');
});

test('no global switch can put every socket into detection', () => {
  const at = code.indexOf('languageCodes: cfg.detect');
  assert.ok(at > 0, 'the language config is gone');
  // The config line itself, not the file: the helper may still exist to be
  // reported, it simply must not decide anything.
  const line = code.slice(at, code.indexOf('\n', at));
  assert.doesNotMatch(line, /multiLanguageEnabled/,
    'a redacted environment variable must not be able to override a caller '
    + 'that asked for one language');
});

test('whatever the operator set is reported, so a trace can rule it out', () => {
  const index = strip(readFileSync('src/index.ts', 'utf8'));
  assert.match(index, /multiLangRequested: multiLanguageEnabled\(\)/,
    'the flag must be visible from outside the service');
  assert.match(index, /autoDetectReachableGlobally: false/,
    'and the answer to "is every socket in auto" must be answerable');
});

test('the single configured language is the one the health output names', () => {
  const index = strip(readFileSync('src/index.ts', 'utf8'));
  assert.match(index, /language: primaryLanguage\(\)/,
    'speech-config must report the language the recogniser actually gets, '
    + 'not a re-read of one environment variable that may not be set');
});
