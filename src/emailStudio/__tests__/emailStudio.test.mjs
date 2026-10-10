// Email Studio — the pure modules the edge renderer and the editor share.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultContent, normalizeContent, switchTemplate, moveBlock, reorderBlock, removeBlock, addBlock,
  createBlock, applyDraftCopy, LIMITS,
} from '../blocks.ts';
import { renderEmail, escapeHtml, safeUrl } from '../render.ts';
import { TEMPLATE_COPY, TEMPLATE_IDS, EMAIL_LANGS, templateAvailability } from '../templates.ts';
import { eligibilityReason, parseEligibility, reasonKey, ELIGIBILITY_REASONS } from '../eligibility.ts';
import { checkDraft, DRAFT_SYSTEM_PROMPT } from '../copyGuard.ts';

const PROPERTY = {
  title: 'Krtsanisi 2BR', homatchId: 100001, transactionType: 'SALE', propertyType: 'APARTMENT',
  city: 'Tbilisi', district: 'Krtsanisi', address: null, price: 185000, currency: 'USD',
  area: 84, rooms: 3, bedrooms: 2, bathrooms: 1, floor: 7, totalFloors: 12,
  images: ['https://cdn.homatch.live/p/1.jpg', 'https://cdn.homatch.live/p/2.jpg'],
};
const BASE = {
  templateId: 'PROPERTY_INTRODUCTION', lang: 'en', property: PROPERTY,
  listingUrl: 'https://homatch.live/property/100001', senderName: 'Nino via HOMATCH',
  unsubscribeUrl: 'https://x.supabase.co/functions/v1/email-webhook?esu=abc&t=def',
};

test('every template has approved copy in all six languages', () => {
  for (const id of TEMPLATE_IDS) for (const lang of EMAIL_LANGS) {
    const c = TEMPLATE_COPY[id][lang];
    assert.ok(c.headline && c.body && c.cta, `${id}/${lang}`);
  }
  assert.equal(TEMPLATE_COPY.PROPERTY_INTRODUCTION.en.headline, 'A Property Worth Exploring');
  assert.equal(TEMPLATE_COPY.PERSONAL_FOLLOW_UP.en.cta, 'Let’s Connect');
});

