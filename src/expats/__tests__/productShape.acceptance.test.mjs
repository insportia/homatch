// What HOMATCH FOR EXPATS is, and what it is not allowed to become.
//
// A guard, not a unit test. Every assertion corresponds to a product
// decision a future change could quietly undo while every other gate
// stayed green:
//
//   IT IS NOT A CHAT PRODUCT (§5). No message list, no composer, no
//   assistant turn. Somebody will one day reach for a text box because it
//   is the fastest way to collect a preference, and that is how the
//   product becomes a chatbot one field at a time.
//
//   IT NEVER FABRICATES INVENTORY, PRICES OR RATINGS (§84). The engines
//   make this hard; this makes it visible. A hard-coded rent, a seeded
//   listing or an aggregate star rating would all pass a typecheck.
//
//   IT NEVER CALLS ITS OWN SUGGESTION A DEADLINE (§45). Three separate
//   i18n keys exist for one date, and only the official one may use the
//   word. A future tidy-up that merges them would be a product that lies
//   to somebody about their immigration status.
//
//   IT REQUIRES NO PAID SEARCH PROVIDER (§34). Nothing here may reach
//   DataForSEO, SerpAPI or a web-search tool.
//
//   SPONSORSHIP CANNOT REACH THE RANKING (§56).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function walk(rel, out = []) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(child, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !child.includes('__tests__')) out.push(child);
  }
  return out;
}

const PRODUCT_FILES = [
  ...walk('src/expats'),
  ...walk('src/components/expats'),
  'src/pages/ForExpatsPage.tsx',
  'src/pages/ExpatTopicPage.tsx',
  'src/pages/ExpatPlanPage.tsx',
  'src/services/expats.ts',
];

/** Source with comments stripped: prose is not behaviour. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ── Not a chat product ──────────────────────────────────────────── */

test('there is no chat surface anywhere in the product', () => {
  for (const file of PRODUCT_FILES) {
    const src = code(read(file));
    assert.ok(!/<textarea/i.test(src), `${file} has a free-text composer`);
    assert.ok(!/role:\s*'(user|assistant)'/.test(src), `${file} carries chat turns`);
    assert.ok(!/\bmessages\s*[:=]\s*\[/.test(src), `${file} keeps a message list`);
    assert.ok(!/useAIChat/.test(src), `${file} opens a chat session`);
  }
});

test('the landing page opens with the hero, not a search box or a grid', () => {
  const page = read('src/pages/ForExpatsPage.tsx');
  /* The MARKUP, not the file: an import list naturally mentions every
     component and would fail a naive scan of everything above the hero. */
  const markup = page.slice(page.indexOf('return ('), page.indexOf('</>'));
  const heroAt = markup.indexOf('<ExpatHero');
  assert.ok(heroAt > 0, 'the hero is missing from the first return');
  const before = markup.slice(0, heroAt);
  assert.ok(!/<input/i.test(before), 'something takes input above the hero');
  assert.ok(
    !/<(CostOfLiving|WhatCanIBuy|TopicIndex|RentalCommunities)/.test(before),
    'a tool renders above the hero',
  );
});

/* ── No invented content ─────────────────────────────────────────── */

test('no component holds a hard-coded price, rent or rating', () => {
  for (const file of [...walk('src/components/expats'), 'src/pages/ForExpatsPage.tsx']) {
    const src = code(read(file));
    assert.ok(
      !/\b(rent|price|cost|fee|rating|stars|reviews?Count)\s*[:=]\s*\d/i.test(src),
      `${file} appears to hold a literal price or rating`,
    );
  }
});

test('the cost engine holds no price at all', () => {
  const src = code(read('src/expats/costOfLiving.ts'));
  // Household multipliers are arithmetic assumptions and are labelled
  // SCALED in the output; a CURRENCY amount would be a price.
  assert.ok(!/\bGEL\b|\bUSD\b|\bEUR\b/.test(src), 'a currency literal appears in the engine');
  assert.ok(!/\d{3,}/.test(src), 'a three-digit figure appears in the engine');
});

test('geography carries no score, rating or lifestyle judgement', () => {
  const src = read('src/expats/geography.ts');
  for (const banned of ['score', 'rating', 'vibe', 'familyFriendly', 'safety', 'walkability']) {
    assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(code(src)), `geography carries a ${banned}`);
  }
});

test('an aggregate rating is never computed and no score is ever exported', () => {
  const src = code(read('src/expats/research/reputation.ts'));
  // No blended rating, on any scale.
  assert.ok(!/averageRating|overallRating|meanRating|ratingAverage/i.test(src));
  // Ratings stay per platform, and the type carries that word.
  assert.ok(/perPlatform/.test(src));
  /*
   * An ordering weight is allowed and necessary — §53 asks for a
   * shortlist. What is forbidden is that weight reaching a reader. It is
   * a local inside rankProviders, and nothing exports it or returns it.
   */
  assert.ok(!/export\s+(?:const|function)\s+score\b/.test(src), 'the ordering score is exported');
  assert.ok(!/\bscore\s*[,:}]/.test(src), 'a score is returned in a result object');
  const assessment = src.slice(src.indexOf('export interface ProviderAssessment'));
  assert.ok(!/score/i.test(assessment.slice(0, assessment.indexOf('}'))), 'the assessment carries a score');
});

