// Two owner-flow bugs pinned so they cannot return:
// 1. The property contact phone could be SET but never CHANGED — the
//    column-grants migration predated the phone columns, so every edit was
//    refused by Postgres while the page said "saved".
// 2. The campaign-launch dialog could not scroll on a phone, and its
//    selected language mode was a pale tint that read as disabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('the contact phone columns are owner-updatable, and the UI never lies about it', () => {
  const grant = read('supabase/migrations/20260929220000_property_contact_phone_update_grant.sql');
  assert.match(grant, /grant update \(contact_phone_e164, contact_phone_raw, contact_phone_country\)\s*\n\s*on public\.properties to authenticated/);
  // The edit page reads the outcome instead of assuming it.
  const edit = read('src/pages/property/EditPropertyPage.tsx');
  assert.ok(edit.includes('const contactSaved = await setPropertyContact(id, reading.contact);'));
  assert.ok(edit.includes("toast.error(t('contact_phone_save_failed'))"));
});

test('the campaign-launch dialogs scroll instead of clipping the choices', () => {
  for (const p of ['src/pages/property/PropertyDetailPage.tsx', 'src/pages/property/MatchesPage.tsx']) {
    const s = read(p);
    assert.match(s, /max-h-\[85dvh\] overflow-y-auto/, `${p} launch dialog must scroll`);
  }
});

test('the selected search-language mode is unmistakable, never a pale tint', () => {
  const s = read('src/components/campaign/SearchLanguagePicker.tsx');
  assert.ok(s.includes("'border-[#0C1119] bg-[hsl(var(--gold-soft))]/70 shadow-card'"));
  assert.ok(!s.includes("'border-primary/50 bg-primary/5'"), 'the disabled-looking selected state came back');
});
