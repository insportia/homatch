// The assistant must stop asking for things it has already been told.
//
// The complaint this exists for, in the owner's words: "It should NOT ask
// again for information already provided." A visitor who opens with
// "კრწანისში მინდა ორ საძინებლიანი ბინა 160 ათასამდე" has given a district, a
// room count and a ceiling in one breath, and being answered with "რომელ
// უბანში ეძებთ?" makes the product look like it was not listening.
//
// The fix is not a longer prompt. It is keeping the facts, so that every turn
// can be told what is already known and what is genuinely still missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyTalkState, updateTalkState, describeState, stateGaps, stateIsRich,
  sanitiseTalkState,
} from '../conversationState.ts';

const OPENING = 'გამარჯობა, კრწანისში მინდა ორ საძინებლიანი ბინა დაახლოებით 160 ათას დოლარამდე.';

test('one Georgian sentence yields district, rooms, ceiling and currency', () => {
  const state = updateTalkState(emptyTalkState(), OPENING, 'ka');

  assert.equal(state.transactionType, 'BUY');
  assert.ok(state.locations.includes('krtsanisi'), `expected krtsanisi, got ${state.locations.join()}`);
  assert.equal(state.bedrooms, 2);
  assert.equal(state.budgetMax, 160_000);
  // "ათასამდე"/"დოლარამდე" is a ceiling, not a target, and the currency is
  // dollars however much of ლარი the Georgian word for dollar contains.
  assert.equal(state.currency, 'USD');
  assert.equal(state.language, 'ka');
});

test('nothing already known is listed as still missing', () => {
  const state = updateTalkState(emptyTalkState(), OPENING, 'ka');
  const gaps = stateGaps(state);

  for (const answered of ['buy, rent', 'district', 'budget', 'bedrooms']) {
    assert.ok(
      !gaps.some((g) => g.includes(answered)),
      `"${answered}" was already given and must not be asked for again — gaps were: ${gaps.join(' | ')}`,
    );
  }
  assert.equal(stateIsRich(state), true, 'four facts in one sentence is enough to stop interrogating');
});

test('later turns add without erasing what came before', () => {
  let state = updateTalkState(emptyTalkState(), OPENING, 'ka');
  state = updateTalkState(state, 'ინვესტიციისთვის მინდა.', 'ka');
  state = updateTalkState(state, 'ახალი პროექტი მირჩევნია.', 'ka');

  // The new facts.
  assert.equal(state.investmentGoal, 'RENTAL_YIELD');
  assert.equal(state.condition, 'NEW_BUILD');
  // And every old one, untouched.
  assert.ok(state.locations.includes('krtsanisi'));
  assert.equal(state.bedrooms, 2);
  assert.equal(state.budgetMax, 160_000);
  assert.equal(state.currency, 'USD');
});

test('a language switch keeps the property, and switches back', () => {
  let state = updateTalkState(emptyTalkState(), OPENING, 'ka');
  state = updateTalkState(state, 'А ипотекой можно воспользоваться?', 'ru');

  assert.equal(state.mortgageNeeded, true);
  assert.equal(state.language, 'ru');
  assert.ok(state.locations.includes('krtsanisi'), 'the flat does not change because the language did');
  assert.equal(state.budgetMax, 160_000);

  state = updateTalkState(state, 'კარგი, ქართულად გავაგრძელოთ.', 'ka');
  assert.equal(state.language, 'ka');
  assert.equal(state.mortgageNeeded, true);
});

test('the shell states are told apart, because they are not the same money', () => {
  const shell = (said) => updateTalkState(emptyTalkState(), said, 'ka').condition;
  assert.equal(shell('მწვანე კარკასი მაინტერესებს'), 'GREEN_FRAME');
  assert.equal(shell('თეთრი კარკასი მირჩევნია'), 'WHITE_FRAME');
  assert.equal(shell('შავი კარკასი არ მინდა'), 'BLACK_FRAME');
  assert.equal(shell('ახალაშენებული სახლი'), 'NEW_BUILD');
  assert.equal(shell('მშენებარე კორპუსი'), 'UNDER_CONSTRUCTION');
});

test('mixed Georgian and English is read as Georgian, not discarded', () => {
  // Georgian buyers say these in the middle of Georgian sentences constantly.
  const a = updateTalkState(emptyTalkState(), 'mortgage-ით მინდა ყიდვა კრწანისში', 'ka');
  assert.equal(a.mortgageNeeded, true);
  assert.ok(a.locations.includes('krtsanisi'));

  const b = updateTalkState(emptyTalkState(), 'ამ project-ის ROI რამდენია?', 'ka');
  assert.equal(b.investmentGoal, 'RENTAL_YIELD');
});

test('the prompt line stays short, and never invents a currency', () => {
  const state = updateTalkState(emptyTalkState(), 'ვეძებ ბინას 200 000-მდე', 'ka');
  const line = describeState(state);

  assert.ok(line.includes('200000'), `expected the figure in "${line}"`);
  assert.ok(
    line.includes('currency-not-stated'),
    'a figure with no currency said out loud must not become dollars in the prompt',
  );
  // Every word here is paid for twice: once in money, once in the wait before
  // the first spoken word.
  assert.ok(line.length < 220, `state line is too long for every turn: ${line.length} chars`);
});

test('an empty state asks for the useful things, in a useful order', () => {
  const gaps = stateGaps(emptyTalkState());
  assert.equal(gaps[0], 'whether they want to buy, rent, sell or invest');
  assert.equal(gaps[1], 'roughly which district or city');
  assert.equal(stateIsRich(emptyTalkState()), false);
});

test('a state arriving from a browser cannot inflate the prompt', () => {
  // The client carries this between turns, so it is untrusted input that ends
  // up inside a model prompt.
  const hostile = sanitiseTalkState({
    transactionType: 'BUY'.padEnd(500, 'x'),
    locations: new Array(50).fill('a'.repeat(500)),
    budgetMax: Number.MAX_SAFE_INTEGER,
    bedrooms: 9999,
    notes: new Array(50).fill('n'.repeat(500)),
    parking: 'yes',
  });

  assert.ok(hostile.transactionType.length <= 12);
  assert.ok(hostile.locations.length <= 4);
  assert.ok(hostile.locations.every((l) => l.length <= 40));
  assert.equal(hostile.budgetMax, null, 'an impossible figure is not a budget');
  assert.equal(hostile.bedrooms, null);
  assert.ok(hostile.notes.length <= 5);
  assert.equal(hostile.parking, null, 'a string is not a boolean');

  assert.deepEqual(sanitiseTalkState(null), emptyTalkState());
  assert.deepEqual(sanitiseTalkState('nonsense'), emptyTalkState());
});

test('the assistant\'s own words never become the visitor\'s facts', () => {
  // updateTalkState is only ever given what the VISITOR said. This documents
  // the contract: an assistant question that names a district as an example
  // must not end up as the district they asked for.
  const state = updateTalkState(emptyTalkState(), 'ჯერ არ ვიცი', 'ka');
  assert.deepEqual(state.locations, []);
  assert.equal(state.budgetMax, null);
});
