// Email designer, UX pass (2026-10-24): rich text with links on a selected word, the CTA button
// builder, the new layout blocks, and ten templates that are genuinely different compositions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock, normalizeDoc } from '../designer/document.ts';
import { renderDesignBody } from '../designer/render.ts';
import { richToEmailHtml, richToText, sanitizeRich, textToRich } from '../designer/richText.ts';
import { builtInTemplate, TEMPLATE_KINDS } from '../designer/templates.ts';
import { assessCampaign } from '../risk/engine.ts';

test('rich text keeps only the safe subset, whatever the editor or a request sends', () => {
  const evil = '<p onclick="x()">Hi <b>there</b> <a href="javascript:alert(1)">bad</a> <a href="https://homatch.live/x?a=1&amp;b=2" onmouseover="y">good</a></p>'
    + '<script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)><iframe src="https://e.example"></iframe>'
    + '<span style="color: rgb(201, 151, 58); font-weight: bold; background:url(x)">gold</span><font color="#abc">f</font>';
  const s = sanitizeRich(evil);
  assert.doesNotMatch(s, /<script|<style|<img|<iframe|onclick|onmouseover|onerror|javascript:|background/i);
  assert.match(s, /^Hi <strong>there<\/strong> bad <a href="https:\/\/homatch\.live\/x\?a=1&amp;b=2">good<\/a>/);
  assert.match(s, /<strong><span style="color:#C9973A">gold<\/span><\/strong>/);
  assert.match(s, /<span style="color:#AABBCC">f<\/span>/);
  assert.equal(sanitizeRich(s), s, 'idempotent');
});

test('rich text: paragraphs become breaks, lists survive, nesting is balanced, links never nest', () => {
  assert.equal(sanitizeRich('line1<div>line2</div><div><br></div><div>line3</div>'), 'line1<br>line2<br><br>line3');
  assert.equal(sanitizeRich('<ul><li>a</li><li><b>b</b></li></ul>'), '<ul><li>a</li><li><strong>b</strong></li></ul>');
  assert.equal(sanitizeRich('<b><i>x</b>y</i>'), '<strong><em>x</em></strong>y');
  assert.equal(sanitizeRich('<a href="https://a.example"><a href="https://b.example">x</a></a>'), '<a href="https://a.example">x</a>');
  assert.equal(sanitizeRich('<li>stray</li>'), 'stray');
  assert.equal(sanitizeRich('<a href="{{ unsubscribe_url }}">u</a>'), '<a href="{{unsubscribe_url}}">u</a>');
  assert.equal(sanitizeRich('<a href="mailto:a@b.example">m</a> <a href="tel:+995 555">t</a>'), '<a href="mailto:a@b.example">m</a> <a href="tel:+995 555">t</a>');
  assert.equal(sanitizeRich('<a href="http://insecure.example">x</a>'), 'x');
  assert.equal(textToRich('a < b\nc'), 'a &lt; b<br>c');
  assert.equal(richToText('Visit <a href="https://a.example">our site</a><br><ul><li>one</li></ul>'), 'Visit our site (https://a.example)\n• one');
});

