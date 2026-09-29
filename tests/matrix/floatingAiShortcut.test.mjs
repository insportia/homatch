// THE FLOATING AI SHORTCUT KNOWS WHERE IT IS NOT WELCOME.
//
// Production showed it sitting ON the Live Chat send control: AppLayout
// mounted it everywhere and the only carve-out ('/ai') lived inline in the
// component. Eligibility is now one pure rule in lib/floatingAiShortcut.ts.
// These tests run THAT function — the module is executed, not pattern-
// matched — so the behaviour is what is asserted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

/** The real module, with its two type annotations stripped so vm runs it. */
function loadRule() {
  const ts = read('src', 'lib', 'floatingAiShortcut.ts');
  const js = ts
    .replace('] as const;', '];')
    .replace('(pathname: string): boolean', '(pathname)')
    .replace(/^export /m, '');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${js}; __rule = shouldShowFloatingAiShortcut;`, context);
  return context.__rule;
}

test('the shortcut never renders inside the AI product or over a composer', () => {
  const shouldShow = loadRule();
  for (const path of [
    '/ai',
    '/live-chat',
    '/chat',
    '/outreach/whatsapp/inbox',
    /* Subpaths are the same screen with the same composer. */
    '/chat/thread-123',
    '/outreach/whatsapp/inbox/conv-9',
  ]) {
    assert.equal(shouldShow(path), false, `${path} must not show the floating AI shortcut`);
  }
});

test('ordinary customer screens keep the shortcut', () => {
  const shouldShow = loadRule();
  for (const path of ['/dashboard', '/property', '/property/123456/matches',
    '/verify', '/mortgage', '/investment', '/find-property', '/credits',
    /* Prefix rules must not overreach: WhatsApp CAMPAIGNS has no composer. */
    '/outreach/whatsapp']) {
    assert.equal(shouldShow(path), true, `${path} lost the floating AI shortcut`);
  }
});

test('the component defers to the rule and clears the bottom nav', () => {
  const body = read('src', 'components', 'common', 'AIFloatingButton.tsx');
  assert.match(body, /shouldShowFloatingAiShortcut\(location\.pathname\)/,
    'the button no longer consults the central eligibility rule');
  assert.ok(!/pathname === '\/ai'/.test(body),
    'an inline pathname check crept back beside the central rule');
  /* Positioning contract: derived from the bottom nav's real geometry
     (3.75rem bar + its safe-area padding + a gap), not a magic bottom-20. */
  assert.match(body, /bottom-\[calc\(4\.5rem\+env\(safe-area-inset-bottom/,
    'the mobile offset regressed to a magic number that ignores the safe area');
});

test('the conversation composers the shortcut was covering still exist', () => {
  const ai = read('src', 'pages', 'AIPage.tsx');
  assert.match(ai, /<textarea/, 'the AI composer is gone');
  assert.match(ai, /onClick=\{handleSend\}/, 'the AI send action is gone');
  const lc = read('src', 'pages', 'LiveChatPage.tsx');
  assert.match(lc, /onSubmit|handleSend|sendMessage/, 'the Live Chat send path is gone');
});
