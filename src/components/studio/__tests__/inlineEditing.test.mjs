import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

/*
 * SITE STUDIO — EDITING THE PAGE ITSELF.
 *
 * The browser gate in tests/studio drives the ten real scenarios: clicking a
 * heading, typing in it, pasting markup at it, editing a duplicate. This is
 * the fast net underneath it — the properties of how these files are written,
 * each one corresponding to a defect that the type-checker, the linter and
 * every other test agreed was fine.
 *
 * The most important is the first: identity comes from the model, not from
 * the text. An implementation that matches elements by their rendered content
 * works exactly once, because the content it matches against is the thing
 * that is about to change.
 */

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const inlineEdit = readFileSync('src/components/studio/InlineEdit.tsx', 'utf8');
const content = readFileSync('src/site/content.tsx', 'utf8');
const preview = readFileSync('src/components/studio/StudioPreview.tsx', 'utf8');
const sitePage = readFileSync('src/site/render/SitePage.tsx', 'utf8');
const state = readFileSync('src/components/studio/useStudioState.ts', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

test('a field is identified by the model, never by its text', () => {
  // The whole architecture in one assertion: section, field, item and locale
  // are declared on the element by whatever rendered it.
  assert.match(content, /export const FIELD_ATTR = \{[\s\S]{0,200}section: 'data-hm-section'/);
  assert.match(content, /export function useFieldProps\(\)/);
  assert.match(inlineEdit, /const sectionId = el\.getAttribute\(FIELD_ATTR\.section\)/);
  assert.match(inlineEdit, /const field = el\.getAttribute\(FIELD_ATTR\.field\)/);
});

test('an edit can never carry markup into the draft', () => {
  // A commit reads textContent. A paste is intercepted and reinserted as
  // plain text, so the clipboard's HTML never enters the document at all.
  assert.equal(code(inlineEdit).includes('innerHTML'), false,
    'InlineEdit must never read innerHTML');
  assert.match(inlineEdit, /const next = normalise\(node\.textContent \?\? ''\)/);
  assert.match(inlineEdit, /setAttribute\('contenteditable', 'plaintext-only'\)/);
  assert.match(inlineEdit, /e\.clipboardData\?\.getData\('text\/plain'\)/);
  assert.match(inlineEdit, /execCommand\('insertText', false, clean\)/);
  // A drop is a paste by another name, and carries the same HTML.
  assert.match(inlineEdit, /const onDrop = \(e: DragEvent\) => \{[\s\S]{0,240}e\.preventDefault\(\)/);
});

test('only fields the registry declares can be edited', () => {
  // Nothing walks the DOM looking for text to offer up: an element is
  // editable because a component marked it, and components mark the fields
  // the registry gave them.
  assert.match(preview, /const isMultiline = useCallback\(\(sectionId: string, field: string\)/);
  assert.match(preview, /d\?\.fields\.find\(\(f\) => f\.key === field\)\?\.kind === 'textarea'/);
});

test('the whole page is editable, not just the selected section', () => {
  // "Select a block, then edit it in the sidebar" is the workflow this
  // replaced. A single click has to put the caret in the words under it.
  assert.match(preview, /<InlineEditLayer[\s\S]{0,160}root=\{previewBody\}/);
  assert.match(preview, /onFocusField=\{\(target\) => \{/);
});

test('the select overlay never swallows a click meant for the text', () => {
  // It was a button covering the whole section, so nothing underneath could
  // be clicked, including the text. Click-to-edit could not receive a click.
  assert.match(sitePage, /pointer-events-none absolute inset-0/);
  assert.equal(
    /<button[\s\S]{0,200}absolute inset-0[\s\S]{0,200}onSelect/.test(sitePage), false,
    'a button over the section blocks the caret',
  );
});

test('typing inside a CTA cannot press the button', () => {
  // SPACE and ENTER are how a button is activated from the keyboard, and
  // activation is a DEFAULT action — stopPropagation does not touch it, and
  // neither does making the button ignore pointer events. Typing the first
  // space of "Start the check" navigated the editor away from Studio.
  assert.match(inlineEdit, /const inControl = node\.closest\('button, a\[href\], summary, \[role="button"\]'\)/);
  assert.match(inlineEdit, /if \(e\.key === ' ' && inControl\) \{[\s\S]{0,220}e\.preventDefault\(\)/);
  assert.match(inlineEdit, /if \(!multiline \|\| inControl\) \{ e\.preventDefault\(\); node\.blur\(\); return; \}/);
});

test('the rendered page is inert while it is being edited', () => {
  // Nothing in the page can be followed, submitted or activated by accident,
  // which is also the answer to "links must not navigate away in Studio".
  assert.match(css, /\[data-hm-editing='on'\] \[data-studio-section\] a\[href\]/);
  assert.match(css, /\[data-hm-editing='on'\] \[data-studio-section\] \[data-hm-field\] \{[\s\S]{0,80}pointer-events: auto/);
  assert.match(preview, /doc\.body\.dataset\.hmEditing = editingRef\.current \? 'on' : 'off'/);
});

test('Escape abandons, and Enter means what the field can hold', () => {
  assert.match(inlineEdit, /if \(e\.key === 'Escape'\)[\s\S]{0,220}node\.textContent = original;/);
  assert.match(inlineEdit, /if \(e\.shiftKey\) \{ e\.preventDefault\(\); node\.blur\(\); \}/);
});

test('an edit is written to the field it came from, in the locale it came from', () => {
  // A commit fires on blur, and switching language is a click elsewhere,
  // which blurs. Reading the editor's current locale at that moment would
  // write the old language's text into the new one's field.
  assert.match(state, /atLocale\?: Locale,/);
  assert.match(state, /editLocale\(s, field, atLocale \?\? locale, value\)/);
});

test('the editing affordance cannot move the page', () => {
  // An outline is painted outside the box. A border or padding would take
  // space, so the layout would shift the moment a field became editable —
  // and "what you see is what you get" would stop being true.
  const block = css.slice(css.indexOf('Site Studio: text you can type on'));
  const start = block.indexOf('[data-hm-field][contenteditable]');
  const rule = block.slice(start, block.indexOf('}', start));
  assert.match(rule, /outline: 1px dashed/);
  assert.equal(/border:|padding:|margin:|font-size:|font-family:/.test(rule), false,
    'the affordance changes something that takes space, or changes the type');
});

test('the public site carries none of this', () => {
  // useFieldProps returns nothing outside the editor, so a visitor downloads
  // exactly the HTML they did before Studio existed.
  assert.match(content, /if \(!editing \|\| !section\) return \{\};/);
});

test('every section component marks the copy it renders', () => {
  // A component that reads a field but marks none of it renders text nobody
  // can click — the sidebar-only workflow, one file at a time.
  const dir = 'src/components/home/sections';
  const offenders = [];
  let checked = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
    const src = readFileSync(`${dir}/${file}`, 'utf8');
    if (!/useSectionField\(\)|useSectionRaw\(\)/.test(src)) continue;
    checked += 1;
    if (!src.includes('useFieldProps')) offenders.push(file);
  }
  assert.ok(checked >= 10, `only ${checked} section components read fields — did the folder move?`);
  assert.deepEqual(offenders, [],
    `these render editable copy but mark none of it: ${offenders.join(', ')}`);
});

test('duplicate and delete stay restricted to the repeatable block', () => {
  // There is one hero. A second copy of it is not a page the design supports,
  // and deleting it is not something to do by accident — hide is reversible.
  assert.match(state, /if \(!source \|\| !sectionDef\(source\.type\)\?\.repeatable\) return prev;/);
  assert.match(state, /if \(!section \|\| !sectionDef\(section\.type\)\?\.repeatable\) return;/);
});
