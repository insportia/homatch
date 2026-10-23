// Email designer (owner brief §5, §7): the document is data, the server renders it, nothing a
// browser writes reaches a recipient as markup; every template renders and is caught unfilled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneBlock, createBlock, normalizeDoc } from '../designer/document.ts';
import { DESIGN_MARKER, inlineMarkup, readDesignMarker, renderDesignBody } from '../designer/render.ts';
import { builtInTemplate, TEMPLATE_KINDS, templateSubject, unfilledPlaceholders } from '../designer/templates.ts';
import { renderCampaignEmail } from '../campaignTemplate.ts';
import { assessCampaign } from '../risk/engine.ts';

test('normalizeDoc drops unknown blocks, bounds every value, refuses unsafe URLs and colours', () => {
  const d = normalizeDoc({
    theme: { canvas: 'red', width: 9999, fontFamily: 'Comic Sans' },
    blocks: [
      { type: 'script', text: 'alert(1)' },
      { type: 'heading', text: 'Hi', level: 7, color: 'expression(alert(1))', fontSize: 500 },
      { type: 'image', src: 'javascript:alert(1)', href: 'data:text/html,x', width: 5000 },
      { type: 'image', src: 'http://insecure.example.com/a.jpg' },
      { type: 'button', label: 'Go', href: 'https://example.com', buttonColor: '#zzzzzz' },
      { type: 'text', text: 'x'.repeat(9000) },
      { type: 'columns', columns: [[{ type: 'columns' }, { type: 'text', text: 'a' }], [{ type: 'button', label: 'b', href: 'vbscript:x' }]] },
    ],
  });
  assert.equal(d.theme.canvas, '#F6F3EE');
  assert.equal(d.theme.width, 680);
  assert.equal(d.theme.fontFamily, 'system');
  assert.deepEqual(d.blocks.map((b) => b.type), ['heading', 'image', 'image', 'button', 'text', 'columns']);
  assert.equal(d.blocks[0].level, 1); assert.equal(d.blocks[0].color, null); assert.equal(d.blocks[0].fontSize, 48);
  assert.equal(d.blocks[1].src, ''); assert.equal(d.blocks[1].href, null); assert.equal(d.blocks[1].width, 600);
  assert.equal(d.blocks[2].src, '', 'images must be https');
  assert.equal(d.blocks[3].buttonColor, '#C9973A');
  assert.equal(d.blocks[4].text.length, 5000);
  assert.deepEqual(d.blocks[5].columns[0].map((b) => b.type), ['text'], 'no nested columns');
  assert.equal(d.blocks[5].columns[1][0].href, '');
  assert.equal(normalizeDoc({ blocks: Array.from({ length: 200 }, () => ({ type: 'spacer' })) }).blocks.length, 60);
});

test('rendering escapes everything: no tag, attribute or script survives from text', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>" onmouseover="x';
  const { html } = renderDesignBody({ blocks: [
    { type: 'heading', text: evil }, { type: 'text', text: evil }, { type: 'button', label: evil, href: 'https://a.example' },
    { type: 'footer', text: evil }, { type: 'contact', name: evil, email: 'not-an-email', phone: 'call me' },
  ] });
  assert.doesNotMatch(html, /<script|<img src=x|"\s*onmouseover=/i, 'no real tag and no attribute breakout');
  assert.doesNotMatch(html, /<[^>]*\sonerror=/i, 'no handler inside a real tag');
  assert.match(html, /&lt;script&gt;/);
  const risk = assessCampaign({ subject: 'Apartment in Vake', html, senderVerified: true, senderEmail: 'a@homatch.live' });
  assert.ok(!risk.findings.some((f) => f.code === 'HTML_ACTIVE_CONTENT'), 'the renderer output is never active content');
});

