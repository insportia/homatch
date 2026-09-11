import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRANSLATION_MODE, LOCALES, applyAutoTranslation, applySuggestion,
  dismissSuggestion, editLocale, emptyPage, localeState, makeSection,
  markReviewed, nextVersion, normalizePage, normalizeSection, readLocalized,
  restoreAsDraft, setSectionField, setSuggestion, suggestionFor,
  translationSummary, translationTargets,
} from '../model.ts';

/*
 * SITE STUDIO — multilingual synchronisation.
 *
 * One rule underwrites this whole file: editing a page in one language must
 * never change what another language SAYS. It may only change what the
 * editor CLAIMS about that language ("this may be out of date"), and it may
 * park a suggestion next to it awaiting a human.
 *
 * That is why approved text and machine text live in two different places in
 * the model rather than one field with a flag. A suggestion cannot reach the
 * public site by accident because publishing does not read from where
 * suggestions are kept. These tests hold that line at each of the ways it is
 * usually crossed: a plain edit, an "automatically translate everything"
 * setting, an applied suggestion, and a rollback.
 */

const RULES = {
  knownTypes: ['hero', 'rich_text'],
  variantsFor: () => ['default'],
  knownRoutes: ['/', '/about'],
};

/** A hero whose title exists in three languages, all human-written. */
function seeded() {
  let s = makeSection('hero', 'sec-1');
  s = editLocale(s, 'title', 'en', 'Smart real estate decisions');
  s = editLocale(s, 'title', 'ka', 'უძრავი ქონების ჭკვიანი გადაწყვეტილებები');
  s = editLocale(s, 'title', 'ru', 'Умные решения по недвижимости');
  // editLocale flags the earlier ones; start each test from a settled page.
  s = markReviewed(s, 'title', 'en');
  s = markReviewed(s, 'title', 'ka');
  s = markReviewed(s, 'title', 'ru');
  return s;
}

test('the default mode is the reviewed one, not silent auto-translation', () => {
  assert.equal(DEFAULT_TRANSLATION_MODE, 'suggest');
});

test('editing one locale leaves every other locale\'s text byte-identical', () => {
  const before = seeded();
  const after = editLocale(before, 'title', 'en', 'Decisions you can defend');

  assert.equal(readLocalized(after.content.title, 'en'), 'Decisions you can defend');
  for (const locale of ['ka', 'ru']) {
    assert.equal(
      readLocalized(after.content.title, locale),
      readLocalized(before.content.title, locale),
      locale + ' was rewritten by an edit to English',
    );
  }
});

test('editing one locale flags the others for review without demoting them', () => {
  const after = editLocale(seeded(), 'title', 'en', 'Decisions you can defend');

  assert.equal(localeState(after, 'title', 'en'), 'reviewed');
  assert.equal(localeState(after, 'title', 'ka'), 'needs_update');
  assert.equal(localeState(after, 'title', 'ru'), 'needs_update');
  // Flagged is not hidden: the old translation is still the live value and
  // still renders on the public site until somebody replaces it.
  assert.equal(readLocalized(after.content.title, 'ka'), 'უძრავი ქონების ჭკვიანი გადაწყვეტილებები');
});

test('a locale with no override of its own is not flagged', () => {
  // It is showing the site's own translated copy, which is already correct
  // in that language. Flagging it would be noise on every single edit.
  let s = makeSection('hero', 'sec-1');
  s = editLocale(s, 'title', 'en', 'Only English is overridden');
  for (const locale of LOCALES) {
    if (locale === 'en') continue;
    assert.equal(localeState(s, 'title', locale), 'current');
  }
});

test('a suggestion never touches the approved value', () => {
  const before = seeded();
  const after = setSuggestion(before, 'title', 'ka', 'სრულიად ახალი ვარიანტი');

  assert.equal(
    readLocalized(after.content.title, 'ka'),
    readLocalized(before.content.title, 'ka'),
  );
  assert.equal(suggestionFor(after, 'title', 'ka'), 'სრულიად ახალი ვარიანტი');
});

