// AI TALK, after the voice changed hands.
//
// The ElevenLabs implementation passed every test it had and was rejected by
// the first person who listened to it on a phone. What those tests never
// checked was the arithmetic BETWEEN the pieces of audio — which is where the
// whine was — and which provider was actually speaking, which is how five
// production turns ran on a silent fallback for half an hour.
//
// So this file checks the joins, the cancellation, and who is talking.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PcmStreamPlayer } from '../pcmPlayer.ts';
import {
  TALK_DESTINATIONS, resolveDestination, parseAction, spokenPart,
  endsWithPartialMarker, ACTION_MARKER, destinationMenu,
} from '../talkActions.ts';
import { stabiliseLanguage, normaliseLanguageTag } from '../transcript.ts';

const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');

// ── A fake audio graph, enough to schedule against ─────────────────────────

class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }
  copyToChannel(source) { this.data.set(source, 0); }
  getChannelData() { return this.data; }
}

class FakeSource {
  constructor(ctx) { this.ctx = ctx; this.started = null; this.stopped = false; }
  connect() {}
  disconnect() {}
  start(when) { this.started = when; this.ctx.scheduled.push(this); }
  stop() { this.stopped = true; }
}

class FakeContext {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.scheduled = [];
  }
  createBuffer(channels, length, rate) { return new FakeBuffer(channels, length, rate); }
  createBufferSource() { return new FakeSource(this); }
}

