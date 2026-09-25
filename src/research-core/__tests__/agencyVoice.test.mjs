// A NOUN NAMES A TOPIC. ONLY A VERB IN THE FIRST PERSON NAMES A SPEAKER.
//
// agencyVoice decides whether a post is an agency talking, and that
// disqualifies it as DEMAND: "we have clients looking for 2BR flats" is a
// sales pitch aimed at sellers, not a lead.
//
// The lexicon it read contained bare nouns — agency, agent, broker, realtor,
// სააგენტო, агентство — so it matched anybody who MENTIONED an agency.
//
// The first production run of demand-discovery, forum.ge board 92, flagged
// three posts as agency voice. All three were real buyers, and two of them
// were complaining about agents. One was a woman saying agencies should not
// contact her. They were the strongest leads the board produced and every
// one would have been thrown away.
//
// Same failure as "дом" inside "рядом": a keyword standing in for a
// judgement.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDirection } from '../signals/direction.ts';
import { LEXICON } from '../discovery/lexicon.ts';

/* Real posts, as forum.ge served them on 2026-09-25. */
const BUYERS = {
  KALOSHA:
    'მე ბინას ვეძებ, ჯერ სააგენტო ან მაკერი ან რეალტერი არ შემხვედრია რომელიც ტყუილში არ დავიჭირე',
  Sopho:
    'მინდა ბინა შევიძინო. განცხადება ვნახე გაზეთში, ქალი იძახის, ვყიდი ბინას, '
    + 'სააგენტოები არ გამომეხმაურონო',
  Kniazna:
    'დღეს, გუშინ და უკვე ორი კვირაა რაც ვრეკავ უძრავი ქონების სააგენტოებში, მარტივი თხოვნით',
};

test('a buyer who mentions an agency is not an agency', () => {
  for (const [who, text] of Object.entries(BUYERS)) {
    const verdict = classifyDirection(text);
    assert.equal(
      verdict.agencyVoice, false,
      `${who} was read as an agency for saying the word`,
    );
  }
});

test('and the ones that state intent are still DEMAND', () => {
  /*
   * The other half of the fix. Removing the nouns must not have removed the
   * lead: these two say they are looking for and want to buy a flat.
   */
  assert.equal(classifyDirection(BUYERS.KALOSHA).direction, 'DEMAND');
  assert.equal(classifyDirection(BUYERS.Sopho).direction, 'DEMAND');
});

test('first-person agency speech is still caught, in every language that has it', () => {
  /*
   * A narrower rule that caught nothing would have passed the tests above
   * and destroyed the thing agencyVoice is for.
   */
  const pitches = [
    ['en', 'We have clients looking for 2BR flats in Vake, contact us'],
    ['ru', 'наши объекты в Батуми, звоните'],
    ['ka', 'დაგვიკავშირდით ბინის შესაძენად'],
    ['tr', 'bize ulaşın'],
  ];
  for (const [language, text] of pitches) {
    assert.equal(
      classifyDirection(text).agencyVoice, true,
      `${language} agency speech is no longer recognised`,
    );
  }
});

test('every language keeps at least one first-person marker', () => {
  /*
   * The lists are what makes this work, and an empty one is a language in
   * which no agency can ever be identified. Each entry must also be speech
   * rather than a noun — checked as "a phrase, or a verb form", which the
   * bare nouns this replaced were not.
   */
  const BARE_NOUNS = [
    'agency', 'agent', 'broker', 'realtor',
    'სააგენტო', 'აგენტი', 'ბროკერი',
    'агентство', 'агент', 'риелтор', 'брокер',
    'emlakçı', 'danışman', 'תיווך', 'מתווך', 'סוכנות',
  ];

  for (const [language, lex] of Object.entries(LEXICON)) {
    assert.ok(
      lex.agency.length > 0,
      `${language} has no agency marker at all, so no agency can be identified in it`,
    );
    for (const marker of lex.agency) {
      assert.equal(
        BARE_NOUNS.includes(marker), false,
        `${language} has the bare noun "${marker}" back in its agency list`,
      );
    }
  }
});
