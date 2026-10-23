// HOMI copilot guard (owner brief §6): proposals only, no invented figures, never past compliance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPayload, COPILOT_SYSTEM_PROMPT, parseProposal, textBlocksOf } from '../copilot.ts';
import { builtInTemplate } from '../designer/templates.ts';

const req = (over = {}) => ({
  task: 'rewrite', instruction: 'Make it shorter. The apartment is 85 m² and costs $120,000.', language: 'en',
  campaign: { name: 'Vake launch', subject: 'New apartment in Vake' },
  blocks: [{ id: 'h1', type: 'heading', text: 'Hello' }, { id: 't1', type: 'text', text: 'Long text' }, { id: 'b1', type: 'button', label: 'Go', href: 'https://homatch.live' }],
  ...over,
});

test('edits only reach existing blocks and the right field', () => {
  const p = parseProposal({ message: 'Shorter now.', edits: [
    { id: 't1', field: 'text', value: 'An 85 m² apartment in Vake for $120,000.' },
    { id: 'zz', field: 'text', value: 'ghost block' },
    { id: 'b1', field: 'label', value: 'View the apartment' },
    { id: 'h1', field: 'label', value: 'a heading has no label' },
    { id: 'b1', field: 'text', value: 'a button has no text' },
  ] }, req());
  assert.deepEqual(p.edits.map((e) => [e.id, e.field]), [['t1', 'text'], ['b1', 'label']]);
  assert.deepEqual(p.warnings, [], 'figures the user gave are fine');
});

test('a figure HOMI invented is flagged, not silently accepted', () => {
  const p = parseProposal({ message: 'ok', edits: [{ id: 't1', field: 'text', value: 'Only 3 left! Save 15% — now $99,000 with 12% yearly yield.' }] }, req());
  const w = p.warnings.find((x) => x.code === 'UNVERIFIED_FIGURE');
  assert.ok(w, JSON.stringify(p.warnings));
  assert.match(w.detail, /15%/); assert.match(w.detail, /99,000|99000/);
});

test('a proposal that would itself be blocked is never offered', () => {
  const p = parseProposal({ message: 'Here you go', subjects: ['Casino bonus: 50 free spins on your deposit'] }, req({ task: 'subjects' }));
  assert.equal(p.message, '');
  assert.ok(p.warnings.some((w) => w.severity === 'BLOCK'));
  const phish = parseProposal({ message: 'x', preview: 'Your account will be suspended, verify your password' }, req({ task: 'preview' }));
  assert.equal(phish.message, '');
});

test('misleading claims come back as warnings for the user to see', () => {
  const p = parseProposal({ message: 'x', subjects: ['Guaranteed return on a Vake apartment'] }, req({ task: 'subjects' }));
  assert.ok(p.warnings.some((w) => w.code === 'MISLEADING_FINANCIAL_CLAIM'));
});

test('drafts become normalized designer blocks with no links; garbage is rejected', () => {
  const p = parseProposal({ message: 'Draft', blocks: [
    { type: 'heading', text: 'A new home in Vake' }, { type: 'text', text: 'Dear {{first_name|there}}, [describe the apartment].' },
    { type: 'button', label: 'Book a viewing', href: 'https://evil.example' }, { type: 'script', text: 'x' },
  ] }, req({ task: 'draft' }));
  assert.deepEqual(p.blocks.map((b) => b.type), ['heading', 'text', 'button', 'text']);
  assert.equal(p.blocks[2].href, '', 'HOMI never sets a URL');
  assert.equal(parseProposal('not json', req()), null);
  assert.equal(parseProposal({}, req()), null);
});

test('request payload carries the context and the hard rules are in the prompt', () => {
  const blocks = textBlocksOf(builtInTemplate('NEWSLETTER', 'en'));
  assert.ok(blocks.length >= 5 && blocks.every((b) => b.id));
  const payload = JSON.parse(buildUserPayload(req({ blocks }), 'ka'));
  assert.equal(payload.uiLanguage, 'Georgian');
  assert.ok(payload.blocks.length === blocks.length);
  for (const rule of ['Never invent prices', 'Never claim the recipient consented', 'No gambling', 'never add or change URLs', 'დამთხვევა']) {
    assert.ok(COPILOT_SYSTEM_PROMPT.includes(rule), rule);
  }
});
