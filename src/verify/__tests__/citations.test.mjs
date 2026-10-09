import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCitations, stripTracking, hasDistance } from '../citations.ts';

test('raw markdown citation becomes a source host; tracking parameters never survive', () => {
  const r = splitCitations('ავტობუსის გაჩერება 70 მ-შია ([sivrce.com](https://sivrce.com/ka/x?utm_source=openai)).');
  assert.equal(r.text, 'ავტობუსის გაჩერება 70 მ-შია.');
  assert.deepEqual(r.sources, [{ host: 'sivrce.com', url: 'https://sivrce.com/ka/x' }]);
  assert.ok(!JSON.stringify(r).includes('utm_'));
});

test('a worded link keeps its words; a bare url is removed; duplicates collapse', () => {
  const r = splitCitations('იხილეთ [დეველოპერის გვერდი](https://www.villion.ge/about/?utm_source=openai&id=2) და https://villion.ge/x');
  assert.equal(r.text, 'იხილეთ დეველოპერის გვერდი და');
  assert.deepEqual(r.sources, [{ host: 'villion.ge', url: 'https://www.villion.ge/about/?id=2' }]);
  assert.equal(stripTracking('https://a.ge/?fbclid=1'), 'https://a.ge/');
  assert.deepEqual(splitCitations(null), { text: '', sources: [] });
});

test('distance detection marks source-quoted precision for approximate display', () => {
  assert.ok(hasDistance('70 მ და 1 წუთი ფეხით'));
  assert.ok(hasDistance('5 min walk'));
  assert.ok(!hasDistance('ახლოს მდებარეობს'));
});
