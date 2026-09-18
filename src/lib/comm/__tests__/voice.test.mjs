// Georgian conversational behaviour, as far as it can be decided without a
// microphone.
//
// §24 makes this a release gate and names the failures precisely: a partial
// that is appended instead of revised, a language hard-locked from the first
// 200ms, and a 300-700ms pause read as the end of a turn. All three are
// decided by pure functions, so all three are testable here. What is NOT
// testable here — that Cartesia's Georgian transcription is actually accurate —
// needs a live provider and is reported separately.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reduceTranscript, visibleTurns, stabiliseLanguage, georgianCharRatio, cyrillicCharRatio,
  decideEndpoint, looksComplete, decideBargeIn, latencyBreakdown,
  DEFAULT_ENDPOINTING, DEFAULT_BARGE_IN,
} from '../transcript.ts';
import {
  canTransition, applyTransition, mayAiReply, mayHumanReply,
  detectsHumanRequest, detectsOptOut,
} from '../handoff.ts';
import { extractDeterministic, mergeExtraction, planExtraction, scoreLead } from '../extraction.ts';
import { resolvePlace, extractPlaces, parseMoney, parseBedrooms } from '../entities.ts';

// ── §24's named failure: a partial must be REVISED ──────────────────────────

test('a growing partial replaces itself instead of piling up', () => {
  // The exact case §24 gives: "მე მინდა ბი…" becoming "მე მინდა ბინა
  // კრწანისში." is ONE utterance that got better.
  let turns = [];
  turns = reduceTranscript(turns, { id: 'u1', speaker: 'USER', text: 'მე მინდა ბი', final: false, atMs: 1 });
  turns = reduceTranscript(turns, { id: 'u1', speaker: 'USER', text: 'მე მინდა ბინა', final: false, atMs: 2 });
  turns = reduceTranscript(turns, { id: 'u1', speaker: 'USER', text: 'მე მინდა ბინა კრწანისში.', final: true, atMs: 3 });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, 'მე მინდა ბინა კრწანისში.');
  assert.equal(turns[0].final, true);
});

test('a late partial cannot un-finalise an utterance', () => {
  let turns = reduceTranscript([], { id: 'u1', speaker: 'USER', text: 'done', final: true, atMs: 1 });
  turns = reduceTranscript(turns, { id: 'u1', speaker: 'USER', text: 'do', final: false, atMs: 2 });
  assert.equal(turns[0].text, 'done');
  assert.equal(turns[0].final, true);
});

test('a corrected final is taken', () => {
  let turns = reduceTranscript([], { id: 'u1', speaker: 'USER', text: 'ვაკე', final: true, atMs: 1 });
  turns = reduceTranscript(turns, { id: 'u1', speaker: 'USER', text: 'ვაკეში', final: true, atMs: 2 });
  assert.equal(turns[0].text, 'ვაკეში');
});

test('two utterances are two turns', () => {
  let turns = reduceTranscript([], { id: 'u1', speaker: 'USER', text: 'first', final: true, atMs: 1 });
  turns = reduceTranscript(turns, { id: 'u2', speaker: 'USER', text: 'second', final: false, atMs: 2 });
  assert.equal(turns.length, 2);
});

test('only one in-flight partial per speaker is rendered', () => {
  const turns = [
    { id: 'a', speaker: 'USER', text: 'final one', final: true, startedAtMs: 1, updatedAtMs: 1 },
    { id: 'b', speaker: 'USER', text: 'stale partial', final: false, startedAtMs: 2, updatedAtMs: 2 },
    { id: 'c', speaker: 'USER', text: 'current partial', final: false, startedAtMs: 3, updatedAtMs: 3 },
  ];
  const visible = visibleTurns(turns);
  assert.equal(visible.length, 2);
  assert.equal(visible[1].text, 'current partial');
});

// ── §24: language must stabilise, not hard-lock ─────────────────────────────

test('Georgian script is recognised regardless of what the detector claims', () => {
  assert.ok(georgianCharRatio('მინდა ბინა') > 0.9);
  assert.equal(georgianCharRatio('I want a flat'), 0);
  assert.ok(cyrillicCharRatio('хочу квартиру') > 0.9);
});

