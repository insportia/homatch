// FIND BUYERS — AI-first classification contract (v11) and the deterministic safety layer.
// Regression: the two leads campaign 343cfc41 displayed were brokers (2026-10-18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDemand, buyerViaBroker } from '../findBuyers/demandClassifier.ts';
import { applyAiVerdict, parseAiVerdict, AI_ROLES, AI_CLASSIFY_SCHEMA, MIN_ROLE_CONFIDENCE } from '../findBuyers/aiClassifier.ts';
import { qualify } from '../findBuyers/qualify.ts';
import { classifyBuyerIntent } from '../findBuyers/buyerIntent.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';

const DNA = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 });
const v = (role, extra = {}) => parseAiVerdict({ role, confidence: 0.9, transaction: 'BUY', compatibility: 'UNKNOWN', budget: null, location: null, contradictions: [], evidence: ['q'], reason: 'r', ...extra });
const shown = (reading, text = 'x') => {
  const q = qualify(reading, DNA, { ageDays: 1, duplicate: false });
  const i = classifyBuyerIntent({ text, kind: 'POST', reading });
  return q.category !== 'REJECTED' && i.resultType !== 'EXCLUDED' ? q : null;
};

test('343cfc41: the two displayed "buyers" are brokers — the rules now reject them too', () => {
  const collecting = classifyDemand('ჩამიყარეთ გასაყიდი ბინები მყავს ბათუმელი კლიენტები❤️❤️მომწერეთ პირადში❤️❤️');
  assert.equal(collecting.role, 'AGENT');
  assert.ok(collecting.evidence.includes('collects_listings'));
  const service = classifyDemand('مرحباً! إذا كنتم مهتمين بشراء شقة في جورجيا، يمكنكم مراسلتي على الخاص. أقدم لكم خدمة متكاملة بنسبة 100%! 🆘');
  assert.equal(service.role, 'AGENT');
  for (const r of [collecting, service]) assert.equal(shown(r), null);
});

test('multilingual brokers and advertisers are not buyers (rule safety layer)', () => {
  for (const text of [
    'გასაყიდი ბინები გადმომიგდეთ, გვყავს უცხოელი მყიდველები',
    'Скидывайте варианты квартир на продажу, есть клиенты',
    'Send me your listings — I have many buyers waiting',
    'Eğer daire almak istiyorsanız bana yazın, tam hizmet sunuyorum',
    'אם אתם מעוניינים לקנות דירה בטביליסי — אני מציע שירות מלא',
    'إذا كنت مهتماً بشراء شقة في تبليسي أقدم لكم خدمة متكاملة',
  ]) {
    const r = classifyDemand(text);
    assert.ok(['AGENT', 'SERVICE', 'SALE_OFFER'].includes(r.role), `${text} → ${r.role} ${r.evidence}`);
    assert.equal(shown(r, text), null, text);
  }
});

test('genuine buyers in every language stay buyers (no broker word confusion)', () => {
  for (const text of [
    'ვყიდულობ 3 ოთახიან ბინას კრწანისში, აგენტებმა არ შემაწუხოთ',
    'Куплю 3-комнатную квартиру в Крцаниси, напишите в личку',
    'Looking to buy a 2 bedroom apartment in Krtsanisi, no agents please',
    'Tiflis\'te 2+1 daire satın almak istiyorum',
    'أريد شراء شقة في تبليسي بثلاث غرف',
    'רוצה לקנות דירה בטביליסי, 3 חדרים',
  ]) assert.equal(classifyDemand(text).role, 'BUY_SEEKER', text);
});

test('the AI decides the role; facts stay the extractor\'s', () => {
  const rule = classifyDemand('ვყიდულობ 3 ოთახიან ბინას კრწანისში, ბიუჯეტი 210 000$');
  const asBroker = applyAiVerdict(rule, v('BROKER_COLLECTING_LISTINGS'));
  assert.equal(asBroker.role, 'AGENT');
  assert.equal(shown(asBroker), null, 'a collecting broker never shows');
  assert.equal(asBroker.budget?.max, rule.budget?.max, 'the stated budget is the text\'s, not the model\'s');
  const withClient = applyAiVerdict(rule, v('BROKER_WITH_CLIENT'));
  assert.ok(buyerViaBroker(withClient));
  const q = shown(withClient);
  assert.ok(q && q.category === 'WEAK' && q.limitations.includes('BUYER_VIA_BROKER'), 'shown apart, never above Weak');
  for (const role of ['SELLER_OR_LANDLORD', 'SERVICE_PROVIDER', 'IRRELEVANT']) assert.equal(shown(applyAiVerdict(rule, v(role))), null, role);
  const direct = applyAiVerdict(rule, v('DIRECT_BUYER', { compatibility: 'COMPATIBLE' }));
  assert.equal(direct.role, 'BUY_SEEKER');
  assert.ok(shown(direct));
});

