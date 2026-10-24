import test from 'node:test';
import assert from 'node:assert/strict';
import { routeHomiTurn } from '../router.ts';
import { HOMI_TEMPLATES, HOMI_DETERMINISTIC_INTENTS, HOMI_LOCALES, HOMI_INTRO } from '../content.ts';
import { parseHomiCards, HOMI_CHECKLISTS } from '../cards.ts';
import { SERVICE_ACTION_CATALOGUE } from '../../ai/serviceActions.ts';

const det = (text, opts) => {
  const r = routeHomiTurn(text, opts);
  return r.kind === 'DETERMINISTIC' ? r.intent : `MODEL_${r.tier}`;
};

test('the specification examples route internal-first', () => {
  assert.equal(det('უფრო იაფი ბინა მინდა.'), 'FIND_PROPERTY');
  assert.equal(det('რა არის Verify?'), 'SERVICE_VERIFY');
  assert.equal(det('როგორ გავიგო, რამდენად მომგებიანია ეს ბინა?'), 'ROI_QUICK');
  assert.equal(det('რა დოკუმენტები მჭირდება იპოთეკისთვის?'), 'MORTGAGE_DOCS');
});

test('social turns in all six languages are free and instant', () => {
  for (const g of ['გამარჯობა', 'Hello', 'Привет', 'Merhaba', 'مرحبا', 'שלום', 'hi homi']) assert.equal(det(g), 'GREETING', g);
  for (const g of ['მადლობა', 'Thank you!', 'Спасибо', 'Teşekkürler', 'شكرا', 'תודה רבה']) assert.equal(det(g), 'THANKS', g);
  assert.equal(det('ვინ ხარ?'), 'IDENTITY');
  assert.equal(det('Are you a human?'), 'IDENTITY');
  assert.equal(det('ვინ შეგქმნა?'), 'IDENTITY');
  assert.equal(det('are you chatgpt?'), 'MODEL_QUESTION');
  assert.equal(det('რა შეგიძლია?'), 'CAPABILITIES');
  assert.equal(det('როგორ დაგიკავშირდე?'), 'CONTACT');
});

test('ambiguous or research-shaped turns are never short-circuited', () => {
  // "fine" is an answer, not a goodbye.
  assert.notEqual(det('კარგად'), 'GOODBYE');
  // Long, specific, or current-facts questions go to the model.
  assert.equal(det('რა ღირს დღეს ოროთახიანი ბინა ვაკეში და რამდენად გაიზარდა ფასები ბოლო წელს?'), 'MODEL_FULL');
  assert.equal(det('What is the latest news about this developer?'), 'MODEL_FULL');
  assert.equal(det('Is Vake or Saburtalo better for a family with two kids?'), 'MODEL_LIGHT');
  // A mortgage question inside the mortgage workspace is about THEIR numbers.
  assert.match(det('რა დოკუმენტები მჭირდება იპოთეკისთვის?', { surface: 'mortgage-consultant' }), /^MODEL_/);
  assert.equal(det('გამარჯობა', { surface: 'mortgage-consultant' }), 'GREETING');
});

test('a chip intent is trusted only from the closed set', () => {
  assert.equal(det('anything', { chipIntent: 'MORTGAGE_DOCS_SALARIED' }), 'MORTGAGE_DOCS_SALARIED');
  assert.match(det('hello there friend', { chipIntent: 'DROP_TABLE' }), /^(GREETING|MODEL_LIGHT)$/);
});

test('every template is complete in six languages and points at real actions/cards', () => {
  for (const intent of HOMI_DETERMINISTIC_INTENTS) {
    const t = HOMI_TEMPLATES[intent];
    assert.ok(t, intent);
    for (const loc of HOMI_LOCALES) assert.ok(t.text[loc]?.trim(), `${intent}.${loc}`);
    for (const a of t.actions ?? []) assert.ok(a in SERVICE_ACTION_CATALOGUE, `${intent} action ${a}`);
    for (const c of t.cards ?? []) assert.deepEqual(parseHomiCards([c]), [c], `${intent} card ${JSON.stringify(c)}`);
    for (const chip of t.chips ?? []) for (const loc of HOMI_LOCALES) assert.ok(chip.label[loc]?.trim());
  }
  for (const [id, list] of Object.entries(HOMI_CHECKLISTS)) {
    for (const item of list.items) for (const loc of HOMI_LOCALES) assert.ok(item[loc]?.trim(), `${id}.${loc}`);
  }
});