test('a suggestion beside reviewed copy does not downgrade the badge', () => {
  // The live text is still the one a human approved, so the editor must keep
  // saying so; the suggestion is an offer, not a state change.
  const after = setSuggestion(seeded(), 'title', 'ka', 'შემოთავაზება');
  assert.equal(localeState(after, 'title', 'ka'), 'reviewed');
  assert.equal(suggestionFor(after, 'title', 'ka'), 'შემოთავაზება');
});

test('auto-translate-everything still cannot overwrite reviewed copy', () => {
  const before = seeded();
  const after = applyAutoTranslation(before, 'title', 'ka', 'მანქანური თარგმანი');

  assert.equal(
    readLocalized(after.content.title, 'ka'),
    readLocalized(before.content.title, 'ka'),
    'auto_all overwrote a translation a human had approved',
  );
  assert.equal(suggestionFor(after, 'title', 'ka'), 'მანქანური თარგმანი');
  assert.equal(localeState(after, 'title', 'ka'), 'reviewed');
});

test('auto-translate writes straight into locales nobody has reviewed', () => {
  let s = makeSection('hero', 'sec-1');
  s = editLocale(s, 'title', 'en', 'Source copy');
  s = applyAutoTranslation(s, 'title', 'tr', 'Kaynak metin');

  assert.equal(readLocalized(s.content.title, 'tr'), 'Kaynak metin');
  // Written, but still labelled machine output so a reviewer can find it.
  assert.equal(localeState(s, 'title', 'tr'), 'ai_suggested');
  assert.equal(suggestionFor(s, 'title', 'tr'), undefined);
});

test('applying a suggestion promotes it and marks the locale human-reviewed', () => {
  let s = setSuggestion(seeded(), 'title', 'ka', 'დამტკიცებული ტექსტი');
  s = applySuggestion(s, 'title', 'ka');

  assert.equal(readLocalized(s.content.title, 'ka'), 'დამტკიცებული ტექსტი');
  assert.equal(localeState(s, 'title', 'ka'), 'reviewed');
  assert.equal(suggestionFor(s, 'title', 'ka'), undefined, 'the suggestion outlived being applied');
});

test('applying a suggestion that does not exist changes nothing', () => {
  const before = seeded();
  assert.equal(applySuggestion(before, 'title', 'tr'), before);
});

test('dismissing a suggestion leaves the approved value alone', () => {
  const before = seeded();
  let s = setSuggestion(before, 'title', 'ru', 'вариант от машины');
  s = dismissSuggestion(s, 'title', 'ru');

  assert.equal(suggestionFor(s, 'title', 'ru'), undefined);
  assert.equal(readLocalized(s.content.title, 'ru'), readLocalized(before.content.title, 'ru'));
  assert.equal(localeState(s, 'title', 'ru'), 'reviewed');
});

test('marking reviewed settles a flag without inventing text', () => {
  // "I looked at the Georgian, it still reads correctly" has to be one click,
  // or reviewers will paste the machine output just to clear the badge.
  const before = editLocale(seeded(), 'title', 'en', 'New English');
  assert.equal(localeState(before, 'title', 'ka'), 'needs_update');

  const after = markReviewed(before, 'title', 'ka');
  assert.equal(localeState(after, 'title', 'ka'), 'reviewed');
  assert.equal(readLocalized(after.content.title, 'ka'), readLocalized(before.content.title, 'ka'));
});

test('clearing an override drops the locale back to the site default', () => {
  let s = seeded();
  s = editLocale(s, 'title', 'ru', '');

  assert.equal(readLocalized(s.content.title, 'ru'), undefined);
  assert.equal(localeState(s, 'title', 'ru'), 'current');
  // Deleting one language is not a content change to the others.
  assert.equal(localeState(s, 'title', 'ka'), 'reviewed');
});

