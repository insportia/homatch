/*
 * npm run homatch:map — regenerate docs/claude/generated/*.
 *
 * Deterministic maps of the things a session otherwise rediscovers by
 * searching: every route and who may open it, every edge function and how it
 * deploys, the migration ledger's local tail, and a one-screen repository
 * orientation. Output is deliberately compact — these files are read by an
 * LLM, and a map that needs a map has failed.
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, git, stamp, parseRoutes, parseMigrations, edgeDeployModes,
  edgeFunctionNames, importClosure,
} from './lib.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = outArg !== -1 && process.argv[outArg + 1]
  ? process.argv[outArg + 1]
  : join(ROOT, 'docs/claude/generated');
mkdirSync(OUT, { recursive: true });
const head = git('rev-parse', '--short', 'HEAD');
const header = (title) => `${stamp(head)}\n# ${title}\n\nRegenerate: \`npm run homatch:map\`\n\n`;

/* ── ROUTE_MAP.md ──────────────────────────────────────────────────────── */
{
  const routes = parseRoutes();
  const rows = routes.map((r) =>
    `| \`${r.path}\` | ${r.access} | ${r.component} | ${r.file ? `\`${r.file}\`` : '—'} |`);
  const byAccess = (a) => routes.filter((r) => r.access === a).length;
  const body = [
    header('Route map'),
    `${routes.length} routes: ${byAccess('public')} public · ${byAccess('auth')} authenticated · ${byAccess('admin')} admin.`,
    '',
    'Shells: public pages render under `PublicHeader`/`AppLayout` public chrome;',
    'authenticated customer pages under the customer `AppLayout`; `/admin/*` under the',
    'protected global Admin shell. Public-nav destinations: `src/site/publicNav.ts`.',
    '',
    '| Path | Access | Component | Source |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'ROUTE_MAP.md'), body);
}

/* ── EDGE_FUNCTIONS.md ─────────────────────────────────────────────────── */
{
  const modes = edgeDeployModes();
  const names = Object.keys(modes).sort();
  const rows = names.map((name) => {
    const entry = `supabase/functions/${name}/index.ts`;
    let closure = [];
    try { closure = [...importClosure(entry, ROOT)]; } catch { /* unreadable */ }
    const shared = closure.filter((f) => f.includes('_shared/')).length;
    const reachesSrc = closure.some((f) => f.startsWith('src/'));
    return `| ${name} | ${modes[name]} | ${closure.length} | ${shared} | ${reachesSrc ? 'yes' : ''} |`;
  });
  const body = [
    header('Edge function map'),
    'Deploy mode comes from `.github/workflows/deploy.yml` (the two name lists) and',
    '`HAND_DEPLOYED` in `scripts/deploy-scope.mjs` — the same sources CI uses, so this',
    'table cannot drift from the pipeline. `UNLISTED` means the function exists but no',
    'CI loop deploys it; treat that as a question, not a default.',
    '',
    'Owed-set / artifact-proof logic: `scripts/deploy-scope.mjs`, `scripts/edgeArtifacts.mjs`.',
    'A CLI "deployed" message is NOT deployment proof; the artifact check is.',
    '',
    '| Function | Deploy mode | Closure files | Shared | Reaches src/ |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'EDGE_FUNCTIONS.md'), body);
}

/* ── DB_MIGRATIONS.md ──────────────────────────────────────────────────── */
{
  const migrations = parseMigrations();
  const tail = migrations.slice(-20);
  const tables = [];
  for (const m of migrations) {
    const sql = readFileSync(join(ROOT, 'supabase/migrations', m.file), 'utf8');
    for (const t of sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z0-9_]+)/gi)) {
      tables.push({ table: t[1], migration: m.file });
    }
  }
  const firstSeen = new Map();
  for (const t of tables) if (!firstSeen.has(t.table)) firstSeen.set(t.table, t.migration);
  const body = [
    header('Database map (from repository migrations)'),
    `${migrations.length} migrations. The repository is the first source of schema truth;`,
    'query production only when live state (drift, ledger, data) actually matters.',
    'Domain narrative: `docs/DATABASE.md`. Ledger guard test: `tests/matrix/migrationHistory.test.mjs`.',
    '',
    `## Tables (${firstSeen.size}) and the migration that created them`,
    '',
    ...[...firstSeen.entries()].sort().map(([t, m]) => `- \`${t}\` — ${m}`),
    '',
    '## Latest 20 migrations',
    '',
    ...tail.map((m) => `- ${m.file}`),
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'DB_MIGRATIONS.md'), body);
}

