import React, { useCallback, useEffect, useRef } from 'react';

/**
 * CLICK THE TEXT ON THE PAGE AND EDIT IT THERE.
 *
 * WHY THIS IS A DOM LAYER AND NOT A COMPONENT
 *
 * Nineteen section components render their copy as `{sf('title', 'key')}`.
 * `useSectionField` returns a STRING, and the components interpolate it into
 * JSX and into attributes — `placeholder={sf(...)}` among them — so it
 * cannot be turned into a React element without breaking them. Rewriting all
 * nineteen to use an <Editable> wrapper would be a large, risky change to
 * files whose only job is the public site's appearance.
 *
 * So the hook records the exact string each field rendered as, and this
 * layer finds the element in the already-rendered DOM that produced it and
 * makes that element editable. The components are untouched, and only fields
 * the registry declares can ever become editable — which is the same
 * allowlist the inspector uses.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never reads innerHTML. A commit takes `textContent` only, so nothing a
 * paste can carry — markup, a script, a style attribute — can reach the
 * stored draft. The model stores plain localized strings and this cannot
 * change that.
 */

export interface EditableFieldRef {
  /** The field key in the section's registry definition. */
  field: string;
  /** The exact string it rendered as, used to find its element. */
  value: string;
  /** Whether the registry says this field is multiline. */
  multiline: boolean;
}

export interface InlineEditLayerProps {
  /** The rendered section's root element, inside the preview document. */
  root: HTMLElement | null;
  /**
   * Which fields may be edited, and what they currently say — READ WHEN
   * THE EFFECT RUNS, not when the parent rendered.
   *
   * A snapshot array is wrong here, and wrong in a way that only shows up
   * on the second edit. The values are recorded by the section components
   * DURING their render, which happens after the parent has already
   * computed its props. So a snapshot always carries the previous pass's
   * text: right the first time, and one edit stale ever after. The layer
   * would then hunt the DOM for text that is no longer there, find
   * nothing, and silently leave the field uneditable.
   *
   * Effects run after the whole tree has committed, so asking then gets
   * the text the page is actually showing.
   */
  getFields: () => EditableFieldRef[];
  /**
   * Changes whenever the rendered content might have. Only used to
   * re-run the effect; its value is never read.
   */
  revision: unknown;
  /** Commit a new value for a field. */
  onCommit: (field: string, value: string) => void;
  /** Off while the admin is only navigating. */
  enabled: boolean;
}

/** Marks the deepest element whose own text is exactly `value`. */
function findElementFor(root: HTMLElement, value: string, claimed: Set<Element>): HTMLElement | null {
  const target = value.trim();
  if (!target) return null;

  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let best: HTMLElement | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as HTMLElement;
    if (claimed.has(el)) continue;
    // Editing a control's label in place would fight the control.
    if (el.closest('button, a, input, textarea, select')) continue;
    if ((el.textContent ?? '').trim() !== target) continue;
    // Deepest wins: a <p> and the <span> inside it can both match, and the
    // span is the element that actually rendered the string.
    best = el;
  }
  return best;
}

/**
 * Applies the affordance to a rendered section.
 *
 * Runs as an effect against real DOM rather than rendering anything, which
 * is why it returns null.
 */
export function InlineEditLayer({ root, getFields, revision, onCommit, enabled }: InlineEditLayerProps) {
  // Held in a ref so the listeners below always see the current committer
  // without being torn down and rebuilt on every keystroke elsewhere.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const fieldsRef = useRef(getFields);
  fieldsRef.current = getFields;

  const apply = useCallback(() => {
    if (!root) return () => {};
    const claimed = new Set<Element>();
    const cleanups: Array<() => void> = [];

    for (const { field, value, multiline } of fieldsRef.current()) {
      const el = findElementFor(root, value, claimed);
      if (!el) continue;
      claimed.add(el);

      el.setAttribute('data-studio-field', field);
      if (!enabled) continue;

      el.setAttribute('contenteditable', 'plaintext-only');
      el.setAttribute('spellcheck', 'false');
      el.setAttribute('role', 'textbox');
      if (multiline) el.setAttribute('aria-multiline', 'true');
      el.style.outline = '1px dashed hsl(38 88% 54% / 0.55)';
      el.style.outlineOffset = '2px';
      el.style.borderRadius = '2px';
      el.style.cursor = 'text';

      const original = value;

      const onFocus = () => { el.style.outline = '2px solid hsl(38 88% 54%)'; };
      const onBlurEl = () => {
        el.style.outline = '1px dashed hsl(38 88% 54% / 0.55)';
        // textContent, never innerHTML: a paste must not be able to carry
        // markup into the stored draft.
        const next = (el.textContent ?? '').trim();
        if (next !== original.trim()) commitRef.current(field, next);
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          // Cancel: put the text back and leave, committing nothing.
          e.preventDefault();
          el.textContent = original;
          el.blur();
          return;
        }
        if (e.key === 'Enter' && !multiline) {
          // A single-line field commits on Enter rather than growing a line
          // the stored value cannot represent.
          e.preventDefault();
          el.blur();
        }
        if (e.key === 'Enter' && multiline && !e.shiftKey) {
          // Multiline: Enter is a newline, Shift+Enter commits, so the
          // common case is the one that does not lose work.
        }
      };
      // The preview is also click-to-select; editing must not re-select and
      // re-render the element out from under the caret.
      const stop = (e: Event) => e.stopPropagation();

      el.addEventListener('focus', onFocus);
      el.addEventListener('blur', onBlurEl);
      el.addEventListener('keydown', onKeyDown as EventListener);
      el.addEventListener('click', stop);
      el.addEventListener('mousedown', stop);

      cleanups.push(() => {
        el.removeEventListener('focus', onFocus);
        el.removeEventListener('blur', onBlurEl);
        el.removeEventListener('keydown', onKeyDown as EventListener);
        el.removeEventListener('click', stop);
        el.removeEventListener('mousedown', stop);
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
        el.removeAttribute('role');
        el.removeAttribute('aria-multiline');
        el.removeAttribute('data-studio-field');
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.style.borderRadius = '';
        el.style.cursor = '';
      });
    }

    return () => { for (const c of cleanups) c(); };
    // `revision` is a dependency on purpose: it is how this effect learns
    // that the page's text may have changed and the elements need finding
    // again. biome-ignore lint/correctness/useExhaustiveDependencies: intentional.
  }, [root, enabled, revision]);

  useEffect(() => apply(), [apply]);

  return null;
}
