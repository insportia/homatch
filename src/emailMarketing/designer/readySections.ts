// EMAIL DESIGNER — ready-made sections for the Elements panel. Each is a section (one email-safe
// nested table) of ordinary blocks with empty copy: the author writes the words; nothing here
// invents prices, names or facts. Inserted as fresh copies (cloneBlock), so ids never repeat.

import { type Block, createBlock, type LeafBlock, normalizeDoc, type SectionBlock } from './document.ts';

export type ReadySectionKey = 'hero' | 'property' | 'features' | 'two_cards' | 'agent' | 'cta' | 'gallery' | 'closing';
export const READY_SECTIONS: ReadySectionKey[] = ['hero', 'property', 'features', 'two_cards', 'agent', 'cta', 'gallery', 'closing'];

const P = (t: number, r: number, b: number, l: number) => ({ t, r, b, l });
const leaf = <T extends LeafBlock['type']>(type: T, patch: Record<string, unknown> = {}) => ({ ...createBlock(type), padding: P(6, 24, 6, 24), ...patch }) as LeafBlock;
const section = (children: SectionBlock['children'], patch: Record<string, unknown> = {}): SectionBlock =>
  ({ ...(createBlock('section') as SectionBlock), children, ...patch });

export function readySection(key: ReadySectionKey, accent = '#C9973A'): Block {
  let b: Block;
  switch (key) {
    case 'hero':
      b = section([leaf('badge', { color: accent, padding: P(24, 24, 6, 24) }), leaf('heading', { level: 1, align: 'left' }), leaf('text'), leaf('button', { buttonColor: accent })],
        { background: '#0C1119', padding: P(10, 24, 10, 24), radius: 14 });
      break;
    case 'property':
      b = section([leaf('image', { width: 552, radius: 10, padding: P(0, 0, 10, 0) }), leaf('heading', { level: 2 }),
        leaf('facts', { columns: 3, items: [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }] }), leaf('button', { buttonColor: accent })],
        { background: '#FFFFFF', borderWidth: 1, borderColor: '#E7E1D6', padding: P(10, 24, 10, 24), radius: 14 });
      break;
    case 'features':
      b = section([leaf('heading', { level: 2 }), leaf('icon', { glyph: 'check', color: accent }), leaf('icon', { glyph: 'check', color: accent }), leaf('icon', { glyph: 'check', color: accent })],
        { background: '#F6F3EE', padding: P(10, 24, 10, 24), radius: 12 });
      break;
    case 'two_cards':
      b = section([{ ...createBlock('columns'), padding: P(4, 12, 4, 12), gap: 14, columns: [[leaf('card', { padding: P(0, 0, 0, 0) })], [leaf('card', { padding: P(0, 0, 0, 0) })]] } as Block as SectionBlock['children'][number]],
        { background: '#FFFFFF', padding: P(6, 12, 6, 12), radius: 0 });
      break;
    case 'agent':
      b = section([{ ...createBlock('columns'), ratio: '33-67', gap: 16, padding: P(4, 12, 4, 12),
        columns: [[leaf('image', { width: 160, radius: 80, padding: P(0, 0, 0, 0) })], [leaf('heading', { level: 3, padding: P(0, 0, 4, 0) }), leaf('contact', { padding: P(0, 0, 0, 0) })]] } as Block as SectionBlock['children'][number]],
        { background: '#F6F3EE', padding: P(10, 24, 10, 24), radius: 12 });
      break;
    case 'cta':
      b = section([leaf('heading', { level: 2, align: 'center' }), leaf('text', { align: 'center' }), leaf('button', { align: 'center', buttonColor: accent, size: 'lg' })],
        { background: '#FBF4E6', padding: P(10, 24, 10, 24), radius: 14 });
      break;
    case 'gallery':
      b = section([leaf('heading', { level: 2 }), leaf('gallery', { padding: P(6, 24, 6, 24) }), leaf('text')], { background: '#FFFFFF', padding: P(6, 8, 6, 8), radius: 0 });
      break;
    case 'closing':
      b = section([leaf('divider'), leaf('social'), leaf('footer'), leaf('unsubscribe')], { background: '#FFFFFF', padding: P(8, 8, 16, 8), radius: 0 });
      break;
  }
  return normalizeDoc({ blocks: [b] }).blocks[0];
}
