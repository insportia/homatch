/*
 * ONE TAP, ONE MICROPHONE.
 *
 * MEASURED, production 2026-09-24T18:21:35Z. One activation of AI TALK made
 * two complete sessions 46 milliseconds apart:
 *
 *   c6e9e704  granted .326   own cache warm   t1 at 18:22:03.826
 *   3db050f2  granted .377   own cache warm   t1 at 18:21:51.701
 *
 * Speech grants arrived in pairs 33-93 ms apart for the whole session. Both
 * recognisers received the SAME four-word sentence -- 20 characters each,
 * voiced_before_ready_ms zero on both -- and two assistants answered it twelve
 * seconds apart. The visitor reported a swallowed opening sentence, because
 * the panel is bound to one session while the other one is also talking.
 *
 * The guard that failed was `startInFlight`, a useRef. Within one component
 * instance it is airtight. Two instances hold two refs and agree about
 * nothing, which is why ownership is module-scope now and why these tests
 * drive that module rather than reading it: a ref-shaped bug cannot be seen
 * by a regex, and this one shipped past a suite that reads source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The module schedules its adoption window with window.setTimeout, as every
 * other timer in this codebase does. Node has the functions and not the
 * object, so the object is supplied; nothing about the behaviour changes.
 */
globalThis.window ??= {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

const {
  newInstanceId, claimActivation, takeOwnership, releaseOwnership,
  adoptExisting, currentSessionId, isAuthoritative, rejectStale,
  ownershipStats, __resetOwnershipForTests,
} = await import('../talkOwnership.ts');

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const PANEL = read('src/components/home/AiTalkPanel.tsx');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A stand-in for everything one activation builds: a server row, a
 * microphone, a speech socket, a playback path. Counting these is how "one
 * tap, one pipeline" stops being a hope.
 */
function world() {
  const w = {
    sessionsCreated: 0, pipelinesOpen: 0, pipelinesEverOpened: 0,
    serverEnds: [], liveIds: new Set(),
  };
  w.activate = async (instanceId) => {
    await tick(5);                       // the edge round trip
    const id = `s${++w.sessionsCreated}`;
    w.liveIds.add(id);
    // A superseded start must not open anything. This is the late second
    // pipeline, and it is as damaging as the early one.
    if (currentSessionId() && currentSessionId() !== id) {
      rejectStale();
      w.liveIds.delete(id);
      w.serverEnds.push([id, 'superseded_start']);
      return null;
    }
    w.pipelinesOpen += 1;
    w.pipelinesEverOpened += 1;
    const dispose = async (reason) => {
      w.pipelinesOpen -= 1;
      w.liveIds.delete(id);
      w.serverEnds.push([id, reason]);
    };
    /*
     * Mirrors AiTalkPanel exactly: a refusal means this instance unmounted
     * while the activation was in flight, and the pipeline it just built has
     * nobody to drive it. Acting on the return value is the behaviour under
     * test -- ignoring it is how the session gets stranded.
     */
    if (!takeOwnership(instanceId, id, dispose)) {
      await dispose('unmounted_during_start');
      return null;
    }
    return id;
  };
  return w;
}

test.beforeEach(() => __resetOwnershipForTests());

/* ── One activation ──────────────────────────────────────────────────────*/

test('ONE_NORMAL_TAP: one session, one pipeline, nothing orphaned', async () => {
  const w = world();
  const id = await claimActivation(() => w.activate('i1'));
  assert.equal(w.sessionsCreated, 1);
  assert.equal(w.pipelinesOpen, 1);
  assert.equal(currentSessionId(), id);
  assert.equal(w.serverEnds.length, 0);
});

test('RAPID_DUPLICATE_START: both callers get the SAME session', async () => {
  const w = world();
  // Not sequential: both entered before either resolved, which is the shape
  // the 41 ms gap had.
  const [a, b] = await Promise.all([
    claimActivation(() => w.activate('i1')),
    claimActivation(() => w.activate('i1')),
  ]);
  assert.equal(a, b, 'two callers got different sessions');
  assert.equal(w.sessionsCreated, 1, 'a second server session was created');
  assert.equal(w.pipelinesEverOpened, 1, 'a second microphone was opened');
  assert.equal(ownershipStats().activationsDeduped, 1);
});

test('TWO_INSTANCES_RACING: the defect that actually shipped', async () => {
  /*
   * The exact production shape: two component instances, each believing it is
   * the only one. Under the old per-instance ref this produced two sessions;
   * the module-scope guard is shared, so the second instance joins the first
   * activation instead of starting its own.
   */
  const w = world();
  const [a, b] = await Promise.all([
    claimActivation(() => w.activate('instance-A')),
    claimActivation(() => w.activate('instance-B')),
  ]);
  assert.equal(a, b);
  assert.equal(w.sessionsCreated, 1);
  assert.equal(w.pipelinesEverOpened, 1, 'two microphones existed at once');
  assert.equal(w.liveIds.size, 1, 'two server sessions were left live');
});

test('NETWORK_RETRY of the start request cannot create a second session', async () => {
  const w = world();
  const first = claimActivation(() => w.activate('i1'));
  // A retry issued while the first is still in flight -- a flaky mobile
  // connection, or a caller that did not trust the first attempt.
  const retry = claimActivation(() => w.activate('i1'));
  await Promise.all([first, retry]);
  assert.equal(w.sessionsCreated, 1);
  assert.equal(ownershipStats().activationsDeduped, 1);
});

test('A_LATER_ACTIVATION still gets its own session: this de-duplicates, it does not latch', async () => {
  const w = world();
  await claimActivation(() => w.activate('i1'));
  releaseOwnership('i1', 'user_ended', 'CALLER_DISPOSES');
  await claimActivation(() => w.activate('i1'));
  assert.equal(w.sessionsCreated, 2, 'the page was latched to one conversation forever');
});

/* ── Unmount, remount, and the leak ──────────────────────────────────────*/

test('REMOUNT_ADOPTS: a re-created component does not start a second session', async () => {
  const w = world();
  await claimActivation(() => w.activate('old'));
  const id = currentSessionId();

  releaseOwnership('old', 'unmount', 'ADOPTABLE');   // unmount
  const adopted = adoptExisting('new');              // remount, inside the grace
  assert.equal(adopted, id, 'the running conversation was not adopted');

  // Well past the grace window: nothing must have been disposed behind it.
  await tick(1400);
  assert.equal(w.pipelinesOpen, 1, 'a healthy conversation was killed by a remount');
  assert.equal(w.serverEnds.length, 0);
  assert.equal(currentSessionId(), id);
  assert.equal(ownershipStats().ownershipAdopted, 1);
});

test('NO_ORPHAN: an unmount nobody comes back for is disposed on BOTH sides', async () => {
  /*
   * The leak, exactly. c6e9e704's component went away, the client pipeline
   * was stopped, and the server was never told -- so the row stayed ACTIVE
   * and billed sixty seconds with nobody listening.
   */
  const w = world();
  await claimActivation(() => w.activate('gone'));
  const id = currentSessionId();
  releaseOwnership('gone', 'unmount', 'ADOPTABLE');

  assert.equal(w.pipelinesOpen, 1, 'disposed before the grace window elapsed');
  await tick(1400);

  assert.equal(w.pipelinesOpen, 0, 'the microphone was left open');
  assert.deepEqual(w.serverEnds, [[id, 'unmount']], 'the server was never told');
  assert.equal(w.liveIds.size, 0, 'an ACTIVE session was orphaned');
  assert.equal(currentSessionId(), null);
  assert.equal(ownershipStats().orphansDisposed, 1);
});

test('UNMOUNT_DURING_STARTUP does not strand the session that is still arriving', async () => {
  const w = world();
  const pending = claimActivation(() => w.activate('i1'));
  // The component goes away while the edge round trip is still in the air.
  releaseOwnership('i1', 'unmount', 'ADOPTABLE');
  await pending;
  await tick(1400);
  // Whatever was created is now accounted for: either never owned, or
  // disposed. What must not exist is a live pipeline with no owner.
  assert.equal(w.pipelinesOpen, 0, 'a pipeline outlived every owner');
  assert.equal(w.liveIds.size, 0, 'a server session was left live with no owner');
});

/* ── Deliberate endings ──────────────────────────────────────────────────*/

test('EXPLICIT_END is immediate, and REPEATED END is harmless', async () => {
  const w = world();
  await claimActivation(() => w.activate('i1'));
  const id = currentSessionId();

  // The caller disposes on this path -- see ReleaseMode. Ownership is
  // dropped at once, with no grace window and no second `end`.
  releaseOwnership('i1', 'user_ended', 'CALLER_DISPOSES');
  assert.equal(currentSessionId(), null);
  assert.equal(w.serverEnds.length, 0, 'ownership sent its own end as well as the caller');

  // Pressing End again, or an unmount arriving right behind it.
  releaseOwnership('i1', 'user_ended', 'CALLER_DISPOSES');
  releaseOwnership('i1', 'unmount', 'ADOPTABLE');
  await tick(1400);
  assert.equal(w.serverEnds.length, 0);
  assert.equal(ownershipStats().deliberateEndings, 1, 'a repeat end was counted as a new one');
  assert.equal(id, id);
});

test('A_DEPARTED_INSTANCE cannot release the session its successor now owns', async () => {
  const w = world();
  await claimActivation(() => w.activate('old'));
  releaseOwnership('old', 'unmount', 'ADOPTABLE');
  adoptExisting('new');

  // The old instance's cleanup fires late. It must not touch what it no
  // longer owns -- that would end a live conversation from a dead component.
  releaseOwnership('old', 'unmount', 'ADOPTABLE');
  await tick(1400);
  assert.equal(w.pipelinesOpen, 1, 'a dead instance ended a live conversation');
  assert.equal(currentSessionId() !== null, true);
});

/* ── Stale responses ─────────────────────────────────────────────────────*/

test('STALE_START_RESPONSE opens nothing and is handed back, not dropped', async () => {
  const w = world();
  // Somebody else is already authoritative when this start comes home.
  takeOwnership('other', 'already-live', async () => {});
  const got = await claimActivation(() => w.activate('late'));

  assert.equal(got, null, 'a superseded start took ownership');
  assert.equal(w.pipelinesOpen, 0, 'a superseded start opened a microphone');
  assert.equal(currentSessionId(), 'already-live');
  assert.equal(ownershipStats().staleStartsRejected, 1);
  // Handed back rather than abandoned: an unowned row is the leak again.
  assert.equal(w.serverEnds.length, 1);
  assert.equal(w.serverEnds[0][1], 'superseded_start');
});

test('isAuthoritative answers for the pair, not for either half', () => {
  takeOwnership('i1', 's1', async () => {});
  assert.equal(isAuthoritative('i1', 's1'), true);
  assert.equal(isAuthoritative('i2', 's1'), false, 'another instance was called the authority');
  assert.equal(isAuthoritative('i1', 's2'), false, 'another session was called the same one');
});

/* ── The panel is actually wired to it ───────────────────────────────────*/

test('THE_PANEL_USES_MODULE_SCOPE, and the ref that failed is gone', () => {
  assert.match(PANEL, /const start = useCallback\(\s*\n\s*\(\) => claimActivation\(\(\) => startOnce\(\)\),/);
  /*
   * Checked against the code, not the word. The comment above `start` names
   * `startInFlight` while explaining why it was removed, and a test that
   * forbids the name forbids the explanation -- which is the more valuable
   * half. What must not exist is a ref still DECIDING an activation.
   */
  assert.ok(!/startInFlight\.current/.test(PANEL), 'the per-instance ref is still deciding activations');
  assert.ok(!/useRef<Promise</.test(PANEL), 'an activation promise is being held per instance again');
  // Unmount hands ownership over instead of abandoning the server row.
  assert.match(PANEL, /releaseOwnership\(instanceId, 'unmount', 'ADOPTABLE'\);/);
  // A remount looks for a conversation already running before starting one.
  assert.match(PANEL, /const adopted = adoptExisting\(instanceId\);/);
  // Deliberate ends do not wait out a grace window.
  assert.match(PANEL, /releaseOwnership\(instanceId, reason, 'CALLER_DISPOSES'\);/);
});

test('endSession is idempotent by construction', () => {
  /*
   * Both refs are read and cleared before anything is awaited, so a second
   * call finds nothing to do. That ordering IS the idempotency; a later
   * `await` between the read and the clear would reopen the window.
   */
  const fn = PANEL.slice(PANEL.indexOf('const endSession = useCallback'), PANEL.indexOf('const followDestination'));
  assert.match(fn, /const live = sessionRef\.current;\s*\n\s*const liveId = sessionIdRef\.current;\s*\n\s*sessionRef\.current = null;\s*\n\s*sessionIdRef\.current = null;/);
  assert.ok(fn.indexOf('if (!live && !liveId) return;') < fn.indexOf('await live?.stop'),
    'the early return happens after the first await');
});

test('a superseded start is returned to the server by the panel too', () => {
  assert.match(PANEL, /const ownerNow = currentSessionId\(\);/);
  assert.match(PANEL, /if \(ownerNow && ownerNow !== grant\.sessionId\) \{/);
  assert.match(PANEL, /endedReason: 'superseded_start',/);
});

/* ── The server backstop ─────────────────────────────────────────────────*/

test('THE_SERVER_COLLAPSES_A_RACE, because two tabs are out of reach of any module', () => {
  /*
   * Module scope is one JavaScript context. Two tabs are two contexts, and no
   * amount of client discipline covers them -- which is why the edge does its
   * own read-after-write. decideGrant's rule was always right; it was a
   * SELECT-then-INSERT and both racers counted zero.
   */
  assert.match(EDGE, /const \{ data: liveNow \} = await sb\.from\('comm_talk_sessions'\)/);
  assert.match(EDGE, /ended_reason: 'duplicate_activation',/);
  assert.match(EDGE, /logEvent\('ai-talk', 'duplicate_session_collapsed'/);
  // Deterministic and total, so two racers cannot both retire and leave none.
  assert.match(EDGE, /if \(a !== b\) return a < b \? row : best;/);
  assert.match(EDGE, /return String\(row\.id\) < String\(best\.id\) \? row : best;/);
  // The loser retires its OWN row only.
  assert.match(EDGE, /\.eq\('id', session\.id\)\.eq\('state', 'ACTIVE'\);/);
});

test('a leaked row cannot become a lockout', () => {
  /*
   * The concurrency rule counts ACTIVE rows, and expiry is applied lazily --
   * so a row nobody touches again stays ACTIVE for ever. Production carried
   * nineteen of them, all past expires_at, none a live conversation. One such
   * row against perVisitorConcurrent = 1 is a visitor who can never start.
   */
  assert.match(EDGE, /\.eq\('state', 'ACTIVE'\)\s*\n\s*\.lte\('expires_at', new Date\(\)\.toISOString\(\)\);/);
  const before = EDGE.indexOf("ended_reason: 'expired' })");
  const insert = EDGE.indexOf("const { data: session, error } = await sb.from('comm_talk_sessions').insert(");
  assert.ok(before > 0 && before < insert, 'stale rows are retired after the insert, which is too late');
});

/* ── Telemetry that can be trusted next time ─────────────────────────────*/

test('PCM_LEVELS_ARE_PER_TURN again, with the session maximum kept apart', () => {
  const PLAYER = read('src/lib/comm/pcmPlayer.ts');
  assert.match(PLAYER, /if \(this\.turnPcmPeak > this\.sessionPcmPeak\) this\.sessionPcmPeak = this\.turnPcmPeak;/);
  assert.match(PLAYER, /this\.turnPcmPeak = 0;\s*\n\s*this\.turnPcmSumSquares = 0;\s*\n\s*this\.turnPcmSamples = 0;/);
  assert.match(PLAYER, /sessionPcmPeak: Math\.max\(this\.sessionPcmPeak, this\.turnPcmPeak\) \|\| null,/);
  // The reset belongs to startTurn, beside the twelve counters that already
  // had one -- which is where it was documented to be all along.
  const startTurn = PLAYER.slice(PLAYER.indexOf('startTurn(generation: number): void {'));
  assert.ok(startTurn.indexOf('this.turnPcmPeak = 0;') < startTurn.indexOf('playbackStats()'));
});

test('DELAYED_VS_LOST now reaches the server', () => {
  const CLIENT = read('src/lib/comm/voiceClient.ts');
  for (const k of [
    'voicedWithoutDestinationMs', 'droppedByReason', 'dropsAccountedFor',
    'bufferedVoicedMs', 'staleFinalsRejected',
    'primarySocketOpenCount', 'recoverySocketOpenCount',
  ]) {
    assert.ok(CLIENT.includes(k), `${k} is missing from the turn shape`);
  }
  assert.match(CLIENT, /audioAccounting: \{/);
  assert.match(EDGE, /audio_accounting: body\.turnShape\?\.audioAccounting \?\? null,/);
});

test('GRANT_LANGUAGE telemetry stops reporting a server-wide constant', () => {
  /*
   * `ready.language` is googleSpeechReady's `?? 'ka-GE'` default, identical on
   * every grant ever issued. Logged as `language` it read like the socket's
   * language, and an entire session of Russian and English turns was recorded
   * as ka-GE -- which cost real analysis time before it was caught.
   */
  assert.match(EDGE, /requestedLanguage: language,/);
  assert.match(EDGE, /candidates: speechCandidates\(body\.languageHint \?\? null, body\.locale \?\? null\),/);
  assert.match(EDGE, /workerDefaultLanguage: ready\.language,/);
  assert.ok(!/logEvent\('ai-talk', 'listen_granted', \{\s*\n\s*provider: 'GOOGLE', model: ready\.model, language: ready\.language,/.test(EDGE));
});

test('LANGUAGE_SWITCHED cannot report false while the language changed', () => {
  assert.match(EDGE, /const languageChangedThisTurn = Boolean\(body\.previousLanguage\)\s*\n\s*&& body\.previousLanguage !== resolution\.resolvedLanguage;/);
  assert.match(EDGE, /language_switched: resolution\.switched \|\| languageChangedThisTurn,/);
  // The resolver's own verdict is kept beside it: the two disagreeing is the
  // finding, not something to paper over.
  assert.match(EDGE, /language_switch_resolver: resolution\.switched,/);
  assert.match(EDGE, /language_switch_observed: languageChangedThisTurn,/);
});

/* ── Nothing that was working was touched ────────────────────────────────*/

test('THE_WORKING_SYSTEMS_ARE_UNTOUCHED', () => {
  const CLIENT = read('src/lib/comm/voiceClient.ts');
  assert.match(CLIENT, /const NO_FINAL_TIMEOUT_MS = 2_500;/);
  assert.match(CLIENT, /if \(!this\.secondOpinionArmed\) \{/);
  assert.match(CLIENT, /if \(origin === 'LIVE' && from && from !== this\.live && from !== this\.finalOwedFrom\) \{/);
  assert.match(CLIENT, /private get safeToListen\(\): boolean \{/);
  assert.match(CLIENT, /const END_TURN_ACK_MS = 300;/);
  // The language resolution this release deliberately did NOT retune.
  assert.match(CLIENT, /const exempt = \(opinion \|\| origin === 'SHADOW'\) && !heardUnsupported;/);
  // Cartesia, and no ElevenLabs TTS.
  assert.match(EDGE, /provider: 'CARTESIA', role: 'TTS', model: 'sonic-3'/);
  assert.match(EDGE, /warmPromptCache/);
});
