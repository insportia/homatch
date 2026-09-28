// THE CUSTOMER-PRODUCT CONTRACT, AS SOURCE FACTS.
//
// Deliberately low-noise: each test states one rule this workstream
// enforced, against the file that would break it first. No snapshots of
// whole bundles — a translation edit should not fail a build unless it
// reintroduces the exact mistake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the match noun is დამთხვევა — შესატყვისი never ships', () => {
  assert.ok(!read('src/i18n/translations.ts').includes('შესატყვისი'));
});

test('the tenant is მოიჯარე — მოქირავნე never ships', () => {
  assert.ok(!read('src/i18n/translations.ts').includes('მოქირავნე'));
});

test('no customer screen glues raw English "failed" onto a translated string', () => {
  const dir = 'src/pages/outreach';
  for (const f of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.tsx'))) {
    const src = read(join(dir, f));
    assert.ok(!/\$\{[^}]*\}\s*failed/.test(src), `${f}: composed "... failed" string`);
  }
});

test('the credits page sells no research products and shows no raw ledger references', () => {
  const src = read('src/pages/CreditsPage.tsx');
  assert.ok(!src.includes('getMyResearchPurchases'));
  assert.ok(!src.includes('purchaseResearchProduct'));
  assert.ok(!src.includes('research_products_title'));
  assert.ok(!src.includes('{entry.reference}'));
});

test('the profile shows no billing plan — the product is PAYG only', () => {
  const src = read('src/pages/ProfilePage.tsx');
  assert.ok(!src.includes('profile_plan_free'));
  assert.ok(!src.includes('profile_field_plan'));
});

test('the activity feed never renders a raw event enum', () => {
  const src = read('src/pages/ActivityPage.tsx');
  assert.ok(!/\?\?\s*event\.event_type/.test(src), 'raw enum fallback is gone');
  assert.match(src, /activityLabelKey/);
});

test('the service worker is stamped per build and the page listens for updates', () => {
  assert.match(read('src/serviceWorker/sw.source.js'), /const VERSION = 'homatch-__BUILD__'/);
  assert.match(read('vite.config.ts'), /replaceAll\('__BUILD__'/);
  assert.match(read('vite.config.ts'), /stampServiceWorker/);
  const main = read('src/main.tsx');
  assert.match(main, /updatefound/);
  assert.match(main, /homatch:sw-update-ready/);
  assert.match(main, /visibilitychange/);
});

test('the dashboard sends each action tile to the product it names', () => {
  const src = read('src/pages/DashboardPage.tsx');
  assert.ok(!/db_qa_client_title[\s\S]{0,120}path: '\/property\/add'/.test(src),
    '"find interested people" must not open the add-property form');
  assert.match(src, /db_qa_property_title[\s\S]{0,120}path: '\/find-property'/);
});

test('mortgage is named the AI consultant, not "analytics", on the dashboard card', () => {
  const t = read('src/i18n/translations.ts');
  assert.ok(!t.includes('იპოთეკური ანალიტიკა'));
  assert.ok(t.includes("db_mortgage_title: 'იპოთეკის AI კონსულტანტი',"));
});

test('the broker directory is reachable from the signed-in sidebar', () => {
  assert.match(read('src/components/layouts/HomatchShell.tsx'), /path: '\/brokers'/);
});
