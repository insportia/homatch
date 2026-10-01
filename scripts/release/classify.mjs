/*
 * HOMATCH FAST RELEASE — which validation a change needs, and whether a
 * merged commit may be promoted on the strength of validation it already
 * passed.
 *
 *   changed files → owning components → their dependency closure
 *                 → required suites → required deploy → required proof
 *
 * Tiers:
 *   REPO_FULL       every suite. Toolchain / dependencies, the application
 *                   shell and shared core, the release engine, a global
 *                   auth / RLS primitive, a change that reaches the shell,
 *                   anything no rule can place, an uncomputable change set.
 *   COMPONENT_FULL  the complete suite set of every affected component,
 *                   because the change is security-relevant inside them
 *                   (access-control SQL, auth / secret paths, shared edge
 *                   code, a component's own workflow, AUTH / BILLING /
 *                   STORAGE). static + unit (all security matrix tests)
 *                   always run with it.
 *   TARGETED        static + unit, plus the suites of the components the
 *                   change can reach. Backend-only changes (edge function,
 *                   plain migration, script) add no browser suite: every
 *                   browser suite stubs the network and cannot observe them.
 *   FAST            post-merge only: the deployed tree is byte-identical to
 *                   a tree a successful PR run validated, and that run
 *                   covered every suite this change requires.
 *
 * Uncertainty always resolves upward. There is no switch that skips
 * validation; there is only evidence that it already happened.
 *
 * Pure: file contents, diffs, the import graph and the edge closure are
 * injected, so the CLIs and the tests drive the same function. Windows
 * paths and CRLF content classify exactly like their POSIX / LF forms.
 */
import {
  SUITES, ALWAYS, SUITE_CATALOGUE, COMPONENTS, GATEKEEPER, SECURITY_PATH, GLOBAL_EDGE_PRIMITIVE,
  DB_OBJECT_OWNERS, I18N_KEY_OWNERS, ownerOf, suiteOfTestFile,
} from './components.mjs';
import { dependentsOf, norm } from './graph.mjs';

export { SUITES, ALWAYS, GATEKEEPER };
export const TIERS = ['TARGETED', 'COMPONENT_FULL', 'REPO_FULL'];
const lf = (s) => (s == null ? s : String(s).replace(/\r\n?/g, '\n'));

