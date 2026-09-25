/*
 * ONE NAVIGATION, NOT NINE.
 *
 * HomePage, AboutPage, PricingPage, PartnersPage, DevelopersPage,
 * PrivacyPage, TermsPage, PublicProjectPage and the Studio-rendered shell
 * each declared their own `headerLinks`, and they had drifted into four
 * different navigations. Investment was missing from the Studio-rendered
 * header; Pricing was in the navigation of no page at all, including its own.
 *
 * These tests are about the SHAPE the product presents, not about a list of
 * strings: a page may not invent a navigation, the order §6 asks for holds,
 * and every destination is a route that exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const NAV = readFileSync('src/site/publicNav.ts', 'utf8');
const ROUTES = readFileSync('src/routes.tsx', 'utf8');

/** The link keys, in the order the file declares them. */
function orderedKeys() {
  return [...NAV.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
}

test('nav 1: no page declares a navigation of its own any more', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      const src = readFileSync(path, 'utf8');
      if (/const \w+: HeaderLink\[\] = \[/.test(src)) offenders.push(path);
    }
  };
  walk('src');
  assert.deepEqual(offenders, [],
    'a page is declaring its own header links again — that is how four navigations appeared');
});

test('nav 2: the two matching actions lead, and Expat is primary without leading', () => {
  /*
   * The product is matching: a visitor either has a property and wants
   * demand, or wants a property and has demand. Those two come first.
   *
   * Expat is primary and deliberately NOT first. The Workspace -> Expat ->
   * Intelligence order in §6 is about the signed-in hierarchy, where Expat
   * sits after the work; giving it the first slot on a public page would
   * tell a Georgian seller that Homatch is a relocation site.
   */
  const keys = orderedKeys();
  assert.equal(keys[0], 'find_property', 'the first thing offered should be finding a property');
  assert.equal(keys[1], 'find_client', 'finding demand should sit beside finding supply');

  const expat = keys.indexOf('expat');
  assert.ok(expat > 1, 'Expat should not take a leading slot on a public page');
  const groups = ['professional', 'company'].map((k) => keys.indexOf(k));
  assert.ok(groups.every((g) => g > expat), 'Expat must stay primary, above the grouped items');
});

test('nav 2b: no Start link, because the logo already goes home', () => {
  /* The slot is worth more to a product action than to a control every
     visitor already knows how to use. */
  const keys = orderedKeys();
  assert.ok(!keys.includes('start') && !keys.includes('home'),
    'a redundant Start link is back in the primary row');
  const header = readFileSync('src/components/home/PublicHeader.tsx', 'utf8');
  assert.match(header, /home_nav_home_aria/, 'the logo must remain the labelled way home');
});
test('nav 3: the secondary destinations are grouped, not competing for the row', () => {
  /* Seven flat links is what made the header crowd. About, Pricing, For
     developers and Partners are real destinations that are not what a
     visitor came to do, so they cost one control each instead of four. */
  assert.match(NAV, /key: 'company'[\s\S]*?children:/, 'Company is not a group');
  assert.match(NAV, /key: 'professional'[\s\S]*?children:/, 'For professionals is not a group');
  for (const child of ['about', 'pricing', 'developers', 'partners']) {
    assert.ok(NAV.includes(`key: '${child}'`), `${child} is missing from the navigation`);
  }
});

test('nav 4: every destination is a route that exists', () => {
  /*
   * A navigation that points at a path with no route sends the customer to
   * the 404 page, and nothing in the build says so.
   */
  const targets = [...NAV.matchAll(/target: '(\/[^']*)'/g)].map((m) => m[1]);
  assert.ok(targets.length >= 6, 'expected the navigation to have route targets');
  for (const target of targets) {
    /* Anchors on the home page are '/#region', which is the home route. */
    const path = target.split('#')[0] || '/';
    assert.ok(ROUTES.includes(`path: '${path}'`), `${target} is not a route`);
  }
});

test('nav 5: a group is never itself a destination', () => {
  /* Clicking "Company" should open the group, not navigate somewhere that
     happens to be first in it. */
  for (const group of ['company', 'professional']) {
    const block = NAV.slice(NAV.indexOf(`key: '${group}'`));
    const target = block.match(/target: '([^']*)'/);
    assert.equal(target?.[1], '', `${group} has a destination of its own`);
  }
});

test('nav 6: every label an admin may rewrite is offered in the Studio registry', () => {
  /*
   * PublicHeader.NAV_FIELDS maps a link key to the translation key it falls
   * back to, and src/site/registry.ts is what Admin actually shows. A label
   * in one and not the other is either an uneditable label or a control that
   * edits nothing.
   */
  const header = readFileSync('src/components/home/PublicHeader.tsx', 'utf8');
  const registry = readFileSync('src/site/registry.ts', 'utf8');
  const fields = header.slice(header.indexOf('const NAV_FIELDS'), header.indexOf('/** The header,'));

  for (const key of ['find_property', 'find_client', 'expat', 'investment', 'pricing', 'company', 'professional']) {
    assert.ok(fields.includes(`${key}:`), `${key} is not admin-editable in NAV_FIELDS`);
    assert.ok(registry.includes(`f('nav_${key}'`), `nav_${key} is not offered in the Studio registry`);
  }
});
