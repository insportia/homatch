// Interrupting the assistant, and the one rule that makes it safe.
//
// Stopping the sound is the easy half. The half that goes wrong is everything
// still in flight at the moment of the interruption: a reply still streaming
// from the model, audio already synthesised and queued, chunks arriving from
// a request nobody cancelled. Any of those speaking AFTER the visitor has
// taken the floor is worse than not stopping at all, because the assistant
// answers a question that has been abandoned.
//
// The mechanism is a generation number. Everything belonging to a turn
// carries it, and stopping advances it, so stale work identifies itself.
//
// REAL-DEVICE acoustic barge-in — a laptop speaker heard by its own
// microphone — is NOT tested here and is not claimed anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const body = (name) => {
  const at = src.indexOf(name);
  assert.ok(at > 0, `${name} is missing`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return strip(src.slice(open, i + 1));
  }
  throw new Error(`${name} never closes`);
};

test('stopping an interrupted turn stops sound, generation and request together', () => {
  const fn = body('private stopPlayback()');
  assert.ok(/source\.stop\(\)/.test(fn), 'what is already sounding must stop');
  assert.ok(/this\.player\?\.stop\(\)/.test(fn), 'and what is queued must be dropped');
  assert.ok(/this\.turnGeneration =/.test(fn), 'the generation must move, or stale audio is valid');
  assert.ok(/this\.turnAbort\?\.abort\(\)/.test(fn),
    'a request nobody cancelled keeps producing audio for an abandoned turn');
});

test('audio from a superseded turn cannot be scheduled', () => {
  // Every chunk is pushed with the generation it belongs to, and the player
  // is what refuses it -- so a late chunk cannot slip through a check that
  // happened earlier.
  assert.ok(/this\.player\?\.push\(pcmBase64, sampleRate, this\.turnGeneration\)/.test(src));
});

test('a stale stream event is dropped before it touches any state', () => {
  const c = strip(src);
  assert.ok(/if \(generation !== this\.turnGeneration\) return;/.test(c),
    'the streaming loop must abandon a turn that has been superseded');
});

test('interruption resolves to a live state and cannot strand the session', () => {
  const c = strip(src);
  const at = c.indexOf("if (action === 'STOP')");
  assert.ok(at > 0, 'the barge-in decision must act');
  /*
   * The whole block, not a fixed number of characters from its start. A
   * window that size silently depends on how much comment sits inside the
   * branch, and adding an explanation to it failed a test about interruption
   * that had not changed. Balanced braces from the branch's opening one.
   */
  const open = c.indexOf('{', at);
  let depth = 0, end = c.length;
  for (let i = open; i < c.length; i++) {
    if (c[i] === '{') depth++;
    else if (c[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const block = c.slice(at, end);
  assert.ok(/setState\('INTERRUPTED'\)/.test(block));
  // INTERRUPTED is a moment, not a resting place: something must take the
  // session back to listening or the microphone never reopens.
  assert.ok(/setState\('LISTENING'\)/.test(block), 'INTERRUPTED must resolve to LISTENING');
});

test('being heard and interrupting are deliberately different thresholds', () => {
  // If these were one number the silence clock would only tick for somebody
  // shouting, and an utterance could only end by reaching the ceiling.
  const c = strip(src);
  assert.ok(/DEFAULT_BARGE_IN\.energyThreshold/.test(c));
  assert.ok(/const SPEECH_RMS = [0-9.]+/.test(c));
  const fn = body('private trackVoiceActivity(');
  assert.ok(/level >= DEFAULT_BARGE_IN\.energyThreshold/.test(fn),
    'interrupting must take more than being audible');
});

test('the assistant own voice is guarded against interrupting itself', () => {
  const fn = body('private trackVoiceActivity(');
  // Echo from a laptop speaker is the failure mode; a guard window exists so
  // the reply's own first moments cannot register as the visitor speaking.
  assert.ok(/agentAudioElapsedMs/.test(fn) && /echoCancelled/.test(fn));
});

test('a turn ending is never decided while the assistant holds the floor', () => {
  // The deliberate end-of-turn must not fire on the assistant's own audio.
  const fn = body('private maybeEndLiveTurn()');
  assert.ok(/this\.micGated/.test(fn));
});
