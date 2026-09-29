// THE SURFACES SHARE A PALETTE. THEY DO NOT SHARE A PRODUCT.
//
// This guards a boundary that has now been got wrong twice in opposite directions.
//
// FIRST FAILURE: no shared scope at all. Matches, Find Property and the owner workspace
// rendered on the root palette, where shadcn's Card, Badge and Button resolve to a white
// rectangle, grey capsules and a black filled button. Three redesigns rearranged children
// and produced the same screenshot each time, because the appearance was never coming
// from the children.
//
// SECOND FAILURE: one shared scope for everything. The fix handed `AppLayout surfaceClass`
// the SHELL's token block, and `surfaceClass` wraps everything a layout renders for a
// page — so the shell's gold became the skin of every product inside it, and Matches came
// out looking like the Dashboard.
//
// WHAT IS CORRECT, and what these tests hold:
//
//   ONE DECLARATION OF THE DARK PALETTE. `.hm-invest`, `.hm-workspace`, `.hm-discovery`
//   and `.hm-owner` are aliases on one rule. A border colour has one home.
//
//   NO PRODUCT COUPLING. Sharing a palette must not make the owner workspace depend on a
//   change somebody makes for Investment. So the shared rule may carry TOKENS and the
//   three structural helpers (-canvas, -panel, -focus) and nothing else: no layout, no
//   spacing, no product component styling. If Investment ever needs a rule of its own it
//   writes `.hm-invest-something`, which no other product wears.
//
//   EACH PAGE PICKS ITS OWN GROUND. A product page names the surface it wants. There is
//   no wrapper over authenticated routes for one to inherit by accident.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const css = read('src', 'index.css').replace(/\r\n/g, '\n');

/** The names that share the dark declaration. */
/* `.hm-invest` left this list on 2026-09-29: Verify, Contracts and Investment
   moved to the MIXED system (navy frames on a light working ground), so their
   scope now carries the customer light tokens while the three names below
   remain the protected dark contracts. */
const DARK_ALIASES = ['.hm-workspace', '.hm-discovery', '.hm-owner'];

/* ────────────────────────────────────────────────────────────────────────
 * One palette
 * ──────────────────────────────────────────────────────────────────────── */

test('the dark surface is declared exactly once', () => {
  /* Four copies of a palette is four places to change a border colour and three chances
     to miss one. `--shadow-hover` is the sentinel: it appears once per declaration of
     this surface and nowhere else in the file. */
  const occurrences = (css.match(/--shadow-hover: 0 18px 46px/g) ?? []).length;
  assert.equal(occurrences, 1,
    `the dark surface is declared ${occurrences} times; the aliases have been copied apart`);
});

test('every dark product name is on that one declaration', () => {
  const block = css.slice(css.indexOf('.hm-workspace,'), css.indexOf('--shadow-hover: 0 18px 46px'));
  for (const alias of DARK_ALIASES) {
    assert.ok(block.includes(`${alias},`) || block.includes(`${alias} {`),
      `${alias} is not on the shared dark declaration`);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * No product coupling
 * ──────────────────────────────────────────────────────────────────────── */

test('the shared dark rule carries tokens, not layout', () => {
  /*
   * THE POINT OF THE WHOLE BOUNDARY. If the shared rule grew a `display`, a `grid` or a
   * `padding`, then a spacing decision made for Investment would silently move the owner
   * workspace — which is product coupling wearing a design system's clothes.
   *
   * A token block may set custom properties and the three properties that make a surface
   * a surface: its colour, its ink and its numerals.
   */
  const start = css.indexOf('.hm-workspace,');
  const block = css.slice(start, css.indexOf('}', css.indexOf('--shadow-hover: 0 18px 46px')));
  const declarations = [...block.matchAll(/^\s{4}([a-z-]+):/gm)].map((m) => m[1]);
  const ALLOWED = new Set(['background-color', 'color', 'font-variant-numeric']);
  const layout = declarations.filter((name) => !name.startsWith('--') && !ALLOWED.has(name));
  assert.deepEqual(layout, [],
    `the shared dark rule sets layout properties, which couples the products: ${layout.join(', ')}`);
});

test('a product that needs its own rule writes its own selector', () => {
  /*
   * Investment carrying a rule the others inherit would be the coupling this forbids. Any
   * rule naming ONE of the aliases must not also name another — that is what "independent
   * consumption of a shared base" means in practice.
   */
  for (const rule of css.matchAll(/^\s{2}(\.hm-[a-z-]+(?:,\s*\n\s{2}\.hm-[a-z-]+)*)\s*\{/gm)) {
    const names = rule[1].split(',').map((n) => n.trim());
    if (names.length < 2) continue;
    /* A multi-name rule is legitimate only when every name is the same helper across the
       family — the shared base and its -canvas/-panel/-focus. */
    const suffixes = new Set(names.map((n) => n.replace(/^\.hm-(invest|workspace|discovery|owner)/, '')));
    assert.equal(suffixes.size, 1,
      `a rule groups unrelated scopes, which couples them: ${names.join(', ')}`);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * Each page picks its own ground
 * ──────────────────────────────────────────────────────────────────────── */

test('no page wears a scope that belongs to another product family', () => {
  const EXPECTED = [
    ['src/pages/property/MatchesPage.tsx', 'hm-discovery'],
    ['src/pages/FindPropertyPage.tsx', 'hm-discovery'],
    ['src/pages/property/MyPropertiesPage.tsx', 'hm-owner'],
    ['src/pages/property/PropertyDetailPage.tsx', 'hm-owner'],
    ['src/pages/DashboardPage.tsx', 'hm-customer'],
  ];
  const ALL = ['hm-customer', 'hm-discovery', 'hm-owner', 'hm-product', 'hm-invest', 'hm-workspace'];

  for (const [file, mine] of EXPECTED) {
    const source = read(...file.split('/'));
    /* Comments explain the boundary and name the other scopes on purpose; the check is
       about what the page RENDERS. */
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    assert.ok(code.includes(mine) || code.includes(mine.replace('hm-', '').toUpperCase()),
      `${file} does not name its own surface`);
    for (const other of ALL.filter((scope) => scope !== mine)) {
      assert.ok(!code.includes(`"${other}`) && !code.includes(`'${other}`) && !code.includes(` ${other} `),
        `${file} renders ${other}, which belongs to another product family`);
    }
  }
});

test('the owner product family shares one surface across its pages', () => {
  /* The portfolio and the property it opens are one product. A customer moving between
     them must not cross a theme boundary. */
  for (const file of ['src/pages/property/MyPropertiesPage.tsx', 'src/pages/property/PropertyDetailPage.tsx']) {
    assert.match(read(...file.split('/')), /surfaceClass=\{OWNER_SURFACE\}/,
      `${file} is not on the owner surface`);
  }
});
