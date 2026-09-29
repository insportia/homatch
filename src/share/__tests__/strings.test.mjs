// The public viewer speaks all six languages, and says the same thing as the app.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_LANGS, SHARE_STRINGS } from '../strings.ts';
import { translations } from '../../i18n/translations.ts';

test('every language has every viewer string, and none is left in English', () => {
  const keys = Object.keys(SHARE_STRINGS.en).sort();
  for (const lang of SHARE_LANGS) {
    assert.deepEqual(Object.keys(SHARE_STRINGS[lang]).sort(), keys, lang);
    for (const k of keys) {
      assert.ok(SHARE_STRINGS[lang][k]?.trim(), `${lang}.${k} is empty`);
      if (lang !== 'en' && !['ds_room_wc'].includes(k)) assert.notEqual(SHARE_STRINGS[lang][k], SHARE_STRINGS.en[k], `${lang}.${k} is untranslated`);
    }
  }
});

test('room and walkthrough words match the app exactly', () => {
  for (const lang of SHARE_LANGS) {
    for (const k of Object.keys(SHARE_STRINGS[lang]).filter((x) => x.startsWith('ds_'))) {
      assert.equal(SHARE_STRINGS[lang][k], translations[lang][k], `${lang}.${k} drifted from translations.ts`);
    }
  }
});