test('one low-confidence vote over four characters does not lock the session', () => {
  const state = { current: 'ka', locked: false, votes: [] };
  const next = stabiliseLanguage(state, { text: 'hi', detected: 'en', confidence: 0.3 });
  assert.equal(next.locked, false);
});

test('sustained Georgian evidence locks the session to Georgian', () => {
  let state = { current: 'en', locked: false, votes: [] };
  for (const text of ['მინდა ბინა კრწანისში', 'ორი საძინებლით', 'დაახლოებით ას ოთხმოცი ათასი']) {
    // The detector is DELIBERATELY wrong here: the script is what decides.
    state = stabiliseLanguage(state, { text, detected: 'en', confidence: 0.4 });
  }
  assert.equal(state.current, 'ka');
  assert.equal(state.locked, true);
});

test('a locked session still yields to a real, sustained language switch', () => {
  // §135: a caller genuinely moving to Russian mid-call is a case to handle,
  // not a misdetection to suppress.
  let state = { current: 'ka', locked: true, votes: [] };
  state = stabiliseLanguage(state, { text: 'давайте поговорим по-русски', detected: 'ru', confidence: 0.9 });
  state = stabiliseLanguage(state, { text: 'мне нужна квартира в Сабуртало', detected: 'ru', confidence: 0.9 });
  assert.equal(state.current, 'ru');
});

test('one stray word does not unlock a settled session', () => {
  let state = { current: 'ka', locked: true, votes: [] };
  state = stabiliseLanguage(state, { text: 'ok', detected: 'en', confidence: 0.9 });
  assert.equal(state.current, 'ka');
});

// ── §24: a pause is not the end of a turn ───────────────────────────────────

test('the assistant does not answer after "ბინა" in a listing sentence', () => {
  // §24's exact example: "მინდა ბინა... კრწანისში... დაახლოებით 180 ათასამდე".
  // The assistant must not interrupt after "ბინა".
  const decision = decideEndpoint({ text: 'მინდა ბინა', silenceMs: 500 });
  assert.equal(decision.endOfTurn, false);
});

test('below the floor, nothing ends a turn', () => {
  const decision = decideEndpoint({ text: 'ეს არის სრული წინადადება.', silenceMs: 100 });
  assert.equal(decision.endOfTurn, false);
  assert.equal(decision.reason, 'SILENCE_FLOOR');
});

test('a complete sentence plus a normal gap does end the turn', () => {
  const decision = decideEndpoint({ text: 'მინდა ბინა ვაკეში ორი საძინებლით.', silenceMs: 700 });
  assert.equal(decision.endOfTurn, true);
});

test('an unfinished sentence gets longer than a finished one', () => {
  const unfinished = decideEndpoint({ text: 'მინდა ბინა და', silenceMs: 700 });
  const finished = decideEndpoint({ text: 'მინდა ბინა ვაკეში.', silenceMs: 700 });
  assert.equal(unfinished.endOfTurn, false);
  assert.equal(finished.endOfTurn, true);
});

test('silence ends a turn eventually, whatever the words look like', () => {
  const decision = decideEndpoint({ text: 'მინდა ბინა და', silenceMs: 2500 });
  assert.equal(decision.endOfTurn, true);
  assert.equal(decision.reason, 'MAX_SILENCE');
});

test('a bare number is treated as unfinished, because a price is about to follow', () => {
  assert.equal(looksComplete('დაახლოებით 180'), false);
  assert.equal(looksComplete('დაახლოებით 180 ათასამდე'), true);
});

test('hesitation words keep the turn open', () => {
  for (const text of ['მინდა ბინა და', 'I want a flat and', 'хочу квартиру примерно', 'bir daire ve']) {
    assert.equal(looksComplete(text), false, `should be unfinished: ${text}`);
  }
  for (const text of ['ეე', 'ემმ', 'um', 'ммм']) {
    assert.equal(looksComplete(`I need something ${text}`), false);
  }
});

