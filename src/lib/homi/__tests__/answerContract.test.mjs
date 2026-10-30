// The extended HOMI answer contract: designed blocks, chips after every
// answer, the rate-limited service note, the stored meta, and the way back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswerBlocks, MAX_ANSWER_BLOCKS } from '../answerBlocks.ts';
import { allowPitch, parsePitchHistory, PITCHABLE_SERVICES, pitchKeys } from '../pitch.ts';
import { ensureReplies, fallbackReplies } from '../replyFallback.ts';
import { parseMessageMeta, hasMeta } from '../messageMeta.ts';
import { isSafeReturnPath, restoreScrollY, samePage, sanitizeReturnTarget } from '../returnTarget.ts';
import { HOMI_LOCALES } from '../content.ts';
import { SERVICE_ACTION_CATALOGUE } from '../../ai/serviceActions.ts';

test('blocks: valid ones render, invalid ones disappear, never more than three', () => {
  const blocks = parseAnswerBlocks([
    { type: 'figures', items: [{ label: 'Monthly payment', value: '$1,240', hint: '20 years' }, { label: 'Total interest', value: '$97,600' }] },
    { type: 'callout', tone: 'warning', title: 'Check this', text: 'The quote leaves out insurance.' },
    { type: 'compare', columns: ['Vake', 'Saburtalo'], rows: [{ label: 'Price', values: ['high', 'mid'] }, { label: 'Schools', values: ['many', 'many'] }] },
    { type: 'steps', items: ['one', 'two'] },
  ]);
  assert.equal(blocks.length, MAX_ANSWER_BLOCKS);
  assert.deepEqual(blocks.map((b) => b.type), ['figures', 'callout', 'compare']);

  assert.deepEqual(parseAnswerBlocks('nope'), []);
  assert.deepEqual(parseAnswerBlocks([{ type: 'figures', items: [{ label: 'only one', value: '1' }] }]), [], 'one figure is not a set');
  assert.deepEqual(parseAnswerBlocks([{ type: 'html', html: '<b>x</b>' }]), []);
  assert.deepEqual(parseAnswerBlocks([{ type: 'callout', text: '<script>alert(1)</script>' }]), [], 'markup is refused');
  assert.deepEqual(parseAnswerBlocks([{ type: 'callout', text: 'see https://evil.example' }]), [], 'links are refused');
  assert.deepEqual(parseAnswerBlocks([{ type: 'compare', columns: ['a', 'b'], rows: [{ label: 'x', values: ['1'] }, { label: 'y', values: ['1', '2'] }] }]), [], 'ragged rows are dropped, then too few remain');
  const [callout] = parseAnswerBlocks([{ type: 'callout', tone: 'shout', text: 'Prices vary — a lot.' }]);
  assert.equal(callout.tone, 'tip', 'unknown tone falls back');
  assert.doesNotMatch(callout.text, /[–—]/, 'no em or en dashes reach the screen');
});

test('suggested replies: there is always something to tap', () => {
  for (const loc of HOMI_LOCALES) {
    for (const service of [null, 'FIND_PROPERTY', 'FIND_BUYERS_TENANTS', 'VERIFY', 'MORTGAGE', 'CONTRACT_INTELLIGENCE', 'INVESTMENT', 'FOR_EXPATS']) {
      const replies = fallbackReplies(loc, service);
      assert.ok(replies.length >= 3, `${loc}/${service}`);
      for (const r of replies) assert.doesNotMatch(r.label, /[–—]/);
    }
  }
  const model = [{ id: 's1', label: 'Tbilisi', value: 'Tbilisi' }, { id: 's2', label: 'Batumi', value: 'Batumi' }];
  assert.deepEqual(ensureReplies(model, 'en', null), model, 'two good model chips are kept');
  assert.equal(ensureReplies([], 'ka', 'FIND_PROPERTY')[0].label, 'თბილისში ვეძებ');
  assert.equal(ensureReplies([model[0]], 'en', null).length, 4, 'one chip is not a choice: fallback');
});

