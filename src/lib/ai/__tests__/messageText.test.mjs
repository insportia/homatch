// A CUSTOMER READ THE RESEARCH ENVELOPE, IN GEORGIAN, ON A PHONE.
//
// One real question from the Mortgage checklist, sent on the live page
// on 19 September 2026. The answer was good and it ended with this,
// visible, under a question about a late mortgage payment:
//
//   [[RESEARCH_JSON:{"entityName":"Research result","entityType":
//   "PUBLIC_WEB_RESEARCH","confidence":60,...
//
// sse.ts attaches that envelope so a surface can draw a research card
// from it. /ai parses it, removes it and draws the card. The assistant
// drawer and the Mortgage consultant printed the message verbatim, so
// both showed the JSON — two of the three surfaces on the same hook.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customerMessage } from '../messageText.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The real answer, shortened, exactly as it reached the screen. */
const REAL = `ერთი კვირით დაგვიანებისას დაგერიცხება ჯარიმა.

შენს სცენარში ყოველთვიური შენატანი **1,765 ლარია**.

[[RESEARCH_JSON:{"entityName":"Research result","entityType":"PUBLIC_WEB_RESEARCH","confidence":60,"sources":[{"label":"matsne","url":"https://www.matsne.gov.ge/ka/document/view/1326445","status":"FOUND ONLINE"}]}]]`;

test('THE INCIDENT: the research envelope never reaches a customer', () => {
  const { text, hadInternalBlock } = customerMessage(REAL);
  assert.equal(hadInternalBlock, true);
  assert.ok(!text.includes('RESEARCH_JSON'), text);
  assert.ok(!text.includes('entityType'), text);
  assert.ok(!text.includes('FOUND ONLINE'), text);
  // And the answer itself survives intact.
  assert.ok(text.includes('1,765'));
  assert.ok(text.includes('ერთი კვირით დაგვიანებისას'));
});

test('an ordinary answer is returned byte for byte', () => {
  const plain = 'თვეში დაახლოებით $1,765 გადაიხდი.';
  const { text, hadInternalBlock } = customerMessage(plain);
  assert.equal(text, plain);
  assert.equal(hadInternalBlock, false);
});

test('any [[NAME:…]] envelope is removed, not only this one', () => {
  // The next such wrapper should be invisible by default rather than
  // after the next incident.
  const { text, hadInternalBlock } = customerMessage('before [[SOMETHING_ELSE:{"a":1}]] after');
  assert.equal(hadInternalBlock, true);
  assert.ok(!text.includes('SOMETHING_ELSE'), text);
  assert.ok(text.startsWith('before') && text.endsWith('after'), text);
});

test('the blank lines a removed block leaves behind are collapsed', () => {
  const { text } = customerMessage('answer\n\n\n[[X:1]]');
  assert.equal(text, 'answer');
});

test('empty input is not an error', () => {
  assert.deepEqual(customerMessage(''), { text: '', hadInternalBlock: false });
});

test('the matcher does not carry state between calls', () => {
  // A /g/ regex reused with .test() advances lastIndex and answers
  // false on the next message, which would make the leak intermittent.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(customerMessage('x [[A:1]]').hadInternalBlock, true, `call ${i}`);
  }
});

test('every surface that renders an assistant message goes through this', () => {
  const consultant = read('src/components/mortgage/ConsultantPanel.tsx');
  const drawer = read('src/components/assistant/AssistantDrawer.tsx');
  const ai = read('src/pages/AIPage.tsx');

  assert.ok(consultant.includes('customerMessage('), 'the Mortgage consultant prints it raw again');
  assert.ok(drawer.includes('customerMessage('), 'the assistant drawer prints it raw again');
  /* /ai does its own extraction because it also DRAWS the card from the
     block. It is the one surface allowed to parse rather than strip. */
  assert.ok(ai.includes('RESEARCH_JSON'), '/ai must still parse the block it renders a card from');
  assert.ok(ai.includes('ResearchCard'), '/ai must still draw the card');
});

test('the Mortgage consultant renders the markdown rather than its asterisks', () => {
  // The same answer emphasised the figure it had just quoted, and the
  // panel showed "**1,765 ლარია**" with the asterisks.
  const consultant = read('src/components/mortgage/ConsultantPanel.tsx');
  assert.ok(consultant.includes('Streamdown'), 'assistant text is rendered as plain text again');
  assert.ok(
    /message\.role === 'user'\s*\?\s*message\.content/.test(consultant.replace(/\s+/g, ' ')),
    'a user message must stay plain: it is their own typing, not markup',
  );
});