test('a trailing ellipsis is an explicit "still going"', () => {
  assert.equal(looksComplete('მინდა ბინა...'), false);
  assert.equal(looksComplete('მინდა ბინა…'), false);
});

test('a one-word acknowledgement is not a finished thought', () => {
  // Answering over someone who was just saying "ჰო" is how an assistant
  // sounds like it is not listening.
  assert.equal(looksComplete('ჰო'), false);
  assert.equal(looksComplete('да'), false);
});

test('an STT final on an incomplete utterance still waits', () => {
  const decision = decideEndpoint({ text: 'მინდა ბინა და', silenceMs: 300, sttFinal: true });
  assert.equal(decision.endOfTurn, false);
});

test('the provider’s own semantic endpointer is trusted when it speaks', () => {
  const decision = decideEndpoint({ text: 'მინდა ბინა', silenceMs: 300, semanticComplete: true });
  assert.equal(decision.endOfTurn, true);
  assert.equal(decision.reason, 'SEMANTIC_COMPLETE');
});

test('the defaults are the tuned ones, not a provider generic', () => {
  assert.equal(DEFAULT_ENDPOINTING.minSilenceMs, 260);
  assert.ok(DEFAULT_ENDPOINTING.continuationGraceMs > DEFAULT_ENDPOINTING.completeSilenceMs);
});

// ── §24: barge-in ───────────────────────────────────────────────────────────

test('the agent yields only to sustained speech, not to a cough', () => {
  // Loud and deliberate: the original bar, unchanged, so a real interruption
  // is as immediate as it ever was.
  const loud = { agentSpeaking: true, inputEnergy: 0.5, agentAudioElapsedMs: 2000, echoCancelled: true };
  assert.equal(decideBargeIn({ ...loud, sustainedMs: 20 }), 'NONE');
  assert.equal(decideBargeIn({ ...loud, sustainedMs: 200 }), 'STOP');
  assert.ok(DEFAULT_BARGE_IN.sustainMs <= 200, 'a deliberate interruption still stops it inside a syllable');
});

test('a small sound over the assistant is not an interruption', () => {
  /*
   * Reported from a real device: it interrupted far too easily. Anything
   * that crossed 0.18 for 180 ms killed the reply, and a stop cannot be
   * undone. Ordinary overlap now has to last about one spoken word.
   */
  const near = { agentSpeaking: true, inputEnergy: 0.22, agentAudioElapsedMs: 4000, echoCancelled: true };
  assert.equal(decideBargeIn({ ...near, sustainedMs: 120 }), 'NONE', 'a syllable');
  assert.equal(decideBargeIn({ ...near, sustainedMs: 200 }), 'NONE', 'a short "hm" that used to stop it');
  assert.equal(decideBargeIn({ ...near, sustainedMs: 300 }), 'NONE', 'a short phrase from the next room');
  assert.equal(decideBargeIn({ ...near, sustainedMs: 400 }), 'DUCK', 'still listening, not yet convinced');
  assert.equal(decideBargeIn({ ...near, sustainedMs: 500 }), 'STOP', 'somebody is genuinely talking');
  assert.ok(DEFAULT_BARGE_IN.confirmMs > DEFAULT_BARGE_IN.sustainMs,
    'ordinary overlap needs more evidence than a raised voice');
  assert.ok(DEFAULT_BARGE_IN.confirmMs <= 600, 'and not so much that interrupting feels ignored');
});

test('a thought that is nearly finished is allowed to finish', () => {
  const weak = {
    agentSpeaking: true, inputEnergy: 0.2, sustainedMs: 5000,
    agentAudioElapsedMs: 4000, echoCancelled: true,
  };
  assert.equal(decideBargeIn({ ...weak, pendingSeconds: 0.2 }), 'NONE', 'a syllable of audio left');
  assert.equal(decideBargeIn({ ...weak, pendingSeconds: 3 }), 'STOP', 'most of the reply left');
  // A deliberate interruption does not wait for the tail either way.
  assert.equal(decideBargeIn({ ...weak, inputEnergy: 0.6, sustainedMs: 200, pendingSeconds: 0.1 }), 'STOP');
});

