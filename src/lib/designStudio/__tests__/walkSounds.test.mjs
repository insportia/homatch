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

test('cooking sizzles until done, a sip is a slurp, brewing is the machine', () => {
  assert.equal(soundFor('STOVE', true, 'SEARING'), 'SIZZLE');
  assert.equal(soundFor('STOVE', true, 'COOKING'), null); // keeps sizzling, nothing new
  assert.equal(soundFor('STOVE', true, 'DONE'), 'SIZZLE_END');
  assert.equal(soundFor('STOVE', true, 'SERVED'), 'PLATE');
  assert.ok(LOOPING.has('SIZZLE'));
  assert.equal(soundFor('COFFEE', true, 'BREWING'), 'COFFEE');
  assert.equal(soundFor('COFFEE', true, 'SIPPING'), 'SLURP');
  assert.equal(soundFor('COFFEE', true, 'READY'), null);
});

test('the walk is dressed (art, books, curtains) without touching the design, and its plan is shown, labelled', () => {
  assert.match(ctl, /this\.decor = buildDecor\(\{ space: this\.space, pieces, palette: d\.state\.palette \?\? \[\] \}\);/);
  assert.match(ctl, /if \(this\.decor\) \{ disposeDecor\(this\.decor\); this\.decor = null; \}/);
  const decor = fs.readFileSync(new URL('../../../components/designStudio/canvas/walkDecor.ts', import.meta.url), 'utf8');
  // Never a target or an obstacle.
  assert.match(decor, /mesh\.raycast = \(\) => \{\};\n\s+mesh\.userData\.decor = true;/);
  const overlay = fs.readFileSync(new URL('../../../components/designStudio/workspace/WalkthroughOverlay.tsx', import.meta.url), 'utf8');
  assert.match(overlay, /<span>\{touch \? tr\('ds_walk_plan'\) : tr\(planOpen \? 'ds_walk_plan_hide' : 'ds_walk_plan_show'\)\}<\/span>/);
  assert.match(overlay, /return v \? v === 'open' : !touch;/);
});

test('time of day, Live Here and sharing are on the screen, each explained — never folded into a menu', () => {
  const overlay = fs.readFileSync(new URL('../../../components/designStudio/workspace/WalkthroughOverlay.tsx', import.meta.url), 'utf8');
  assert.match(overlay, /<FeatureDock tr=\{tr\} touch=\{touch\} env=\{env\}/);
  for (const k of ['ds_feat_time_help', 'ds_feat_live_help', 'ds_feat_share_help']) assert.ok(overlay.includes(`tr('${k}')`), k);
  // Not in the More menu any more.
  const more = overlay.slice(overlay.indexOf('data-testid="walk-more-menu"'), overlay.indexOf('{props.actions}'));
  assert.ok(!more.includes("setSheet('LIVE')") && !more.includes("setSheet('TIME')"));
  const ws = fs.readFileSync(new URL('../../../components/designStudio/workspace/DesignWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(ws, /onShare=\{\(\) => setShareOpen\('WALKTHROUGH'\)\}/);
});

test('a phone: the stick stays put in its corner, a fingertip finds what it meant, a thumb walks a little faster', async () => {
  const overlay = fs.readFileSync(new URL('../../../components/designStudio/workspace/WalkthroughOverlay.tsx', import.meta.url), 'utf8');
  const stick = overlay.slice(overlay.indexOf('function StickZone('), overlay.indexOf('// ── Live Here: running'));
  // Fixed in the bottom-left corner, pushed from its own centre: never a base that appears under the thumb.
  assert.match(stick, /className="absolute bottom-6 left-5 z-10 grid h-36 w-36/);
  assert.doesNotMatch(stick, /b\.style\.left = /);
  assert.match(ctl, /const hit = g\.mouse \? this\.targetAt\(px, py\) : this\.targetNear\(px, py, TOUCH_TAP_RADIUS_PX\);/);
  assert.match(ctl, /this\.touchInput \? \{ \.\.\.this\.settings, speed: this\.settings\.speed \* TOUCH_PACE \} : this\.settings/);
  const { TOUCH_LOOK_RAD_PER_PX, TOUCH_PACE } = await import('../player.ts');
  assert.ok(TOUCH_LOOK_RAD_PER_PX >= 0.0035 && TOUCH_PACE > 1 && TOUCH_PACE <= 1.25);
});

test('a phone: the feature row is one line that fits (time steps through its four), the door hint sits below it', () => {
  const overlay = fs.readFileSync(new URL('../../../components/designStudio/workspace/WalkthroughOverlay.tsx', import.meta.url), 'utf8');
  assert.match(overlay, /flex flex-nowrap items-center justify-center gap-1\.5" data-testid="walk-features"/);
  assert.match(overlay, /onEnv\(ENVS\[\(ENVS\.findIndex\(\(x\) => x\.id === env\) \+ 1\) % ENVS\.length\]\.id\)/);
  assert.match(overlay, /touch \? 'top-\[6\.75rem\]' : 'top-28'\)\} data-testid="walk-door-hint"/);
});
