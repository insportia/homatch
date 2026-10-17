// FIND BUYERS — language coverage before depth, and native Telegram messages as pipeline
// items (2026-10-16). Pure: no network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deepenPriority } from '../findBuyers/executor.ts';
import { nativeMessageItem, NATIVE_TELEGRAM_LIMITS } from '../findBuyers/nativeTelegram.ts';

test('a productive search never deepens ahead of another language\'s first probe', () => {
  /* production: FB_GROUP_SEARCH base 80; a productive ka arm measured 99 */
  for (const stage of ['FB_GROUP_SEARCH', 'FB_POST_SEARCH', 'FB_AD_LIBRARY']) {
    assert.equal(deepenPriority(stage, 99, 80), 79, stage);
    assert.equal(deepenPriority(stage, 40, 80), 40, 'a weak arm keeps its lower priority');
  }
  assert.equal(deepenPriority('FB_GROUP_POSTS', 99, 80), 99, 'reading known groups is not a language probe');
});

test('a stored native Telegram message becomes a pipeline item with its own id and link', () => {
  const item = nativeMessageItem({ external_id: 'tbilisi_flats/4512', source_url: 'https://t.me/tbilisi_flats/4512', author_public_name: 'Nino',
    original_text: 'ვეძებ 3 ოთახიან ბინას კრწანისში, ბიუჯეტი 200 000$', published_at: '2026-10-15T08:00:00Z' });
  assert.equal(item.externalId, 'tbilisi_flats/4512', 'verbatim: the stored row is matched, never duplicated');
  assert.equal(item.network, 'TELEGRAM');
  assert.equal(item.url, 'https://t.me/tbilisi_flats/4512');
  assert.equal(item.engagement.comments, null);
  assert.equal(nativeMessageItem({ external_id: 'x/1', original_text: '   ' }), null);
  assert.equal(nativeMessageItem({ original_text: 'text' }), null);
  assert.ok(NATIVE_TELEGRAM_LIMITS.maxAgeDays <= 30, 'the 30-day rule');
});