test('the agent’s own first syllable does not interrupt it', () => {
  // Without the echo guard, a laptop speaker triggers a barge-in on every
  // single utterance the agent makes.
  const action = decideBargeIn({
    agentSpeaking: true, inputEnergy: 0.9, sustainedMs: 300,
    agentAudioElapsedMs: 50, echoCancelled: false,
  });
  assert.equal(action, 'NONE');
});

test('nothing barges in while the agent is silent', () => {
  assert.equal(decideBargeIn({
    agentSpeaking: false, inputEnergy: 0.9, sustainedMs: 900, agentAudioElapsedMs: 0,
  }), 'NONE');
  assert.ok(DEFAULT_BARGE_IN.sustainMs > 0);
});

test('latency is reported as the caller experiences it', () => {
  const result = latencyBreakdown({
    speechEndedAtMs: 1000, transcriptFinalAtMs: 1200,
    endpointConfirmedAtMs: 1500, llmFirstTokenAtMs: 1800, ttsFirstAudioAtMs: 1950,
  });
  assert.equal(result.transcriptionMs, 200);
  assert.equal(result.thinkingMs, 300);
  // The only number that describes the real behaviour: last word to first sound.
  assert.equal(result.perceivedMs, 950);
});

test('a missing mark produces null rather than a fabricated figure', () => {
  assert.equal(latencyBreakdown({ speechEndedAtMs: 1000 }).perceivedMs, null);
});

// ── §36: AI and a human never both reply ────────────────────────────────────

test('a human can take over from the AI, and the AI can never take over from a human', () => {
  assert.equal(canTransition('AI_ACTIVE', 'HUMAN_ACTIVE', 'HUMAN'), true);
  assert.equal(canTransition('HUMAN_ACTIVE', 'AI_ACTIVE', 'AI'), false);
  assert.equal(canTransition('HUMAN_ACTIVE', 'AI_ACTIVE', 'SYSTEM'), false);
  // Returning a conversation to the AI is an explicit human act.
  assert.equal(canTransition('HUMAN_ACTIVE', 'AI_ACTIVE', 'HUMAN'), true);
});

test('the AI may only speak when it holds the conversation', () => {
  assert.equal(mayAiReply('AI_ACTIVE'), true);
  assert.equal(mayAiReply('HUMAN_ACTIVE'), false);
  assert.equal(mayAiReply('PENDING_HANDOFF'), false);
  assert.equal(mayAiReply('PAUSED'), false);
  assert.equal(mayAiReply('CLOSED'), false);
});

test('a human may step in from any live state', () => {
  assert.equal(mayHumanReply('AI_ACTIVE'), true);
  assert.equal(mayHumanReply('PENDING_HANDOFF'), true);
  assert.equal(mayHumanReply('CLOSED'), false);
});

test('an illegal transition is refused with a reason', () => {
  assert.deepEqual(applyTransition('HUMAN_ACTIVE', { to: 'AI_ACTIVE', by: 'AI' }),
    { ok: false, mode: 'HUMAN_ACTIVE', error: 'ILLEGAL_TRANSITION' });
  assert.deepEqual(applyTransition('AI_ACTIVE', { to: 'AI_ACTIVE', by: 'HUMAN' }),
    { ok: false, mode: 'AI_ACTIVE', error: 'NO_CHANGE' });
});

test('a new inbound on a closed thread reaches the AI first', () => {
  assert.equal(canTransition('CLOSED', 'AI_ACTIVE', 'SYSTEM'), true);
});

// ── §113 and opt-out ────────────────────────────────────────────────────────

test('"give me a real person" is recognised in every locale', () => {
  for (const text of [
    'can I speak to a real person',
    'მინდა ნამდვილ ადამიანთან საუბარი',
    'соедините меня с оператором',
    'gerçek insan ile görüşmek istiyorum',
    'أريد التحدث مع شخص حقيقي',
    'אני רוצה נציג אנושי',
  ]) {
    assert.equal(detectsHumanRequest(text).requested, true, `missed: ${text}`);
  }
});