/* ── §45: our suggestion is never their deadline ─────────────────── */

test('three separate keys exist for a due date and only one says deadline', () => {
  const bundle = read('src/i18n/translations.ts');
  for (const key of ['expat_task_due_suggested', 'expat_task_due_user', 'expat_task_due_official']) {
    assert.ok(bundle.includes(`${key}:`), `${key} is missing`);
  }
  const line = (key) => {
    const m = bundle.match(new RegExp(`^  ${key}: '(.*)',$`, 'm'));
    return m ? m[1] : '';
  };
  assert.match(line('expat_task_due_official'), /deadline/i);
  assert.doesNotMatch(line('expat_task_due_suggested'), /deadline/i);
  assert.doesNotMatch(line('expat_task_due_user'), /deadline/i);
});

test('the component picks the key from the basis and cannot be talked out of it', () => {
  const src = read('src/components/expats/PlanBoard.tsx');
  assert.ok(/deadlineBasis === 'OFFICIAL'/.test(src));
  assert.ok(/expat_task_due_official/.test(src));
  // There is exactly one place that chooses, so there is one place to audit.
  assert.equal((src.match(/expat_task_due_official/g) ?? []).length, 1);
});

test('nothing generated by the roadmap is ever marked official', () => {
  const src = code(read('src/expats/plan/roadmap.ts'));
  assert.ok(/'SUGGESTED' as DeadlineBasis/.test(src));
  assert.ok(!/deadlineBasis:\s*'OFFICIAL'/.test(src), 'the generator marks a date official');
});

/* ── §34: no paid search provider ────────────────────────────────── */

test('nothing in the product reaches a paid SERP or web-search provider', () => {
  for (const file of [...PRODUCT_FILES, 'supabase/functions/jobs-worker/index.ts']) {
    const src = code(read(file));
    for (const banned of ['dataforseo', 'serpapi', 'web_search', 'serper', 'bing.com/v7']) {
      assert.ok(!src.toLowerCase().includes(banned), `${file} reaches ${banned}`);
    }
  }
});

/* ── §56: sponsorship cannot touch organic ranking ───────────────── */

test('the ranking input type cannot carry a sponsorship flag', () => {
  const src = read('src/expats/research/reputation.ts');
  const block = src.slice(src.indexOf('export interface RankingInputs'));
  const body = block.slice(0, block.indexOf('}'));
  for (const banned of ['sponsored', 'paid', 'placement', 'promoted', 'partner']) {
    assert.ok(!body.includes(banned), `RankingInputs carries ${banned}`);
  }
});

test('the funnel cannot record a stage Homatch does not observe', () => {
  const migration = read('supabase/migrations/20260920191136_for_expats_foundation.sql');
  /* Scoped to the funnel table. There is a `stage` CHECK on expat_tasks
     too, listing the plan's own stages, and an unscoped search finds that
     one first — which would make this assertion pass for the wrong
     reason for ever. */
  const table = migration.indexOf('create table if not exists public.expat_outbound_events');
  assert.ok(table > 0, 'the funnel table is gone');
  const at = migration.indexOf('stage       text not null check', table);
  assert.ok(at > 0, 'the funnel stage constraint is gone');
  const check = migration.slice(at, migration.indexOf('),', at));
  assert.ok(check.includes("'LEAD_SUBMITTED'"));
  assert.ok(!check.includes("'BOOKED'"), 'the database accepts an unobservable BOOKED');
  assert.ok(!check.includes("'CONVERTED'"), 'the database accepts an unobservable CONVERTED');
});

/* ── §36: a coverage gap is never a finding ──────────────────────── */

test('every surface that can show a gap has a string for it', () => {
  const bundle = read('src/i18n/translations.ts');
  for (const key of [
    'expat_availability_coverage_gap',
    'expat_availability_unknown',
    'expat_wcib_gap_title',
    'expat_col_gap_title',
    'expat_research_note_not_an_absence',
  ]) {
    assert.ok(bundle.includes(`${key}:`), `${key} is missing from the bundle`);
  }
});

test('the two established availabilities render nothing', () => {
  const src = read('src/components/expats/Provenance.tsx');
  assert.ok(/availability === 'ESTABLISHED'/.test(src));
  assert.ok(/return null/.test(src));
});

/* ── §66: the free layer is genuinely free ───────────────────────── */

