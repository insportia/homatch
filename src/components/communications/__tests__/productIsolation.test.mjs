import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * THREE PRODUCTS, ONE SET OF TABLES, AND THE SEAM BETWEEN THEM.
 *
 * AI Calls, WhatsApp and Email share comm_* and outreach_*, share services,
 * and share components. A customer experiences them as separate products, and
 * the only thing keeping that true is that every product-facing read names its
 * channel and every product-facing route carries its prefix.
 *
 * Both are the kind of invariant that breaks silently. A query without a
 * channel filter returns MORE rows, not an error; a rail pointing at a shared
 * path still navigates. Nothing goes red, and one product quietly starts
 * showing another product's work.
 *
 * It has already happened twice in this codebase: listConversations had no
 * channel filter, so the WhatsApp inbox would have listed EMAIL replies the
 * day inbound email went live; and listChannelAccounts had neither a channel
 * nor an owner filter, so the call centre's Numbers screen listed the WhatsApp
 * Business account.
 *
 * These read source rather than run a browser, because the property under test
 * is structural. The click-through happens separately, against a real Chrome.
 */
const WORKSPACE = readFileSync('src/components/communications/CommsWorkspace.tsx', 'utf8');
const ROUTES = readFileSync('src/routes.tsx', 'utf8');
const SERVICE = readFileSync('src/services/communications.ts', 'utf8');
const CHANNEL = readFileSync('src/components/communications/channel.ts', 'utf8');

/** The `to` paths declared for one product's rail. */
function railFor(product) {
  const at = WORKSPACE.indexOf(`  ${product}: [`);
  assert.ok(at > 0, `no rail is declared for "${product}"`);
  const block = WORKSPACE.slice(at, WORKSPACE.indexOf('\n  ],', at));
  return [...block.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1]);
}

/** The body of one exported service function. */
function fnBody(name) {
  const at = SERVICE.indexOf(`export async function ${name}`);
  assert.ok(at > 0, `${name} is not exported from the communications service`);
  const end = SERVICE.indexOf('\n}\n', at);
  return SERVICE.slice(at, end === -1 ? SERVICE.length : end);
}

const PREFIX = { calls: '/outreach/calls', whatsapp: '/outreach/whatsapp', email: '/outreach/email' };

test('a product rail never leaves its own product', () => {
  /*
   * The strong form of the rule, and the one that actually bites: it is not
   * enough that AI Calls avoids the word "WhatsApp". Every destination must
   * live UNDER this product's prefix, because a link to a shared path is how
   * the channel gets lost — the page then has no way to know which product
   * sent you, and falls back to showing all of them.
   */
  for (const [product, prefix] of Object.entries(PREFIX)) {
    for (const to of railFor(product)) {
      assert.ok(
        to === prefix || to.startsWith(`${prefix}/`),
        `the "${product}" rail links to ${to}, which is outside ${prefix}. `
        + 'A shared destination loses the channel, and the screen falls back to every channel at once.',
      );
    }
  }
});

test('every rail destination is a route that exists', () => {
  /* A rail entry pointing at an unrouted path is a dead end that type-checking
     cannot see, because it is a string. */
  for (const product of Object.keys(PREFIX)) {
    for (const to of railFor(product)) {
      assert.ok(
        ROUTES.includes(`path: '${to}'`),
        `the "${product}" rail links to ${to}, which no route serves`,
      );
    }
  }
});

test('channel context is read from the path, not from a prop or a context', () => {
  /*
   * The distinction matters for exactly one reason: a refresh. A prop or a
   * React context is gone after F5, so a bookmarked /outreach/calls/contacts
   * would reopen with no channel and render the generic page. The URL is the
   * only state the browser restores for us.
   */
  assert.match(CHANNEL, /useLocation\(\)\.pathname/,
    'the channel is not derived from the URL, so it cannot survive a refresh');
  assert.equal(/createContext/.test(CHANNEL), false,
    'the channel is held in a React context, which a refresh destroys');
});