test('Georgian in Latin letters: the model can make a buyer the rules cannot read', () => {
  const rule = classifyDemand('vyidulob 3 otaxian binas krwanisshi');
  assert.notEqual(rule.role, 'BUY_SEEKER', 'the rules do not read transliteration');
  const r = applyAiVerdict(rule, v('DIRECT_BUYER'));
  assert.equal(r.role, 'BUY_SEEKER');
  assert.ok(shown(r));
});

test('uncertain is never shown, never Strong; a contradiction or a low-confidence role is never Strong', () => {
  const rule = classifyDemand('ვყიდულობ 3 ოთახიან ბინას კრწანისში, ბიუჯეტი 210 000$');
  assert.equal(shown(applyAiVerdict(rule, v('UNCERTAIN'))), null);
  assert.equal(shown(applyAiVerdict(rule, v('DIRECT_BUYER', { confidence: MIN_ROLE_CONFIDENCE - 0.1 }))), null);
  const contra = shown(applyAiVerdict(rule, v('DIRECT_BUYER', { compatibility: 'INCOMPATIBLE', contradictions: ['wants Batumi'] })));
  assert.ok(!contra || contra.category !== 'STRONG');
  const unsure = shown(applyAiVerdict(rule, v('DIRECT_BUYER', { confidence: 0.7 })));
  assert.ok(!unsure || unsure.category !== 'STRONG');
});

test('AI failure: a rule seeker becomes UNVERIFIED and is never shown; a rule rejection stays one', () => {
  const buyer = applyAiVerdict(classifyDemand('ვყიდულობ 3 ოთახიან ბინას კრწანისში'), null);
  assert.equal(buyer.role, 'UNCLEAR');
  assert.ok(buyer.evidence.includes('ai_unverified'));
  assert.equal(shown(buyer), null);
  const seller = applyAiVerdict(classifyDemand('იყიდება 3 ოთახიანი ბინა კრწანისში'), null);
  assert.equal(seller.role, 'SALE_OFFER');
});

test('the structured-output schema carries every required field and only the eight roles', () => {
  const item = AI_CLASSIFY_SCHEMA.schema.properties.items.items;
  assert.deepEqual(item.properties.role.enum, [...AI_ROLES]);
  assert.equal(AI_ROLES.length, 8);
  for (const f of ['role', 'confidence', 'transaction', 'compatibility', 'budget', 'location', 'contradictions', 'evidence', 'reason']) assert.ok(item.required.includes(f), f);
  assert.equal(parseAiVerdict({ role: 'SOMETHING_ELSE', confidence: 7 }).role, 'UNCERTAIN');
  assert.equal(parseAiVerdict({ role: 'DIRECT_BUYER', confidence: 7 }).confidence, 1);
});

test('jsonb-safe text: never half an emoji, never a lone surrogate (replay of 343cfc41)', async () => {
  const { safeText } = await import('../findBuyers/aiClassifier.ts');
  const t = `${'a'.repeat(159)}🏡 house`;
  assert.equal(t.slice(0, 160).length, 160);
  assert.match(t.slice(0, 160), /[\uD800-\uDBFF]$/, 'the old cut ends mid-emoji');
  const safe = safeText(t, 160);
  assert.doesNotMatch(safe, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  assert.ok(safe.endsWith('🏡'));
  assert.equal(safeText('x\uD83C', 10), 'x');
  const v = parseAiVerdict({ role: 'DIRECT_BUYER', confidence: 0.9, reason: 'r'.repeat(199) + '🏡🏡', evidence: ['🏡'.repeat(200)] });
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(v)));
  assert.doesNotMatch(v.reason + v.evidence.join(''), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});
