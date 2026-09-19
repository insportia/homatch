import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * NOTHING A CUSTOMER TAPS MAY LEAD BACK INTO THE DEAL ROOM.
 *
 * The workspace was retired from the customer journey, but retiring a
 * concept is not one edit — it is every button that still points at it. Two
 * survived the first pass and were found by scrolling a deployed page and by
 * reading a job's stored destination, not by reading routes.tsx:
 *
 *   - the dashboard listed deal rooms as "verifications" and opened
 *     /verify/<room> on click
 *   - every contract analysis wrote /verify/<case>?tab=documents&doc=<id>
 *     as its result_ref, so Current Tasks sent the customer there when the
 *     contract finished
 *
 * Route definitions are not the thing to check: /verify/:id and /deal-rooms
 * both still exist ON PURPOSE, so old links and bookmarks keep working. What
 * must not exist is a NAVIGATION TARGET a customer reaches by using the
 * product normally. So this reads what the code navigates to.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

/** Files allowed to mention the retired surface, each for a stated reason. */
const ALLOWED = new Map([
  // The compatibility route itself — its whole job is to catch old URLs.
  ['src/pages/LegacyDealRoomRedirect.tsx', 'the redirect that keeps old links alive'],
  // The case page still exists so a bookmark resolves; nothing links to it.
  ['src/pages/VerificationCasePage.tsx', 'the legacy case page, reachable only by direct URL'],
  // The route table deliberately keeps both for compatibility.
  ['src/routes.tsx', 'route definitions, which are compatibility not navigation'],
  // Back-navigation parents for a customer who arrived by direct URL.
  ['src/lib/backNavigation.ts', 'where Back goes if someone opens a legacy URL directly'],
  // The resolver is what REPAIRS the retired refs; it names them to rewrite.
  ['src/jobs/destination.ts', 'rewrites the retired refs into Contracts'],
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (/\.(tsx?|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC).map((full) => ({
  rel: path.relative(ROOT, full).split(path.sep).join('/'),
  // Comments explain history; only executable code can navigate anywhere.
  code: fs
    .readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, ''),
}));

test('no customer CTA navigates into the retired verification case', () => {
  /*
   * `navigate('/verify/<something>')` and its aliases. `/verify?job=` is the
   * Center opening a stored report and is the correct destination, so the
   * pattern requires a SLASH after verify.
   */
  const intoCase = /(?:navigate|nav)\(\s*[`'"]\/verify\/(?!history)/;
  const offenders = FILES.filter((f) => !ALLOWED.has(f.rel) && intoCase.test(f.code));
  assert.deepEqual(
    offenders.map((f) => f.rel),
    [],
    'these navigate a customer into the retired Deal Room case page'
  );
});

test('nothing writes or links the Documents tab any more', () => {
  const offenders = FILES.filter((f) => !ALLOWED.has(f.rel) && f.code.includes('tab=documents'));
  assert.deepEqual(
    offenders.map((f) => f.rel),
    [],
    'the Documents tab is the retired workspace; contracts open at /contracts/:id'
  );
});

test('no customer CTA links to a /deal-rooms URL', () => {
  const offenders = FILES.filter((f) => !ALLOWED.has(f.rel) && f.code.includes('/deal-rooms'));
  assert.deepEqual(
    offenders.map((f) => f.rel),
    [],
    'the customer should never need to know what a deal room is'
  );
});

test('a contract analysis is queued with the contract’s own page as its result', () => {
  const src = fs.readFileSync(path.join(SRC, 'services/documentWorkspace.ts'), 'utf8');
  assert.match(
    src,
    /resultRef: `\/contracts\/\$\{doc\.id\}`/,
    'a finished contract task must open the contract, not a workspace'
  );
});

test('the dashboard lists verifications, not the containers they are stored in', () => {
  const summary = fs.readFileSync(path.join(SRC, 'services/dashboardSummary.ts'), 'utf8');
  /*
   * The dashboard read listDealRooms() and called the result "verifications":
   * it showed 8 where the same account had 67 completed research runs, and
   * every row opened the retired workspace.
   */
  assert.ok(
    summary.includes('listVerifyHistory('),
    'verifications must come from research runs'
  );
  assert.equal(
    /listDealRooms\s*\(/.test(summary), false,
    'deal rooms are storage containers, not the customer’s verifications'
  );
});

test('the legacy compatibility surface is deliberately kept, not deleted', () => {
  // The other half of the rule: nothing here may be "cleaned up". A customer
  // with an old bookmark, and every historical document, must still resolve.
  const routes = fs.readFileSync(path.join(SRC, 'routes.tsx'), 'utf8');
  for (const keep of ['/deal-rooms', '/verify/:id']) {
    assert.ok(routes.includes(keep), `${keep} must remain for compatibility`);
  }
  assert.ok(
    fs.existsSync(path.join(SRC, 'pages/LegacyDealRoomRedirect.tsx')),
    'the redirect must remain'
  );
});