test('"are you a robot" counts as asking for a person', () => {
  assert.equal(detectsHumanRequest('are you a bot?').requested, true);
  assert.equal(detectsHumanRequest('რობოტი ხარ?').requested, true);
});

test('an ordinary property question is not a handoff request', () => {
  assert.equal(detectsHumanRequest('how many bedrooms does it have').requested, false);
});

test('a bare STOP is an opt-out; "stop by the office" is not', () => {
  assert.equal(detectsOptOut('STOP'), true);
  assert.equal(detectsOptOut('стоп'), true);
  assert.equal(detectsOptOut('unsubscribe'), true);
  assert.equal(detectsOptOut('please remove me from your list'), true);
  assert.equal(detectsOptOut('აღარ დამირეკო'), true);
  assert.equal(detectsOptOut('I will stop by the office on Tuesday'), false);
});

// ── §42: extraction and reconciliation ──────────────────────────────────────

test('Georgian districts, prices and room counts are read without a model', () => {
  const result = extractDeterministic('მინდა ბინა კრწანისში, ორი საძინებელი, დაახლოებით 180 ათასამდე');
  assert.ok(result.locations.includes('krtsanisi'));
  assert.equal(result.budgetMax, 180_000);
  assert.equal(result.method, 'DETERMINISTIC');
});

test('district names resolve across scripts and Georgian case endings', () => {
  assert.equal(resolvePlace('ვაკე').id, 'vake');
  assert.equal(resolvePlace('ვაკეში').id, 'vake');
  assert.equal(resolvePlace('Vake').id, 'vake');
  assert.equal(resolvePlace('Ваке').id, 'vake');
  assert.equal(resolvePlace('Krtsanisi').id, 'krtsanisi');
  assert.equal(resolvePlace('Atlantis District'), null);
});

test('the longer district name wins over the shorter one inside it', () => {
  const places = extractPlaces('looking in Didi Dighomi');
  assert.ok(places.some((p) => p.id === 'didi-dighomi'));
});

test('a currency is never invented', () => {
  // Assuming dollars when the caller meant lari mis-qualifies the lead by a
  // factor of three.
  const [bare] = parseMoney('around 180 000');
  assert.equal(bare.currency, null);
  const [dollars] = parseMoney('$180k');
  assert.equal(dollars.currency, 'USD');
  assert.equal(dollars.value, 180_000);
  const [lari] = parseMoney('180 ათასი ლარი');
  assert.equal(lari.currency, 'GEL');

  /*
   * დოლარი CONTAINS ლარი.
   *
   * Testing for lari first matched inside the Georgian word for dollar, so a
   * visitor saying "180,000 დოლარის ბიუჯეტით" had their budget shown back to
   * them as 180,000 lari — out by a factor of 2.7, in the currency the
   * Georgian market quotes property in. Caught in a live production
   * conversation, which is the only place it could have been caught: nobody
   * types that sentence.
   */
  const [spoken] = parseMoney('კრწანისში ბინის ყიდვა დაახლოებით 180,000 დოლარის ბიუჯეტით');
  assert.equal(spoken.value, 180_000);
  assert.equal(spoken.currency, 'USD', 'დოლარი is dollars, however much of ლარი it contains');

  const [russian] = parseMoney('бюджет примерно 180 000 долларов');
  assert.equal(russian.currency, 'USD');
});

test('a bedroom count survives being spoken rather than typed', () => {
  // Nobody dictates "2 საძინებელი". They say "ორი საძინებლით", and a voice
  // conversation therefore lost the room count entirely.
  assert.equal(parseBedrooms('ორი საძინებლით'), 2);
  assert.equal(parseBedrooms('სამი საძინებელი მინდა'), 3);
  assert.equal(parseBedrooms('двухкомнатная квартира'), 2);
  assert.equal(parseBedrooms('two bedrooms please'), 2);
  assert.equal(parseBedrooms('iki yatak odası'), 2);

  // Digits still win, and still work.
  assert.equal(parseBedrooms('3 საძინებელი'), 3);

  // A number word with no room word next to it is not a bedroom count.
  assert.equal(parseBedrooms('ორი კვირაა ვეძებ'), null);
  assert.equal(parseBedrooms('ორი თვის წინ ვნახე ბინა'), null);
});

