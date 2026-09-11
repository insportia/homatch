import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCALES, checkLink, emptyPage, fieldStatus, makeSection, moveSection,
  nextVersion, normalizePage, normalizeSection, readLocalized, reorder,
  restoreAsDraft, setLocalized, setSectionEnabled, setSectionField,
} from '../model.ts';

/*
 * SITE STUDIO — the content model.
 *
 * These are the rules that decide whether an admin editor is safe to point
 * at a live website. Every one of them corresponds to a way this kind of
 * feature goes wrong:
 *
 *   - an editor that "helpfully" clears the other languages when you save one
 *   - a stored section type nobody registered, rendering who knows what
 *   - a javascript: URL typed into a button label field
 *   - a restore that deletes the history it restored from
 *   - a bad row that blanks the public homepage
 *
 * None of this needs a database, which is the point: the guarantees hold
 * before any SQL runs.
 */

const RULES = {
  knownTypes: ['hero', 'action_launcher', 'rich_text'],
  variantsFor: type => (type === 'hero' ? ['default', 'compact'] : ['default']),
  knownRoutes: ['/', '/about', '/verify', '/mortgage', '/verify/:id'],
};

/* ---------------------------------------------------------------- *
 * Locale isolation                                                  *
 * ---------------------------------------------------------------- */

test('editing one locale leaves every other locale untouched', () => {
  let section = makeSection('hero', 's1');
  for (const locale of LOCALES) {
    section = setSectionField(section, 'title', locale, `title-${locale}`);
  }

  section = setSectionField(section, 'title', 'en', 'rewritten in English');

  assert.equal(section.content.title.en, 'rewritten in English');
  for (const locale of LOCALES.filter(l => l !== 'en')) {
    assert.equal(section.content.title[locale], `title-${locale}`,
      `${locale} was modified by an edit to en`);
  }
});

test('clearing an override returns that locale to the site default, and only that locale', () => {
  let section = makeSection('hero', 's1');
  section = setSectionField(section, 'title', 'ka', 'ქართული');
  section = setSectionField(section, 'title', 'en', 'English');

  section = setSectionField(section, 'title', 'en', '   ');

  assert.equal(readLocalized(section.content.title, 'en'), undefined);
  assert.equal(readLocalized(section.content.title, 'ka'), 'ქართული');
});

test('setLocalized never mutates the object it is given', () => {
  const original = { en: 'before' };
  const next = setLocalized(original, 'ka', 'after');
  assert.deepEqual(original, { en: 'before' });
  assert.equal(next.ka, 'after');
  assert.equal(next.en, 'before');
});

test('translation status separates an edit, a site default and a genuine gap', () => {
  const text = { en: 'edited' };
  assert.equal(fieldStatus(text, 'en', true), 'edited');
  // Backed by a translation key: the reviewed site copy shows, so nothing
  // is missing.
  assert.equal(fieldStatus(text, 'ru', true), 'default');
  // Admin-created content with no key behind it genuinely has a hole.
  assert.equal(fieldStatus(text, 'ru', false), 'missing');
});

/* ---------------------------------------------------------------- *
 * Ordering and visibility                                           *
 * ---------------------------------------------------------------- */