test('none of the translation helpers mutate the section they are given', () => {
  const before = seeded();
  const snapshot = JSON.stringify(before);
  editLocale(before, 'title', 'en', 'x');
  setSuggestion(before, 'title', 'ka', 'y');
  applyAutoTranslation(before, 'title', 'tr', 'z');
  markReviewed(before, 'title', 'ru');
  dismissSuggestion(before, 'title', 'ka');
  assert.equal(JSON.stringify(before), snapshot);
});

test('translate-changed targets the flagged locales and nothing else', () => {
  const page = { ...emptyPage(), sections: [editLocale(seeded(), 'title', 'en', 'New English')] };
  const targets = translationTargets(page, { sourceLocale: 'en' });

  assert.deepEqual(targets.map(t => t.locale).sort(), ['ka', 'ru']);
  assert.equal(targets[0].source, 'New English');
  assert.equal(targets[0].sourceLocale, 'en');
});

test('fill-missing-languages is opt-in, and reaches locales with no override', () => {
  let s = makeSection('hero', 'sec-1');
  s = editLocale(s, 'title', 'en', 'Source copy');
  const page = { ...emptyPage(), sections: [s] };

  assert.deepEqual(translationTargets(page, { sourceLocale: 'en' }), []);

  const filling = translationTargets(page, { sourceLocale: 'en', includeMissing: true });
  assert.deepEqual(
    filling.map(t => t.locale).sort(),
    LOCALES.filter(l => l !== 'en').slice().sort(),
  );
});

test('a field with no source text is never a translation target', () => {
  let s = makeSection('hero', 'sec-1');
  s = editLocale(s, 'title', 'ka', 'მხოლოდ ქართული');
  const page = { ...emptyPage(), sections: [s] };
  // Asking to translate from English when English was never written should
  // produce nothing, not an empty-string round trip through the model.
  assert.deepEqual(translationTargets(page, { sourceLocale: 'en', includeMissing: true }), []);
});

test('reviewed locales are only re-translated when explicitly asked for', () => {
  const page = { ...emptyPage(), sections: [seeded()] };
  assert.deepEqual(translationTargets(page, { sourceLocale: 'en' }), []);

  const forced = translationTargets(page, { sourceLocale: 'en', includeReviewed: true });
  assert.deepEqual(forced.map(t => t.locale).sort(), ['ka', 'ru']);
});

test('the summary counts what the locale switcher has to badge', () => {
  let s = editLocale(seeded(), 'title', 'en', 'New English');
  s = setSuggestion(s, 'title', 'ru', 'предложение');
  const summary = translationSummary({ ...emptyPage(), sections: [s] });

  assert.equal(summary.en.reviewed, 1);
  assert.equal(summary.ka.needsUpdate, 1);
  // ru was flagged by the English edit and now carries a suggestion, so it
  // reports as suggested rather than merely stale: there is something to act on.
  assert.equal(summary.ru.suggested, 1);
  assert.equal(summary.tr.current, 1);
});

test('translation state survives a save and reload unchanged', () => {
  let s = editLocale(seeded(), 'title', 'en', 'New English');
  s = setSuggestion(s, 'title', 'ka', 'შემოთავაზებული');

  const round = normalizeSection(JSON.parse(JSON.stringify(s)), RULES);
  assert.equal(localeState(round, 'title', 'ka'), 'ai_suggested');
  assert.equal(localeState(round, 'title', 'ru'), 'needs_update');
  assert.equal(suggestionFor(round, 'title', 'ka'), 'შემოთავაზებული');
  assert.equal(round.i18n.title.source, 'en');
});

test('a stored state value nobody recognises is dropped, not rendered', () => {
  const s = seeded();
  const raw = JSON.parse(JSON.stringify(s));
  raw.i18n.title.state.ka = 'approved_by_marketing';
  raw.i18n.title.state.ru = { nested: true };

  const round = normalizeSection(raw, RULES);
  assert.equal(localeState(round, 'title', 'ka'), 'current');
  assert.equal(localeState(round, 'title', 'ru'), 'current');
  // The text itself is untouched by a bad state value.
  assert.equal(readLocalized(round.content.title, 'ka'), readLocalized(s.content.title, 'ka'));
});