test('"მდე" makes a figure a ceiling, not a target', () => {
  const [amount] = parseMoney('180 ათასამდე');
  assert.equal(amount.isMaximum, true);
});

test('bedroom counts are read in four languages', () => {
  assert.equal(parseBedrooms('2 bedrooms'), 2);
  // Was null, and was wrong to be: this is how the count is actually spoken.
  assert.equal(parseBedrooms('ორი საძინებელი'), 2);
  assert.equal(parseBedrooms('3 საძინებელი'), 3);
  assert.equal(parseBedrooms('2 комнатная'), 2);
  assert.equal(parseBedrooms('3 yatak odası'), 3);
});

test('A MODEL NEVER OVERWRITES WHAT A PERSON CONFIRMED', () => {
  // §42's rule stated literally.
  const human = { budgetMax: 200_000, method: 'HUMAN', confidence: 1, at: 'x' };
  const llm = { budgetMax: 90_000, method: 'LLM', confidence: 0.99, at: 'y' };
  const { merged, decisions } = mergeExtraction(human, llm);
  assert.equal(merged.budgetMax, 200_000);
  assert.ok(decisions.some((d) => d.field === 'budgetMax' && d.action === 'KEPT'));
});

test('a measured figure beats a model paraphrase of the same sentence', () => {
  const measured = { budgetMax: 180_000, method: 'DETERMINISTIC', confidence: 0.8, at: 'x' };
  const paraphrased = { budgetMax: 100_000, method: 'LLM', confidence: 0.95, at: 'y' };
  assert.equal(mergeExtraction(measured, paraphrased).merged.budgetMax, 180_000);
});

test('a model owns the fields code cannot judge', () => {
  const deterministic = { summary: null, method: 'DETERMINISTIC', confidence: 0.9, at: 'x' };
  const llm = { summary: 'Wants a two-bedroom flat in Vake.', method: 'LLM', confidence: 0.6, at: 'y' };
  assert.equal(mergeExtraction(deterministic, llm).merged.summary, 'Wants a two-bedroom flat in Vake.');
});

test('an empty slot is filled by anything', () => {
  const existing = { budgetMax: null, method: 'DETERMINISTIC', confidence: 0.9, at: 'x' };
  const incoming = { budgetMax: 150_000, method: 'LLM', confidence: 0.2, at: 'y' };
  assert.equal(mergeExtraction(existing, incoming).merged.budgetMax, 150_000);
});

test('silence is never summarised by a model', () => {
  // §138: paying an LLM to summarise a call nobody answered is pure waste.
  assert.equal(planExtraction({ status: 'NO_ANSWER', durationSec: 0, transcriptChars: 0, turns: 0 }), 'SKIP');
  assert.equal(planExtraction({ status: 'BUSY', durationSec: 0, transcriptChars: 0, turns: 0 }), 'SKIP');
  assert.equal(planExtraction({ status: 'COMPLETED', durationSec: 4, transcriptChars: 200, turns: 2 }), 'SKIP');
  assert.equal(planExtraction({ status: 'COMPLETED', durationSec: 20, transcriptChars: 60, turns: 1 }), 'DETERMINISTIC_ONLY');
  assert.equal(planExtraction({ status: 'COMPLETED', durationSec: 120, transcriptChars: 900, turns: 8 }), 'FULL');
});

test('a lead score can always say why it is what it is', () => {
  const { score, reasons } = scoreLead({
    transactionType: 'BUY', budgetMax: 180_000, locations: ['vake'],
    bedrooms: 2, viewingInterest: true, interestLevel: 'HIGH',
  });
  assert.ok(score > 60);
  assert.ok(reasons.length >= 5);
  const refused = scoreLead({ interestLevel: 'NONE' });
  assert.equal(refused.score, 0);
});
