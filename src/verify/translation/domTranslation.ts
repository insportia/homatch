// HOMATCH Verify — translating what the report RENDERS.
//
// Why the DOM and not each component: the Georgian on a report comes from
// three places — prose stored in synthesis_json, deterministic copy the server
// wrote, and sentences the browser computes from the evidence (projectStory,
// legalStatus, propertyFacts, visual labels …) across dozens of components.
// Wrapping each string by hand covers what someone remembered to wrap; the
// next component, or the next computed sentence, is Georgian again. Reading
// the rendered text covers everything the customer can see, now and later.
//
// How it stays safe with React: a text node's VALUE is changed in place, never
// the node itself (replacing nodes is what breaks React under browser
// translators). React only writes a text node when its own props change; when
// it does, the new Georgian value is seen by the observer and translated
// again. Each node remembers its Georgian source, so `detach()` puts every
// original back (switching to Georgian, or to another language).
//
// Skipped: anything inside [data-no-translate], [translate="no"], .notranslate,
// script/style, form fields and contenteditable. Attributes a customer reads
// or hears (title, aria-label, alt, placeholder) are translated too.

import { hasGeorgian, splitEdges } from './textTranslation.ts';

export interface DomTranslator {
  lookup(text: string): string | undefined;
  request(text: string): void;
  subscribe(fn: () => void): () => void;
}

export const TRANSLATED_ATTRIBUTES = ['title', 'aria-label', 'alt', 'placeholder'] as const;
const SKIP_SELECTOR = '[data-no-translate],[translate="no"],.notranslate,script,style,noscript,textarea,input,select,[contenteditable="true"],[contenteditable=""]';

type Rec = { source: string; shown: string };

export function attachDomTranslation(root: Element, translator: DomTranslator): () => void {
  const texts = new WeakMap<Text, Rec>();
  const attrs = new WeakMap<Element, Map<string, Rec>>();
  const doc = root.ownerDocument;
  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;

  // Only markers INSIDE the root count: the app marks <html>/<body> translate="no"
  // (App.tsx DomMutationGuard) to keep browser translators from breaking React.
  const skipped = (el: Element | null): boolean => {
    if (!el) return true;
    const m = el.closest(SKIP_SELECTOR);
    return !!m && root.contains(m);
  };

  /** Georgian value → displayed value, or undefined (and requested) when not known yet. */
  const render = (value: string): string | undefined => {
    const { lead, core, trail } = splitEdges(value);
    const hit = translator.lookup(core);
    if (hit === undefined) { translator.request(core); return undefined; }
    return lead + hit + trail;
  };

  const doText = (node: Text): void => {
    const value = node.nodeValue ?? '';
    const rec = texts.get(node);
    if (rec && value === rec.shown && rec.shown !== rec.source) return; // our own write
    if (!hasGeorgian(value) || skipped(node.parentElement)) { if (rec) texts.delete(node); return; }
    const shown = render(value);
    texts.set(node, { source: value, shown: shown ?? value });
    if (shown !== undefined && shown !== value) node.nodeValue = shown;
  };

  const doAttr = (el: Element, name: string): void => {
    const value = el.getAttribute(name);
    let m = attrs.get(el);
    const rec = m?.get(name);
    if (value == null) { m?.delete(name); return; }
    if (rec && value === rec.shown && rec.shown !== rec.source) return;
    if (!hasGeorgian(value) || skipped(el)) { m?.delete(name); return; }
    const shown = render(value);
    if (!m) { m = new Map(); attrs.set(el, m); }
    m.set(name, { source: value, shown: shown ?? value });
    if (shown !== undefined && shown !== value) el.setAttribute(name, shown);
  };

  const doElement = (el: Element): void => {
    if (skipped(el)) return;
    for (const a of TRANSLATED_ATTRIBUTES) if (el.hasAttribute(a)) doAttr(el, a);
  };

  const walk = (start: Node): void => {
    if (start.nodeType === TEXT_NODE) { doText(start as Text); return; }
    if (start.nodeType !== ELEMENT_NODE) return;
    doElement(start as Element);
    const w = doc.createTreeWalker(start, 1 | 4 /* SHOW_ELEMENT | SHOW_TEXT */);
    let n = w.nextNode();
    while (n) {
      if (n.nodeType === TEXT_NODE) doText(n as Text);
      else doElement(n as Element);
      n = w.nextNode();
    }
  };

  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const MO = view?.MutationObserver ?? (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  const observer = MO ? new MO((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes' && m.attributeName) doAttr(m.target as Element, m.attributeName);
      else if (m.type === 'childList') m.addedNodes.forEach((n) => walk(n));
    }
  }) : null;
  observer?.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...TRANSLATED_ATTRIBUTES] });

  walk(root);
  // A batch of translations arrived: everything still Georgian gets another look.
  const unsubscribe = translator.subscribe(() => walk(root));

  return () => {
    unsubscribe();
    observer?.disconnect();
    // Put every original back.
    const w = doc.createTreeWalker(root, 1 | 4);
    let n: Node | null = root;
    while (n) {
      if (n.nodeType === TEXT_NODE) {
        const rec = texts.get(n as Text);
        if (rec && (n as Text).nodeValue === rec.shown && rec.shown !== rec.source) (n as Text).nodeValue = rec.source;
      } else if (n.nodeType === ELEMENT_NODE) {
        const m = attrs.get(n as Element);
        if (m) for (const [name, rec] of m) if ((n as Element).getAttribute(name) === rec.shown && rec.shown !== rec.source) (n as Element).setAttribute(name, rec.source);
      }
      n = w.nextNode();
    }
  };
}

/** Marks a portal's root (rendered outside the report, e.g. the gallery lightbox) as report content. */
export const REPORT_PORTAL_ATTR = 'data-report-portal';

/**
 * Report content rendered through a portal lives under <body>, outside the
 * report's root. Every element marked [data-report-portal] — present now or
 * added later — is translated with the same translator, and restored on detach.
 */
export function attachPortalTranslation(doc: Document, translator: DomTranslator): () => void {
  const body = doc.body;
  if (!body) return () => {};
  const attached = new Map<Element, () => void>();
  const scan = (): void => {
    for (const el of Array.from(body.querySelectorAll(`[${REPORT_PORTAL_ATTR}]`))) {
      if (!attached.has(el)) attached.set(el, attachDomTranslation(el, translator));
    }
    for (const [el, detach] of attached) if (!el.isConnected) { detach(); attached.delete(el); }
  };
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const MO = view?.MutationObserver ?? (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  const observer = MO ? new MO(scan) : null;
  observer?.observe(body, { childList: true });
  scan();
  return () => {
    observer?.disconnect();
    for (const detach of attached.values()) detach();
    attached.clear();
  };
}