test('inline markup: bold, italic, https links only, newlines', () => {
  assert.equal(inlineMarkup('**a** *b*', '#000'), '<strong>a</strong> <em>b</em>');
  assert.match(inlineMarkup('[site](https://homatch.live)', '#123456'), /<a href="https:\/\/homatch.live" target="_blank" style="color:#123456/);
  assert.doesNotMatch(inlineMarkup('[x](javascript:alert(1))', '#000'), /<a /);
  assert.doesNotMatch(inlineMarkup('[x](http://a.example)', '#000'), /<a /);
  assert.equal(inlineMarkup('a\nb', '#000'), 'a<br />b');
});

test('the designed body is one table with a marker; the campaign shell keeps the compliance footer', () => {
  const doc = builtInTemplate('ANNOUNCEMENT', 'en');
  doc.blocks.push(createBlock('unsubscribe'));
  const body = renderDesignBody(doc);
  assert.ok(body.html.startsWith(DESIGN_MARKER));
  assert.deepEqual(readDesignMarker(body.html), { canvas: '#EFEAE2', card: '#FFFFFF', width: 600, radius: 14 });
  const email = renderCampaignEmail({ subject: 'S', bodyHtml: body.html, bodyText: body.text, lang: 'ka', senderName: 'Nino', unsubscribeUrl: 'https://x.example/unsub?c=1&t=2' });
  assert.match(email.html, /background-color:#EFEAE2/);
  assert.match(email.html, /max-width:600px/);
  assert.doesNotMatch(email.html, /letter-spacing:3px;color:#E8A33D;">HOMATCH/, 'no standard header bar on a designed email');
  assert.match(email.html, /გამოწერის გაუქმება/, 'the localized unsubscribe footer is always there');
  assert.doesNotMatch(email.html, /\{\{\s*unsubscribe_url\s*\}\}/, 'the designer unsubscribe block got the real link');
  assert.match(email.html, /<head>[\s\S]*@media only screen[\s\S]*<\/head>/, 'mobile CSS moved into head');
  assert.match(email.text, /unsub\?c=1&t=2/);
  /* RTL */
  const he = renderCampaignEmail({ subject: 'S', bodyHtml: renderDesignBody(doc, { rtl: true }).html, lang: 'he', unsubscribeUrl: 'https://x.example/u' });
  assert.match(he.html, /dir="rtl"/);
});

test('every built-in template renders in en/ka/ru and is refused while unfilled', () => {
  for (const kind of TEMPLATE_KINDS) {
    for (const lang of ['en', 'ka', 'ru', 'tr']) {
      const doc = builtInTemplate(kind, lang);
      const { html, text } = renderDesignBody(doc);
      assert.ok(html.length > 500, `${kind}/${lang}`);
      assert.ok(unfilledPlaceholders(text).length > 0, `${kind}/${lang} has placeholders`);
      assert.ok(templateSubject(kind, lang));
      const risk = assessCampaign({ subject: templateSubject(kind, lang), html, text, senderVerified: true, senderEmail: 'a@homatch.live' });
      assert.ok(risk.findings.some((f) => f.code === 'TEMPLATE_PLACEHOLDER'), `${kind}/${lang} unfilled is caught`);
    }
  }
  assert.deepEqual(unfilledPlaceholders('[label](https://a.example) {{first_name|x}} [Price]'), ['Price']);
});

test('columns stack on mobile; hide-on-mobile and duplicate', () => {
  const cols = createBlock('columns');
  const { html } = renderDesignBody({ blocks: [cols, { ...createBlock('text'), text: 'mobile only', hideOnDesktop: true }, { ...createBlock('text'), text: 'desktop only', hideOnMobile: true }] });
  assert.match(html, /class="hm-col"/);
  assert.match(html, /hm-hide-mobile/);
  assert.match(html, /hm-hide-desktop/);
  const copy = cloneBlock(cols);
  assert.notEqual(copy.id, cols.id);
  assert.notEqual(copy.columns[0][0].id, cols.columns[0][0].id);
});
