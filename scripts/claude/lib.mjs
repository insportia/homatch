/*
 * HOMATCH Claude engineering layer — shared, dependency-free helpers.
 *
 * Everything here answers questions FROM THE REPOSITORY, deterministically:
 * no network, no production SQL, no model reasoning. The commands in
 * scripts/claude/*.mjs and the guards in tests/matrix/claudeTooling.test.mjs
 * are thin shells around these functions, so one implementation is tested
 * once and reused everywhere.
 *
 * Existing infrastructure is REUSED, never re-implemented: the edge-function
 * inventory and import-closure walker come from scripts/deploy-scope.mjs,
 * which the deploy pipeline already trusts.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { edgeFunctionNames, importClosure, HAND_DEPLOYED } from '../deploy-scope.mjs';

export { edgeFunctionNames, importClosure, HAND_DEPLOYED };

export const ROOT = process.cwd();

export const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/* ── Routes ──────────────────────────────────────────────────────────────
 * src/routes.tsx declares every route as a one-line object literal:
 *   { name: '…', path: '/…', element: <Component …/>, public: true }
 * plus `adminOnly: true` on the admin screens, and maps each component to
 * its source file through the lazyRoute import above the table. That shape
 * is already what tests/matrix/publicSite.test.mjs parses; this reads the
 * same fields plus the component identity.
 */
export function parseRoutes(root = ROOT) {
  const src = readFileSync(join(root, 'src/routes.tsx'), 'utf8');

  // Component name -> repo source file, from the lazyRoute imports and the
  // handful of eager imports.
  const files = {};
  for (const m of src.matchAll(/const (\w+) = lazyRoute\(\(\) => import\('\.\/(.+?)'\)\)/g)) {
    files[m[1]] = `src/${m[2]}${m[2].endsWith('.tsx') || m[2].endsWith('.ts') ? '' : '.tsx'}`;
  }
  for (const m of src.matchAll(/import (\w+) from '\.\/(.+?)';/g)) {
    files[m[1]] ??= `src/${m[2]}${m[2].endsWith('.tsx') ? '' : '.tsx'}`;
  }

  const routes = [];
  for (const line of src.split('\n')) {
    const path = line.match(/path:\s*'([^']+)'/);
    if (!path) continue;
    const name = line.match(/name:\s*'([^']+)'/)?.[1] ?? '';
    const component = line.match(/element:\s*<(\w+)/)?.[1] ?? '';
    const isPublic = /public:\s*true/.test(line);
    const adminOnly = /adminOnly:\s*true/.test(line);
    routes.push({
      path: path[1],
      name,
      component,
      file: files[component] ?? null,
      access: adminOnly ? 'admin' : isPublic ? 'public' : 'auth',
    });
  }
  return routes;
}

/* ── Migrations ────────────────────────────────────────────────────────── */
export function parseMigrations(root = ROOT) {
  const dir = join(root, 'supabase/migrations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const m = file.match(/^(\d+)_(.+)\.sql$/);
      return { file, timestamp: m?.[1] ?? '', name: m?.[2] ?? file };
    });
}

/**
 * Local migration hygiene. No production access: the ledger comparison for
 * real deployments stays where it lives (deploy workflow / deploy:status).
 */
export function checkMigrations(migrations) {
  const problems = [];
  const seenTs = new Map();
  for (const m of migrations) {
    if (!/^\d{14}$/.test(m.timestamp)) {
      problems.push({ file: m.file, kind: 'BAD_TIMESTAMP', detail: 'expected a 14-digit YYYYMMDDHHMMSS prefix' });
    }
    if (seenTs.has(m.timestamp)) {
      problems.push({ file: m.file, kind: 'DUPLICATE_TIMESTAMP', detail: `same prefix as ${seenTs.get(m.timestamp)}` });
    }
    seenTs.set(m.timestamp, m.file);
    if (!/^[a-z0-9_]+$/.test(m.name)) {
      problems.push({ file: m.file, kind: 'BAD_NAME', detail: 'name should be lower_snake_case' });
    }
  }
  return problems;
}

/**
 * A migration that opens its own transaction breaks under a runner that
 * already owns one — the broker-directory migration did exactly this and had
 * to be patched before it could be applied. Comments are stripped first so
 * prose about transactions cannot trip the check, and cron.schedule bodies
 * (dollar-quoted) are ignored because their BEGIN belongs to the scheduled
 * statement, not to this migration.
 */
