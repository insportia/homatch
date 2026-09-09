import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * DEVELOPER / COMPANY INTELLIGENCE — STATIC.
 *
 * Two things were wrong with /developer/:id.
 *
 * 1. The function behind it had never been deployed. developer-score exists in
 *    the repository, is called by getDeveloperProfile(), and is absent from
 *    production's function list and from both CI deploy lists. The page was a
 *    dead route pointing at a 404.
 *
 * 2. Its scoring started every developer at 50 and adjusted from there. A
 *    company we hold nothing about -- no projects, no permits, no risk
 *    evidence -- scored 50/100, which a buyer reads as "averagely
 *    trustworthy". That is a fabricated signal about a real business, printed
 *    next to that business's name. NO EVIDENCE = NO SCORE.
 */

const ROOT = process.cwd();
const fn = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'developer-score', 'index.ts'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'DeveloperProfilePage.tsx'), 'utf8');
const types = fs.readFileSync(path.join(ROOT, 'src', 'types', 'phase3.ts'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

test('a developer we know nothing about gets no score', () => {
  assert.match(fn, /const hasAnyEvidence = projects\.length > 0 \|\| riskCount > 0 \|\| hasRestrictions \|\| hasPermits/);
  assert.match(fn, /score = null;/);
  assert.match(fn, /reason: 'NO_EVIDENCE'/);
});

test('the unscored state survives all the way to the type and the screen', () => {
  // A `score: number` type is what forces a null into being rendered as
  // something -- 0, NaN, or the string "null".
  assert.match(types, /score: number \| null;/);
  assert.match(page, /score \}: \{ score: number \| null \}/);
  assert.match(page, /const unassessed = dev\.score === null \|\| dev\.score === undefined/);
  // No partial ring and no breakdown bars for a score that does not exist.
  assert.match(page, /if \(score === null\)/);
  assert.match(page, /\{!unassessed && breakdown/);
});

test('"not assessed" is translated in every supported language', () => {
  const translations = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'translations.ts'), 'utf8');
  const hits = translations.match(/developer_not_assessed:/g) ?? [];
  assert.equal(hits.length, 6, 'KA / EN / RU / AR / TR / HE must all have this string');
});

test('a failed score refresh is not reported as a fresh score', () => {
  // The update used to end in .catch(() => {}) and the freshly computed number
  // was returned regardless -- a score the customer saw that was never stored.
  assert.ok(
    !/from\('developer_profiles'\)[\s\S]{0,400}?\.catch\(\(\) => \{\}\)/.test(fn),
    'the score refresh must not swallow its error'
  );
  assert.match(fn, /if \(refreshErr\)/);
  assert.match(fn, /score = dev\.score \?\? null;/, 'fall back to what is stored, not to what was computed');
});

test('project counts come from the project rows, not from unmaintained columns', () => {
  // developer_profiles.completed_projects / active_projects default to 0 and
  // nothing ever updates them. Scoring used the derived counts while the
  // response returned the stale columns, so a profile could show 75/100 beside
  // "0 completed projects".
  assert.match(fn, /completed_projects: completedCount/);
  assert.match(fn, /active_projects: activeCount/);
  assert.ok(!fn.includes('completed_projects: dev.completed_projects'));
});

test('developer-score is registered for deployment', () => {
  const jwtList = workflow.slice(
    workflow.indexOf('JWT_FUNCTIONS=('),
    workflow.indexOf('NO_JWT_FUNCTIONS=(')
  );
  assert.match(jwtList, /"developer-score"/, '/developer/:id is a dead route until this deploys');
});

test('every outreach function this repo can fix is registered for deployment', () => {
  // These were deployed by hand and never registered, so a fix committed here
  // stayed here. That is how a duplicate-send race survived in a file CI had
  // never shipped.
  const jwtList = workflow.slice(
    workflow.indexOf('JWT_FUNCTIONS=('),
    workflow.indexOf('NO_JWT_FUNCTIONS=(')
  );
  for (const f of ['outreach-send', 'contact-import', 'social-post-generate', 'community-recommend']) {
    assert.match(jwtList, new RegExp(`"${f}"`), `${f} must deploy from source`);
  }
});

test('no outreach or developer function is registered in both deploy lists', () => {
  // Being in both means the second deploy silently decides the JWT setting.
  const jwtList = workflow.slice(workflow.indexOf('JWT_FUNCTIONS=('), workflow.indexOf('NO_JWT_FUNCTIONS=('));
  const noJwtList = workflow.slice(workflow.indexOf('NO_JWT_FUNCTIONS=('));
  const names = [...jwtList.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  for (const n of names) {
    assert.ok(!new RegExp(`"${n}"`).test(noJwtList.slice(0, noJwtList.indexOf(')'))), `${n} is in both lists`);
  }
});