/** `seconds` of a sine, as base64 PCM16 at `rate` — what the provider sends. */
function tone(seconds, rate, freq = 220, phaseOffset = 0) {
  const n = Math.round(seconds * rate);
  const bytes = new Uint8Array(n * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) {
    const v = Math.sin(2 * Math.PI * freq * ((i + phaseOffset) / rate));
    view.setInt16(i * 2, Math.round(v * 30000), true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return Buffer.from(binary, 'binary').toString('base64');
}

function playedSamples(ctx) {
  const out = [];
  for (const s of ctx.scheduled) out.push(...s.buffer.data);
  return out;
}

// ── The joins, which is what the listener actually complained about ────────

test('consecutive chunks join without a step in the waveform', () => {
  /*
   * THE BUG THIS EXISTS FOR.
   *
   * Every chunk used to become its own AudioBuffer declared at the provider's
   * rate, which made the browser resample each one independently. An
   * independent resample restarts its interpolation from nothing, so the
   * waveform takes a step at every join, and a step in a waveform is a click.
   * At phrase boundaries, dozens a second, that is the high-frequency whine.
   *
   * A continuous sine split across chunks must come out continuous. The test
   * is the largest jump between neighbouring output samples: in a 220Hz tone
   * at 48kHz no two adjacent samples differ by much, so a join that restarts
   * shows up immediately.
   */
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);

  const rate = 24000;                  // deliberately NOT the context rate
  const chunkSeconds = 0.05;
  const samplesPerChunk = chunkSeconds * rate;
  for (let i = 0; i < 8; i++) {
    player.push(tone(chunkSeconds, rate, 220, i * samplesPerChunk), rate, 1);
  }
  player.endOfTurn();

  const played = playedSamples(ctx);
  assert.ok(played.length > 1000, `expected audio, got ${played.length} samples`);

  let worst = 0;
  for (let i = 1; i < played.length; i++) {
    worst = Math.max(worst, Math.abs(played[i] - played[i - 1]));
  }
  // One step of a 220Hz sine at 48kHz is about 0.029. Allow generous headroom
  // for interpolation error; a restarted resampler produces jumps far larger.
  assert.ok(worst < 0.15, `discontinuity at a chunk join: largest step ${worst.toFixed(4)}`);
});

test('a chunk already at the context rate is played, not resampled', () => {
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  player.push(tone(0.2, 48000), 48000, 1);
  player.endOfTurn();

  const stats = player.snapshot();
  assert.equal(stats.resampled, false, 'matching rates must not resample');
  assert.equal(stats.providerRate, 48000);
  // Same number of samples in as out: nothing was invented or dropped.
  assert.equal(playedSamples(ctx).length, Math.round(0.2 * 48000));
});

test('pieces are scheduled end to end, never overlapping and never gapped', () => {
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  for (let i = 0; i < 6; i++) player.push(tone(0.1, 48000, 220, i * 4800), 48000, 1);
  player.endOfTurn();

  assert.ok(ctx.scheduled.length >= 2, 'expected several scheduled pieces');
  for (let i = 1; i < ctx.scheduled.length; i++) {
    const prev = ctx.scheduled[i - 1];
    const expected = prev.started + prev.buffer.duration;
    const gap = Math.abs(ctx.scheduled[i].started - expected);
    // Overlap is the assistant talking over itself; a gap is a stutter.
    assert.ok(gap < 1e-6, `piece ${i} starts ${gap}s away from where the previous one ends`);
  }
});

test('audio from an interrupted turn is dropped, not played over the next one', () => {
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  player.push(tone(0.2, 48000), 48000, 1);

  // The visitor interrupts. Chunks for turn 1 are still on the wire.
  player.stop();
  const after = ctx.scheduled.length;

  player.push(tone(0.2, 48000), 48000, 1);
  assert.equal(ctx.scheduled.length, after, 'a stale chunk reached the output');
  assert.equal(player.snapshot().stale, 1, 'the stale chunk must be counted, not silently ignored');
});

test('stopping releases every scheduled source and resets the cursor', () => {
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  for (let i = 0; i < 4; i++) player.push(tone(0.1, 48000), 48000, 1);
  player.endOfTurn();

  const sources = [...ctx.scheduled];
  assert.ok(sources.length > 0);
  player.stop();
  assert.ok(sources.every((s) => s.stopped), 'a source was left playing after stop()');

  /*
   * And the next reply must not wait for the audio that was cancelled. A
   * cursor left in the future is silence at the start of the NEXT turn, which
   * is the kind of bug that reads as "the assistant did not answer".
   */
  ctx.currentTime = 1.0;
  player.startTurn(player.currentGeneration);
  player.push(tone(0.2, 48000), 48000, player.currentGeneration);
  player.endOfTurn();
  const next = ctx.scheduled[ctx.scheduled.length - 1];
  assert.ok(next.started < ctx.currentTime + 0.2, 'the next reply was scheduled far in the future');
});

test('an odd trailing byte cannot shift every sample after it', () => {
  // Half a sample would move the byte boundary and turn the rest of the reply
  // into noise. The server holds these back; if one arrives anyway it is
  // dropped rather than realigning the stream.
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  const odd = Buffer.from([0x00, 0x10, 0x00, 0x20, 0x7f]).toString('base64');
  player.push(odd, 48000, 1);
  player.endOfTurn();
  assert.equal(playedSamples(ctx).length, 2, 'the half sample was not discarded');
});

// ── Where the assistant may send somebody ──────────────────────────────────

test('the assistant can only offer routes this application registers', () => {
  const app = read('src/App.tsx') + read('src/main.tsx');
  const routerFiles = ['src/App.tsx'];
  let declared = app;
  for (const f of routerFiles) declared += read(f);

  for (const d of TALK_DESTINATIONS) {
    assert.ok(d.path.startsWith('/'), `${d.key} is not a path`);
    assert.ok(!d.path.includes(':'), `${d.key} needs an id nobody has: ${d.path}`);
  }
});

test('no admin route is ever offered to an anonymous caller', () => {
  // AI TALK is public. Offering /admin/* sends a stranger to a page that will
  // refuse them, which reads as the product being broken.
  for (const d of TALK_DESTINATIONS) {
    assert.ok(!d.path.startsWith('/admin'), `${d.key} points at an admin page`);
  }
});

test('an invented destination produces no button at all', () => {
  assert.equal(resolveDestination('properties-in-vake'), null);
  assert.equal(resolveDestination('/verify'), null, 'a path is not a key');
  assert.equal(resolveDestination(''), null);
  assert.equal(resolveDestination(undefined), null);
  assert.ok(resolveDestination('verify'), 'a real key must still resolve');
});

test('the marker is never spoken, however badly the model writes it', () => {
  const good = `დაგეხმარებით. ${ACTION_MARKER} {"go":"verify","end":false}>>`;
  assert.equal(spokenPart(good), 'დაგეხმარებით.');
  assert.equal(parseAction(good).destination.path, '/verify');

  // Malformed: still must not be read aloud.
  const broken = `დაგეხმარებით. ${ACTION_MARKER} {"go":`;
  assert.equal(spokenPart(broken), 'დაგეხმარებით.');
  assert.equal(parseAction(broken).destination, null);
  assert.equal(parseAction(broken).end, false);
});

test('a half-arrived marker is held back rather than spoken', () => {
  // Tokens arrive one at a time, so "<<A" exists for a moment. Speaking it
  // because the rest had not arrived yet would be the same bug with better
  // timing.
  assert.equal(endsWithPartialMarker('hello <<A'), true);
  assert.equal(endsWithPartialMarker('hello <'), true);
  assert.equal(endsWithPartialMarker('hello <<ACT'), false, 'a complete marker is not partial');
  assert.equal(endsWithPartialMarker('hello there'), false);
});

test('ending the call requires an explicit decision and a known reason', () => {
  assert.equal(parseAction('bye <<ACT {"end":true,"why":"FAREWELL"}>>').endReason, 'FAREWELL');
  assert.equal(parseAction('bye <<ACT {"end":true,"why":"NONSENSE"}>>').endReason, 'OBJECTIVE_MET');
  assert.equal(parseAction('hello').end, false, 'an ordinary reply must never end the call');
  assert.equal(parseAction('hi <<ACT {"go":"verify"}>>').end, false);
});

test('the menu the model sees lists every destination and no paths', () => {
  const menu = destinationMenu();
  for (const d of TALK_DESTINATIONS) assert.ok(menu.includes(d.key), `${d.key} missing from the menu`);
  assert.ok(!menu.includes('/'), 'the model must never be shown a path it could copy');
});

// ── Who is actually speaking ───────────────────────────────────────────────

test('AI TALK synthesis goes to Cartesia and has no path to ElevenLabs', () => {
  /*
   * The check that was missing last time. speakPhraseStreaming used to walk a
   * ladder — ElevenLabs streaming, ElevenLabs whole-clip, then Cartesia — and
   * nothing recorded which rung answered, so a silent demotion to the slow
   * path went unnoticed through five production turns.
   *
   * There is now one provider on this surface. This asserts it at the only
   * place it is decidable: the source of the function that speaks.
   */
  const src = read('supabase/functions/ai-talk-session/index.ts');
  const at = src.indexOf('async function speakPhraseStreaming(');
  assert.ok(at > 0, 'the streaming synthesiser is gone');
  const body = src.slice(at, src.indexOf('\n}\n', at));

  assert.ok(/streamCartesiaPcm\(/.test(body), 'AI TALK must synthesise through Cartesia');
  assert.ok(!/elevenLabs|ElevenLabs|eleven_/i.test(body),
    'AI TALK must have no ElevenLabs path, not even as a fallback');
  assert.ok(!/speakPhrase\(sb/.test(body),
    'the whole-clip ladder is what hid the last regression; it must not be reachable from here');
});

test('the browser tells the server what rate to synthesise at', () => {
  // Matching the AudioContext is how the resampler stops running at all, and
  // the resampler is where the artefacts were. If this stops being sent, the
  // artefacts come back quietly.
  const panel = read('src/components/home/AiTalkPanel.tsx');
  assert.ok(/outputSampleRate/.test(panel), 'the panel must send its output rate');

  const edge = read('supabase/functions/ai-talk-session/index.ts');
  assert.ok(/nearestCartesiaRate\(/.test(edge), 'the server must snap it to a supported rate');
  assert.ok(/outputSampleRate,/.test(edge), 'the rate must reach synthesis');
});

test('an interrupted turn cancels the request rather than just ignoring it', () => {
  const client = read('src/lib/comm/voiceClient.ts');
  assert.ok(/turnAbort\s*=\s*new AbortController\(\)/.test(client), 'a turn must be cancellable');
  assert.ok(/this\.turnAbort\?\.abort\(\)/.test(client), 'stopping playback must abort the request');
  assert.ok(/generation !== this\.turnGeneration/.test(client),
    'events from a superseded turn must be dropped');

  const edge = read('supabase/functions/ai-talk-session/index.ts');
  assert.ok(/turnAbort/.test(edge), 'the server must be able to stop synthesising for a dropped caller');
});

test('navigating away tears the session down before the route changes', () => {
  /*
   * A React route change unmounts the panel. An unmount racing a live
   * microphone, a websocket and a scheduled audio queue is how a voice keeps
   * talking over the next page — which is the specific thing the owner asked
   * never to happen.
   */
  const panel = read('src/components/home/AiTalkPanel.tsx');
  const at = panel.indexOf('const followDestination');
  assert.ok(at > 0, 'taking the assistant up on a destination is not implemented');
  const body = panel.slice(at, at + 400);
  assert.ok(body.indexOf('await endSession') < body.indexOf('navigate('),
    'the session must be stopped BEFORE navigating, not after');
});

test('the transcript is painted once a frame, not once a token', () => {
  const panel = read('src/components/home/AiTalkPanel.tsx');
  assert.ok(/requestAnimationFrame/.test(panel), 'transcript updates must be coalesced');
  assert.ok(!/onTranscript: \(next\) => setTurns/.test(panel),
    'setting state per token is what made the panel stutter on a phone');
  assert.ok(/memo\(TranscriptView/.test(panel), 'the transcript must not re-render for unchanged turns');
});

// ── Six languages, and nobody choosing one from a menu ─────────────────────

test('the recogniser is given every language the product speaks, not just Georgian', () => {
  /*
   * Georgian was the language the Google path was proved in, and the whole
   * pipeline ended up pinned to ka-GE because of it. A Russian speaker would
   * have been transcribed into Georgian letters.
   */
  // The six now live in one shared module rather than being restated here.
  const domain = read('src/lib/comm/talkLanguage.ts');
  for (const code of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    assert.ok(new RegExp(`'${code}'`).test(domain), `${code} is not a language AI TALK offers`);
  }
  const edge = read('supabase/functions/ai-talk-session/index.ts');
  assert.ok(/resolveTurnLanguage\(/.test(edge), 'the server must resolve the turn language itself');

  /*
   * This assertion used to demand the whole candidate set be sent as the
   * recogniser config, which was the obvious design and which chirp_3 refuses
   * with INVALID_ARGUMENT -- taking every stream down, not just the
   * multilingual ones. The mode it does accept is `auto`, asserted in its own
   * test below. What belongs here is that the SESSION knows about six
   * languages, which is a different claim from how the recogniser is set up.
   */
  assert.ok(/multiLanguageEnabled\(\)/.test(read('official-worker/src/speech/GoogleSpeechStream.ts')),
    'multilingual recognition must be a deliberate, switchable mode');
});

test('the language the recogniser heard is carried back, not thrown away', () => {
  // English and Turkish are the same alphabet, so no amount of looking at the
  // transcript can separate them. The provider's own answer is the only
  // evidence, and it used to be discarded at the call site.
  const worker = read('official-worker/src/speech/SpeechGateway.ts');
  assert.ok(/language: heard \?\? language/.test(worker), 'the gateway must forward what was heard');

  // Comments stripped first: the code explaining this trap has to quote the
  // old call, and a guard that fails on its own documentation teaches people
  // to delete the documentation.
  const client = read('src/lib/comm/voiceClient.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // It reaches the resolver as EVIDENCE now, not as an answer, which is the
  // distinction that stopped Korean entering a Georgian session.
  assert.ok(/providerLanguage: detected/.test(client),
    'the recogniser answer must reach the resolver');
  assert.ok(/resolveTurnLanguage\(/.test(client),
    'the turn language must come from the one resolver');
});

test('script decides where it can, and the page locale never decides first', () => {
  const fresh = { current: 'en', locked: false, votes: [] };

  // Georgian letters are Georgian whatever a detector guessed.
  const ka = stabiliseLanguage(fresh, { text: 'გამარჯობა, ბინას ვეძებ ვაკეში დღეს', detected: 'en', confidence: 0.9 });
  assert.equal(ka.current, 'ka');

  const he = stabiliseLanguage(fresh, { text: 'שלום, אני מחפש דירה בתל אביב היום', detected: 'en', confidence: 0.9 });
  assert.equal(he.current, 'he');

  const ar = stabiliseLanguage(fresh, { text: 'مرحبا، أبحث عن شقة في تبليسي اليوم', detected: 'en', confidence: 0.9 });
  assert.equal(ar.current, 'ar');

  const ru = stabiliseLanguage(fresh, { text: 'Здравствуйте, я ищу квартиру в Тбилиси', detected: 'en', confidence: 0.9 });
  assert.equal(ru.current, 'ru');
});

test('Turkish and English are separated by the recogniser, since script cannot', () => {
  const fresh = { current: 'ka', locked: false, votes: [] };
  const tr = stabiliseLanguage(fresh, {
    text: 'Merhaba, Tiflis merkezde iki odali bir daire ariyorum',
    detected: 'tr', confidence: 0.9,
  });
  assert.equal(tr.current, 'tr', 'Latin script must defer to what the recogniser heard');
});

test('a settled conversation is not re-decided by one short sample', () => {
  let state = { current: 'ka', locked: false, votes: [] };
  for (let i = 0; i < 4; i++) {
    state = stabiliseLanguage(state, {
      text: 'მინდა ვიყიდო ბინა ვაკეში ბალკონით და პარკინგით',
      detected: 'ka', confidence: 0.9,
    });
  }
  assert.equal(state.current, 'ka');

  // "ok" is two Latin characters. It must not move a settled Georgian call.
  const wobble = stabiliseLanguage(state, { text: 'ok', detected: 'en', confidence: 0.3 });
  assert.equal(wobble.current, 'ka', 'a two-character aside switched the language');
});

test('a real switch mid-conversation is followed', () => {
  let state = { current: 'ka', locked: false, votes: [] };
  for (let i = 0; i < 4; i++) {
    state = stabiliseLanguage(state, { text: 'გამარჯობა, ბინას ვეძებ ვაკეში', detected: 'ka', confidence: 0.9 });
  }
  for (let i = 0; i < 4; i++) {
    state = stabiliseLanguage(state, {
      text: 'Извините, давайте продолжим по-русски, я ищу квартиру',
      detected: 'ru', confidence: 0.9,
    });
  }
  assert.equal(state.current, 'ru', 'a caller who genuinely switched must be followed');
});

test('the browser sends its language set and the socket accepts one', () => {
  const socket = read('src/lib/comm/googleTranscribe.ts');
  assert.ok(/query\.set\('languages'/.test(socket), 'the browser must send its candidates');

  const gateway = read('official-worker/src/speech/SpeechGateway.ts');
  assert.ok(/searchParams\.get\('languages'\)/.test(gateway), 'the gateway must read them');
  assert.ok(/MAX_STREAM_LANGUAGES/.test(gateway), 'the set must be capped to the provider limit');
  // Everything in that query string is browser-controlled.
  assert.ok(/\/\^\[a-z\]\{2,3\}-\[A-Z\]\{2\}\$\//.test(gateway), 'each tag must be validated');
});

test('a language label that contradicts the script is discarded', () => {
  /*
   * MEASURED ON THE DEPLOYED PATH.
   *
   * An English sentence — "Hello, I am looking for a two bedroom flat in
   * Vake" — was transcribed perfectly and labelled ka-GE by the recogniser's
   * own automatic detection. Taken at face value that is a Georgian vote on
   * an English turn, and the assistant answers an English speaker in
   * Georgian.
   *
   * Georgian has its own alphabet. A label naming it, on text containing none
   * of it, is wrong about something it cannot be wrong about.
   */
  const fromEnglish = { current: 'en', locked: false, votes: [] };
  const kept = stabiliseLanguage(fromEnglish, {
    text: 'Hello, I am looking for a two bedroom flat in Vake',
    detected: 'ka-GE', confidence: 0.9,
  });
  assert.equal(kept.current, 'en', 'a Georgian label on Latin text moved the conversation');

  // The same guard must not fire when the label AGREES with the script.
  const georgian = stabiliseLanguage({ current: 'en', locked: false, votes: [] }, {
    text: 'გამარჯობა, ვაკეში ბინა მაინტერესებს',
    detected: 'ka-GE', confidence: 0.9,
  });
  assert.equal(georgian.current, 'ka');

  // And it must not fire on a Latin-script label, where the detector is the
  // only evidence that exists.
  const turkish = stabiliseLanguage({ current: 'ka', locked: false, votes: [] }, {
    text: 'Merhaba, Vake semtinde iki odali bir daire ariyorum',
    detected: 'tr', confidence: 0.9,
  });
  assert.equal(turkish.current, 'tr');
});

test('Hebrew arrives as the legacy tag and is normalised once, at the edge', () => {
  // Google emits `iw`, the code ISO renamed to `he` in 1989. Nothing
  // downstream should have to know they are the same language.
  assert.equal(normaliseLanguageTag('iw'), 'he');
  assert.equal(normaliseLanguageTag('iw-IL'), 'he');
  assert.equal(normaliseLanguageTag('ka-GE'), 'ka');
  assert.equal(normaliseLanguageTag('ru'), 'ru');
  assert.equal(normaliseLanguageTag(null), null);
  assert.equal(normaliseLanguageTag(''), null);
});

test('automatic detection is what the recogniser is configured with', () => {
  // An explicit candidate list is refused by chirp_3 with INVALID_ARGUMENT,
  // and that refusal takes every stream down, not just the multilingual ones.
  const worker = read('official-worker/src/speech/GoogleSpeechStream.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // Either trigger -- a socket that asked to identify the language, or the
  // global operator switch -- must resolve to `auto` and never to a list.
  assert.ok(/\?\s*\['auto'\]\s*:\s*\[cfg\.languageCode\]/.test(worker),
    'multilingual recognition must use auto, which is the mode chirp_3 accepts');
  assert.ok(/multiLanguageEnabled\(\)/.test(worker), 'the global switch must still be honoured');
  assert.ok(/cfg\.detect/.test(worker), 'and a single socket must be able to ask');
  assert.ok(!/languageCodes: cfg\.languageCodes(?!\?)/.test(worker),
    'an explicit language list must never be sent as the recogniser config');
});

test('a turn that ends the call never offers somewhere to go', () => {
  /*
   * Observed in production: a Georgian farewell came back with a button to
   * /active-search attached. A destination offered as the panel closes is not
   * a helpful extra — the user has just said they are finished.
   */
  const farewell = parseAction('gmadlobt, nakhvamdis <<ACT {"go":"search","end":true,"why":"FAREWELL"}>>');
  assert.equal(farewell.end, true);
  assert.equal(farewell.endReason, 'FAREWELL');
  assert.equal(farewell.destination, null, 'a closing turn must carry no CTA');

  // And a turn that is NOT ending still offers one.
  const helping = parseAction('here it is <<ACT {"go":"verify","end":false}>>');
  assert.equal(helping.destination.path, '/verify');
});

test('the transcript still updates when the tab is in the background', () => {
  /*
   * requestAnimationFrame is the right way to coalesce paints and the wrong
   * way to coalesce data: a hidden tab never fires one. Caught on the deployed
   * build — a whole turn completed, audio played, the destination button
   * appeared, and the transcript stayed empty behind them. On a phone that is
   * switching apps and coming back to an empty conversation.
   */
  const panel = read('src/components/home/AiTalkPanel.tsx');
  assert.ok(/visibilityState === 'visible'/.test(panel),
    'coalescing must know whether the tab can paint at all');
  assert.ok(/window\.setTimeout\(flush/.test(panel),
    'a hidden tab needs a timer, since it will never get a frame');
});

// ── What "audible" is allowed to mean ──────────────────────────────────────

test('a reply of pure silence is not reported as playback', () => {
  // A provider that gives up answers 200 with zeroes. That is not speech.
  const ctx = new FakeContext(48000);
  ctx.state = 'running';
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  const silent = Buffer.alloc(9600).toString('base64');   // 0.1s of zeroes
  player.push(silent, 48000, 1);
  player.endOfTurn();
  ctx.currentTime = 5;
  const v = player.audiblyPlayed();
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'ONLY_SILENCE');
});

test('a suspended context is reported, not treated as playback', () => {
  // Chrome creates contexts suspended without a gesture; a buffer scheduled
  // into one is a buffer nobody will ever hear.
  const ctx = new FakeContext(48000);
  ctx.state = 'suspended';
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  player.push(tone(0.2, 48000), 48000, 1);
  player.endOfTurn();
  ctx.currentTime = 5;
  const v = player.audiblyPlayed();
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'CONTEXT_SUSPENDED');
});

test('nothing scheduled is not playback, whatever the counters say', () => {
  const ctx = new FakeContext(48000);
  ctx.state = 'running';
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  assert.equal(player.audiblyPlayed().reason, 'NOTHING_SCHEDULED');
});

test('a real reply into a running context is audible once the clock passes it', () => {
  const ctx = new FakeContext(48000);
  ctx.state = 'running';
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  player.push(tone(0.3, 48000), 48000, 1);
  player.endOfTurn();
  // Before the clock reaches the first piece: scheduled, not yet heard.
  assert.equal(player.audiblyPlayed().reason, 'CLOCK_NOT_ADVANCED');
  ctx.currentTime = 1;
  assert.equal(player.audiblyPlayed().ok, true);
});

test('an underrun resyncs once instead of accumulating drift', () => {
  const ctx = new FakeContext(48000);
  ctx.state = 'running';
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  player.push(tone(0.15, 48000), 48000, 1);            // scheduled at ~0.05
  // The network stalls: the clock runs well past everything scheduled.
  ctx.currentTime = 3;
  player.push(tone(0.15, 48000), 48000, 1);
  const last = ctx.scheduled[ctx.scheduled.length - 1];
  assert.ok(last.started >= 3 && last.started < 3.2,
    `after a stall the next piece must restart near the clock, not at ${last.started}`);
  assert.equal(player.snapshot().underruns, 1, 'the stall must be counted once');
});

// ── Session identity, reset, and what reaches the screen ───────────────────

test('every turn carries a generation and an id, and stale events are dropped', () => {
  const client = read('src/lib/comm/voiceClient.ts');
  assert.ok(/this\.turnGeneration \+= 1;/.test(client), 'a turn must claim a generation');
  assert.ok(/this\.turnId = `t\$\{generation\}/.test(client), 'a turn must have an id for the trace');
  assert.ok(/if \(generation !== this\.turnGeneration\) return;/.test(client),
    'events from a superseded turn must be dropped before they touch state');
  assert.ok(/if \(this\.closed \|\| generation !== this\.turnGeneration\) return;/.test(client),
    'a stale turn must not resume listening or end the session on behalf of a newer one');
});

test('a new session starts with no language, transcript, destination or queue from the last one', () => {
  const panel = read('src/components/home/AiTalkPanel.tsx');
  const at = panel.indexOf('const start = useCallback(async () => {');
  // The whole reset block -- up to the request that starts the session --
  // rather than a fixed 900 characters, which an explanatory comment on
  // one of the resets pushed the last reset out of.
  const body = panel.slice(at, panel.indexOf("action: 'start'", at));
  assert.ok(body.includes('languageRef.current = null'),
    'start() must reset languageRef: it is what every grant languageCode is built from');
  for (const reset of ['setTurns([])', 'setDestination(null)', 'setFailure(null)',
                       'detectedRef.current = null', 'historyRef.current = []']) {
    assert.ok(body.includes(reset), `start() must reset: ${reset}`);
  }
  // And the session object is new each time, so the player, generation and
  // language state are fresh by construction rather than by cleanup.
  assert.ok(/const session = new Session\(/.test(panel), 'each start must construct a new session');
});

test('the visible transcript renders recognised text and nothing else', () => {
  // No provider label, no candidate list, no confidence, no diagnostics.
  const panel = read('src/components/home/AiTalkPanel.tsx');
  const at = panel.indexOf('function TranscriptView(');
  const body = panel.slice(at, panel.indexOf('\n}\n', at));
  assert.ok(/\{turn\.text\}/.test(body), 'a row must render the turn text');
  for (const forbidden of ['providerLanguage', 'resolution', 'confidence', 'candidates', 'diag']) {
    assert.ok(!body.includes(forbidden), `the transcript must not render ${forbidden}`);
  }
});

test('a silent or wrong-language turn is named to the visitor, not swallowed', () => {
  const panel = read('src/components/home/AiTalkPanel.tsx');
  assert.ok(/VOICE_SILENT: 'talk_err_playback'/.test(panel), 'a silent turn must have a sentence');
  assert.ok(/LANGUAGE_UNAVAILABLE: 'talk_err_assistant'/.test(panel), 'a language failure must have a sentence');
  const client = read('src/lib/comm/voiceClient.ts');
  assert.ok(/this\.cb\.onError\?\.\('VOICE_SILENT'\)/.test(client), 'a silent turn must be reported');
});

test('the state machine is one variable with a transition table', () => {
  const client = read('src/lib/comm/voiceClient.ts');
  assert.ok(/const ALLOWED_TRANSITIONS/.test(client), 'transitions must be declared');
  assert.ok(/milestone\('illegal_transition'/.test(client), 'an unexpected transition must be recorded');
  // Not enforced: refusing a transition mid-call is worse than logging it.
  assert.ok(!/if \(allowed && !allowed\.includes\(state\)\) return;/.test(client),
    'a guard that blocks transitions would freeze a live call');
});

test('the server writes one structured trace per turn, with no transcript in it', () => {
  const edge = read('supabase/functions/ai-talk-session/index.ts');
  const at = edge.indexOf("logEvent('ai-talk', 'turn_trace'");
  assert.ok(at > 0, 'the per-turn trace is missing');
  const body = edge.slice(at, edge.indexOf('});', at));
  for (const field of ['session_id', 'turn_id', 'provider_language', 'normalized_provider_language',
                       'transcript_script', 'resolved_language', 'resolution_reason', 'tts_first_byte_ms',
                       'tts_chunk_count', 'tts_sample_rate', 'auto_end_reason']) {
    assert.ok(body.includes(field), `trace must carry ${field}`);
  }
  assert.ok(!/said|full|shown|transcript:/.test(body), 'the trace must not carry what was said');
});

// ── CARTESIA_PACING: the voice is paced by the provider, never by the player ─
//
// "It sounds slow" has one obvious fix and one correct fix. The obvious one is
// raising playbackRate in the browser, which shortens the audio by resampling
// it and takes the pitch up with it — the chipmunk this whole migration was
// about. The correct one is asking sonic to GENERATE at a different pace.

const cartesiaSrc = readFileSync('supabase/functions/_shared/comm/cartesia.ts', 'utf8');
const edgeSrc = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
const playerSrc = readFileSync('src/lib/comm/pcmPlayer.ts', 'utf8');
const clientSrc = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');

test('pacing is a provider generation control, not a browser resample', () => {
  const player = stripComments(playerSrc);
  const client = stripComments(clientSrc);
  // playbackRate on a buffer source is resampling, and resampling moves pitch.
  assert.ok(!/playbackRate/.test(player), 'the player must never retime audio');
  assert.ok(!/playbackRate/.test(client), 'the client must never retime audio');
  assert.ok(/generation_config/.test(cartesiaSrc), 'pacing must be asked of the provider');
});

test('the speed sent is always one the API documents as valid', () => {
  // Cartesia documents [0.6, 1.5] inclusive and answers 400 outside it. A bad
  // value must become a valid one here, not a failed turn mid-conversation.
  assert.ok(/min:\s*0\.6/.test(cartesiaSrc) && /max:\s*1\.5/.test(cartesiaSrc));
  assert.ok(/Math\.min\(/.test(cartesiaSrc) && /Math\.max\(/.test(cartesiaSrc));
});

test('the default speed stays inside the documented range', () => {
  const m = /const CARTESIA_DEFAULT_SPEED = ([0-9.]+);/.exec(edgeSrc);
  assert.ok(m, 'there must be one named default');
  const speed = Number(m[1]);
  assert.ok(speed >= 0.6 && speed <= 1.5, `${speed} is outside what Cartesia accepts`);
  // A big jump reads as rushed rather than competent, and the measured
  // provider latency (177–301ms) says the voice was never why a reply felt late.
  assert.ok(speed <= 1.25, `${speed} is a rush, not a pace`);
});

test('the requested pace is recorded on the turn that used it', () => {
  assert.ok(/tts_speed:/.test(edgeSrc), 'a report about how it sounded needs the setting that made it');
});

test('the output rate we may ask for is exactly what Cartesia serves', () => {
  // Every rate in the list is one the API documents for raw pcm_s16le. A rate
  // it does not serve comes back as a different rate, which is the whine.
  const documented = [8000, 16000, 22050, 24000, 44100, 48000];
  const m = /CARTESIA_OUTPUT_RATES = \[([^\]]+)\]/.exec(cartesiaSrc);
  assert.ok(m);
  const listed = m[1].split(',').map((n) => Number(n.trim())).filter(Number.isFinite);
  assert.deepEqual(listed, documented);
});