test('render escapes every piece of owner text', () => {
  const content = defaultContent('PROPERTY_INTRODUCTION', 'en');
  content.subject = '<script>alert(1)</script>';
  content.blocks = content.blocks.map((b) => b.type === 'headline' ? { ...b, text: '<img src=x onerror=alert(1)>"&' } : b);
  const out = renderEmail({ ...BASE, content });
  assert.ok(!out.html.includes('<script>alert(1)'), 'subject escaped');
  assert.ok(!out.html.includes('<img src=x'), 'headline escaped');
  assert.ok(out.html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;'));
  assert.equal(escapeHtml(`<a href="x">'`), '&lt;a href=&quot;x&quot;&gt;&#39;');
});

test('a real send always carries the unsubscribe link; without one it refuses', () => {
  const content = defaultContent('MODERN_RESIDENCE', 'en');
  const out = renderEmail({ ...BASE, templateId: 'MODERN_RESIDENCE', content });
  assert.ok(out.html.includes('href="https://x.supabase.co/functions/v1/email-webhook?esu=abc&amp;t=def"'));
  assert.ok(out.text.includes('https://x.supabase.co/functions/v1/email-webhook?esu=abc&t=def'));
  // even when the owner's content tries to drop it
  const stripped = { ...content, blocks: content.blocks.filter((b) => b.type !== 'unsubscribe' && b.type !== 'footer') };
  assert.ok(renderEmail({ ...BASE, content: stripped }).html.includes('esu=abc'), 'locked block re-added');
  assert.throws(() => renderEmail({ ...BASE, content, unsubscribeUrl: null }), /UNSUBSCRIBE_URL_REQUIRED/);
  assert.throws(() => renderEmail({ ...BASE, content, unsubscribeUrl: 'javascript:alert(1)' }), /UNSUBSCRIBE_URL_REQUIRED/);
  const preview = renderEmail({ ...BASE, content, unsubscribeUrl: null, preview: true });
  assert.ok(preview.html.includes('Unsubscribe link (added to every email)'), 'preview placeholder');
});

test('RTL languages render right-to-left', () => {
  for (const lang of ['ar', 'he']) {
    const out = renderEmail({ ...BASE, lang, content: defaultContent('PROPERTY_INTRODUCTION', lang) });
    assert.match(out.html, /<html lang="(ar|he)" dir="rtl"/);
    assert.ok(out.html.includes('text-align:right'));
    assert.ok(out.html.includes(TEMPLATE_COPY.PROPERTY_INTRODUCTION[lang].headline));
  }
  const ka = renderEmail({ ...BASE, lang: 'ka', content: defaultContent('PROPERTY_INTRODUCTION', 'ka') });
  assert.match(ka.html, /dir="ltr"/);
});

test('only the listing’s real photos appear — never a fabricated image', () => {
  const content = defaultContent('PROPERTY_INTRODUCTION', 'en');
  content.blocks = content.blocks.map((b) => (b.type === 'gallery' ? { ...b, images: [1, 5, 9] } : b));
  const out = renderEmail({ ...BASE, content });
  const srcs = [...out.html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  for (const s of srcs) assert.ok(PROPERTY.images.includes(s), `unexpected image ${s}`);
  assert.equal(out.droppedImages, 2, 'indexes 5 and 9 dropped');
  const none = renderEmail({ ...BASE, content, property: { ...PROPERTY, images: [] } });
  assert.ok(!/<img /.test(none.html), 'no photos → no img tags at all');
  const bad = renderEmail({ ...BASE, content, property: { ...PROPERTY, images: ['javascript:alert(1)', 'data:image/png;base64,AA'] } });
  assert.ok(!/<img /.test(bad.html), 'non-http image addresses are dropped');
  assert.equal(safeUrl('ftp://x'), null);
});

test('facts come from the property only; empty facts render nothing', () => {
  const content = defaultContent('PROPERTY_INTRODUCTION', 'en');
  const out = renderEmail({ ...BASE, content });
  assert.ok(out.html.includes('$185,000'), 'price formatted');
  assert.ok(out.html.includes('84 m²') && out.html.includes('7 / 12'));
  assert.ok(out.html.includes('Krtsanisi, Tbilisi'));
  const bare = renderEmail({ ...BASE, content, property: { ...PROPERTY, price: null, area: null, rooms: null, bedrooms: null, bathrooms: null, floor: null, city: null, district: null } });
  assert.ok(!bare.html.includes('Property details') && !bare.html.includes('Location'), 'no empty spec/location sections');
  const rent = renderEmail({ ...BASE, content, property: { ...PROPERTY, transactionType: 'RENT', price: 900 } });
  assert.ok(rent.html.includes('For rent') && rent.html.includes('/ month'));
});

test('email-safe structure: tables, inline styles, 600px max width, CTA to the listing only', () => {
  const out = renderEmail({ ...BASE, content: defaultContent('PREMIUM_PROPERTY', 'en'), templateId: 'PREMIUM_PROPERTY' });
  assert.ok(out.html.includes('max-width:600px'));
  assert.ok(out.html.includes('role="presentation"'));
  assert.ok(!/<link /.test(out.html) && !/<script/.test(out.html));
  const links = [...out.html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  for (const l of links) assert.ok(l === BASE.listingUrl || l === BASE.unsubscribeUrl, `unexpected link ${l}`);
});

test('template switching keeps the owner’s content and photo choices', () => {
  const content = defaultContent('PROPERTY_INTRODUCTION', 'en');
  content.blocks = content.blocks.map((b) => {
    if (b.type === 'text') return { ...b, text: 'My own words about the flat.' };
    if (b.type === 'hero') return { ...b, image: 1 };
    return b;
  });
  const next = switchTemplate(content, 'PROPERTY_INTRODUCTION', 'MODERN_RESIDENCE', 'en');
  assert.deepEqual(next.blocks.map((b) => b.id), content.blocks.map((b) => b.id), 'order and blocks preserved');
  assert.equal(next.blocks.find((b) => b.type === 'text').text, 'My own words about the flat.', 'edited text kept');
  assert.equal(next.blocks.find((b) => b.type === 'hero').image, 1, 'photo choice kept');
  assert.equal(next.blocks.find((b) => b.type === 'headline').text, 'Discover Your Next Home', 'untouched default swapped');
  assert.equal(next.subject, 'Discover Your Next Home');
  const back = switchTemplate(next, 'MODERN_RESIDENCE', 'PROPERTY_INTRODUCTION', 'en');
  assert.equal(back.blocks.find((b) => b.type === 'headline').text, 'A Property Worth Exploring');
});

test('block editing: move, reorder, add, remove — footer/unsubscribe stay locked last', () => {
  let c = normalizeContent(defaultContent('PERSONAL_FOLLOW_UP', 'en'));
  const n = c.blocks.length;
  assert.deepEqual(c.blocks.slice(-2).map((b) => b.type), ['footer', 'unsubscribe']);
  const moved = moveBlock(c.blocks, 0, 1);
  assert.equal(moved[1].type, 'headline');
  assert.equal(moveBlock(c.blocks, n - 3, 1), c.blocks, 'cannot move into the footer');
  assert.equal(moveBlock(c.blocks, n - 2, -1), c.blocks, 'footer never moves');
  const dragged = reorderBlock(c.blocks, 0, n - 1);
  assert.deepEqual(dragged.slice(-3).map((b) => b.type), ['headline', 'footer', 'unsubscribe'], 'drag clamps before footer');
  const added = addBlock(c.blocks, createBlock('divider', 'b-new', 'PERSONAL_FOLLOW_UP', 'en'));
  assert.equal(added[added.length - 3].id, 'b-new');
  assert.equal(removeBlock(added, 'b-new').length, n);
  assert.equal(removeBlock(c.blocks, 'b-footer').length, n, 'footer cannot be removed');
  const many = { blocks: Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, type: 'text', text: 'x'.repeat(5000) })) };
  c = normalizeContent(many);
  assert.equal(c.blocks.length, LIMITS.blocks + 2);
  assert.equal(c.blocks[0].text.length, LIMITS.text);
  const junk = normalizeContent({ subject: 'a\r\nBcc: x@y', blocks: [{ type: 'iframe' }, { type: 'hero', image: -1 }, null] });
  assert.equal(junk.subject, 'a Bcc: x@y', 'no header injection via newlines');
  assert.deepEqual(junk.blocks.map((b) => b.type), ['hero', 'footer', 'unsubscribe']);
  assert.equal(junk.blocks[0].image, undefined);
});

