// Email Studio's design document crosses trust boundaries (model replies,
// saved drafts, the editor's contentEditable). The sanitiser and renderer are
// the one place that decides what reaches a recipient; these lock it down.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMergeFields, designProblems, renderEmailHtml, renderEmailText, safeHref, safeImageSrc,
  sanitizeDesign, sanitizeInline,
} from '../../communication/emailDesign.ts';

test('inline rich text keeps only the allowlist and closes what it opens', () => {
  assert.equal(sanitizeInline('<b>bold</b> <script>alert(1)</script>x'), '<b>bold</b> alert(1)x');
  assert.equal(sanitizeInline('<i>open'), '<i>open</i>');
  assert.equal(sanitizeInline('<div>a</div><div>b</div>'), 'a<br>b');
  assert.equal(sanitizeInline('<a href="javascript:alert(1)">x</a>'), 'x');
  assert.equal(sanitizeInline('<a href="https://homatch.live/p" onclick="x()">go</a>'), '<a href="https://homatch.live/p">go</a>');
  assert.equal(sanitizeInline('<img src=x onerror=alert(1)>hi'), 'hi');
  assert.equal(sanitizeInline('a < b & c'), 'a &lt; b &amp; c');
});

test('links and images accept only safe schemes', () => {
  assert.equal(safeImageSrc('http://x.test/a.jpg'), '');
  assert.equal(safeImageSrc('data:image/png;base64,AAA'), '');
  assert.match(safeImageSrc('https://cdn.test/a.jpg'), /^https:\/\//);
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('mailto:owner@example.com'), 'mailto:owner@example.com');
  assert.equal(safeHref('tel:+995 555 12 34'), 'tel:+995 555 12 34');
});

test('unknown blocks are dropped, numbers clamped, ids made unique', () => {
  const d = sanitizeDesign({
    theme: { accent: 'red', background: '#000000' },
    blocks: [
      { id: 'a', type: 'image', src: 'https://cdn.test/a.jpg', width: 999, align: 'nowhere' },
      { id: 'a', type: 'text', html: '<b>x</b>' },
      { type: 'iframe', src: 'https://evil.test' },
      { type: 'spacer', size: -5 },
    ],
  });
  assert.equal(d.blocks.length, 3);
  assert.equal(d.blocks[0].width, 100);
  assert.equal(d.blocks[0].align, 'left');
  assert.notEqual(d.blocks[0].id, d.blocks[1].id);
  assert.equal(d.blocks[2].size, 8);
  assert.equal(d.theme.accent, '#C9962B');
  assert.equal(d.theme.background, '#000000');
});

test('rendered HTML escapes every text field and never emits a script', () => {
  const html = renderEmailHtml(sanitizeDesign({ blocks: [
    { type: 'heading', text: '<script>x</script>' },
    { type: 'button', label: '"><img>', href: 'https://homatch.live' },
    { type: 'footer', text: '<b>f</b>' },
  ] }), { subject: 'S', dir: 'rtl', lang: 'he' });
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('dir="rtl"'));
  assert.ok(!html.includes('"><img>'));
});

test('plain-text alternative carries the words and the button link', () => {
  const text = renderEmailText(sanitizeDesign({ blocks: [
    { type: 'heading', text: 'Flat in Vake' },
    { type: 'text', html: 'Hello <b>there</b><br>line 2' },
    { type: 'button', label: 'View', href: 'https://homatch.live/x' },
  ] }));
  assert.equal(text, 'Flat in Vake\n\nHello there\nline 2\n\nView: https://homatch.live/x');
});

test('merge fields fill per recipient, fall back, and escape in HTML', () => {
  assert.equal(applyMergeFields('Hi {{first_name|there}}!', 'Nino Beridze', false), 'Hi Nino!');
  assert.equal(applyMergeFields('Hi {{name|there}}!', null, false), 'Hi there!');
  assert.equal(applyMergeFields('Hi {{first_name|}}', '', false), 'Hi ');
  assert.equal(applyMergeFields('{{name}}', '<b>x</b>', true), '&lt;b&gt;x&lt;/b&gt;');
});

test('send blockers are reported before a confirmation is offered', () => {
  const d = sanitizeDesign({ blocks: [{ type: 'image', src: '' }, { type: 'button', label: 'Go', href: '' }] });
  assert.deepEqual(designProblems(d, ''), ['NO_SUBJECT', 'NO_CONTENT', 'IMAGE_WITHOUT_SOURCE', 'BUTTON_INCOMPLETE']);
  const ok = sanitizeDesign({ blocks: [{ type: 'text', html: 'Hello' }] });
  assert.deepEqual(designProblems(ok, 'Subject'), []);
});
