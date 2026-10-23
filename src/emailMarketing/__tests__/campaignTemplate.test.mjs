// The campaign email template: safe with owner text, every email carries its unsubscribe
// link, the markup stays inside what Gmail and Outlook render, and RTL languages flip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asCampaignLang, renderCampaignEmail, safeHref } from '../campaignTemplate.ts';

const UNSUB = 'https://ptx.supabase.co/functions/v1/outreach-unsubscribe?contact=c1&token=abc';

test('owner text is escaped and paragraphs become paragraphs', () => {
  const { html, text } = renderCampaignEmail({
    subject: 'New homes <b>now</b>', bodyText: 'Hello <script>alert(1)</script>\n\nSecond paragraph\nline two', unsubscribeUrl: UNSUB,
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('New homes &lt;b&gt;now&lt;/b&gt;'));
  assert.equal((html.match(/<p style="margin:0 0 16px 0/g) ?? []).length, 2);
  assert.ok(html.includes('Second paragraph<br />line two'));
  assert.ok(text.includes('Hello <script>alert(1)</script>'), 'the plain-text part keeps the words');
});

test('every email carries the unsubscribe link, in HTML and in text', () => {
  const { html, text } = renderCampaignEmail({ subject: 's', bodyText: 'b', unsubscribeUrl: UNSUB });
  assert.ok(html.includes(`href="${UNSUB.replace(/&/g, '&amp;')}"`));
  assert.ok(text.includes(UNSUB));
  assert.match(html, />Unsubscribe</);
});

test('markup stays inside what mail clients render', () => {
  const { html } = renderCampaignEmail({ subject: 's', bodyText: 'b', unsubscribeUrl: UNSUB, cta: { label: 'View homes', url: 'https://www.homatch.live/x' } });
  assert.doesNotMatch(html, /<style/i, 'no <style> block');
  assert.doesNotMatch(html, /display:\s*(flex|grid)/i, 'no flex or grid');
  assert.doesNotMatch(html, /<img|@import|url\(/i, 'no images or remote CSS');
  assert.match(html, /role="presentation"/);
  assert.match(html, /bgcolor="#E8A33D"/, 'bulletproof (table) button');
});

test('only http(s) and mailto links are allowed', () => {
  assert.equal(safeHref('javascript:alert(1)'), '#');
  assert.equal(safeHref('data:text/html,x'), '#');
  assert.equal(safeHref('https://a.test/?x=1&y=2'), 'https://a.test/?x=1&amp;y=2');
  const { html } = renderCampaignEmail({ subject: 's', bodyText: 'b', unsubscribeUrl: UNSUB, cta: { label: 'Go', url: 'javascript:alert(1)' } });
  assert.ok(!html.includes('javascript:'), 'an unsafe button is dropped');
});

test('Arabic and Hebrew render right-to-left; the footer speaks the campaign language', () => {
  const ar = renderCampaignEmail({ subject: 'عرض', bodyText: 'مرحبا', lang: 'ar', unsubscribeUrl: UNSUB }).html;
  assert.match(ar, /<html lang="ar" dir="rtl">/);
  assert.match(ar, /text-align:right/);
  assert.match(ar, /إلغاء الاشتراك/);
  const ka = renderCampaignEmail({ subject: 'შეთავაზება', bodyText: 'გამარჯობა', lang: 'ka', senderName: 'ვაკე', unsubscribeUrl: UNSUB }).html;
  assert.match(ka, /dir="ltr"/);
  assert.match(ka, /გამოწერის გაუქმება/);
  assert.match(ka, /გამომგზავნი: ვაკე/);
  assert.equal(asCampaignLang('fr'), 'en');
  assert.equal(asCampaignLang('he-IL'), 'he');
});