test('every channel-scoped read names its channel', () => {
  /*
   * Named individually rather than by scanning, because the failure is an
   * ABSENCE and a scan for absences finds nothing by construction. Each entry
   * is a query that returns another product's rows when the filter is missing.
   */
  const REQUIRED = [
    ['listConversations', /\.eq\('channel', filter\.channel\)/, 'the inbox would mix channels'],
    ['listChannelAccounts', /\.eq\('channel', channel\)/, 'Numbers would mix WhatsApp with call numbers'],
    ['listChannelAccounts', /\.eq\('owner_id', uid\)/, 'Numbers would rely on RLS alone for tenant scope'],
    ['listCalls', /\.eq\('channel', 'AI_CALL'\)/, 'call history would include messages'],
    ['listEmailSends', /\.eq\('channel', 'EMAIL'\)/, 'email activity would include calls'],
    ['listLiveCalls', /\.eq\('channel', 'AI_CALL'\)/, 'live calls would match any channel using those statuses'],
  ];
  for (const [name, pattern, consequence] of REQUIRED) {
    assert.match(fnBody(name), pattern, `${name} does not scope its query: ${consequence}`);
  }
});

test('analytics scopes BOTH halves of its answer', () => {
  /* The sends half honoured the channel and the conversation half did not, so
     call analytics were measured against a funnel built from WhatsApp and
     email. Plausible numbers, wrong numbers. */
  const body = fnBody('getAnalytics');
  const conversationScope = /convQuery = convQuery\.eq\('channel', filter\.channel\)/;
  assert.match(body, conversationScope,
    'getAnalytics filters sends by channel but not conversations, so one product is measured against another');
});

test('contacts are scoped to who this product can actually reach', () => {
  const body = fnBody('listContacts');
  assert.match(body, /params\.channel === 'EMAIL'/,
    'Email Campaigns would list contacts with no email address');
  assert.match(body, /params\.channel === 'AI_CALL' \|\| params\.channel === 'WHATSAPP'/,
    'the phone channels would list contacts with no number');
});

test('each product has its own copy of every shared screen', () => {
  /* The screens are one component each; the destinations must not be. */
  const REQUIRED_ROUTES = [
    '/outreach/calls/campaigns', '/outreach/calls/agents',
    '/outreach/calls/numbers', '/outreach/calls/contacts',
    '/outreach/whatsapp/numbers', '/outreach/whatsapp/contacts',
    '/outreach/whatsapp/inbox', '/outreach/whatsapp/templates',
    '/outreach/email/contacts', '/outreach/email/lists', '/outreach/email/analytics',
  ];
  for (const path of REQUIRED_ROUTES) {
    assert.ok(ROUTES.includes(`path: '${path}'`), `${path} is not routed, so that product cannot reach it`);
  }
});

test('a cross-channel selector is not offered inside a product', () => {
  /* A channel tab strip inside AI Calls is a door out of the product wearing
     the clothes of a filter. */
  const campaigns = readFileSync('src/pages/outreach/CampaignsPage.tsx', 'utf8');
  assert.match(campaigns, /routeChannel \? null : \(/,
    'the campaigns screen offers its channel tabs inside a product, which is a way into another channel');
});

test('shared screens announce which product they are in', () => {
  /* "Communications > Contacts" names the category, which the reader already
     knows, and hides the one fact they need before acting on a row. */
  for (const name of ['ContactsPage', 'ChannelAccountsPage', 'ContactListsPage', 'CommunicationsAnalyticsPage']) {
    const src = readFileSync(`src/pages/outreach/${name}.tsx`, 'utf8');
    assert.match(src, /CHANNEL_TITLE_KEY/,
      `${name} does not name its product, so it reads as a generic Communications page`);
    assert.match(src, /useCommsProduct\(\)/,
      `${name} does not take its rail from the route, so it can render another product's menu`);
  }
});