test('service note: once per service per conversation, never on the first answer, never two in a row', () => {
  assert.equal(allowPitch('VERIFY', []), null, 'not on the first answer');
  assert.equal(allowPitch('VERIFY', [null]), 'VERIFY');
  assert.equal(allowPitch('verify', [null, null]), 'VERIFY', 'case-insensitive id');
  assert.equal(allowPitch('VERIFY', ['VERIFY', null, null, null]), null, 'once per conversation');
  assert.equal(allowPitch('MORTGAGE', [null, 'VERIFY']), null, 'not right after another note');
  assert.equal(allowPitch('MORTGAGE', ['VERIFY', null]), null, 'a breather of two answers');
  assert.equal(allowPitch('MORTGAGE', ['VERIFY', null, null]), 'MORTGAGE');
  assert.equal(allowPitch('CONTACT', [null, null]), null, 'only services with reviewed copy');
  assert.equal(allowPitch('DROP_TABLE', [null]), null);
  assert.deepEqual(parsePitchHistory(['VERIFY', 'nope', null, 3]), ['VERIFY', null, null, null]);
  for (const id of PITCHABLE_SERVICES) assert.ok(id in SERVICE_ACTION_CATALOGUE, id);
  assert.deepEqual(pitchKeys('FIND_PROPERTY'), { title: 'homi_pitch_find_property_title', body: 'homi_pitch_find_property_body' });
});

test('every customer service has its own reviewed note, and Verify says it plainly', async () => {
  const { UX_HOMICHAT_STRINGS: S } = await import('../../../../scripts/ux-homichat-i18n-data.mjs');
  const expected = ['VERIFY', 'FIND_PROPERTY', 'FIND_BUYERS_TENANTS', 'CONTRACT_INTELLIGENCE', 'MORTGAGE', 'INVESTMENT', 'FOR_EXPATS', 'BROKERS', 'META_ADS'];
  assert.deepEqual([...PITCHABLE_SERVICES].sort(), [...expected].sort());
  for (const id of PITCHABLE_SERVICES) {
    const { title, body } = pitchKeys(id);
    for (const key of [title, body]) {
      assert.equal(S[key]?.length, 6, key);
      for (const v of S[key]) {
        assert.doesNotMatch(v, /[–—]/, `${key}: no dashes`);
        assert.doesNotMatch(v, /confirmed buyer|დადასტურებული მყიდველი|შესატყვისი/i, `${key}: forbidden wording`);
      }
    }
  }
  assert.match(S.homi_pitch_verify_body[1], /საქართველოში პირველია და მხოლოდ HOMATCH-ზე/);
  assert.match(S.homi_pitch_verify_body[0], /first service of its kind in Georgia.*only find it on HOMATCH/);
  // Subscriptions (owner, 2026-10-30): the first analysis is free once, then a plan; never "each month" or a credit price.
  assert.match(S.homi_pitch_contract_intelligence_body[0], /Your first analysis is free; after that you will need a subscription plan\./);
  assert.match(S.homi_pitch_contract_intelligence_body[1], /პირველი ანალიზი უფასოა, შემდეგ კი გამოწერის გეგმა დაგჭირდება\./);
});

test('stored meta is re-validated on read', () => {
  const meta = parseMessageMeta({ blocks: [{ type: 'steps', items: ['a', 'b'] }], services: ['VERIFY', 'NOPE', 'VERIFY'], pitch: 'MORTGAGE' });
  assert.deepEqual(meta.services, ['VERIFY']);
  assert.equal(meta.pitch, 'MORTGAGE');
  assert.equal(meta.blocks.length, 1);
  assert.deepEqual(parseMessageMeta(null), { blocks: [], services: [], pitch: null });
  assert.equal(hasMeta(parseMessageMeta({})), false);
});

test('the way back: in-app paths only, exact place restored', () => {
  assert.ok(isSafeReturnPath('/investment?propertyId=245310#result'));
  for (const bad of ['https://evil.example', '//evil.example', '/ai', '/ai?x=1', '/auth/login', 'investment', '/x\\y', '']) {
    assert.equal(isSafeReturnPath(bad), false, bad);
  }
  assert.deepEqual(sanitizeReturnTarget({ path: '/investment', y: 1234.6, anchorId: 'inv-homi', anchorTop: 88 }), { path: '/investment', y: 1235, anchorId: 'inv-homi', anchorTop: 88 });
  assert.deepEqual(sanitizeReturnTarget({ path: '/investment', y: 10, anchorId: ':r1:' }), { path: '/investment', y: 10 }, 'generated ids are not anchors');
  assert.deepEqual(sanitizeReturnTarget({ path: '/x', y: 10, anchorId: 'radix-12' }), { path: '/x', y: 10 });
  assert.equal(sanitizeReturnTarget({ path: '/ai', y: 0 }), null);
  const target = { path: '/investment', y: 900, anchorId: 'inv-homi', anchorTop: 120 };
  assert.equal(restoreScrollY(target, 1100), 980, 'anchor wins: where it sat in the viewport');
  assert.equal(restoreScrollY(target, null), 900, 'anchor gone: raw position');
  assert.ok(samePage('/investment/', '/investment#top'));
  assert.ok(!samePage('/investment?a=1', '/investment?a=2'));
});
