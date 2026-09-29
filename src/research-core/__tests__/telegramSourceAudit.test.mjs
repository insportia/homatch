// Telegram source discovery: multilingual searches and the measured audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSource, mentionsProperty, sourceQueriesFor } from '../discovery/telegram-sources.ts';

const NOW = Date.parse('2026-09-29T12:00:00Z');
const d = (days) => Math.floor((NOW - days * 86_400_000) / 1000);

test('queries cover all six HOMATCH languages for Georgia and can be narrowed', () => {
  const langs = new Set(sourceQueriesFor('GE').map((q) => q.language));
  for (const l of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) assert.ok(langs.has(l), l);
  assert.ok(sourceQueriesFor('ge', ['ru']).every((q) => q.language === 'ru'));
  assert.deepEqual(sourceQueriesFor('XX'), []);
});

test('property talk is recognised across languages; chatter is not', () => {
  assert.equal(mentionsProperty('Сдаётся квартира в Ваке, 2 комнаты'), true);
  assert.equal(mentionsProperty('ვეძებ ბინას საბურთალოზე'), true);
  assert.equal(mentionsProperty('Looking for an apartment in Tbilisi'), true);
  assert.equal(mentionsProperty('Good morning everyone, nice weather today'), false);
});

test('an active real-estate community qualifies; a quiet or off-topic one does not', () => {
  const realEstate = [
    'Ищу квартиру в Тбилиси, бюджет 800$', 'Сдаётся квартира, Сабуртало', 'Продаю квартиру в Батуми',
    'Looking for an apartment to rent in Vake', 'ვეძებ ბინას ქირით', 'Hello all',
  ].map((text, i) => ({ text, date: d(i + 1) }));
  const ok = auditSource(realEstate, { now: NOW, activeMaxDays: 30, minRelevance: 0.3 });
  assert.equal(ok.qualifies, true, ok.reason);
  assert.ok(ok.demandMessages >= 2);

  const quiet = realEstate.map((m) => ({ ...m, date: d(90) }));
  const q = auditSource(quiet, { now: NOW, activeMaxDays: 30, minRelevance: 0.3 });
  assert.equal(q.qualifies, false);
  assert.match(q.reason, /active window/);

  const chatter = ['hi', 'lol', 'football tonight?', 'who is coming', 'nice', 'ok'].map((text, i) => ({ text, date: d(i) }));
  assert.equal(auditSource(chatter, { now: NOW, activeMaxDays: 30, minRelevance: 0.3 }).qualifies, false);
  assert.equal(auditSource([], { now: NOW, activeMaxDays: 30, minRelevance: 0.3 }).relevance, 0);
});
