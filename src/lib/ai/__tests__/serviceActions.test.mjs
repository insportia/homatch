// The service-action catalogue: the wall between "says something" and
// "goes somewhere", tested from both sides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseServiceActions, SERVICE_ACTION_CATALOGUE, MAX_SERVICE_ACTIONS, SERVICE_ACTIONS_INSTRUCTION,
} from '../serviceActions.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('valid IDs come back with their route and label key', () => {
  const out = parseServiceActions(['VERIFY', 'MORTGAGE']);
  assert.deepEqual(out.map(a => a.id), ['VERIFY', 'MORTGAGE']);
  assert.equal(out[0].route, '/verify');
  assert.equal(out[1].route, '/mortgage');
  assert.ok(out.every(a => a.labelKey.startsWith('ai_action_')));
});

test('the model cannot invent, duplicate, or overload actions', () => {
  assert.deepEqual(parseServiceActions(['TELEPORT', 'VERIFY', 'VERIFY']).map(a => a.id), ['VERIFY']);
  assert.deepEqual(parseServiceActions('VERIFY'), []);
  assert.deepEqual(parseServiceActions([{ id: 'VERIFY' }]), []);
  assert.deepEqual(parseServiceActions(null), []);
  const flood = parseServiceActions(Object.keys(SERVICE_ACTION_CATALOGUE));
  assert.equal(flood.length, MAX_SERVICE_ACTIONS);
});

test('IDs are matched case-insensitively but returned canonical', () => {
  assert.deepEqual(parseServiceActions([' verify ']).map(a => a.id), ['VERIFY']);
});

test('every catalogue route is a real registered route', () => {
  const routes = readFileSync(join(root, 'src', 'routes.tsx'), 'utf8');
  for (const [id, entry] of Object.entries(SERVICE_ACTION_CATALOGUE)) {
    assert.ok(routes.includes(`path: '${entry.route}'`),
      `${id} points at ${entry.route}, which is not in routes.tsx — a chip must never 404`);
  }
});

test('every catalogue label key exists in all six locales', () => {
  const i18n = readFileSync(join(root, 'src', 'i18n', 'translations.ts'), 'utf8');
  for (const entry of Object.values(SERVICE_ACTION_CATALOGUE)) {
    const n = (i18n.match(new RegExp(`^  ${entry.labelKey}: `, 'gm')) ?? []).length;
    assert.equal(n, 6, `${entry.labelKey} appears ${n} times, expected one per locale`);
  }
});

test('the instruction offers exactly the IDs the validator accepts', () => {
  for (const id of Object.keys(SERVICE_ACTION_CATALOGUE)) {
    assert.ok(SERVICE_ACTIONS_INSTRUCTION.includes(id), `${id} missing from the model instruction`);
  }
  assert.match(SERVICE_ACTIONS_INSTRUCTION, /0 to 3/);
});