test('reorder moves one item and keeps every other one', () => {
  const items = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorder(items, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(reorder(items, 3, 0), ['d', 'a', 'b', 'c']);
  // The source array is never touched.
  assert.deepEqual(items, ['a', 'b', 'c', 'd']);
});

test('reorder clamps out-of-range targets instead of dropping the item', () => {
  const items = ['a', 'b', 'c'];
  assert.deepEqual(reorder(items, 0, 99), ['b', 'c', 'a']);
  assert.deepEqual(reorder(items, 2, -5), ['c', 'a', 'b']);
  assert.deepEqual(reorder(items, 9, 0), ['a', 'b', 'c'], 'unknown source is a no-op');
});

test('moving a section persists as array order, and every section survives', () => {
  const page = {
    ...emptyPage(),
    sections: [makeSection('hero', 'a'), makeSection('action_launcher', 'b'), makeSection('rich_text', 'c')],
  };

  const moved = moveSection(page, 'c', -1);
  assert.deepEqual(moved.sections.map(s => s.id), ['a', 'c', 'b']);
  assert.equal(moved.sections.length, 3);

  const roundTrip = normalizePage(JSON.parse(JSON.stringify(moved)), RULES);
  assert.deepEqual(roundTrip.sections.map(s => s.id), ['a', 'c', 'b'],
    'order did not survive a save and reload');
});

test('a disabled section stays in the document but is marked not to render', () => {
  const page = { ...emptyPage(), sections: [makeSection('hero', 'a')] };
  const off = setSectionEnabled(page, 'a', false);
  assert.equal(off.sections.length, 1, 'disabling must not delete content');
  assert.equal(off.sections[0].enabled, false);
  assert.equal(normalizePage(JSON.parse(JSON.stringify(off)), RULES).sections[0].enabled, false);
});

/* ---------------------------------------------------------------- *
 * What may render                                                   *
 * ---------------------------------------------------------------- */

test('an unregistered section type is refused rather than rendered', () => {
  assert.equal(normalizeSection({ id: 'x', type: 'arbitrary_component' }, RULES), null);
  assert.equal(normalizeSection({ id: 'x', type: '<script>' }, RULES), null);
  assert.equal(normalizeSection({ id: 'x' }, RULES), null);

  const page = normalizePage(
    { schema: 1, sections: [{ id: 'a', type: 'hero' }, { id: 'b', type: 'evil' }] }, RULES);
  assert.deepEqual(page.sections.map(s => s.type), ['hero']);
});

test('a variant the code does not implement falls back instead of rendering nothing', () => {
  assert.equal(normalizeSection({ id: 'x', type: 'hero', variant: 'compact' }, RULES).variant, 'compact');
  assert.equal(normalizeSection({ id: 'x', type: 'hero', variant: 'neon' }, RULES).variant, 'default');
});

test('two sections cannot share an id', () => {
  const page = normalizePage(
    { schema: 1, sections: [{ id: 'dup', type: 'hero' }, { id: 'dup', type: 'rich_text' }] }, RULES);
  assert.equal(page.sections.length, 1);
});

test('an unrecognised schema version is treated as empty, not guessed at', () => {
  assert.deepEqual(normalizePage({ schema: 99, sections: [{ id: 'a', type: 'hero' }] }, RULES).sections, []);
  assert.deepEqual(normalizePage(null, RULES).sections, []);
  assert.deepEqual(normalizePage('not an object', RULES).sections, []);
});

/* ---------------------------------------------------------------- *
 * Links and media                                                   *
 * ---------------------------------------------------------------- */

test('unsafe URL schemes are refused in every disguise', () => {
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)'.replace('\t', ''),
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'file:///etc/passwd',
  ]) {
    const verdict = checkLink(bad, RULES.knownRoutes);
    assert.equal(verdict.ok, false, `${bad} was accepted`);
  }
});

test('an internal route is accepted, and an unknown one warns rather than failing', () => {
  assert.deepEqual(checkLink('/verify', RULES.knownRoutes), { ok: true, kind: 'internal' });
  assert.deepEqual(checkLink('/verify?code=123', RULES.knownRoutes), { ok: true, kind: 'internal' });
  assert.deepEqual(checkLink('/verify/abc123', RULES.knownRoutes), { ok: true, kind: 'internal' },
    'a parameterised route should match by shape');

  const unknown = checkLink('/no-such-page', RULES.knownRoutes);
  assert.equal(unknown.ok, true);
  assert.equal(unknown.warning, 'unknown-route');
});

test('external links must be http or https and must parse', () => {
  assert.equal(checkLink('https://example.com/x', RULES.knownRoutes).kind, 'external');
  assert.equal(checkLink('example.com', RULES.knownRoutes).ok, false);
  assert.equal(checkLink('', RULES.knownRoutes).ok, false);
});

