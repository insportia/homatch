// JOB 3 regression guard — the SPECIFIC legacy patterns this migration
// removed from Verify and Contracts, so they cannot quietly return.
// Deliberately narrow: semantic status colors (emerald/amber/slate badges),
// quiet metadata, and genuine disabled states are all still allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const FILES = [
  ...readdirSync(join(root, 'src/components/verify')).filter((f) => f.endsWith('.tsx'))
    .map((f) => `src/components/verify/${f}`),
  ...readdirSync(join(root, 'src/components/contracts')).filter((f) => f.endsWith('.tsx'))
    .map((f) => `src/components/contracts/${f}`),
  'src/pages/ContractsPage.tsx',
  'src/pages/ContractResultPage.tsx',
  'src/components/documents/DropZone.tsx',
];

test('no translucent cream-on-cream nested surfaces (bg-background/40)', () => {
  const hits = FILES.filter((f) => read(f).includes('bg-background/40'));
  assert.deepEqual(hits, [], `washed nested cards returned in: ${hits.join(', ')}`);
});

test('no double-quieted label text (muted token * extra opacity)', () => {
  const hits = FILES.filter((f) => /text-muted-foreground\/[4-7]0/.test(read(f)));
  assert.deepEqual(hits, [], `over-faded labels returned in: ${hits.join(', ')}`);
});

test('the selected contract-type chip is solid navy, never a pale tint', () => {
  const s = read('src/pages/ContractsPage.tsx');
  assert.ok(s.includes("'border-[#0C1119] bg-[#0C1119] font-semibold text-white shadow-card'"));
  assert.ok(!s.includes('bg-primary/10 text-foreground'), 'the pale selected tint came back');
});

test('the dropzone CTA is a real primary action (navy pill, gold detail)', () => {
  const s = read('src/components/documents/DropZone.tsx');
  assert.ok(s.includes('bg-[#0C1119]'));
  assert.ok(s.includes('border-foreground/30'), 'the resting border is drawn from ink, not the pale token');
});

test('research progress is gold on an ink track, not translucent navy', () => {
  const s = read('src/components/verify/ResearchStream.tsx');
  assert.ok(s.includes('bg-[hsl(38_92%_54%)]'));
  assert.ok(!s.includes('bg-primary/70'), 'the grey-navy progress fill came back');
});
