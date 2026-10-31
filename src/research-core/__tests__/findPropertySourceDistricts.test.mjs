// Find Property (2026-10-31): sources are asked for the district a named street or neighbourhood lies in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceDistricts } from '../marketplace/worker-contract.ts';
import { districtFit } from '../marketplace/ranking.ts';

test('a neighbourhood or street reaches the sources as its district (prod 8f9ba53b: „პეკინი“ failed MyHome)', () => {
  assert.deepEqual(sourceDistricts(['პეკინი']), ['Saburtalo']);
  assert.deepEqual(sourceDistricts(['Pekini Ave', 'Saburtalo']), ['Saburtalo'], 'one district, asked once');
  assert.deepEqual(sourceDistricts(['ვაკე', 'Didube']), ['ვაკე', 'Didube'], 'districts pass through unchanged');
  assert.deepEqual(sourceDistricts(['უცნობი ადგილი']), ['უცნობი ადგილი'], 'an unknown name is not invented into a district');
  assert.deepEqual(sourceDistricts([]), []);
});

test('ranking agrees with what the sources were asked: a Saburtalo listing matches the Pekini request', () => {
  assert.equal(districtFit('Saburtalo', ['პეკინი']), 'MATCH');
  assert.equal(districtFit('Saburtalo', sourceDistricts(['პეკინი'])), 'MATCH');
});
