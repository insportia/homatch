// Two things a real Windows session found after 454b292a.
//
// ONE. The visitor spoke Russian, then a clear English sentence. The reply
// came back in Russian. The turn trace, from production:
//
//   provider_language ru-RU  transcript_script latin  previous ru
//   resolved ru  reason STICKY_HELD  confidence 0.2          (twice)
//
// The socket is pinned to the session's language, so its label is the
// configuration, not a detection -- and the resolver treated "ru" as a vote
// against the Latin letters the same socket had just written.
//
// TWO. After ending that session and pressing Start again on the same page,
// every new socket opened as ru-RU (worker logs: four sockets, 85-96 frames
// each, no usable final) and the panel sat on "Thinking". start() reset
// detectedRef and historyRef and forgot languageRef, the one ref every grant's
// languageCode is built from.
//
// These drive the REAL resolver turn by turn with the provider label the
// pinned socket would actually give, and the REAL session objects across
// three starts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTurnLanguage, SWITCH_MIN_LETTERS } from '../talkLanguage.ts';
import { FinalWatch } from '../finalWatch.ts';
import { LiveAudioRouter } from '../liveAudioRouter.ts';
import { PcmStreamPlayer } from '../pcmPlayer.ts';

/**
 * A pinned socket reports the language it was configured with. What it
 * WRITES depends on what was said: same-script speech comes back in that
 * script; speech in a Latin language comes back in Latin letters.
 */
const PROVIDER_TAG = { ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', ar: 'ar-XA', tr: 'tr-TR', he: 'iw-IL' };

const SAID = {
  ka: 'გამარჯობა, ვაკეში ორსაძინებლიანი ბინა მაინტერესებს.',
  en: 'Okay, and what does a square metre cost in Vake right now?',
  ru: 'Хорошо, а сколько стоит квадратный метр в Ваке сейчас?',
  ar: 'حسنا، وكم سعر المتر المربع في فاكي الآن؟',
  tr: 'Tamam, peki Vake\'de metrekare fiyatı şu anda ne kadar?',
  he: 'בסדר, וכמה עולה מטר מרובע בוואקה עכשיו?',
};

/** One conversation: the session language is carried turn to turn, as the client does. */
function conversation(pageLocale = 'ka') {
  const history = [];
  let session = null;
  return {
    history,
    turn(lang, text = SAID[lang]) {
      // The socket was pinned to the PREVIOUS session language (or the page).
      const pinned = session ?? pageLocale;
      const r = resolveTurnLanguage({
        transcript: text, providerLanguage: PROVIDER_TAG[pinned],
        previousSessionLanguage: session, pageLocale,
      });
      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: `[reply in ${r.resolvedLanguage}]` });
      session = r.resolvedLanguage;
      return r;
    },
    get session() { return session; },
  };
}

/* ── BUG ONE ────────────────────────────────────────────────────────────── */