test('a whole page of translation state round-trips through normalisation', () => {
  let s = editLocale(seeded(), 'title', 'en', 'New English');
  s = setSuggestion(s, 'title', 'ru', 'предложение');
  const page = normalizePage(
    JSON.parse(JSON.stringify({ ...emptyPage(), sections: [s] })),
    RULES,
  );
  assert.equal(page.sections.length, 1);
  assert.equal(localeState(page.sections[0], 'title', 'ka'), 'needs_update');
  assert.equal(suggestionFor(page.sections[0], 'title', 'ru'), 'предложение');
});

test('rollback restores every language together, suggestions included', () => {
  // The reason multilingual state lives INSIDE the versioned page content
  // rather than beside it: a rollback that restored English to last week and
  // left Georgian on today's copy would publish a page that contradicts
  // itself, in a language most reviewers cannot read.
  let v1 = seeded();
  v1 = setSuggestion(v1, 'title', 'ka', 'ძველი შემოთავაზება');
  const snapshot = { ...emptyPage(), sections: [v1] };

  const versions = [
    { version: 3, content: snapshot, note: null, publishedAt: '2026-09-01T00:00:00Z', publishedBy: null },
  ];

  // The snapshot goes to the database as JSON and comes back as JSON, so the
  // restore path has to survive that round trip, not just an object copy.
  const restored = restoreAsDraft(JSON.parse(JSON.stringify(snapshot)), RULES);
  const section = restored.sections[0];

  assert.equal(readLocalized(section.content.title, 'en'), 'Smart real estate decisions');
  assert.equal(readLocalized(section.content.title, 'ka'), 'უძრავი ქონების ჭკვიანი გადაწყვეტილებები');
  assert.equal(readLocalized(section.content.title, 'ru'), 'Умные решения по недвижимости');
  assert.equal(suggestionFor(section, 'title', 'ka'), 'ძველი შემოთავაზება');
  // Still reviewed: the suggestion was parked beside approved copy, and a
  // rollback must not turn approved text into machine text on the way back.
  assert.equal(localeState(section, 'title', 'ka'), 'reviewed');
  // Restoring is a draft edit: it publishes nothing and consumes no version
  // number, so the next publish still takes the number it would have taken.
  assert.equal(nextVersion(versions), 4);
});

test('a field edited in a non-English source flags English like any other', () => {
  // Georgian is the working language for this market; nothing in the model
  // may treat English as privileged.
  const after = editLocale(seeded(), 'title', 'ka', 'ახალი ქართული სათაური');
  assert.equal(localeState(after, 'title', 'ka'), 'reviewed');
  assert.equal(localeState(after, 'title', 'en'), 'needs_update');
  assert.equal(localeState(after, 'title', 'ru'), 'needs_update');
  assert.equal(after.i18n.title.source, 'ka');
});

test('translation state is per field, not per section', () => {
  let s = seeded();
  s = editLocale(s, 'subtitle', 'en', 'A subtitle');
  s = editLocale(s, 'subtitle', 'ka', 'ქვესათაური');
  s = editLocale(s, 'subtitle', 'en', 'A changed subtitle');

  assert.equal(localeState(s, 'subtitle', 'ka'), 'needs_update');
  assert.equal(localeState(s, 'title', 'ka'), 'reviewed', 'an unrelated field was flagged');
});

test('a plain setSectionField write carries no translation claims', () => {
  // The low-level setter still exists for migrations and defaults. It must
  // stay silent about review state rather than quietly asserting "reviewed".
  const s = setSectionField(makeSection('hero', 'sec-1'), 'title', 'en', 'Seeded');
  assert.equal(localeState(s, 'title', 'en'), 'current');
  assert.equal(suggestionFor(s, 'title', 'en'), undefined);
});
