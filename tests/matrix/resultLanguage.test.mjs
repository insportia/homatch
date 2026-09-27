// A RESULT IS OPENED, NOT UNLOCKED — AND A SIGNAL IS INTEREST, NOT A BUYER.
//
// Three copy defects, each of which reached customers in six languages:
//
//   LOCK LANGUAGE ON RESULTS. "Match unlocked!", "Unlock Contact", "Confirm Unlock",
//   and Georgian `unlock_unlocking: 'იბლოკება…'`, which literally reads "is being
//   LOCKED" on the button that opens a contact. The lock model was retired from the
//   result card (see includedUnlock.test.mjs); its vocabulary had not been. Results
//   are now opened and contacts revealed.
//
//   THE GEORGIAN MATCH TERM. The product word is დამთხვევა. The bundle also used the
//   transliteration მატჩი (a football match) and შესატყვისი/შესატყვისობა (an
//   equivalent), so one product had three names on one screen.
//
//   OVERCLAIMS. "We found buyers interested…", "New buyer/renter found". What was
//   found is a signal of possible interest; nobody has agreed to anything.
//
// The internal identifiers (unlock_* keys, MATCH_UNLOCK, the UNLOCKED status) are
// not customer copy and keep their names. What is counted here is VALUES.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src', 'i18n', 'translations.ts'), 'utf8');
const lines = source.split('\n');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

/** Every `key: value` line of one locale bundle. */
function bundle(lang) {
  const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
  const start = lines.findIndex((l) => l.startsWith(opener));
  assert.ok(start >= 0, `guard: no ${lang} bundle`);
  const end = lines.findIndex((l, i) => i > start && l === '};');
  const out = new Map();
  for (const line of lines.slice(start + 1, end)) {
    const m = /^ {2}([A-Za-z0-9_]+):\s*(.+),\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  assert.ok(out.size > 5000, `guard: the ${lang} bundle parsed to ${out.size} keys`);
  return out;
}

/*
 * Lock vocabulary per language, specific to OPENING something. Not "blocked": a
 * blocked chat user and a provider blocked by a kill switch are real and stay.
 */
const LOCK = {
  en: /\b(un)?lock(ed|ing|s)?\b/i,
  ka: /განბლოკ|იბლოკება|ჩაკეტილ/,
  ru: /разблок/i,
  tr: /kilid|kilit/i,
  ar: /قفل/,
  he: /נעול|נעילה/,
};

/*
 * Named exceptions, each with a reason. Everything under admin_ is excluded as a
 * family: operators read words like UNLOCK as the event names they are.
 */
const NOT_RESULT_ACCESS = {
  comm_locked: 'a WhatsApp template becomes read-only once Meta approves it; it is not a result',
};

test('no customer string uses lock or unlock language', () => {
  const remaining = [];
  for (const lang of LANGS) {
    for (const [key, value] of bundle(lang)) {
      if (key.startsWith('admin_') || key in NOT_RESULT_ACCESS) continue;
      if (LOCK[lang].test(value)) remaining.push(`${lang}.${key}: ${value.slice(0, 70)}`);
    }
  }
  console.log(`[result-language] customer lock/unlock strings remaining: ${remaining.length}`);
  assert.deepEqual(remaining, [], `lock language is back on customer copy:\n${remaining.join('\n')}`);
});

test('the Georgian open button no longer says "is being locked"', () => {
  const ka = bundle('ka');
  assert.equal(ka.get('unlock_unlocking'), "'იხსნება…'");
});

test('the Georgian bundle calls a Match დამთხვევა, and only that', () => {
  const offenders = [...bundle('ka')]
    .filter(([, value]) => /მატჩ|შესატყვის/.test(value))
    .map(([key, value]) => `${key}: ${value.slice(0, 60)}`);
  assert.deepEqual(offenders, [], `the Match term is misused:\n${offenders.join('\n')}`);
  assert.match(bundle('ka').get('prop_matchability_excellent'), /დამთხვევა/);
});

test('the Georgian bundle does not write Tbilisi in Latin', () => {
  const offenders = [...bundle('ka')].filter(([, v]) => /Tbilisi/.test(v)).map(([k]) => k);
  assert.deepEqual(offenders, []);
});

test('no locale says a buyer was found, only that interest may exist', () => {
  const OVERCLAIM = {
    en: /\b(found|confirmed|verified) (a |new )?buyers?\b|buyers? (was |were )?found|new buyer\b/i,
    ka: /მყიდველ(ი|ები) (მოიძებნა|ვიპოვეთ)|ვიპოვეთ მყიდველ/,
    ru: /(нашли|найден[аоы]?) (нов\S+ )?покупател/i,
    tr: /alıcı(lar)? bul|alıcı\/kiracı bulundu/i,
    ar: /وجدنا مشترين|العثور على مشترٍ/,
    he: /מצאנו קונים|נמצא קונה/,
  };
  const offenders = [];
  for (const lang of LANGS) {
    for (const key of ['home_sms_demo_message', 'notif_new_signal_match_title', 'notif_new_signal_match_body', 'as_dialog_supply_desc']) {
      const value = bundle(lang).get(key) ?? '';
      if (OVERCLAIM[lang].test(value)) offenders.push(`${lang}.${key}: ${value}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the reveal modal and the matches page use neutral icons, not padlocks', () => {
  const modal = readFileSync(join(process.cwd(), 'src', 'components', 'matching', 'ExternalContactUnlockModal.tsx'), 'utf8');
  const page = readFileSync(join(process.cwd(), 'src', 'pages', 'property', 'MatchesPage.tsx'), 'utf8');
  for (const [name, src] of [['modal', modal], ['matches page', page]]) {
    const imports = /import \{([^}]+)\} from 'lucide-react'/.exec(src)?.[1] ?? '';
    assert.doesNotMatch(imports, /\b(Lock|Unlock|LockOpen|LockKeyhole)\b/, `the ${name} imports a padlock icon`);
  }
});
