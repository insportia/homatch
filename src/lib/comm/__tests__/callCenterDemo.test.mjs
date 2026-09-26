/*
 * THE DEMO THAT NEVER SAID WHAT IT WAS A DEMO OF.
 *
 * AI TALK is the live demonstration of the Homatch AI Call Center: the visitor
 * is not using a support line, they are hearing the product they could run
 * themselves. That was true of the architecture and entirely absent from the
 * prompt, so the assistant introduced itself as a property assistant and no
 * visitor could have learned otherwise.
 *
 * These tests hold the product behaviour that is easy to lose: the demo saying
 * what it is, being honest about what a campaign can actually configure, and
 * never sending anybody to a route this application does not register.
 *
 * WHY THE ALLOWLIST IS TESTED RATHER THAN TRUSTED. A model asked for a link
 * will produce a plausible one. `/properties/tbilisi-vake` reads like a route,
 * renders as a button, and 404s in front of a customer. The model therefore
 * chooses a KEY and the application resolves the path -- and the keys are
 * checked here against routes.tsx, because a registry that drifts from the
 * router is exactly as broken as an invented URL, only quieter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TALK_DESTINATIONS, resolveDestination, destinationMenu, parseAction, spokenPart,
} from '../talkActions.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');
const ROUTES = read('src/routes.tsx');

/** The instruction text as the model receives it. */
const PROMPT = (() => {
  const i = EDGE.indexOf('function publicDemoInstructions');
  const j = EDGE.indexOf('if (name === ', i);
  return EDGE.slice(i, j);
})();

/* ── What the demo says it is ────────────────────────────────────────────*/

test('IT_SAYS_WHAT_THIS_CALL_IS: the live AI Call Center demo', () => {
  assert.match(PROMPT, /live demo of Homatch AI Call Center/);
  // Demonstrate by being, not by reciting: the instruction is to answer well.
  assert.match(PROMPT, /Demonstrate it by BEING it/);
  assert.match(PROMPT, /Explain the product only when asked/);
});

test('THE_DEMO_VOICE_IS_NOT_MANDATORY, and it says so', () => {
  /*
   * A visitor who dislikes the voice is telling us about a setting. Left
   * unsaid, they reasonably conclude that this is what Homatch sounds like.
   */
  assert.match(PROMPT, /ONE demo setting, not what their agent must sound like/);
});

test('CONFIGURATION_IS_DESCRIBED_HONESTLY and nothing beyond it', () => {
  // Exactly what a campaign genuinely carries today.
  assert.match(PROMPT, /Configurable per campaign: purpose, instructions, language,/);
  assert.match(PROMPT, /voice, speaking pace\. Nothing beyond that\./);
  // And provider vocabulary stays out of a customer conversation.
  assert.match(PROMPT, /Never name a provider or model id\./);
  assert.ok(!/cartesia|sonic-3|chirp|elevenlabs/i.test(PROMPT),
    'a provider name reached the instruction the customer hears');
});

test('IT_NEVER_CLAIMS_TO_BE_HUMAN', () => {
  // The pre-existing identity rule, which this change must not have loosened.
  assert.match(PROMPT, /you are Homatch AI/);
  assert.match(PROMPT, /Never name a model, a provider or a vendor\./);
});

test('THE_CTA_IS_NOT_PUSHED_EVERY_TURN', () => {
  assert.match(PROMPT, /Only when it genuinely helps\. Not on every reply\./);
  // And the personality rule that forbids ending every reply with an offer.
  assert.match(PROMPT, /Do not close every reply with an offer, a next step or a question\./);
  assert.match(PROMPT, /never bolted onto an unrelated answer/);
});

/* ── The registry resolves to routes that exist ──────────────────────────*/

test('EVERY_DESTINATION_RESOLVES_TO_A_ROUTE_THIS_APP_REGISTERS', () => {
  /*
   * The check that makes the allowlist worth having. A key pointing at a
   * path routes.tsx does not register is an invented URL with extra steps.
   */
  for (const d of TALK_DESTINATIONS) {
    assert.ok(
      ROUTES.includes(`path: '${d.path}'`),
      `${d.key} points at ${d.path}, which routes.tsx does not register`,
    );
  }
});

test('and no destination sends an anonymous visitor into the Admin', () => {
  for (const d of TALK_DESTINATIONS) {
    assert.ok(!d.path.startsWith('/admin'), `${d.key} offers ${d.path}`);
  }
});

test('THE_THREE_NEW_SERVICES point where they claim to', () => {
  // The product this demo demonstrates.
  assert.equal(resolveDestination('call_center')?.path, '/outreach/calls');
  // The same assistant, typed. AI Chat is NOT redesigned here -- only reachable.
  assert.equal(resolveDestination('ai_chat')?.path, '/ai');
  assert.equal(resolveDestination('investment')?.path, '/investment');
  // And the model is told what each is for, or it cannot choose between them.
  const menu = destinationMenu();
  for (const key of ['call_center', 'ai_chat', 'investment']) {
    assert.ok(menu.includes(key), `${key} is not offered to the model`);
  }
});