test('a link on one selected word renders with mail-client styles, the rest of the sentence untouched', () => {
  const doc = normalizeDoc({ blocks: [{ type: 'text', text: '', rich: 'Book a <a href="https://homatch.live/v">viewing</a> today, <strong>{{first_name|friend}}</strong>.' }] });
  const { html, text } = renderDesignBody(doc);
  assert.match(html, /Book a <a target="_blank" style="color:#8A6420;text-decoration:underline;" href="https:\/\/homatch\.live\/v">viewing<\/a> today, <strong>\{\{first_name\|friend\}\}<\/strong>\./);
  assert.match(text, /Book a viewing \(https:\/\/homatch\.live\/v\) today/);
  assert.match(richToEmailHtml('<ul><li>x</li></ul>', '#000'), /<ul style="margin:6px 0;/);
  /* An empty rich value falls back to the plain text, never to nothing. */
  assert.equal(normalizeDoc({ blocks: [{ type: 'text', text: 'plain', rich: '<script></script>' }] }).blocks[0].rich, null);
});

test('CTA builder: sizes, padding, outline, hover, Outlook padding, colours validated', () => {
  const b = normalizeDoc({ blocks: [{ type: 'button', id: 'cta1', label: 'Go', href: 'https://a.example', size: 'lg', strokeWidth: 2, strokeColor: '#112233', hoverColor: '#445566', radius: 99, paddingX: 500 }] }).blocks[0];
  assert.equal(b.size, 'lg'); assert.equal(b.radius, 40); assert.equal(b.paddingX, 64);
  const { html } = renderDesignBody({ blocks: [b] });
  assert.match(html, /padding:18px 64px/);
  assert.match(html, /mso-padding-alt:18px 64px/);
  assert.match(html, /border:2px solid #112233/);
  assert.match(html, /td\.hm-btn-cta1:hover,a\.hm-btn-cta1:hover\{background-color:#445566!important;\}/);
  assert.equal(normalizeDoc({ blocks: [{ type: 'button', label: 'x', href: 'https://a.example', hoverColor: 'red;}body{x' }] }).blocks[0].hoverColor, null);
  assert.equal(renderDesignBody({ blocks: [{ type: 'button', label: 'x', href: '' }] }).html.includes('<a href'), false, 'no link, no button');
});

test('banner, card, header and facts render as tables with escaped text and https-only images', () => {
  const doc = normalizeDoc({ blocks: [
    { ...createBlock('banner'), title: '<b>T</b>', buttonLabel: 'Go', buttonHref: 'https://a.example', imageSrc: 'http://x.example/a.jpg' },
    { ...createBlock('card'), title: 'Card', text: 'Body', layout: 'side', imageSrc: 'https://img.example/a.jpg', buttonLabel: 'More', buttonHref: 'https://a.example' },
    { ...createBlock('header'), brand: 'ACME', tagline: 'Homes', logoSrc: 'https://img.example/logo.png' },
    { ...createBlock('facts'), items: [{ label: 'Price', value: '$1' }, { label: '', value: '' }, { label: 'Area', value: '90 m²' }] },
  ] });
  assert.equal(doc.blocks[0].imageSrc, '', 'banner image must be https');
  assert.equal(doc.blocks[3].items.length, 2, 'empty facts are dropped');
  const { html, text } = renderDesignBody(doc);
  assert.match(html, /&lt;b&gt;T&lt;\/b&gt;/);
  assert.match(html, /class="hm-col"/, 'side card stacks on mobile');
  assert.match(html, /<img src="https:\/\/img\.example\/logo\.png"/);
  assert.match(text, /Price: \$1\nArea: 90 m²/);
  assert.match(text, /More: https:\/\/a\.example/);
});

test('ten templates, ten different compositions — not one layout recoloured', () => {
  assert.equal(TEMPLATE_KINDS.length, 10);
  const sig = (kind) => builtInTemplate(kind, 'en').blocks.map((b) => b.type).join('>');
  const sigs = TEMPLATE_KINDS.map(sig);
  assert.equal(new Set(sigs).size, 10, 'every block structure is unique');
  const themes = TEMPLATE_KINDS.map((k) => { const t = builtInTemplate(k, 'en').theme; return `${t.canvas}/${t.accent}/${t.fontFamily}`; });
  assert.equal(new Set(themes).size, 10, 'every palette/type pairing is unique');
  /* Pairwise: no two templates share more than 60% of their block sequence. */
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      const a = sigs[i].split('>'), b = sigs[j].split('>');
      const same = a.filter((x, k) => b[k] === x).length;
      assert.ok(same / Math.max(a.length, b.length) <= 0.6, `${TEMPLATE_KINDS[i]} vs ${TEMPLATE_KINDS[j]}`);
    }
  }
  assert.equal(builtInTemplate('LUXURY', 'ka').meta.template, 'LUXURY', 'the starting template is remembered');
});

test('templates never claim HOMATCH as the sender and trip no pressure, finance or phishing rule once filled', () => {
  for (const kind of TEMPLATE_KINDS) {
    for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
      const { html, text } = renderDesignBody(builtInTemplate(kind, lang));
      assert.doesNotMatch(`${html.replace('<!--homatch-designer:v1', '')}${text}`, /homatch/i, `${kind}/${lang}`);
      const filled = text.replace(/\[[^\]\n]{2,160}\](?!\()/g, 'X');
      const risk = assessCampaign({ subject: 'Hello', html: html.replace(/\[[^\]\n]{2,160}\](?!\()/g, 'X'), text: filled, senderVerified: true, senderEmail: 'a@agency.example' });
      const bad = risk.findings.filter((f) => ['SPAM_PRESSURE', 'MISLEADING_FINANCIAL_CLAIM', 'PHISHING_CREDENTIALS', 'IMPERSONATION_AUTHORITY', 'HTML_ACTIVE_CONTENT'].includes(f.code) || f.severity === 'BLOCK');
      assert.deepEqual(bad, [], `${kind}/${lang}`);
    }
  }
});