test('AI draft copy lands in the first headline/text/cta', () => {
  const c = applyDraftCopy(defaultContent('PROPERTY_INTRODUCTION', 'en'), { headline: 'H', body: 'B', cta: 'C', subject: 'S' });
  assert.equal(c.subject, 'S');
  assert.equal(c.blocks.find((b) => b.type === 'headline').text, 'H');
  assert.equal(c.blocks.find((b) => b.type === 'cta').text, 'C');
});

test('premium template is offered only for a PREMIUM-segment listing', () => {
  assert.equal(templateAvailability('PREMIUM_PROPERTY', 'MIDDLE').available, false);
  assert.equal(templateAvailability('PREMIUM_PROPERTY', null).available, false);
  assert.equal(templateAvailability('PREMIUM_PROPERTY', 'PREMIUM').available, true);
  assert.equal(templateAvailability('MODERN_RESIDENCE', null).available, true);
});

const OK = {
  unlocked: true, suspended: false, blocked: false, acceptMarketingEmail: true, shareEmailOnUnlock: true,
  acceptPropertyOffers: true, marketingOptIn: null, email: 'lead@example.com', suppressed: false,
};

test('eligibility: explicit consent required; suppression and opt-outs exclude', () => {
  assert.equal(eligibilityReason(OK), null);
  assert.equal(eligibilityReason({ ...OK, unlocked: false }), 'NOT_UNLOCKED');
  assert.equal(eligibilityReason({ ...OK, acceptMarketingEmail: false }), 'NO_MARKETING_CONSENT', 'unlocked email alone is not consent');
  assert.equal(eligibilityReason({ ...OK, shareEmailOnUnlock: false }), 'EMAIL_NOT_SHARED');
  assert.equal(eligibilityReason({ ...OK, acceptPropertyOffers: false }), 'NOT_ACCEPTING_OFFERS');
  assert.equal(eligibilityReason({ ...OK, marketingOptIn: false }), 'MARKETING_OPT_OUT');
  assert.equal(eligibilityReason({ ...OK, marketingOptIn: true }), null);
  assert.equal(eligibilityReason({ ...OK, suppressed: true }), 'SUPPRESSED');
  assert.equal(eligibilityReason({ ...OK, blocked: true }), 'BLOCKED');
  assert.equal(eligibilityReason({ ...OK, suspended: true }), 'ACCOUNT_UNAVAILABLE');
  assert.equal(eligibilityReason({ ...OK, email: 'nope' }), 'NO_EMAIL');
  for (const r of ELIGIBILITY_REASONS) assert.notEqual(reasonKey(r), 'es_reason_eligible', r);
});