/* SQL that changes who may read or write what. */
export const SECURITY_SQL = /\b(create|alter|drop)\s+policy\b|\b(grant|revoke)\b|\brow\s+level\s+security\b|\bsecurity\s+definer\b|\bauth\.(uid|role|jwt)\s*\(/i;

/** The objects a migration defines or writes, schema-qualified, lower case. */
export function migrationObjects(sqlText) {
  const sql = lf(sqlText)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, ' '); // function bodies: what it does is not what it defines
  const id = String.raw`((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)`;
  const ex = String.raw`(?:\s+if\s+(?:not\s+)?exists)?`;
  const patterns = [
    new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:materialized\s+)?(?:table|view|function|procedure|type|sequence|schema)${ex}\s+${id}`, 'gi'),
    new RegExp(String.raw`\b(?:alter|drop)\s+(?:materialized\s+)?(?:table|view|function|procedure|type|sequence)${ex}\s+(?:only\s+)?${id}`, 'gi'),
    new RegExp(String.raw`\b(?:create|alter|drop)\s+policy${ex}\s+(?:"[^"]+"|[a-z0-9_]+)\s+on\s+${id}`, 'gi'),
    new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+[a-z0-9_"]+[\s\S]*?\bon\s+${id}`, 'gi'),
    new RegExp(String.raw`\bdrop\s+trigger${ex}\s+[a-z0-9_"]+\s+on\s+${id}`, 'gi'),
    new RegExp(String.raw`\bcreate\s+(?:unique\s+)?index(?:\s+concurrently)?${ex}(?:\s+[a-z0-9_"]+)?\s+on\s+(?:only\s+)?${id}`, 'gi'),
    new RegExp(String.raw`\b(?:grant|revoke)\b[^;]*?\bon\s+(?:table\s+|function\s+|sequence\s+|all\s+tables\s+in\s+schema\s+|schema\s+)?${id}`, 'gi'),
    new RegExp(String.raw`\binsert\s+into\s+${id}`, 'gi'),
    new RegExp(String.raw`\bupdate\s+${id}\s+set\b`, 'gi'),
    new RegExp(String.raw`\bdelete\s+from\s+${id}`, 'gi'),
    new RegExp(String.raw`\bcomment\s+on\s+(?:table|function|view|column)\s+${id}`, 'gi'),
  ];
  const out = new Set();
  for (const re of patterns) {
    for (const m of sql.matchAll(re)) {
      let name = m[1].replace(/"/g, '').toLowerCase();
      if (!name.includes('.')) name = `public.${name}`;
      out.add(name);
    }
  }
  if (/\balter\s+default\s+privileges\b/i.test(sql)) out.add('auth.default_privileges');
  return [...out].sort();
}

function ownerOfObject(name) {
  if (/^(cron|net|extensions)\./.test(name)) return 'SCHEDULE';
  const hit = DB_OBJECT_OWNERS.find(([re]) => re.test(name));
  return hit ? hit[1] : null;
}

/** Translation keys a diff of translations.ts adds or removes, and whether it changed anything else. */
export function translationChange(diffText) {
  const keys = new Set();
  let structural = false;
  for (const raw of lf(diffText).split('\n')) {
    if (!/^[+-]/.test(raw) || /^(\+\+\+|---)/.test(raw)) continue;
    const line = raw.slice(1);
    if (!line.trim() || /^\s*(\/\/|\/\*|\*)/.test(line)) continue;
    const m = line.match(/^\s+['"]?([A-Za-z][A-Za-z0-9_]*)['"]?\s*:/);
    if (m && !/^\s*(en|ka|ru|tr|ar|he)\s*:/.test(line)) keys.add(m[1]);
    else if (!/^\s*['"`].*['"`],?\s*$/.test(line)) structural = true; // a wrapped value line is still the key above it
  }
  return { keys: [...keys].sort(), structural };
}

/**
 * Which suites a set of changed paths requires, and why.
 *
 *   read(f)           file text at the head being classified (migrations)
 *   diff(f)           unified diff of f (translations.ts)
 *   graph             buildGraph() — required for src/ and tests/ paths
 *   edgeFunctionsFor(f) edge function names whose import closure holds f
 */
export function classifyChanges(files, { read, diff, graph, edgeFunctionsFor } = {}) {
  const list = [...new Set((files ?? []).map(norm).filter(Boolean))].sort();
  const reasons = [];
  const comps = new Map(); // name → { ui, security, why: [] }
  const extraSuites = new Set();
  const repo = [];
  const proofs = new Set();
  const deploy = { frontend: false, functions: new Set(), migrations: [], railway: false };
  const touch = (name, { ui = false, security = false } = {}, why) => {
    if (!comps.has(name)) comps.set(name, { ui: false, security: false, why: [] });
    const c = comps.get(name);
    c.ui ||= ui; c.security ||= security || Boolean(COMPONENTS[name]?.security);
    if (why) c.why.push(why);
  };
  const escalate = (f, why) => { repo.push(`${f}: ${why}`); };
  const isShell = (f) => ownerOf(f) === 'CORE_SHARED';

  if (list.length === 0) escalate('(change set)', 'no changed files could be determined');

  for (const f of list) {
    const owner = ownerOf(f);
    if (/^(src|public)\/|^(index|share)\.html$/.test(f)) deploy.frontend = true;
    if (owner === 'RAILWAY') deploy.railway = true;
    const fnDir = f.match(/^supabase\/functions\/([^_/][^/]*)\//);
    if (fnDir && !/(^|\/)__tests__\//.test(f)) deploy.functions.add(fnDir[1]);

    // ── Repository-wide by ownership ──
    if (owner && COMPONENTS[owner].scope === 'repo') { escalate(f, `${owner} → REPO_FULL`); continue; }

    // ── Shared edge code: the functions that import it decide ──
    if (/^supabase\/functions\/_shared\//.test(f) && owner !== 'TESTS') {
      if (GLOBAL_EDGE_PRIMITIVE.test(f)) { escalate(f, 'global edge auth / security primitive → REPO_FULL'); continue; }
      let fns = null;
      try { fns = edgeFunctionsFor ? edgeFunctionsFor(f) : null; } catch { fns = null; }
      if (fns == null) { escalate(f, 'shared edge code and its importers are unknown → REPO_FULL'); continue; }
      fns.forEach((n) => deploy.functions.add(n));
      const owners = [...new Set(fns.map((n) => ownerOf(`supabase/functions/${n}/index.ts`) ?? 'EDGE'))].sort();
      if (owners.length > 2) { escalate(f, `shared edge code reaches ${owners.length} components (${owners.join(', ')}) → REPO_FULL`); continue; }
      if (owners.length === 0) { reasons.push(`${f}: shared edge code no function imports`); continue; }
      for (const o of owners) touch(o, { security: true }, `${f} (shared edge code: ${fns.filter((n) => (ownerOf(`supabase/functions/${n}/index.ts`) ?? 'EDGE') === o).join(', ')})`);
      reasons.push(`${f}: shared edge code → ${fns.join(', ')} → ${owners.join(' + ')} (security-relevant)`);
      continue;
    }

    // ── Migrations: by the objects they define ──
    if (owner === 'DATABASE' && /\.sql$/.test(f)) {
      deploy.migrations.push(f);
      let sql = null;
      try { sql = read ? read(f) : null; } catch { sql = null; }
      if (sql == null) { escalate(f, 'migration could not be read → REPO_FULL'); continue; }
      sql = lf(sql);
      const security = SECURITY_SQL.test(sql);
      const objects = migrationObjects(sql);
      const owners = new Map();
      const unknown = [];
      for (const o of objects) {
        const ow = ownerOfObject(o);
        if (ow === 'SCHEDULE') { proofs.add(`cron: ${f} schedules work — prove a real execution (cron.job_run_details)`); continue; }
        if (!ow) { unknown.push(o); continue; }
        if (!owners.has(ow)) owners.set(ow, []);
        owners.get(ow).push(o);
      }
      proofs.add(`database: ${f.split('/').pop()} present in the production ledger`);
      if (owners.has('GLOBAL')) { escalate(f, `defines a global auth / RLS object (${owners.get('GLOBAL').join(', ')}) → REPO_FULL`); continue; }
      if (security && unknown.length) { escalate(f, `changes access control on objects no component owns (${unknown.slice(0, 6).join(', ')}) → REPO_FULL`); continue; }
      if (!owners.size) { reasons.push(`${f}: migration on unowned objects, no access-control change → static + unit`); continue; }
      for (const [o, objs] of owners) {
        touch(o, { security }, `${f} (${objs.slice(0, 4).join(', ')}${objs.length > 4 ? ', …' : ''})`);
        if (security) proofs.add(`RLS: verify policies / grants on ${objs.slice(0, 4).join(', ')} in production`);
      }
      reasons.push(`${f}: migration → ${[...owners.keys()].join(' + ')}${security ? ' (access control → COMPONENT_FULL)' : ''}${unknown.length ? `; also ${unknown.length} unowned object(s)` : ''}`);
      continue;
    }

    // ── Translations: by the keys that changed ──
    if (owner === 'I18N') {
      let d = null;
      try { d = diff ? diff(f) : null; } catch { d = null; }
      const ch = d == null ? null : translationChange(d);
      const mapped = ch ? ch.keys.map((k) => [k, I18N_KEY_OWNERS.find(([re]) => re.test(k))?.[1]]) : [];
      const unmapped = mapped.filter(([, o]) => !o).map(([k]) => k);
      if (!ch || ch.structural || unmapped.length || !mapped.length) {
        const why = !ch ? 'diff unavailable' : ch.structural ? 'structural edit' : unmapped.length ? `keys outside a component (${unmapped.slice(0, 5).join(', ')})` : 'no key change found';
        SUITES.filter((s) => s.startsWith('mobile:') || s === 'a11y').forEach((s) => extraSuites.add(s));
        reasons.push(`${f}: translations, ${why} → every mobile shard + a11y`);
        continue;
      }
      const owners = [...new Set(mapped.map(([, o]) => o))].sort();
      for (const o of owners) touch(o, { ui: true }, `${f} (keys ${mapped.filter(([, x]) => x === o).map(([k]) => k).slice(0, 3).join(', ')}…)`);
      reasons.push(`${f}: ${ch.keys.length} translation key(s) → ${owners.join(' + ')}`);
      continue;
    }

    // ── A browser suite's own file ──
    const ownSuite = suiteOfTestFile(f);
    if (ownSuite) { extraSuites.add(ownSuite); reasons.push(`${f}: ${ownSuite} suite file`); continue; }

    // ── Frontend and test code: walk the import graph upward ──
    if (/^(src|tests)\//.test(f) && owner !== 'TESTS') {
      if (!graph) { escalate(f, 'frontend dependency graph unavailable → REPO_FULL'); continue; }
      const reached = dependentsOf(graph, f, isShell);
      const shell = [...reached].filter((n) => n !== f && ['CORE_SHARED', 'TOOLCHAIN'].includes(ownerOf(n)));
      if (shell.length) { escalate(f, `reaches the application shell (${shell.slice(0, 2).join(', ')}) → REPO_FULL`); continue; }
      const hit = new Set();
      const suites = new Set();
      for (const n of reached) {
        const s = suiteOfTestFile(n);
        if (s) { suites.add(s); continue; }
        const o = ownerOf(n);
        if (o && !['TESTS', 'TOOLING', 'DATABASE', 'I18N', 'EDGE'].includes(o)) hit.add(o);
      }
      if (!owner && !hit.size && !suites.size) { escalate(f, 'no rule places it and nothing depends on it → REPO_FULL'); continue; }
      const security = SECURITY_PATH.test(f);
      for (const o of hit) touch(o, { ui: /^src\//.test(f) || o === owner, security: security && o === owner }, f);
      suites.forEach((s) => extraSuites.add(s));
      const dependents = [...hit].filter((o) => o !== owner);
      reasons.push(`${f}: ${owner ?? 'unowned'}${dependents.length ? ` → also ${dependents.join(', ')} (import graph)` : ''}${suites.size ? ` · suites ${[...suites].join(', ')}` : ''}${security ? ' (security path)' : ''}`);
      continue;
    }

    if (!owner) { escalate(f, 'no rule proves its blast radius → REPO_FULL'); continue; }
    if (['TOOLING', 'TESTS'].includes(owner)) { reasons.push(`${f}: ${owner.toLowerCase()} → static + unit`); continue; }

    // ── Everything else a component owns: edge functions, scripts, assets, workflows ──
    const workflow = /^\.github\/workflows\//.test(f);
    const security = workflow || SECURITY_PATH.test(f);
    const ui = /^public\//.test(f);
    touch(owner, { ui, security }, f);
    reasons.push(`${f}: ${owner}${workflow ? ' component workflow (permissions / secrets)' : ''}${security && !workflow ? ' (security path)' : ''}${ui ? '' : ' · backend'}`);
  }

  // ── Result ──
  const componentSummary = Object.fromEntries([...comps].map(([n, c]) => [n, { ui: c.ui, security: c.security, why: c.why.slice(0, 8) }]));
  const deployOut = { frontend: deploy.frontend, functions: [...deploy.functions].sort(), migrations: deploy.migrations, railway: deploy.railway };
  if (repo.length) {
    return { tier: 'REPO_FULL', suites: [...SUITES], components: componentSummary, reasons: [...repo, ...reasons], files: list, deploy: deployOut, proofs: [...proofs] };
  }
  const suites = new Set([...ALWAYS, ...extraSuites]);
  let security = false;
  for (const [name, c] of comps) {
    const def = COMPONENTS[name] ?? {};
    if (c.security) security = true;
    if (c.ui || c.security) (def.suites ?? []).forEach((s) => suites.add(s));
    (def.backendSuites ?? []).forEach((s) => suites.add(s));
    if (name === 'RAILWAY') suites.add('worker');
    (def.proofs ?? []).forEach((p) => proofs.add(p));
  }
  if (deployOut.functions.length) proofs.add(`edge: PROVEN_EXACT for ${deployOut.functions.join(', ')}`);
  if (deployOut.frontend) proofs.add('frontend: Vercel READY at the merge commit, aliased to www.homatch.live, served entry asset belongs to it');
  return {
    tier: security ? 'COMPONENT_FULL' : 'TARGETED',
    suites: SUITES.filter((s) => suites.has(s)),
    components: componentSummary,
    reasons,
    files: list,
    deploy: deployOut,
    proofs: [...proofs],
  };
}

/** The shape a PR validation run records about itself. */
export const RECORD_VERSION = 2;

/**
 * May this merged commit be promoted without re-running validation?
 *
 *   mergedTree   git tree id of the commit being deployed (HEAD^{tree})
 *   record       the validation record the PR run uploaded, or null
 *   run          { conclusion, path, event } of that PR run, or null
 *   changed      files changed by the commit being deployed (HEAD^..HEAD)
 *   context      { read, diff, graph, edgeFunctionsFor } for classification
 *
 * Returns { path: 'FAST' | 'VALIDATE', reasons, required }. Every branch
 * that is not a complete, positive proof returns VALIDATE — the required
 * plan then runs in full, in parallel, before anything deploys.
 */
export function promotionDecision({ mergedTree, record, run, changed, ...context }) {
  const required = changed ? classifyChanges(changed, context) : null;
  const no = (why) => ({ path: 'VALIDATE', reasons: [why], required });
  if (!mergedTree || !/^[0-9a-f]{40}$/.test(mergedTree)) return no('the deployed tree id is unknown');
  if (!changed) return no('the deployed commit has no readable parent to diff against');
  if (!run) return no('no successful PR validation run was found for this commit');
  if (run.conclusion !== 'success') return no(`the PR validation run concluded ${run.conclusion ?? 'unknown'}`);
  if (run.event !== 'pull_request') return no(`the validation run came from ${run.event ?? 'an unknown event'}, not a pull request`);
  if (run.path !== '.github/workflows/pr-check.yml') return no(`the validation run came from ${run.path ?? 'an unknown workflow'}`);
  if (!record) return no('the PR run has no validation record');
  if (record.version !== RECORD_VERSION) return no(`validation record version ${record.version} is not ${RECORD_VERSION}`);
  if (!TIERS.includes(record.tier)) return no(`validation record tier ${record.tier} is unknown`);
  if (!Array.isArray(record.suites) || record.suites.some((s) => !SUITES.includes(s))) return no('validation record names unknown suites');
  if (record.validatedTree !== mergedTree) {
    return no(`the deployed tree ${mergedTree.slice(0, 12)} is not the validated tree ${String(record.validatedTree).slice(0, 12)} (main moved, or the merge changed code)`);
  }
  const gate = changed.map(norm).filter((f) => GATEKEEPER.some((re) => re.test(f)));
  if (gate.length) return no(`the release engine changed (${gate.join(', ')}); it cannot vouch for itself`);
  const ran = new Set(record.suites);
  const missing = required.suites.filter((s) => !ran.has(s));
  if (missing.length) return no(`the PR run did not cover: ${missing.join(', ')}`);
  return {
    path: 'FAST',
    required,
    reasons: [
      `deployed tree ${mergedTree.slice(0, 12)} is byte-identical to the tree PR validation run ${record.runId} validated`,
      `that run covered every required suite (${required.suites.join(', ')}) at tier ${record.tier}`,
    ],
  };
}

/** Old (v1) engine suite names → current suite ids, for the base-engine guard. */
export function upgradeSuiteNames(names) {
  const out = new Set();
  for (const n of names ?? []) {
    if (n === 'mobile') SUITES.filter((s) => s.startsWith('mobile:')).forEach((s) => out.add(s));
    else if (n === 'studio') SUITES.filter((s) => s.startsWith('studio:')).forEach((s) => out.add(s));
    else if (SUITES.includes(n)) out.add(n);
    else return null; // unknown: cannot be honoured, so cannot be narrowed
  }
  return [...out];
}

/** Suite → the files it runs, for the runner and the coverage test. */
export const suiteFiles = (id) => SUITE_CATALOGUE[id]?.files ?? [];
