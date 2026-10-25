// My Georgia by HOMI: Places in Georgia, as data.
//
// The owner asked for a lot of places, in six languages, in plain words with no
// dashes, each with a way to get there and an official page. These pin that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PLACES } from '../places/meta.ts';
import ka from '../places/content.ka.ts';
import en from '../places/content.en.ts';
import ru from '../places/content.ru.ts';
import tr from '../places/content.tr.ts';
import ar from '../places/content.ar.ts';
import he from '../places/content.he.ts';

const LOCALES = { ka, en, ru, tr, ar, he };
const TYPES = ['MOUNTAINS', 'SEA', 'WINE', 'HISTORIC', 'CAVES', 'LAKES', 'SPA', 'PARKS', 'CITIES'];

test('at least forty destinations, every kind well covered, ids unique', () => {
  assert.ok(PLACES.length >= 40, `only ${PLACES.length} places`);
  assert.equal(new Set(PLACES.map((p) => p.id)).size, PLACES.length, 'a duplicate id');
  for (const type of TYPES) {
    const n = PLACES.filter((p) => p.types.includes(type)).length;
    assert.ok(n >= 3, `${type} has only ${n} places`);
  }
});

test('every place says when, how long and how, and links an official page', () => {
  for (const p of PLACES) {
    assert.ok(p.seasons.length > 0, `${p.id}: no season`);
    assert.ok(p.transport.length > 0, `${p.id}: no transport`);
    assert.ok(p.hours >= 0 && p.hours < 24, `${p.id}: travel time ${p.hours}`);
    assert.match(p.source.url, /^https:\/\/(www\.)?(georgia\.travel|apa\.gov\.ge)\//, `${p.id}: source ${p.source.url}`);
  }
});

test('all six languages carry every place, fully, in their own script, with no dashes', () => {
  for (const [lang, texts] of Object.entries(LOCALES)) {
    assert.deepEqual(Object.keys(texts).sort(), PLACES.map((p) => p.id).sort(), `${lang}: places differ from the list`);
    for (const p of PLACES) {
      const x = texts[p.id];
      for (const f of ['name', 'region', 'blurb', 'getThere']) assert.ok(x[f]?.trim(), `${lang}/${p.id}: empty ${f}`);
      assert.equal(x.todo.length, 3, `${lang}/${p.id}: ${x.todo.length} things to do`);
      const all = [x.name, x.region, x.blurb, x.getThere, ...x.todo].join(' ');
      assert.ok(!/[–—]/.test(all) && !/\s-\s/.test(all), `${lang}/${p.id}: a dash`);
      if (lang === 'ka') assert.match(x.blurb, /[Ⴀ-ჿ]/, `ka/${p.id}: not Georgian`);
      if (lang === 'ar') assert.match(x.blurb, /[؀-ۿ]/, `ar/${p.id}: not Arabic`);
      if (lang === 'he') assert.match(x.blurb, /[֐-׿]/, `he/${p.id}: not Hebrew`);
      if (lang !== 'en') assert.notEqual(x.blurb, en[p.id].blurb, `${lang}/${p.id}: left in English`);
    }
  }
});

test('the Georgian follows the house terms', () => {
  const src = readFileSync('src/myGeorgia/places/content.ka.ts', 'utf8');
  assert.ok(!src.includes('ტბილისი'), 'თბილისი is misspelt');
  assert.ok(!src.includes('შესატყვისი'));
});
