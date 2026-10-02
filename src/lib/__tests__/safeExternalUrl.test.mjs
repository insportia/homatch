// A source or profile link opens only when it is a real http(s) URL, in a new tab
// that cannot reach back into HOMATCH.
import test from 'node:test';
import assert from 'node:assert/strict';

import { openExternal, safeExternalUrl } from '../safeExternalUrl.ts';

test('safeExternalUrl accepts http(s) and refuses every other scheme', () => {
  assert.equal(safeExternalUrl('https://t.me/udzravi_qoneba/1234'), 'https://t.me/udzravi_qoneba/1234');
  assert.equal(safeExternalUrl('http://forum.ge/?showtopic=1&view=findpost&p=2'), 'http://forum.ge/?showtopic=1&view=findpost&p=2');
  for (const bad of ["javascript:paste('x')", 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'signal:abc', 'vbscript:x',
    'file:///x', 'mailto:a@b.ge', 'tel:+995', 'tg://resolve?domain=x', '/relative', '//t.me/x',
    'https://u:p@evil.example/', '', null, undefined, {}]) {
    assert.equal(safeExternalUrl(bad), null, String(bad));
  }
});

test('openExternal opens only validated links, with noopener and noreferrer', () => {
  const opened = [];
  globalThis.window = { open: (...args) => { opened.push(args); return null; } };
  try {
    assert.equal(openExternal('javascript:alert(1)'), false);
    assert.equal(openExternal('signal:1'), false);
    assert.equal(openExternal('https://t.me/konttin'), true);
    assert.deepEqual(opened, [['https://t.me/konttin', '_blank', 'noopener,noreferrer']]);
  } finally {
    delete globalThis.window;
  }
});