export function findInnerTransactions(sql) {
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, '$$body$$');
  const hits = [];
  for (const m of stripped.matchAll(/^\s*(begin|commit|rollback)\s*;/gim)) hits.push(m[1].toLowerCase());
  return hits;
}

/* ── Domain classification ───────────────────────────────────────────────
 * One table, used by homatch:scope, homatch:context and the affected-test
 * selector, so the three can never disagree about what a file touches.
 * First match wins within a group; a file can land in several domains.
 */
const DOMAIN_RULES = [
  ['VERIFY', [/^src\/pages\/Verify/, /^src\/pages\/ContractResultPage/, /^src\/verify\//, /^src\/components\/verify/i, /^supabase\/functions\/(research-agent|verify-synthesis|verification-handoff|browserbase-handoff)\//]],
  ['PUBLIC_HOMEPAGE', [/^src\/pages\/HomePage/, /^src\/components\/home\//, /^src\/site\//, /^src\/pages\/(AboutPage|PricingPage|PartnersPage|DevelopersPage|PrivacyPage|TermsPage|BrokersPage|ProductEntryPage)/, /^public\//, /^scripts\/build-sitemap/]],
  ['OWNER', [/^src\/pages\/property\//, /^src\/components\/property\//, /^src\/components\/owner/i]],
  ['DISCOVERY', [/^src\/pages\/(FindPropertyPage|ActiveSearchPage)/, /^src\/components\/matching\//, /^src\/research-core\/(match|discovery|intent)\//, /^supabase\/functions\/(supply-matching|find-property|find-property-plan|run-matching|run-matching-v2|ingest-live-chat)\//]],
  ['ADMIN', [/^src\/pages\/admin\//, /^src\/admin\//, /^src\/components\/admin/i, /^src\/components\/studio\//, /^supabase\/functions\/(admin-user360|impersonate-user)\//]],
  ['BILLING', [/^src\/pages\/CreditsPage/, /^src\/services\/(billing|credits)/i, /^supabase\/functions\/(billing|credits-topup|payment-webhook|payment-method-setup|atomic-unlock|unlock-external-contact|research-purchase)\//, /^supabase\/functions\/_shared\/(billing|payment_provider)\.ts$/]],
  ['NOTIFICATIONS', [/^src\/pages\/NotificationsPage/, /^src\/components\/notifications/i, /^src\/lib\/pwa/, /^supabase\/functions\/(push-send|active-search-notify)\//, /^supabase\/functions\/_shared\/notify\.ts$/]],
  ['BROKER', [/^src\/pages\/BrokersPage/, /^src\/components\/brokers/i, /^src\/components\/home\/sections\/BrokersSection/, /^supabase\/functions\/[^/]*broker[^/]*\//i, /^supabase\/migrations\/.*broker/i]],
  ['AI_TALK', [/^src\/components\/home\/AiTalkPanel/, /^src\/lib\/comm\//, /^official-worker\//, /^supabase\/functions\/(comm-|voice-|whatsapp-|ai-talk|cartesia)/, /^supabase\/functions\/_shared\/comm\//]],
  ['EXPATS', [/^src\/pages\/expat/i, /^src\/components\/expat/i, /^scripts\/expat-/]],
  ['I18N', [/^src\/i18n\//, /^scripts\/.*i18n/]],
  ['DATABASE', [/^supabase\/migrations\//]],
  ['EDGE', [/^supabase\/functions\//]],
  ['DEPLOYMENT', [/^\.github\/workflows\//, /^scripts\/(deploy-|edgeArtifacts|check-edge-functions)/, /^vercel\.json$/]],
  ['TOOLING', [/^scripts\/claude\//, /^docs\/claude\//, /^CLAUDE\.md$/, /^\.claude\//]],
];

export function domainsFor(files) {
  const out = new Map();
  for (const file of files) {
    for (const [domain, patterns] of DOMAIN_RULES) {
      if (patterns.some((re) => re instanceof RegExp && re.test(file))) {
        if (!out.has(domain)) out.set(domain, []);
        out.get(domain).push(file);
      }
    }
  }
  return out;
}

/* ── Protected surfaces ──────────────────────────────────────────────────
 * The contracts recorded in docs/claude/PROTECTED_SURFACES.md, as warnings
 * a script can print next to a diff. Text lives here once; the doc explains
 * the reasoning.
 */
export const PROTECTED_WARNINGS = {
  VERIFY: 'PROTECTED SURFACE — Verify. No redesign, no behavior change, no intelligence-architecture change without an explicit instruction. Read docs/claude/PROTECTED_SURFACES.md.',
  PUBLIC_HOMEPAGE: 'PROTECTED VISUAL BASELINE — the live black/gold homepage identity (hero, AI TALK, storytelling sections). Functional/responsive/a11y fixes allowed; no visual replacement. Read docs/claude/PROTECTED_SURFACES.md.',
  ADMIN: 'PROTECTED SHELL — reuse the existing global Admin shell; never build a second Admin app.',
  OWNER: 'DESIGN CONTRACT — Owner surfaces are FULL DARK NAVY; keep their established product design.',
  DISCOVERY: 'DESIGN CONTRACT — Matches / Find Property follow the dark discovery contract.',
  BILLING: 'FINANCIAL INVARIANTS — PAYG only, 10 credits = $1, reserve→settle→release, no silent zero COGS. Read docs/claude/BILLING.md before editing.',
  DATABASE: 'MIGRATIONS — append-only, runner owns the transaction, push does NOT apply them. Run npm run homatch:migrations.',
  AI_TALK: 'RAILWAY — only if official-worker/ files changed is a Railway deploy in scope, and only homatch-official-worker (3e7f132b-d0be-4804-9bc0-0b6ad368ad15). Never -v2.',
};

/** Changed files against a base ref (default: merge-base with origin/main). */
export function changedFiles(base) {
  const ref = base
    || (git('rev-parse', '--verify', 'origin/main') && git('merge-base', 'HEAD', 'origin/main'))
    || 'HEAD~1';
  const committed = git('diff', '--name-only', `${ref}...HEAD`).split('\n').filter(Boolean);
  // -uall expands untracked directories into their files (plain porcelain
  // prints `?? dir/`, which would classify as a phantom "file").
  const working = git('status', '--porcelain', '-uall').split('\n').filter(Boolean)
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter(Boolean)
    .map((l) => (l.includes(' -> ') ? l.split(' -> ')[1] : l));
  return { base: ref, files: [...new Set([...committed, ...working])] };
}

/* ── Edge deploy modes, read from the pipeline itself ────────────────────
 * deploy.yml holds the two authoritative name lists (JWT and no-JWT); the
 * hand-deployed pair lives in deploy-scope.mjs. Reading them means this map
 * can never contradict what CI actually does.
 */
export function edgeDeployModes(root = ROOT) {
  const yml = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
  const lines = yml.split('\n');
  const listAfter = (marker) => {
    // Bash array: from the `NAME=(` line to the first line that is just `)`.
    // Comment lines inside the block may contain anything (incl. parens).
    const start = lines.findIndex((l) => l.trim() === marker);
    if (start === -1) return [];
    const names = [];
    for (let i = start + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === ')') break;
      if (t.startsWith('#') || t === '') continue;
      const m = t.match(/^"([a-z0-9-]+)"$/);
      if (m) names.push(m[1]);
    }
    return names;
  };
  const jwt = new Set(listAfter('JWT_FUNCTIONS=('));
  const noJwt = new Set(listAfter('NO_JWT_FUNCTIONS=('));
  const modes = {};
  for (const name of edgeFunctionNames(root)) {
    modes[name] = jwt.has(name) ? 'jwt' : noJwt.has(name) ? 'no-jwt' : 'UNLISTED';
  }
  for (const name of HAND_DEPLOYED) modes[name] = 'hand-deploy-only';
  return modes;
}

/** The freshness stamp generated files carry, and how to read it back. */
export function stamp(head = git('rev-parse', '--short', 'HEAD')) {
  return `<!-- GENERATED by scripts/claude/repo-map.mjs — DO NOT EDIT. head:${head} at:${new Date().toISOString()} -->`;
}

export function readStampHead(file) {
  try {
    return readFileSync(file, 'utf8').match(/head:([0-9a-f]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}
