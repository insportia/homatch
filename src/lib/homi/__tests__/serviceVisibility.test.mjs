// Owner: HOMI must never recommend a service Admin has hidden. One read of the
// Service Control Center's customer switch (frontend_enabled) builds the
// visible set; every HOMI output is filtered through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildServiceVisibility, filterReplies, hiddenServicesPrompt, HOMI_PROMPT_SERVICE_KEYS, replyPointsToHidden, visibleLines,
  serviceOfIntent, filterServiceIds,
} from '../serviceVisibility.ts';
import { homiPitchInstruction, allowPitch } from '../pitch.ts';
import { ensureReplies, fallbackReplies } from '../replyFallback.ts';
import { serviceActionsInstruction, SERVICE_ACTION_SERVICE } from '../../ai/serviceActions.ts';
import { HOMI_LOCALES } from '../content.ts';

const allOn = () => Object.fromEntries(HOMI_PROMPT_SERVICE_KEYS.map((k) => [k, { frontend: true, backend: true }]));
const hide = (...keys) => { const s = allOn(); for (const k of keys) s[k] = { frontend: false, backend: true }; return s; };

test('the visible set follows the frontend switch; missing state fails closed; Contact is always visible', () => {
  const v = buildServiceVisibility(hide('verify', 'mortgage', 'ai_call_center'));
  assert.ok(!v.isVisible('VERIFY') && !v.isVisible('MORTGAGE'));
  assert.ok(v.isVisible('FIND_PROPERTY') && v.isVisible('CONTACT'));
  assert.deepEqual(v.hidden.sort(), ['MORTGAGE', 'VERIFY']);
  assert.ok(v.hiddenKeys.includes('ai_call_center'));
  const none = buildServiceVisibility({});
  assert.deepEqual(none.visible, ['CONTACT'], 'no state read: recommend nothing but Contact');
  for (const key of Object.values(SERVICE_ACTION_SERVICE)) assert.ok(HOMI_PROMPT_SERVICE_KEYS.includes(key), key);
});

test('a hidden service never appears in the pitch instruction, actions contract or product lines', () => {
  const v = buildServiceVisibility(hide('verify', 'contracts'));
  const pitch = homiPitchInstruction(v.visible);
  assert.doesNotMatch(pitch, /VERIFY|CONTRACT_INTELLIGENCE/);
  assert.match(pitch, /FIND_PROPERTY/);
  const actions = serviceActionsInstruction(v.visible);
  assert.doesNotMatch(actions, /VERIFY|CONTRACT_INTELLIGENCE/);
  assert.match(actions, /MORTGAGE/);
  const lines = visibleLines([['verify', 'Verify (/verify)'], ['mortgage', 'Mortgage (/mortgage)'], [null, 'Contact (/contact)']], v);
  assert.deepEqual(lines, ['Mortgage (/mortgage)', 'Contact (/contact)']);
  const hidden = hiddenServicesPrompt(v);
  assert.match(hidden, /Verify \(\/verify\)/);
  assert.match(hidden, /Do not mention, recommend or link these/);
  assert.match(hidden, /not available right now and offer the closest visible alternative/);
  assert.equal(hiddenServicesPrompt(buildServiceVisibility(allOn())), '');
  assert.match(homiPitchInstruction([]), /"pitch_service": null/);
});

test('cards and the service note skip hidden services', () => {
  const v = buildServiceVisibility(hide('find_property'));
  assert.deepEqual(filterServiceIds(['FIND_PROPERTY', 'VERIFY', 'CONTACT'], v), ['VERIFY', 'CONTACT']);
  const pitch = allowPitch('FIND_PROPERTY', [null, null]);
  assert.equal(pitch && v.isVisible(pitch) ? pitch : null, null, 'the edge drops a pitch for a hidden service');
});

test('reply chips that lead to a hidden service are dropped, model and fallback alike', () => {
  const v = buildServiceVisibility(hide('mortgage', 'find_property'));
  assert.ok(replyPointsToHidden({ label: 'რა ღირს იპოთეკა თვეში', value: 'რა ღირს იპოთეკა თვეში' }, v));
  assert.ok(replyPointsToHidden({ label: 'Find me a flat in Vake', value: 'Find me a flat in Vake' }, v));
  assert.ok(replyPointsToHidden({ label: 'x', value: 'x', intent: 'SERVICE_MORTGAGE' }, v));
  assert.ok(!replyPointsToHidden({ label: 'Show me an example', value: 'Show me an example' }, v));
  const model = [
    { id: 's1', label: 'Work out my mortgage', value: 'Work out my mortgage' },
    { id: 's2', label: 'Show me an example', value: 'Show me an example' },
    { id: 's3', label: 'Got it, thanks', value: 'Got it, thanks' },
  ];
  assert.deepEqual(filterReplies(model, v).map((r) => r.id), ['s2', 's3']);
  for (const loc of HOMI_LOCALES) {
    for (const service of ['MORTGAGE', 'FIND_PROPERTY', 'FOR_EXPATS', null]) {
      const chips = fallbackReplies(loc, service, v);
      assert.ok(chips.length >= 2, `${loc}/${service}`);
      for (const c of chips) assert.ok(!replyPointsToHidden(c, v), `${loc}/${service}: ${c.label}`);
    }
    const ensured = ensureReplies([model[0], model[1]], loc, 'MORTGAGE', v);
    for (const c of ensured) assert.ok(!replyPointsToHidden(c, v), `${loc}: ${c.label}`);
  }
});

test('written answers about a hidden service are not served deterministically', () => {
  assert.equal(serviceOfIntent('SERVICE_VERIFY'), 'VERIFY');
  assert.equal(serviceOfIntent('MORTGAGE_DOCS_SALARIED'), 'MORTGAGE');
  assert.equal(serviceOfIntent('GREETING'), null);
  const edge = readFileSync(new URL('../../../../supabase/functions/homatch-ai/index.ts', import.meta.url), 'utf8');
  assert.ok(edge.includes('const visibility = buildServiceVisibility(serviceStates)'), 'one visibility set per turn');
  assert.ok(edge.includes('routedService && !visibility.isVisible(routedService)'));
  assert.ok(edge.includes('${hiddenServicesPrompt(visibility)}'));
  assert.ok(edge.includes('${homiPitchInstruction(visibility.visible)}'));
  assert.ok(edge.includes('visibleLines(PRODUCT_LINES, visibility)'));
  assert.ok(edge.includes('visibleLines(MENTION_EXAMPLES, visibility)'));
  assert.ok(edge.includes('if (pitch && !visibility.isVisible(pitch)) pitch = null'));
  assert.ok(edge.includes('ensureReplies(parseSuggestedReplies(lead?.suggested_replies), lang, policy.service, visibility)'));
  assert.equal((edge.match(/serviceState\(/g) ?? []).length, 1, 'switches are read in one place per turn');
});