test('the introduction is the authoritative wording', () => {
  assert.equal(HOMI_INTRO.ka, 'გამარჯობა! მე HOMI ვარ, HOMATCH-ის შენი პერსონალური ასისტენტი. 🏡 მითხარი, რაში გჭირდება დახმარება, ან აირჩიე სასურველი მიმართულება.');
  assert.equal(HOMI_INTRO.en, "Hi! I'm HOMI, your personal HOMATCH assistant. 🏡 Tell me what you need help with, or choose where you'd like to start.");
});

test('templates never state a price, an approval, or invented contact details', () => {
  for (const intent of HOMI_DETERMINISTIC_INTENTS) {
    const en = HOMI_TEMPLATES[intent].text.en;
    assert.doesNotMatch(en, /\$\s?\d|\d+\s?(GEL|USD|credits)|you will be approved|guarantee/i, intent);
    assert.doesNotMatch(en, /@[a-z0-9-]+\.[a-z]|\+995|\(\d{3}\)/i, intent);
  }
});

test('cards from a model are validated against the catalogue', () => {
  assert.deepEqual(parseHomiCards(['roi_quick', 'MORTGAGE_QUICK', 'START']), [{ type: 'ROI_QUICK' }, { type: 'MORTGAGE_QUICK' }]);
  assert.deepEqual(parseHomiCards([{ type: 'CHECKLIST', id: 'evil' }, { type: 'HTML' }]), []);
  assert.deepEqual(parseHomiCards('ROI_QUICK'), []);
});

test('HOMI never shows an em or en dash, and keeps grammatical hyphens', async () => {
  const { stripAiDashes } = await import('../style.ts');
  assert.equal(stripAiDashes('ეს ზოგადი სიაა — ბანკი თავად ადგენს.'), 'ეს ზოგადი სიაა, ბანკი თავად ადგენს.');
  assert.equal(stripAiDashes('usually 6–12 months'), 'usually 6-12 months');
  assert.equal(stripAiDashes('HOMATCH-ის ასისტენტი, ნაბიჯ-ნაბიჯ'), 'HOMATCH-ის ასისტენტი, ნაბიჯ-ნაბიჯ');
  assert.equal(stripAiDashes('— first\n— second'), 'first\nsecond');
  assert.equal(stripAiDashes('end —.'), 'end.');
  for (const intent of HOMI_DETERMINISTIC_INTENTS) {
    for (const loc of HOMI_LOCALES) assert.doesNotMatch(HOMI_TEMPLATES[intent].text[loc], /[–—]/, `${intent}.${loc}`);
  }
  for (const list of Object.values(HOMI_CHECKLISTS)) for (const item of list.items) for (const loc of HOMI_LOCALES) assert.doesNotMatch(item[loc], /[–—]/);
});

/* The owner's own examples (HOMI brief 2.2): each is answered by HOMATCH's own route, not a model. */
test('the owner examples route to HOMATCH services without a model call', () => {
  const cases = [
    ['იაფი ბინა მინდა', 'FIND_PROPERTY'],
    ['ჩემი ბინის ფასი მაინტერესებს', 'PROPERTY_PRICE'],
    ['იპოთეკა მინდა', 'SERVICE_MORTGAGE'],
    ['ხელშეკრულება შემიმოწმე', 'SERVICE_CONTRACTS'],
    ['საქართველოში გადმოსვლა მინდა', 'SERVICE_EXPATS'],
    ['რა არის Verify?', 'SERVICE_VERIFY'],
    ['check my contract', 'SERVICE_CONTRACTS'],
    ['проверь договор', 'SERVICE_CONTRACTS'],
    ['how much is my flat worth', 'PROPERTY_PRICE'],
  ];
  for (const [text, intent] of cases) {
    const r = routeHomiTurn(text);
    assert.equal(r.kind, 'DETERMINISTIC', text);
    assert.equal(r.intent, intent, text);
  }
});

test('a real question about a clause is still the model\'s', () => {
  assert.equal(routeHomiTurn('ხელშეკრულების მე-5 პუნქტი რას ნიშნავს და რატომ არის ასე დაწერილი').kind, 'MODEL');
});
