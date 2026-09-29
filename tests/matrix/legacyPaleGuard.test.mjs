// PALE LEGACY UI MUST NOT COME BACK.
//
// The 2026-09-29 cleanup removed a family of washed-out fragments from the
// authenticated customer product. Each rule below bans the EXACT deprecated
// pattern that was found and fixed — not a colour word. Neutral colours used
// for metadata and genuinely disabled controls are none of this file's
// business.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

/** Every .tsx under src/pages that is customer-facing (admin, developer and
    auth shells have their own contracts and are out of this mandate). */
function customerPages() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = `${dir}/${name}`;
      const full = join(root, rel);
      if (statSync(full).isDirectory()) {
        if (['admin', 'developer', 'auth'].includes(name)) continue;
        walk(rel);
      } else if (name.endsWith('.tsx')) {
        out.push(rel);
      }
    }
  };
  walk('src/pages');
  return out;
}

test('the washed-out empty-state glyph is gone and stays gone', () => {
  /*
   * THE PATTERN: a lucide icon centred with `mx-auto` and faded to
   * `opacity-25/30/40`, floating above grey text — an empty state dressed as
   * a rendering error. The replacement is the gold-soft chip (EmptyState in
   * customer/surface.tsx, or its inline equivalent).
   *
   * The ban is the COMBINATION on one element: centred AND faded. A plain
   * opacity utility elsewhere (hover transitions, deliberate depth ramps,
   * disabled rows) does not match.
   */
  const bad = /className="[^"]*mx-auto[^"]*opacity-[1234]0[^"]*"|className="[^"]*opacity-[1234]0[^"]*mx-auto[^"]*"/;
  const offenders = customerPages().filter((f) => bad.test(read(...f.split('/'))));
  assert.deepEqual(offenders, [],
    `washed-out empty-state icons are back: ${offenders.join(', ')}`);
});

test('the owner primary action never puts white ink on solid gold', () => {
  /* OWNER_PRIMARY's hover fill is solid gold; the ink there must be the dark
     button ink, because --primary-foreground resolves to WHITE on the light
     owner scope and white-on-gold fails contrast outright. */
  const body = read('src', 'components', 'owner', 'portfolio.tsx');
  assert.ok(!/hover:bg-\[hsl\(var\(--gold\)\)\][^']*hover:text-\[hsl\(var\(--primary-foreground\)\)\]/.test(body)
    && !/hover:text-\[hsl\(var\(--primary-foreground\)\)\]/.test(body),
    'OWNER_PRIMARY hovers back to white-on-gold');
  assert.match(body, /hover:text-\[#161309\]/,
    'the gold hover lost its dark ink');
});

test('direct messages are Private Messages; notifications are not', () => {
  /*
   * ONE SEMANTIC LINE, BOTH SIDES OF IT. The person-to-person product wears
   * "პირადი შეტყობინებები"; the Notification Center keeps its own name. A
   * refactor that blanket-renames every "შეტყობინებები" — or reverts the
   * private-message labels to the generic word — crosses that line.
   */
  const i18n = read('src', 'i18n', 'translations.ts');
  assert.match(i18n, /nav_chat: 'პირადი შეტყობინებები',/,
    'the rail label for direct messages lost the Private Messages naming');
  assert.match(i18n, /chat_title: 'პირადი შეტყობინებები',/,
    'the messages page title lost the Private Messages naming');
  assert.match(i18n, /nav_chat: 'Private Messages',/);
  assert.match(i18n, /notif_title: 'შეტყობინებები',/,
    'the Notification Center was renamed — notifications are not private messages');
});

test('the conversation products carry the navy identity strip', () => {
  /* Live Chat and Private Messages both frame their white workspace with the
     product's navy strip; losing it regresses them to the hairline header. */
  for (const file of ['LiveChatPage.tsx', 'ChatPage.tsx']) {
    const body = read('src', 'pages', file);
    assert.match(body, /bg-\[#0C1119\]/, `${file} lost its navy identity strip`);
  }
});
