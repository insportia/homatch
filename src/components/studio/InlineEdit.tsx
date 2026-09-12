import { useCallback, useEffect, useRef } from 'react';
import { FIELD_ATTR } from '@/site/content';

/**
 * EDITING THE PAGE BY TYPING ON IT.
 *
 * Every element that renders editable copy carries its own identity —
 * section, field, item, locale — put there by the component that rendered it
 * (see useFieldProps). This layer turns those elements into text boxes in
 * place. Nothing is duplicated into a sidebar, nothing is matched by
 * appearance, and the element that becomes editable is the element you can
 * see.
 *
 * WHY IDENTITY COMES FROM THE MODEL AND NOT FROM THE TEXT
 *
 * The first version of this found elements by comparing their text to the
 * value the model held. It worked exactly once. The comparison ran against
 * the value from BEFORE the edit, so a field stopped being editable the
 * moment it was edited, and two fields that happened to say the same thing
 * were indistinguishable. Identity cannot be derived from content that is
 * about to change — so it is not derived at all, it is declared.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never reads innerHTML. A commit takes `textContent` only, and paste is
 * intercepted and reinserted as plain text, so nothing a clipboard can carry
 * — markup, a script, an onerror attribute — reaches the stored draft. The
 * model holds plain localized strings and this cannot change that.
 */

export interface FieldTarget {
  sectionId: string;
  field: string;
  item?: string;
  locale: string;
}

export interface InlineEditProps {
  /** The rendered page's root, inside the preview document. */
  root: HTMLElement | null;
  /** Whether a field takes newlines, according to the registry. */
  isMultiline: (sectionId: string, field: string) => boolean;
  /** Commit a new value. Called once, and only on a real change. */
  onCommit: (target: FieldTarget, value: string) => void;
  /** Told which field the caret entered, so the shell can follow along. */
  onFocusField?: (target: FieldTarget) => void;
  /** Off while the admin is only looking. */
  enabled: boolean;
  /** Re-scan when the page's content or locale changes. */
  revision: unknown;
}

const SEL = `[${FIELD_ATTR.field}]`;

/** Non-breaking spaces come back from contenteditable; the model stores real ones. */
const normalise = (s: string) => s.replace(/ /g, ' ');

function targetOf(el: HTMLElement): FieldTarget | null {
  const sectionId = el.getAttribute(FIELD_ATTR.section);
  const field = el.getAttribute(FIELD_ATTR.field);
  if (!sectionId || !field) return null;
  return {
    sectionId,
    field,
    item: el.getAttribute(FIELD_ATTR.item) ?? undefined,
    locale: el.getAttribute(FIELD_ATTR.locale) ?? '',
  };
}

/**
 * Applies editing to every marked element in the page.
 *
 * Runs as an effect against real DOM rather than rendering anything, which is
 * why it returns null. React owns the text; this owns the affordance.
 */
