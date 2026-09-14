import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * ONE PRODUCT'S RAIL MUST NOT ADVERTISE ANOTHER PRODUCT'S WORKFLOW.
 *
 * Communications is three products sharing a URL prefix: telephony, WhatsApp
 * and email. They share an audience and nothing else. For a long time they
 * also shared one ten-item rail, rendered identically on all of them, and the
 * result was a menu that was wrong nearly everywhere it appeared — WhatsApp
 * templates offered to somebody running a call campaign, Billing and AI agents
 * offered to somebody answering a message.
 *
 * That is not a styling problem and it does not stay fixed by itself: the
 * cheapest way to expose a new screen is to add one line to a shared array,
 * and the cheapest way is what happens under time pressure. So the rule is a
 * test.
 *
 * Read from source rather than imported, because the module is TSX and this
 * suite runs under plain Node. The assertions are about the shape of the
 * declaration, which is exactly what a careless edit changes.
 */
const SRC = readFileSync('src/components/communications/CommsWorkspace.tsx', 'utf8');

/** The entries declared for one product, as their `to` paths. */
function railFor(product) {
  const at = SRC.indexOf(`  ${product}: [`);
  assert.ok(at > 0, `no rail is declared for "${product}"`);
  const end = SRC.indexOf('\n  ],', at);
  assert.ok(end > at, `the "${product}" rail is not closed`);
  const block = SRC.slice(at, end);
  return [...block.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1]);
}

/** Paths that belong to exactly one channel, and to which. */
const OWNED = {
  '/outreach/whatsapp': 'whatsapp',
  '/outreach/whatsapp/inbox': 'whatsapp',
  '/outreach/whatsapp/templates': 'whatsapp',
  '/outreach/calls': 'calls',
  '/outreach/agents': 'calls',
  '/outreach/email': 'email',
};

test('no channel rail carries another channel\'s screens', () => {
  /* The hub is exempt by design: it is the one surface that IS about all the
     channels, it is reached deliberately, and it is not in the global
     navigation. The neutral audience rail is exempt for the opposite reason —
     it belongs to no channel, so it offers the way back to each. */
  for (const product of ['calls', 'whatsapp', 'email']) {
    for (const to of railFor(product)) {
      const owner = OWNED[to];
      if (!owner) continue; // a shared surface: contacts, lists, numbers
      assert.equal(
        owner, product,
        `the "${product}" rail links to ${to}, which belongs to "${owner}". `
        + 'A person running a campaign on one channel is not offered another channel\'s workflow.',
      );
    }
  }
});

test('the AI Call Center offers nothing about WhatsApp', () => {
  // Named separately from the loop above because it is the specific complaint
  // that produced this work, and a named failure is easier to act on than an
  // index into a table.
  const calls = railFor('calls');
  const offenders = calls.filter((to) => to.startsWith('/outreach/whatsapp'));
  assert.deepEqual(offenders, [], `AI Calls still links to ${offenders.join(', ')}`);
});

test('WhatsApp offers nothing about calls or billing', () => {
  const wa = railFor('whatsapp');
  const offenders = wa.filter((to) => (
    to === '/outreach/calls' || to === '/outreach/agents' || to === '/outreach/billing'
  ));
  assert.deepEqual(offenders, [], `WhatsApp still links to ${offenders.join(', ')}`);
});

test('every product rail is short enough to be read', () => {
  /* A rail is a glance, not an index. Ten items was the old shared list and
     the reason none of it registered. */
  for (const product of ['calls', 'whatsapp', 'email', 'contacts', 'hub']) {
    const rail = railFor(product);
    assert.ok(rail.length >= 3, `the "${product}" rail has ${rail.length} entries, which is not a rail`);
    assert.ok(rail.length <= 6, `the "${product}" rail has ${rail.length} entries; six is the ceiling`);
  }
});

test('the conversation list is not given a rail at all', () => {
  /* The left column of a messaging screen is the inbox. A menu there has put
     a menu where the product goes, and no styling makes that the right
     layout. */
  const inbox = readFileSync('src/pages/outreach/WhatsAppInboxPage.tsx', 'utf8');
  assert.match(
    inbox, /<CommsWorkspace[^>]*railless/,
    'the WhatsApp inbox renders the product rail beside the conversation list',
  );
});

test('every communications screen declares which product it is', () => {
  /* The default is the cross-channel hub. A screen that forgets to say gets
     the widest rail, which is the old behaviour — so the ones that belong to
     a channel must name it. */
  const channelScreens = [
    'CallsPage', 'WhatsAppPage', 'WhatsAppInboxPage', 'WhatsAppTemplatesPage',
    'AgentsPage', 'CampaignsPage', 'EmailCampaignsPage',
  ];
  for (const name of channelScreens) {
    const src = readFileSync(`src/pages/outreach/${name}.tsx`, 'utf8');
    assert.match(
      src, /<CommsWorkspace[^>]*product="(calls|whatsapp|email|contacts)"/s,
      `${name} does not say which product it belongs to, so it falls back to the cross-channel rail`,
    );
  }
});
