import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { defaultOrderFor } from '../render/order.ts';
import { KNOWN_SECTION_TYPES } from '../registry.ts';

/*
 * EVERY PAGE IS A PAGE YOU CAN OPEN — AND WHAT HAPPENS WHEN YOU DO.
 *
 * PageSlug was a two-value union for a while: Pricing, Partners, Mortgage,
 * Privacy and Terms could not be opened in Site Studio at all. A page that
 * cannot be opened cannot be corrected, and "the marketing site" was never
 * only the home page.
 *
 * Fixing that introduced a second failure, which these tests are mostly
 * about: the picker lists a page, the page opens, and NOTHING an admin does
 * there ever appears — because the route renders no band for the blocks they
 * add. A list and a renderer that disagree is worse than a missing entry,
 * because the missing entry is visible and this is not.
 */

/*
 * The editor's page list, read from its source rather than imported.
 *
 * services/siteContent.ts reaches the Supabase client through a bundler
 * alias, which node cannot resolve — and pulling a database client into a
 * test about which files render which band would be the wrong dependency
 * even if it did.
 */
const EDITABLE_PAGES = [...readFileSync('src/services/siteContent.ts', 'utf8')
  .matchAll(/\{\s*slug: '([a-z]+)'/g)].map(m => ({ slug: m[1] }));

const ROUTES = {
  home: 'src/pages/HomePage.tsx',
  about: 'src/pages/AboutPage.tsx',
  pricing: 'src/pages/PricingPage.tsx',
  partners: 'src/pages/PartnersPage.tsx',
  developers: 'src/pages/DevelopersPage.tsx',
  mortgage: 'src/pages/MortgagePage.tsx',
  privacy: 'src/pages/PrivacyPage.tsx',
  terms: 'src/pages/TermsPage.tsx',
  verify: 'src/pages/VerifyPage.tsx',
};

test('the page list was actually found', () => {
  // Guards the regex above: an empty list would make every test below pass
  // by iterating over nothing.
  assert.ok(EDITABLE_PAGES.length >= 7, 'the editable-page list could not be read');
});

test('every page in the picker has a running order the code knows', () => {
  for (const { slug } of EDITABLE_PAGES) {
    const order = defaultOrderFor(slug);
    assert.ok(Array.isArray(order), `${slug} has no running order`);
    for (const type of order) {
      assert.ok(KNOWN_SECTION_TYPES.includes(type),
        `${slug} ships section type "${type}", which no component renders`);
    }
  }
});

test('a page an admin can open is a page their blocks appear on', () => {
  /*
   * The one that would otherwise rot silently. Pricing seeded with the home
   * page's twelve sections for a while, because seedPage read
   * `slug === 'about' ? about : home` -- correct with two pages, wrong the
   * moment there were seven, and invisible until somebody saved.
   */
  for (const { slug } of EDITABLE_PAGES) {
    // The shell is the header and footer; it has no route of its own.
    if (slug === 'shell') continue;
    const file = ROUTES[slug];
    assert.ok(file, `${slug} is offered in the editor but maps to no route file`);
    const src = readFileSync(file, 'utf8');

    const composed = src.includes('<SitePage');
    const banded = src.includes('<PageBlocks');
    assert.ok(composed || banded,
      `${slug} can be opened in the editor, but nothing an admin adds there is rendered`);
    if (banded) {
      assert.match(src, new RegExp(`<PageBlocks slug="${slug}"`),
        `${slug} renders a block band for the wrong page`);
    }
  }
});

test('the shell is editable but belongs to no route', () => {
  // The header and footer are read by ShellScope wherever they appear, not by
  // a page. A route rendering slug 'shell' would draw a second header.
  const slugs = EDITABLE_PAGES.map(p => p.slug);
  assert.ok(slugs.includes('shell'), 'the header and footer cannot be opened in the editor');
  for (const file of Object.values(ROUTES)) {
    assert.equal(readFileSync(file, 'utf8').includes('"shell"'), false,
      `${file} renders the shell page, which would draw the chrome twice`);
  }
});

/*
 * THE CONTENT FIXES, PINNED.
 *
 * Two strings and one number that were asked for by name. They are asserted
 * here rather than checked once by eye, because the way they came back last
 * time was somebody re-adding a caption that looked like it belonged.
 */

/** Every source file under src/, so a reintroduction anywhere is caught. */
function sourceFiles(dir = 'src', out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('nothing anywhere calls itself an illustrative example', () => {
  // "საილუსტრაციო მაგალითი" — a caption that told a visitor the official
  // record they were looking at was a mock-up. On a product that sells
  // confidence in records, it was the one label that had to go.
  const offenders = sourceFiles().filter(f => readFileSync(f, 'utf8').includes('საილუსტრაციო'));
  assert.deepEqual(offenders, [], 'the illustrative-example label is back');
});

test('the official-record image carries no cadastral number', () => {
  const src = readFileSync('src/components/home/sections/VerifyShowcaseSection.tsx', 'utf8');
  // A plausible-looking cadastral code printed over a stock photograph reads
  // as a real property's identifier. There is no version of that which is
  // honest, so the plate carries no code at all.
  assert.equal(/\d{2}\.\d{2}\.\d{2}\.\d{3}/.test(src), false,
    'a cadastral code is being printed over the record image again');
  // And the image is given room rather than being cropped to a letterbox.
  assert.match(src, /aspect-\[16\/10\]/,
    'the record image is back to a fixed height that crops most of it away');
});

test('the document is READ, not filled in', () => {
  const doc = readFileSync('src/components/home/sections/ContractDocument.tsx', 'utf8');
  const section = readFileSync('src/components/home/sections/ContractIntelligenceSection.tsx', 'utf8');

  // It must look like a contract, not a loading skeleton: a heading, the
  // parties, the property, the price and a clause, each a region the scan
  // can reach and report on.
  for (const region of ['parties', 'property', 'price', 'clause']) {
    assert.match(doc, new RegExp(`'${region}'`), `the document has no ${region} region`);
  }

  /*
   * AND IT MUST START WHEN IT IS SEEN.
   *
   * The previous version ran on a setInterval started at mount, so on a phone
   * the sequence had already been round several times before anybody scrolled
   * to it — the complaint that the animation "does not work on mobile" was
   * really that it was always over by the time it was visible.
   */
  assert.match(doc, /IntersectionObserver/, 'the scan does not wait to be seen');
  // A CALL, not the word: the comment above the removal says "setInterval".
  assert.equal(/setInterval\s*\(/.test(section), false,
    'something in this section still animates on a timer started at mount');
});