test('a link with an unsafe href is dropped from a stored section', () => {
  const section = normalizeSection({
    id: 'x', type: 'hero',
    links: {
      good: { href: '/verify', label: { en: 'Verify' } },
      bad: { href: 'javascript:alert(1)', label: { en: 'Click' } },
    },
  }, RULES);
  assert.ok(section.links.good);
  assert.equal(section.links.bad, undefined);
});

test('an image src is held to the same scheme rule as a link', () => {
  const section = normalizeSection({
    id: 'x', type: 'hero',
    media: {
      ok: { url: '/images/hero/a.jpg', alt: { en: 'A' } },
      evil: { url: 'javascript:alert(1)' },
      empty: { url: '   ' },
    },
  }, RULES);
  assert.ok(section.media.ok);
  assert.equal(section.media.evil, undefined);
  assert.equal(section.media.empty, undefined);
});

/* ---------------------------------------------------------------- *
 * RTL content                                                       *
 * ---------------------------------------------------------------- */

test('right-to-left content survives a save and reload unchanged', () => {
  const arabic = 'تحقّق من عقار برمزه العقاري';
  const hebrew = 'אמתו נכס לפי קוד קדסטרלי';
  let section = makeSection('hero', 'rtl');
  section = setSectionField(section, 'title', 'ar', arabic);
  section = setSectionField(section, 'title', 'he', hebrew);

  const reloaded = normalizeSection(JSON.parse(JSON.stringify(section)), RULES);
  assert.equal(reloaded.content.title.ar, arabic);
  assert.equal(reloaded.content.title.he, hebrew);
});

/* ---------------------------------------------------------------- *
 * Versions                                                          *
 * ---------------------------------------------------------------- */

test('restoring a version produces a draft and removes nothing from history', () => {
  const v1 = { ...emptyPage(), sections: [makeSection('hero', 'a')] };
  const v2 = { ...emptyPage(), sections: [makeSection('hero', 'a'), makeSection('rich_text', 'b')] };
  const history = [
    { version: 1, content: v1, note: null, publishedAt: 't1', publishedBy: 'u' },
    { version: 2, content: v2, note: null, publishedAt: 't2', publishedBy: 'u' },
  ];

  const draft = restoreAsDraft(history[0].content, RULES);

  assert.deepEqual(draft.sections.map(s => s.id), ['a'], 'restore did not reproduce the snapshot');
  assert.equal(history.length, 2, 'history was mutated by a restore');
  assert.deepEqual(history[1].content.sections.map(s => s.id), ['a', 'b'],
    'the version restored past was altered');
  assert.equal(nextVersion(history), 3, 'a restore must publish forward, not overwrite');
});

test('version numbers only ever go up, so an older snapshot stays reachable', () => {
  assert.equal(nextVersion([]), 1);
  assert.equal(nextVersion([{ version: 4 }, { version: 2 }]), 5);
});

/* ---------------------------------------------------------------- *
 * The fallback that keeps the public site alive                      *
 * ---------------------------------------------------------------- */

test('a corrupt stored page degrades to empty, which renders the shipped site', () => {
  // Empty is not a blank website: SitePage falls back to the code-defined
  // composition when a page has no usable sections. The guarantee tested
  // here is that garbage never produces a half-built page.
  for (const junk of [undefined, null, 0, '', [], { sections: 'nope' }, { schema: 1, sections: null }]) {
    const page = normalizePage(junk, RULES);
    assert.equal(page.schema, 1);
    assert.deepEqual(page.sections, []);
    assert.equal(page.seo.noindex, false, 'garbage must never noindex the site');
  }
});

test('noindex is off unless it was explicitly stored as true', () => {
  assert.equal(normalizePage({ schema: 1, seo: { noindex: 'yes' } }, RULES).seo.noindex, false);
  assert.equal(normalizePage({ schema: 1, seo: { noindex: 1 } }, RULES).seo.noindex, false);
  assert.equal(normalizePage({ schema: 1, seo: { noindex: true } }, RULES).seo.noindex, true);
});
