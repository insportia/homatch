import test from 'node:test';
import assert from 'node:assert/strict';
import { waitingMoodFor } from '../mood.ts';

test('HOMI reads the mood of a message in six languages', () => {
  assert.equal(waitingMoodFor('ვაუ, მართლა ასე იაფია?!'), 'surprised');
  assert.equal(waitingMoodFor('Really?! That cheap?'), 'surprised');
  assert.equal(waitingMoodFor('ვეძებ ბინას საბურთალოზე'), 'searching');
  assert.equal(waitingMoodFor('Ищу квартиру в Ваке'), 'searching');
  assert.equal(waitingMoodFor('Daire arıyorum'), 'searching');
  assert.equal(waitingMoodFor('أبحث عن شقة'), 'searching');
  assert.equal(waitingMoodFor('מחפש דירה בתל אביב'), 'searching');
  assert.equal(waitingMoodFor('მეშინია, რომ მომატყუეს'), 'encouraging');
  assert.equal(waitingMoodFor('I am worried about this contract'), 'encouraging');
  assert.equal(waitingMoodFor('დიდი მადლობა!'), 'happy');
  assert.equal(waitingMoodFor('გამარჯობა'), 'greeting');
  assert.equal(waitingMoodFor('რა უნდა ვიცოდე იპოთეკის აღებამდე?'), 'thinking');
  assert.equal(waitingMoodFor(''), 'thinking');
});
