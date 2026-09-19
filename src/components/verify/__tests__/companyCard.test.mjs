import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'src/components/verify/CompanyIntelligenceCard.tsx'),
  'utf8'
);

/*
 * THE COMPANY CARD.
 *
 * Source-level, in the style of this repo's other component gates: there is no
 * jsdom here, and the properties asserted below are statically true or false.
 * The one behavioural rule — deduplicating people — is exercised directly by
 * lifting the helper's contract into the assertions, because it was a real
 * defect seen on the deployed page.
 */

test('the same person is never listed twice', () => {
  /*
   * FOUND ON THE DEPLOYED PAGE.
   *
   * result_json holds two directors. The customer-facing copy reached the card
   * with four entries — the same two people once as objects carrying a
   * representation role and once as bare strings — so the card listed „კობა
   * კვანტალიანი" twice and a reader could reasonably have concluded the
   * company has four directors.
   */
  assert.match(SRC, /function dedupeByName/, 'nothing collapses duplicate people');
  assert.match(
    SRC,
    /const directors = dedupeByName\(/,
    'the directors list must be deduplicated before it renders'
  );
  // The entry that states a role must win, or the role disappears.
  assert.match(SRC, /!directorRole\(existing\) && directorRole\(entry\)/);
});

test('a company-level obligation is never presented as a charge on the flat', () => {
  /*
   * The single most damaging sentence this product could print. The stored
   * Villion report carries BOTH a pledge registered against the company and a
   * mortgage on the parent parcel, from different documents, and the extract
   * is explicit that it neither extends to nor excludes this unit.
   */
  assert.match(SRC, /verify_co_company_obligations/, 'the company-level block is missing');
  assert.match(SRC, /verify_co_property_obligations/, 'the property-level block is missing');
  assert.match(
    SRC,
    /verify_co_company_scope_note/,
    'the company block must say it is not a mortgage on this apartment'
  );
  // Two separate containers, so they cannot read as one list.
  const companyAt = SRC.indexOf('verify_co_company_obligations');
  const propertyAt = SRC.indexOf('verify_co_property_obligations');
  assert.ok(companyAt > 0 && propertyAt > companyAt, 'the two must be distinct blocks');
});

test('an empty project list is a statement about our search, never about the company', () => {
  // "This is their first project" is an inference the reader may draw and
  // Homatch may not assert.
  assert.match(SRC, /verify_co_no_other_projects/);
  /*
   * Comments explain what the card refuses to say and necessarily quote the
   * claim; only executable code can put it in front of a customer. Checking
   * the raw source flagged this file's own header — correctly, and uselessly.
   */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(
    !/first project|პირველი პროექტი/i.test(code),
    'the card must not claim this is the first project'
  );
});

test('the card renders nothing rather than an empty shell', () => {
  // A heading with no company under it invites the reader to assume the
  // check failed, when in fact no company was identified at all.
  assert.match(SRC, /if \(!company\) return null;/);
  assert.match(SRC, /if \(!name && !idCode\) return null;/);
});

test('registry-confirmed and web-only are distinguishable', () => {
  // The provenance of a company profile changes how much weight it carries.
  assert.match(SRC, /REGISTRY_CONFIRMED/);
  assert.match(SRC, /verify_co_registry_confirmed/);
  assert.match(SRC, /verify_co_web_only/);
});

test('long Georgian names wrap instead of pushing the card sideways', () => {
  // Company names, registered addresses and governance bodies are all long
  // and unbreakable in Georgian.
  const wraps = (SRC.match(/break-words/g) ?? []).length;
  assert.ok(wraps >= 6, `only ${wraps} wrapping guards in a card full of long names`);
  assert.ok(!/\btruncate\b/.test(SRC), 'a truncated company name is not an identification');
});