/* ── REPO_MAP.md ───────────────────────────────────────────────────────── */
{
  const count = (dir, filter = () => true) => {
    try { return readdirSync(join(ROOT, dir)).filter(filter).length; } catch { return 0; }
  };
  const srcDirs = readdirSync(join(ROOT, 'src'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const body = [
    header('Repository map'),
    '## Where things live',
    '',
    `- \`src/pages/\` — ${count('src/pages', (f) => f.endsWith('.tsx'))} top-level pages, plus \`admin/\` (${count('src/pages/admin')}), \`property/\` (${count('src/pages/property')}), \`auth/\`, \`developer/\`. Route table: \`src/routes.tsx\` → generated/ROUTE_MAP.md.`,
    `- \`src/components/\` — feature components; \`home/sections/\` are the protected homepage regions; \`studio/\` is Site Studio; \`matching/\` the discovery surfaces; \`ui/\` shadcn primitives.`,
    `- \`src/site/\` — the public site system: \`publicNav.ts\` (one navigation), \`registry.ts\` (Site-Studio section defs, PUBLIC/SIGNED_IN routes), \`render/\` (SitePage/order), \`productEntry.ts\` (auth-aware product links).`,
    `- \`src/research-core/\` — deterministic intelligence: \`intent/\` (six-language reader, effective intent), \`match/\` (compatibility), \`discovery/\`, \`normalize/\`. Shared by frontend AND edge functions (see runtime-neutrality seam tests).`,
    `- \`src/i18n/translations.ts\` — the single six-locale bundle (en full; ka/ru/tr/ar/he overrides). Never hand-splice: use/extend the idempotent \`scripts/*-i18n-apply.mjs\` pattern.`,
    `- \`src/services/\`, \`src/lib/\`, \`src/contexts/\` — client services (Supabase access), utilities, auth/language contexts.`,
    `- \`supabase/functions/\` — ${edgeFunctionNames().length} CI-deployable edge functions + \`_shared/\` (+ hand-deploy-only ones) → generated/EDGE_FUNCTIONS.md.`,
    `- \`supabase/migrations/\` — ${parseMigrations().length} append-only migrations → generated/DB_MIGRATIONS.md.`,
    `- \`official-worker/\` — the Railway AI TALK worker (canonical service only; see CLAUDE.md).`,
    `- \`tests/\` — \`matrix/\` source-level guards (${count('tests/matrix')} files), \`mobile/\` + \`browser/\` + \`studio/\` Playwright harness suites, \`developer/\`.`,
    `- \`scripts/\` — deploy scope/artifact proof (\`deploy-scope.mjs\`, \`edgeArtifacts.mjs\`), i18n apply/check suite, test runners, \`claude/\` (this layer).`,
    `- \`.github/workflows/deploy.yml\` — the deploy pipeline: scope → validate → build → edge deploy with artifact proof → refs/deployed/* advance.`,
    '',
    '## src/ top level',
    '',
    srcDirs.map((d) => `\`${d}\``).join(' · '),
    '',
    '## Read next, by task',
    '',
    '- Routing/UI entry → generated/ROUTE_MAP.md · UI contracts → docs/claude/UI_CONTRACTS.md',
    '- Edge/deploy → generated/EDGE_FUNCTIONS.md · docs/claude/../DEPLOYMENT.md',
    '- Schema → generated/DB_MIGRATIONS.md · docs/DATABASE.md',
    '- Anything protected → docs/claude/PROTECTED_SURFACES.md',
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'REPO_MAP.md'), body);
}

console.log(`[homatch:map] wrote 4 maps to ${OUT} (head ${head})`);