test('THE_NEED_TO_PRODUCT_MAPPING is in the instruction, and picks ONE', () => {
  assert.match(PROMPT, /MATCH THE NEED TO THE PRODUCT, one only/);
  assert.match(PROMPT, /rather type or read -> ai_chat/);
  assert.match(PROMPT, /automated calling for their own business ->/);
  assert.match(PROMPT, /call_center, which is this\./);
});

/* ── The model cannot invent a link ──────────────────────────────────────*/

test('AN_INVENTED_KEY_PRODUCES_NO_BUTTON, not a broken one', () => {
  // 'expat' was in this list until For Expats shipped, and 'brokers' until /brokers
  // did -- which is exactly the drift the resolve-every-path test is there to catch,
  // and it caught both. What stays here is what the product genuinely does not have.
  for (const invented of ['properties', '/properties/tbilisi-vake', 'listings', 'agencies', '', null]) {
    assert.equal(resolveDestination(invented), null, `${invented} resolved to something`);
  }
});

test('AN_INVENTED_URL_IN_THE_MARKER IS IGNORED ENTIRELY', () => {
  /*
   * The marker carries a key, never a path. A model that supplies a URL gets
   * no button, because `go` is resolved through the allowlist and a URL is
   * not a key -- which is the whole design.
   */
  const withUrl = 'Here you go. <<ACT {"go":"https://homatch.live/evil","end":false,"why":""}>>';
  assert.equal(parseAction(withUrl).destination, null);
  const withPath = 'Sure. <<ACT {"go":"/admin/users","end":false,"why":""}>>';
  assert.equal(parseAction(withPath).destination, null);
  // A real key still works, so the guard is not simply refusing everything.
  const real = 'Have a look. <<ACT {"go":"call_center","end":false,"why":""}>>';
  assert.equal(parseAction(real).destination?.path, '/outreach/calls');
});

test('the marker is never spoken, however malformed', () => {
  const raw = 'Two bedrooms in Vake. <<ACT {"go":"ai_chat"';
  assert.equal(spokenPart(raw), 'Two bedrooms in Vake.');
  // A malformed marker costs a missing button, never a voice reading JSON.
  assert.equal(parseAction(raw).destination, null);
});

test('ENDING_AND_NAVIGATING stay mutually exclusive', () => {
  const bye = 'Glad to help. <<ACT {"go":"call_center","end":true,"why":"FAREWELL"}>>';
  const act = parseAction(bye);
  assert.equal(act.end, true);
  assert.equal(act.destination, null, 'a button appeared as the panel was closing');
});

/* ── The prompt cannot reach the machinery ───────────────────────────────*/

test('PERSONALITY_CANNOT_OVERRIDE_THE_TECHNICAL_PATH', () => {
  /*
   * Language resolution, recovery and session ownership are code. The
   * instruction text is not allowed to be the mechanism for any of them --
   * a prompt that says "switch language when you hear Russian" is not a
   * language switch, it is a hope.
   */
  const CLIENT = read('src/lib/comm/voiceClient.ts');
  assert.match(CLIENT, /resolveTurnLanguage\(/);
  assert.match(CLIENT, /describeRecoveryDecline\(recoveryInput, exempt\);/);
  assert.match(CLIENT, /const NO_FINAL_TIMEOUT_MS = 2_500;/);
  // And the prompt does not try to do any of it.
  assert.ok(!/switch (the )?language|detect the language|set the language/i.test(PROMPT),
    'the prompt is being used to perform language switching');
});

test('SERVICES_ARE_OFFERED_ONLY_ONCE_THEY_EXIST', () => {
  /*
   * Expat was deliberately absent when this registry was written: routes.tsx
   * had no /for-expats and site_pages carried only `home`, so offering it
   * would have advertised a 404. The Phase 2 workstream shipped
   * /for-expats/georgia as a public route while this work was in progress,
   * and re-fetching main before committing is what caught it.
   *
   * Brokers has now shipped too, and this test caught it the same way -- it was
   * written to fail the moment a /brokers route appeared, and it did. The rule is
   * the same in both directions: a destination exists here only when the router
   * registers it, AND a registered route that belongs in the demo has to be
   * offered rather than quietly unreachable.
   */
  const keys = TALK_DESTINATIONS.map((d) => d.key);
  assert.ok(keys.includes('expat'), 'For Expats shipped; the demo cannot reach it');
  assert.equal(resolveDestination('expat')?.path, '/for-expats/georgia');
  assert.ok(keys.includes('brokers'), 'the /brokers route shipped; the demo cannot reach it');
  assert.equal(resolveDestination('brokers')?.path, '/brokers');
  assert.ok(/path: '\/brokers'/.test(ROUTES), 'brokers is offered without a route');
});