test('the public routes are public and only the plan is not', () => {
  const routes = read('src/routes.tsx');
  const row = (p) => {
    const m = routes.match(new RegExp(`\\{[^}]*path: '${p.replace(/\//g, '\\/')}'[^}]*\\}`));
    return m ? m[0] : '';
  };
  assert.match(row('/for-expats/georgia'), /public: true/);
  assert.match(row('/for-expats/georgia/:slug'), /public: true/);
  assert.match(row('/for-expats/plan'), /public: false/);
});

test('the landing page renders its tools without waiting for a session', () => {
  const page = read('src/pages/ForExpatsPage.tsx');
  // The only thing the auth state changes is which link the plan CTA gets.
  const uses = page.match(/homatchUser/g) ?? [];
  assert.ok(uses.length <= 2, `auth is consulted ${uses.length} times on a free page`);
  assert.ok(!/if \(!homatchUser\) return/.test(page), 'the page gates itself on a session');
});

/* ── §91: it is discoverable ─────────────────────────────────────── */

test('For Expats is in the navigation and is not buried', () => {
  const shell = read('src/components/layouts/HomatchShell.tsx');
  assert.ok(shell.includes("path: '/for-expats/georgia'"), 'it is not in the rail');
  const nav = shell.slice(shell.indexOf('export const NAV'));
  /*
   * WORKSPACE -> EXPAT -> INTELLIGENCE.
   *
   * It used to be the first group of all, on the reasoning that anything
   * lower would read as a fifth analysis tool. It keeps its own group and
   * its own heading, which is what 'not buried' means; what changed is that
   * opening the product on a relocation guide told every signed-in owner,
   * buyer and broker that explaining Georgia to foreigners is the thing
   * Homatch does. It sits after the work and before the tools now.
   */
  assert.ok(nav.indexOf('nav_group_workspace') < nav.indexOf('nav_group_expats'),
    'Expat should follow the workspace, not precede it');
  assert.ok(nav.indexOf('nav_group_expats') < nav.indexOf('nav_group_intelligence'),
    'Expat should come before the intelligence tools');
  for (const burial of ['nav_group_more', 'nav_group_resources', 'nav_group_tools']) {
    assert.ok(!nav.includes(burial), `it is filed under ${burial}`);
  }
});

/* ── SEO ─────────────────────────────────────────────────────────── */

test('robots.txt points at a sitemap that exists and blocks the plan', () => {
  const robots = read('public/robots.txt');
  assert.match(robots, /Sitemap: https:\/\/homatch\.live\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/for-expats\/plan/);
  assert.ok(exists('public/sitemap.xml'));
});

test('the sitemap lists the public entry point and never the plan', () => {
  const xml = read('public/sitemap.xml');
  assert.ok(xml.includes('<loc>https://homatch.live/for-expats/georgia</loc>'));
  assert.ok(!xml.includes('/for-expats/plan'));
  assert.ok(!xml.includes(':slug'), 'a route parameter was published as a literal');
});

test('structured data is Article and BreadcrumbList, never a fake FAQ', () => {
  const src = read('src/components/expats/ExpatSeo.tsx');
  assert.ok(src.includes("'@type': 'Article'"));
  assert.ok(src.includes("'@type': 'BreadcrumbList'"));
  /* Stripped of comments: the file EXPLAINS why FAQPage is wrong here, and
     a guard that cannot tell prose from code teaches people to delete the
     explanation rather than to avoid the mistake. */
  assert.ok(!code(src).includes('FAQPage'), 'sections were marked up as questions nobody asked');
});

/* ── The database is the second half of the guarantee ────────────── */

test('a published topic must be verified and readable in English', () => {
  const migration = read('supabase/migrations/20260920191136_for_expats_foundation.sql');
  assert.ok(migration.includes('constraint expat_topics_publishable'));
  assert.ok(migration.includes("content ? 'en' and last_verified_at is not null"));
});

test('a completion timestamp exists exactly when a task is done', () => {
  const migration = read('supabase/migrations/20260920191136_for_expats_foundation.sql');
  assert.ok(migration.includes("(status = 'DONE') = (completed_at is not null)"));
});

test('calling a date official requires the fact that makes it official', () => {
  const migration = read('supabase/migrations/20260920191136_for_expats_foundation.sql');
  assert.ok(migration.includes("deadline_basis <> 'OFFICIAL' or deadline_fact_id is not null"));
});

test('the sensitive tables have no anonymous policy', () => {
  const migration = read('supabase/migrations/20260920191136_for_expats_foundation.sql');
  for (const table of ['expat_profiles', 'expat_tasks', 'expat_reminder_log', 'expat_provider_research']) {
    const policies = migration
      .split('\n')
      .filter((l) => l.includes(`on public.${table}`) || l.includes(`create policy ${table}`));
    for (const line of policies) {
      assert.ok(!/\bto anon\b|anon,/.test(line), `${table} has an anonymous policy: ${line}`);
    }
  }
});
