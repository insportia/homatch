// users.preferred_language follows the interface: stored on first sight (signup, old
// accounts with none), updated when the person switches while signed in, and never
// overwritten just because another device opened in another language.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { languageToPersist } from '../preferredLanguage.ts';

test('nothing stored: the settled interface language is stored', () => {
  assert.equal(languageToPersist({ userId: 'u', stored: null, current: 'ru', baseline: 'ru' }), 'ru');
  assert.equal(languageToPersist({ userId: 'u', stored: 'xx', current: 'ka', baseline: 'ka' }), 'ka');
});

test('a switch while signed in is stored; the same value twice is not', () => {
  assert.equal(languageToPersist({ userId: 'u', stored: 'ka', current: 'en', baseline: 'ka' }), 'en');
  assert.equal(languageToPersist({ userId: 'u', stored: 'ka', current: 'en', baseline: 'ka', lastWritten: 'en' }), null);
  assert.equal(languageToPersist({ userId: 'u', stored: 'en', current: 'en', baseline: 'ka' }), null);
});

test('another device opening in another language does not overwrite the account choice', () => {
  assert.equal(languageToPersist({ userId: 'u', stored: 'ka', current: 'en', baseline: 'en' }), null);
});

test('signed out or an unknown language: nothing', () => {
  assert.equal(languageToPersist({ userId: null, stored: null, current: 'en', baseline: 'en' }), null);
  assert.equal(languageToPersist({ userId: 'u', stored: null, current: 'fr', baseline: 'fr' }), null);
});

test('the hook is mounted from AuthProvider, waits to settle, and never writes while impersonating', () => {
  const auth = fs.readFileSync('src/contexts/AuthContext.tsx', 'utf8');
  assert.match(auth, /usePersistPreferredLanguage\(homatchUser\?\.id, homatchUser\?\.preferred_language, lang\)/);
  const hook = fs.readFileSync('src/hooks/usePersistPreferredLanguage.ts', 'utf8');
  assert.match(hook, /isImpersonating\(\)/);
  assert.match(hook, /SETTLE_MS/);
  assert.match(hook, /update\(\{ preferred_language: next \}\)/);
});
