// EMAIL DESIGNER — completeness checks a design must pass before review (shared by the Review
// step and campaign_submit, so the browser's checklist and the server's refusal never disagree).

import { type Block, type EmailDoc, type LeafBlock, normalizeDoc } from './document.ts';

const leaves = (doc: EmailDoc): LeafBlock[] => doc.blocks.flatMap((b: Block) => (b.type === 'columns' ? [...b.columns[0], ...b.columns[1]] : [b]));

/** Block ids whose button has a label but no destination (it would silently disappear). */
export function buttonsMissingLink(input: unknown): string[] {
  return leaves(normalizeDoc(input)).filter((b) =>
    (b.type === 'button' && b.label.trim() && !b.href)
    || ((b.type === 'banner' || b.type === 'card') && b.buttonLabel.trim() && !b.buttonHref)).map((b) => b.id);
}

/** Block ids with an image but no alternative text (shown when images are blocked; read aloud). */
export function imagesMissingAlt(input: unknown): string[] {
  return leaves(normalizeDoc(input)).filter((b) =>
    ((b.type === 'image' || b.type === 'logo') && b.src && !b.alt.trim())
    || ((b.type === 'banner' || b.type === 'card') && b.imageSrc && !b.imageAlt.trim())
    || (b.type === 'header' && b.logoSrc && !(b.logoAlt.trim() || b.brand.trim()))).map((b) => b.id);
}