test('eligibility parse never selects an item without an unlock and carries no address', () => {
  const s = parseEligibility({ total: 2, items: [
    { unlockId: 'u1', displayName: 'Layla', eligible: true, reason: null },
    { unlockId: null, matchId: 'm', eligible: true, reason: 'NOT_UNLOCKED' },
  ], reasons: { NOT_UNLOCKED: 1 } });
  assert.equal(s.eligibleCount, 1);
  assert.equal(s.items[1].eligible, false);
  assert.ok(!('email' in s.items[0]));
});

test('AI draft guard rejects invented numbers, urgency, discounts and luxury', () => {
  const facts = { price: 185000, currency: 'USD', area: 84, bedrooms: 2, city: 'Tbilisi' };
  const good = { subject: 'A 2-bedroom flat in Tbilisi', preheader: '84 m² for 185,000 USD', headline: 'A home in Tbilisi', body: 'This 2-bedroom flat offers 84 m².', cta: 'View Property' };
  assert.ok(checkDraft(good, facts));
  assert.equal(checkDraft({ ...good, body: 'Now 10% off.' }, facts), null, 'invented number');
  assert.equal(checkDraft({ ...good, headline: 'Luxury living' }, facts), null, 'luxury');
  assert.equal(checkDraft({ ...good, body: 'Hurry, limited time.' }, facts), null, 'urgency');
  assert.equal(checkDraft({ ...good, body: 'Great flat!' }, facts), null, 'exclamation');
  assert.equal(checkDraft({ ...good, cta: '' }, facts), null, 'missing field');
  assert.equal(checkDraft('text', facts), null);
  assert.match(DRAFT_SYSTEM_PROMPT, /Never invent/);
});

test('changing the email language translates untouched default copy only', async () => {
  const { relocalizeContent } = await import('../blocks.ts');
  const c = defaultContent('MODERN_RESIDENCE', 'en');
  c.blocks = c.blocks.map((b) => (b.type === 'text' ? { ...b, text: 'Custom.' } : b));
  const ka = relocalizeContent(c, 'MODERN_RESIDENCE', 'en', 'ka');
  assert.equal(ka.blocks.find((b) => b.type === 'headline').text, TEMPLATE_COPY.MODERN_RESIDENCE.ka.headline);
  assert.equal(ka.blocks.find((b) => b.type === 'text').text, 'Custom.');
  assert.equal(ka.subject, TEMPLATE_COPY.MODERN_RESIDENCE.ka.headline);
});
