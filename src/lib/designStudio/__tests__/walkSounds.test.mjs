// The walked home's sounds (walkSounds.ts) and the seated / choice controls (SceneController): what each
// interaction is heard as, and that a person never gets stuck sitting or makes a bed they meant to lie on.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { distanceGain, LOOPING, soundFor } from '../walkSounds.ts';
import { INTERACTION_ROLES } from '../interactions.ts';
import { DEFAULT_SETTINGS, normalizeSettings } from '../player.ts';

test('each interaction is heard as itself: doors, taps, the toilet, switches, the TV', () => {
  assert.equal(soundFor('DOOR', true, 'OPEN'), 'DOOR_OPEN');
  assert.equal(soundFor('DOOR', false, 'CLOSED'), 'DOOR_CLOSE');
  assert.equal(soundFor('TOILET', true, 'FLUSHING'), 'FLUSH');
  assert.equal(soundFor('TOILET', false, 'IDLE'), null);
  assert.equal(soundFor('FAUCET', true, 'ON'), 'WATER_ON');
  assert.equal(soundFor('FAUCET', false, 'OFF'), 'WATER_OFF');
  assert.equal(soundFor('BATH', true, 'DRAINING'), 'WATER_OFF');
  assert.equal(soundFor('LIGHT', true, 'ON'), 'SWITCH');
  assert.equal(soundFor('MIRROR', true, 'OPEN'), 'CABINET_OPEN');
  assert.equal(soundFor('TV', true, 'ON'), 'TV_ON');
  assert.equal(soundFor('WARDROBE', false, 'CLOSED'), 'CABINET_CLOSE');
  // Every role the runtime knows has an answer (a cue or a deliberate silence), never a throw.
  for (const role of INTERACTION_ROLES) for (const active of [true, false]) soundFor(role, active, active ? 'ON' : 'OFF');
  assert.ok(LOOPING.has('WATER_ON') && !LOOPING.has('FLUSH'));
});

test('a sound fades with distance and is silent across the home; the visitor may turn sounds off', () => {
  assert.equal(distanceGain(0.5), 1);
  assert.ok(distanceGain(4) < distanceGain(2) && distanceGain(2) < 1);
  assert.equal(distanceGain(20), 0);
  assert.equal(DEFAULT_SETTINGS.sound, true);
  assert.equal(normalizeSettings({ sound: false }).sound, false);
  assert.equal(normalizeSettings({}).sound, true);
});

const ctl = fs.readFileSync(new URL('../../../components/designStudio/canvas/SceneController.ts', import.meta.url), 'utf8');

test('seated or lying, the same click, tap or E gets you up', () => {
  assert.match(ctl, /if \(this\.walk\?\.seated && !action && \(!t \|\| t\.objectId === this\.walk\.seated\.objectId \|\| !this\.actionsFor\(t\)\.length\)\) return this\.standUp\(\);/);
  assert.match(ctl, /if \(this\.walk\?\.seated\) this\.standUp\(\);/);
  assert.match(ctl, /if \(!hit && !this\.walk\.seated\) return false;/);
});

test('a piece with several uses offers the choice (a bed: lie down first), never the first use unasked', () => {
  assert.match(ctl, /if \(!action && offered\.length > 1\) \{[\s\S]{0,200}this\.releasePointer\(\);\n\s+return true;/);
  assert.match(ctl, /if \(lie && t\.entry\?\.machine\.role === 'BED'\) out\.push\('LIE_DOWN'\);/);
  assert.match(ctl, /\/\^\(Digit\|Numpad\)\[1-3\]\$\/\.test\(e\.code\)/);
  // Sounds come from the runtime's own transitions, and stop with the walk.
  assert.match(ctl, /onTransition: \(e, _from, to\) => \{/);
  assert.match(ctl, /this\.walk = null;\n\s+this\.sounds\.stopAll\(\);/);
});