test('the real turn: a clear English sentence into a ru-RU socket is answered in English', () => {
  const r = resolveTurnLanguage({
    transcript: SAID.en, providerLanguage: 'ru-RU',
    previousSessionLanguage: 'ru', pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'en', 'RU -> EN must switch on THIS turn');
  assert.equal(r.resolutionReason, 'LATIN_FROM_PINNED');
  assert.ok(r.confidence >= 0.6, 'and settle, so the next socket is en-US');
});

test('the same sentence with Turkish letters resolves to Turkish, not English', () => {
  const r = resolveTurnLanguage({
    transcript: SAID.tr, providerLanguage: 'ru-RU',
    previousSessionLanguage: 'ru', pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'tr');
});

test('one conversation through all six languages keeps its history and follows each turn', () => {
  const c = conversation('ka');
  const expected = ['ka', 'en', 'ru', 'ar', 'tr', 'he', 'ka'];
  const got = expected.map((lang) => c.turn(lang).resolvedLanguage);
  assert.deepEqual(got, expected, `KA→EN→RU→AR→TR→HE→KA resolved as ${got.join('→')}`);
  assert.equal(c.history.length, 14, 'seven user turns and seven replies, nothing reset');
  assert.equal(c.history[0].content, SAID.ka, 'the first turn is still the first turn');
});

test('EN -> a clear Russian sentence -> Russian, on the same turn', () => {
  const r = resolveTurnLanguage({
    transcript: SAID.ru, providerLanguage: 'en-US',
    previousSessionLanguage: 'en', pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'ru', 'Cyrillic script is decisive on its own');
});

test('weak tokens still cannot move an established session, in either direction', () => {
  /*
   * "კი" AND "არა" MOVED OUT OF THIS LIST DELIBERATELY.
   *
   * They were here because the letter floor could not tell a short real word
   * from a short invented one. The owner's physical test found the cost: a
   * session that had drifted to another language would not come back until a
   * whole Georgian sentence was spoken, because every natural way of
   * returning -- "კი", "ხო", "არა", "მოკლედ" -- was too short to be heard.
   *
   * What replaced the floor for these is not a lower bar, it is a different
   * question: the letters must be an alphabet nobody else in this product
   * writes in, the session must not already be in that alphabet, the word
   * must be one that language actually uses, and it must be a RETURN -- to
   * the page's own language or to one this conversation has already spoken.
   * "да" arriving in an English session on a Georgian page is none of those
   * things, and is still held, which is what the rest of this list checks.
   */
  for (const [session, token] of [['ru', 'ok'], ['ru', 'yes'], ['ka', 'no'], ['en', 'да'], ['ru', 'ok so']]) {
    const r = resolveTurnLanguage({
      transcript: token, providerLanguage: PROVIDER_TAG[session],
      previousSessionLanguage: session, pageLocale: 'ka',
    });
    assert.equal(r.resolvedLanguage, session, `"${token}" moved a ${session} session to ${r.resolvedLanguage}`);
  }
  // And the two that changed, stated as the behaviour they now have.
  for (const [session, token] of [['en', 'კი'], ['ru', 'არა'], ['tr', 'ხო'], ['he', 'მოკლედ']]) {
    const r = resolveTurnLanguage({
      transcript: token, providerLanguage: PROVIDER_TAG[session] ?? session,
      previousSessionLanguage: session, pageLocale: 'ka',
    });
    assert.equal(r.resolvedLanguage, 'ka', `"${token}" did not bring a ${session} session home`);
  }
  assert.ok(SWITCH_MIN_LETTERS >= 6, 'the floor itself is unchanged');
});

test('a short Latin fragment from a ru socket is held, a sentence is not', () => {
  const held = resolveTurnLanguage({ transcript: 'ok so', providerLanguage: 'ru-RU', previousSessionLanguage: 'ru', pageLocale: 'ka' });
  assert.equal(held.resolvedLanguage, 'ru');
  const moved = resolveTurnLanguage({ transcript: 'ok so what about the parking space', providerLanguage: 'ru-RU', previousSessionLanguage: 'ru', pageLocale: 'ka' });
  assert.equal(moved.resolvedLanguage, 'en');
});

test('Luna is told the current turn language with the turn, and told not to announce it', () => {
  const edge = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  assert.match(edge, /\.\.\.languageContract\(replyLanguage, body, resolution\)/,
    'the reply language must travel with the utterance, not be inferred from history');
  assert.match(edge, /CURRENT USER TURN LANGUAGE: \$\{name\}/, 'stated as a fact of THIS turn');
  assert.match(edge, /without saying which language you are using/, 'and must not become "I will answer in English"');
});

/* ── BUG TWO ────────────────────────────────────────────────────────────── */

test('a new session starts from the page language, never from the last conversation', () => {
  const panel = readFileSync('src/components/home/AiTalkPanel.tsx', 'utf8');
  const start = panel.slice(panel.indexOf('const start = useCallback('), panel.indexOf("action: 'start'"));
  assert.match(start, /languageRef\.current = null;/,
    'start() must reset languageRef -- it is what every grant languageCode comes from');
  assert.match(start, /detectedRef\.current = null;/);
  assert.match(panel, /languageCode: languageRef\.current \|\| language,/,
    'the grant falls back to the page language when nothing has been established');
});

/** The per-session objects the client creates; drive them through a whole session. */
function freshSession(clock) {
  const ctx = {
    sampleRate: 48000, currentTime: 0, state: 'running', sources: [],
    createBuffer: (_c, n, r) => { const d = new Float32Array(n); return { length: n, sampleRate: r, duration: n / r, copyToChannel: (a) => d.set(a) }; },
    createBufferSource() { const s = { buffer: null, onended: null, _at: null, connect() {}, disconnect() {}, start(at) { s._at = at; ctx.sources.push(s); }, stop() { s._stopped = true; } }; return s; },
    advance(sec) { ctx.currentTime += sec; for (const s of ctx.sources) if (!s._done && !s._stopped && s._at !== null && ctx.currentTime >= s._at + s.buffer.duration) { s._done = true; s.onended?.(); } },
  };
  return {
    ctx,
    router: new LiveAudioRouter({ sampleRate: 16000, maxBufferMs: 3000, maxWaitMs: 2500, now: () => clock.t }),
    watch: new FinalWatch({ timeoutMs: 6000, maxConsecutive: 3 }),
    player: new PcmStreamPlayer(ctx, {}),
  };
}

const pcm = (ms, rate) => {
  const n = Math.round((ms / 1000) * rate); const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 7) * 5000), i * 2);
  return b;
};

function runSession(s, clock) {
  // READY, mic active, one utterance sent live
  s.router.expect('CONNECTING'); s.router.ready();
  const sent = s.router.route(new Int16Array(320), true);
  assert.equal(sent.kind, 'SEND', 'MIC_ACTIVE: audio reaches the socket');
  // end of turn, a usable final, the model is reached
  s.watch.requested(clock.t); clock.t += 900; s.watch.arrived();
  // the reply plays to the end
  s.player.startTurn(1);
  for (let i = 0; i < 20; i++) { s.player.push(pcm(200, 48000).toString('base64'), 48000, 1); s.ctx.advance(0.1); }
  s.player.endOfTurn(); s.ctx.advance(10);
  const t = s.player.turnStats();
  assert.equal(t.drained, true, 'PLAYBACK_DRAINED');
  assert.equal(s.watch.consecutiveNoFinals, 0);
  assert.equal(s.router.currentPhase, 'READY');
  return t;
}

test('Start -> Stop -> Start -> Stop -> Start: three sessions, nothing carried over', () => {
  const clock = { t: 0 };
  let previous = null;
  for (let n = 1; n <= 3; n++) {
    const s = freshSession(clock);
    if (previous) {
      assert.notEqual(s.router, previous.router, 'a new session builds its own router');
      assert.equal(s.router.postResampleBytes, 0, 'NO_STALE_SESSION_STATE: no bytes from the last session');
      assert.equal(s.watch.noFinalCount, 0, 'no misses from the last session');
      assert.equal(s.player.turnStats().queued, 0, 'no audio from the last session');
    }
    const t = runSession(s, clock);
    assert.ok(t.queued > 0 && t.completed === t.queued, `session ${n}: heard to the end`);
    // Stop: everything this session owned is released.
    s.player.stop('SESSION_STOP'); s.router.abandon('session closed');
    previous = s;
    clock.t += 30_000;
  }
});
