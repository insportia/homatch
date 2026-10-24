// EMAIL DESIGNER — completeness checks a design must pass before review (shared by the Review
// step and campaign_submit, so the browser's checklist and the server's refusal never disagree).

import { type EmailDoc, type LeafBlock, normalizeDoc, walkBlocks } from './document.ts';

/* Every leaf at any depth (columns and sections included); a hidden layer is never sent, so its
   contents are never checked. */
const leaves = (doc: EmailDoc): LeafBlock[] => {
  const skip = new Set<string>();
  for (const b of walkBlocks(doc.blocks)) {
    if (!b.hidden && !skip.has(b.id)) continue;
    skip.add(b.id);
    if (b.type === 'columns') for (const x of [...b.columns[0], ...b.columns[1]]) skip.add(x.id);
    if (b.type === 'section') for (const x of walkBlocks(b.children)) skip.add(x.id);
  }
  return walkBlocks(doc.blocks).filter((b): b is LeafBlock => b.type !== 'columns' && b.type !== 'section' && !skip.has(b.id));
};

/** Block ids whose button has a label but no destination (it would silently disappear). */
export function buttonsMissingLink(input: unknown): string[] {
  return leaves(normalizeDoc(input)).filter((b) =>
    (b.type === 'button' && b.label.trim() && !b.href)
    || ((b.type === 'banner' || b.type === 'card') && b.buttonLabel.trim() && !b.buttonHref)
    || (b.type === 'video' && b.thumbSrc && !b.href)).map((b) => b.id);
}

/** Block ids with an image but no alternative text (shown when images are blocked; read aloud). */
export function imagesMissingAlt(input: unknown): string[] {
  return leaves(normalizeDoc(input)).filter((b) =>
    ((b.type === 'image' || b.type === 'logo') && b.src && !b.alt.trim())
    || ((b.type === 'banner' || b.type === 'card') && b.imageSrc && !b.imageAlt.trim())
    || (b.type === 'header' && b.logoSrc && !(b.logoAlt.trim() || b.brand.trim()))
    || (b.type === 'video' && b.thumbSrc && !b.alt.trim())
    || (b.type === 'gallery' && b.images.some((x) => x.src && !x.alt.trim()))).map((b) => b.id);
}
