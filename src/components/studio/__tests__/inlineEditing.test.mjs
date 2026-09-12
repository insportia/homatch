import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * SITE STUDIO — EDITING ON THE PAGE ITSELF.
 *
 * Every assertion here corresponds to a defect that was found by opening the
 * editor in a real browser and pressing the buttons, not by reading the code.
 * They are source-level because each one is a property of how these files are
 * written, and because the browser gate that found them needs a build, a
 * Chrome and forty seconds — too slow to be the only thing standing between a
 * refactor and a silently broken editor.
 *
 * The browser gate still exists and still runs. This is the fast net.
 */

const inlineEdit = readFileSync('src/components/studio/InlineEdit.tsx', 'utf8');
const preview = readFileSync('src/components/studio/StudioPreview.tsx', 'utf8');
const sitePage = readFileSync('src/site/render/SitePage.tsx', 'utf8');
const richText = readFileSync('src/components/home/sections/RichTextSection.tsx', 'utf8');
const state = readFileSync('src/components/studio/useStudioState.ts', 'utf8');

/**
 * The file with its comments removed.
 *
 * These files explain themselves at length, and several explanations name
 * the very thing the code must not do ("never reads innerHTML"). Asserting
 * an absence against the raw text would fail on the sentence promising it.
 */
const code = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('an edit can never carry markup into the draft', () => {
  // The single most important property in the feature. A paste carries
  // text/html, and contenteditable will happily insert it; reading innerHTML
  // on commit would store a <script> or an onerror attribute as page content.
  assert.equal(code(inlineEdit).includes('innerHTML'), false,
    'InlineEdit must never read innerHTML — commits are textContent only');
  assert.match(inlineEdit, /const next = \(el\.textContent \?\? ''\)\.trim\(\)/);
  // plaintext-only also stops the browser producing markup in the first place.
  assert.match(inlineEdit, /setAttribute\('contenteditable', 'plaintext-only'\)/);
});

test('only fields the registry declares can become editable', () => {
  // The allowlist is the registry's own field list, the same one the
  // inspector uses. Nothing walks the DOM looking for text to offer up.
  assert.match(preview, /def\.fields[\s\S]{0,200}multiline: f\.kind === 'textarea'/);
});

test('the edit layer reads its values when the effect runs, not when props were built', () => {
  // The values are recorded during the CHILDREN's render, after the parent
  // has computed props. A snapshot array is therefore always one edit stale:
  // correct the first time, and thereafter the layer hunts for text that is
  // no longer on the page, finds nothing, and leaves the field uneditable.
  assert.match(inlineEdit, /getFields: \(\) => EditableFieldRef\[\]/);
  assert.match(inlineEdit, /fieldsRef\.current\(\)/);
  assert.equal(/fields: EditableFieldRef\[\]/.test(code(inlineEdit)), false,
    'a snapshot array prop would reintroduce the stale-value bug');
});

test('the selected section stops swallowing clicks', () => {
  // The click-to-select overlay covers the whole section. While it is a
  // button, nothing underneath can be clicked — including the text — so
  // click-to-edit is unreachable on the one section it applies to.
  assert.match(sitePage, /const isSelected = selectedId === section\.id;/);
  assert.match(sitePage, /isSelected \? \([\s\S]{0,220}pointer-events-none/);
});

test('the preview document is standards mode', () => {
  // An empty iframe has no doctype, which puts the preview in quirks mode:
  // it stops being a faithful preview of a page that HAS a doctype, and
  // scrollIntoView silently does nothing because the scrolling element moves
  // to <body>.
  assert.match(preview, /const FRAME_DOC = '<!doctype html>/);
  assert.match(preview, /srcDoc=\{FRAME_DOC\}/);
});

test('corrections to the scroll are instant, not animated', () => {
  // `behavior: 'auto'` defers to CSS, and the site's stylesheet — cloned into
  // the preview with everything else — sets scroll-behavior: smooth. A
  // correction that animates races the scroll it is correcting.
  assert.match(preview, /behavior: 'instant'/);
  assert.equal(code(preview).includes("behavior: 'auto'"), false);
});

test('the preview cannot navigate away from itself', () => {
  // The selected section deliberately lets clicks through, and these are the
  // real components, with real links in them.
  assert.match(preview, /closest\('a\[href\]'\)\) e\.preventDefault\(\)/);
  assert.match(preview, /addEventListener\('submit', \(e\) => e\.preventDefault\(\), true\)/);
});

test('an empty block is visible and writable in the editor, and absent in public', () => {
  // Without this a freshly added section renders zero pixels tall: the admin
  // presses "add", nothing appears, and there is no text to click into.
  assert.match(richText, /const editing = useIsEditing\(\);/);
  assert.match(richText, /editing \? t\('studio_ph_title'\) : undefined/);
  // ...but the prompt is not content. The public render still returns null,
  // because `editing` is false there and the stored value is empty.
  assert.match(richText, /if \(!title\) return null;/);
});

test('placeholders are never written to the draft', () => {
  // record() only tells the editor what is on screen. The only thing that
  // writes is a commit, and a commit happens only when the text CHANGED.
  assert.match(inlineEdit, /if \(next !== original\.trim\(\)\) commitRef\.current\(field, next\)/);
  assert.equal(code(richText).includes('editLocale'), false,
    'the section component must not write content');
  assert.equal(code(richText).includes('setSectionField'), false);
});

test('an inline commit names its section instead of trusting the selection', () => {
  // Commits fire from a blur handler, by which time a click may already have
  // moved the selection. Routing through selectedId would write the text into
  // whichever section happened to be selected at that moment — the same
  // mistake the visibility toggle had.
  assert.match(state, /editSectionField = useCallback\(\(sectionId: string, field: string, value: string\)/);
  assert.match(state, /patch\(sectionId, s => editLocale\(s, field, locale, value\)\)/);
});

test('Escape abandons an edit and Enter commits a single-line field', () => {
  assert.match(inlineEdit, /if \(e\.key === 'Escape'\)[\s\S]{0,160}el\.textContent = original;/);
  assert.match(inlineEdit, /if \(e\.key === 'Enter' && !multiline\)/);
});

test('duplicate and delete stay restricted to the repeatable block', () => {
  // There is one hero. A second copy of it is not a page the design supports,
  // and deleting it is not something an admin should be able to do by
  // accident — hide is the reversible control for that.
  assert.match(state, /if \(!source \|\| !sectionDef\(source\.type\)\?\.repeatable\) return prev;/);
  assert.match(state, /if \(!section \|\| !sectionDef\(section\.type\)\?\.repeatable\) return;/);
});