export function InlineEditLayer({
  root, isMultiline, onCommit, onFocusField, enabled, revision,
}: InlineEditProps) {
  // Held in refs so the listeners always see the current callbacks without
  // being torn down and rebuilt while somebody is typing.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const focusRef = useRef(onFocusField);
  focusRef.current = onFocusField;
  const multilineRef = useRef(isMultiline);
  multilineRef.current = isMultiline;

  const apply = useCallback(() => {
    if (!root) return () => {};
    const cleanups: Array<() => void> = [];

    for (const node of Array.from(root.querySelectorAll<HTMLElement>(SEL))) {
      const target = targetOf(node);
      if (!target) continue;

      if (!enabled) {
        node.removeAttribute('contenteditable');
        node.style.cursor = '';
        continue;
      }

      const multiline = multilineRef.current(target.sectionId, target.field);

      /*
       * plaintext-only is the first line of defence, not the only one. It
       * stops the browser producing markup as you type; the paste handler
       * below stops the clipboard bringing any in. Firefox only shipped the
       * value in 2024, which is why neither is load-bearing on its own.
       */
      node.setAttribute('contenteditable', 'plaintext-only');
      node.setAttribute('spellcheck', 'false');
      node.setAttribute('role', 'textbox');
      if (multiline) node.setAttribute('aria-multiline', 'true');
      node.style.cursor = 'text';

      /*
       * The value as it stood when the caret arrived — not when this effect
       * ran. Escape restores this and a commit is compared against it, so
       * both are measured from where the editing actually began.
       */
      let original = normalise(node.textContent ?? '');

      const onFocus = () => {
        original = normalise(node.textContent ?? '');
        node.dataset.hmEditing = 'on';
        focusRef.current?.(target);
      };

      const commit = () => {
        // textContent, never innerHTML: a paste must not be able to carry
        // markup into the stored draft.
        const next = normalise(node.textContent ?? '');
        if (next.trim() === original.trim()) return;
        commitRef.current(target, next.trim());
      };

      const onBlur = () => {
        delete node.dataset.hmEditing;
        commit();
      };

      /*
       * Is this text living inside something the keyboard can press?
       *
       * A CTA label sits inside its button. Space and Enter are how a
       * button is activated from the keyboard, and that activation is a
       * DEFAULT ACTION — stopPropagation does not touch it, and neither
       * does making the button ignore pointer events. Typing the first
       * space of "Start the check" pressed the button and navigated the
       * editor away from Site Studio, destroying the preview mid-word.
       */
      const inControl = node.closest('button, a[href], summary, [role="button"]') !== null;

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === ' ' && inControl) {
          // Insert the space ourselves, so the button never sees the key.
          e.preventDefault();
          node.ownerDocument.execCommand('insertText', false, ' ');
          return;
        }
        if (e.key === 'Escape') {
          // Cancel: put the text back and leave, committing nothing.
          e.preventDefault();
          e.stopPropagation();
          node.textContent = original;
          node.blur();
          return;
        }
        if (e.key === 'Enter') {
          // A heading is one line. Enter finishes it rather than growing a
          // second line the stored value cannot represent.
          // preventDefault here also stops Enter pressing a surrounding button.
          if (!multiline || inControl) { e.preventDefault(); node.blur(); return; }
          // A paragraph takes newlines, so Enter makes one and Shift+Enter
          // is the deliberate "done" — the opposite way round from a chat
          // box, because here the common action is writing another line.
          if (e.shiftKey) { e.preventDefault(); node.blur(); }
        }
      };

      const onPaste = (e: ClipboardEvent) => {
        /*
         * Take the plain text and insert it ourselves.
         *
         * Left alone, pasting rich content inserts the clipboard's HTML —
         * images, links, styles, and anything else it carries. Reading only
         * text/plain and writing that back is what makes "paste an
         * <img onerror=...>" produce those characters and nothing else.
         */
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') ?? '';
        const clean = multiline ? text : text.replace(/[\r\n]+/g, ' ');
        node.ownerDocument.execCommand('insertText', false, clean);
      };

      const onDrop = (e: DragEvent) => {
        // A drop is a paste by another name and carries the same HTML.
        // There is no safe way to accept it here, so it is refused.
        e.preventDefault();
      };

      // The preview is also click-to-select. A click that lands on text
      // belongs to the caret, and must not be read as a click on the section.
      const stop = (e: Event) => e.stopPropagation();

      node.addEventListener('focus', onFocus);
      node.addEventListener('blur', onBlur);
      node.addEventListener('keydown', onKeyDown as EventListener);
      node.addEventListener('paste', onPaste as EventListener);
      node.addEventListener('drop', onDrop as EventListener);
      node.addEventListener('click', stop);
      node.addEventListener('mousedown', stop);

      cleanups.push(() => {
        node.removeEventListener('focus', onFocus);
        node.removeEventListener('blur', onBlur);
        node.removeEventListener('keydown', onKeyDown as EventListener);
        node.removeEventListener('paste', onPaste as EventListener);
        node.removeEventListener('drop', onDrop as EventListener);
        node.removeEventListener('click', stop);
        node.removeEventListener('mousedown', stop);
      });
    }

    return () => { for (const c of cleanups) c(); };
  }, [root, enabled, revision]);

  useEffect(() => apply(), [apply]);

  return null;
}
