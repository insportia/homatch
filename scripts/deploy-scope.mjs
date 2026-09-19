#!/usr/bin/env node
/*
 * WHAT ACTUALLY HAS TO BE DEPLOYED, AND WHY A CANCELLED RUN MUST NOT LOSE IT.
 *
 * THE INCIDENT THIS EXISTS FOR
 *
 * 2026-09-19. dafdebd2 fixed a P0: a Georgian speaker was being answered in
 * Hindi. It reached main, CI started, and two commits from parallel sessions
 * landed minutes later. The workflow's concurrency group is `deploy-production`
 * with cancel-in-progress, so the run was killed -- and the edge deploy step
 * walks FIFTY-SEVEN functions serially, with `ai-talk-session` ninety-first in
 * the list. It never got there. Production ran the old resolver for hours
 * while main, and the frontend, had the fix. The owner tested a half-deployed
 * system and reported the bug as unfixed, which it was.
 *
 * Two independent faults produced that, and this addresses both.
 *
 *   EVERY DEPLOY DEPLOYS EVERYTHING. There is no change detection, so a
 *   one-line edge fix costs the same fifteen minutes as a rewrite, and that
 *   fifteen-minute window is what a later push cancels.
 *
 *   SCOPE WAS IMPLICITLY "THIS COMMIT". Anything computed from HEAD~1..HEAD
 *   is wrong after a cancellation: the newer commit touched different files,
 *   so the older commit's component simply disappears from the work list.
 *
 * SO SCOPE IS MEASURED AGAINST WHAT IS DEPLOYED, NOT AGAINST THE LAST COMMIT.
 *
 * CI records the commit each component was last deployed from in a git ref,
 * `refs/deployed/<component>`, and advances it ONLY after that component's
 * deploy succeeds. Scope is then the diff from that ref to HEAD. A cancelled
 * run never advances the ref, so the next run still sees the delta, however
 * many commits later it arrives and whatever those commits touched. Scenario F
 * is not a special case here; it is the ordinary reading of the question.
 *
 * A git ref is the right store because it is atomic, free, replicated with the
 * repository, and readable from a laptop without an API token.
 *
 * TRANSITIVE, BECAUSE EDGE FUNCTIONS IMPORT REAL CODE
 *
 * A function is not its own directory. ai-talk-session reaches into
 * _shared/comm and, through it, into generated mirrors of src/. Nine functions
 * import from src/ directly. So the closure of each entry point is walked and
 * a changed file maps to every function whose closure contains it -- which is
 * how a shared-module change still deploys all its dependants, and how an
 * unrelated change deploys none of them.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const FUNCTIONS_DIR = 'supabase/functions';

/** Components this repository can deploy independently. */
export const COMPONENTS = ['frontend', 'edge', 'worker', 'migrations'];

// stdio: git's own "Needed a single revision" on an absent ref is an
// ANSWER here, not an error, and printing it makes a normal first run
// look broken.
const git = (...args) => execFileSync('git', args,
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Every deployable edge function: a directory with an index.ts. */
export function edgeFunctionNames(root = ROOT) {
  const dir = join(root, FUNCTIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('_'))
    .filter((name) => existsSync(join(dir, name, 'index.ts')))
    .sort();
}

/**
 * Every file an entry point can reach, following relative imports.
 *
 * Deliberately only relative specifiers: a Deno URL import is somebody else's
 * code and cannot be changed by a commit here, and a bare specifier does not
 * appear in these functions. Unresolvable paths are skipped rather than thrown
 * on -- this decides what to deploy, and check-edge-functions.mjs is what
 * decides whether the code is valid.
 */
export function importClosure(entry, root = ROOT) {
  const seen = new Set();
  const stack = [resolve(root, entry)];
  const IMPORT = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;

  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(IMPORT)) {
      const target = resolve(dirname(file), m[1]);
      for (const candidate of [target, `${target}.ts`, join(target, 'index.ts')]) {
        if (existsSync(candidate) && !seen.has(candidate)) { stack.push(candidate); break; }
      }
    }
  }
  return new Set([...seen].map((f) => relative(root, f).split('\\').join('/')));
}

/** Which edge functions a set of changed files can reach. */
export function affectedFunctions(changed, root = ROOT) {
  const names = edgeFunctionNames(root);
  const touched = new Set(changed);
  const hit = [];
  for (const name of names) {
    const closure = importClosure(`${FUNCTIONS_DIR}/${name}/index.ts`, root);
    for (const file of closure) {
      if (touched.has(file)) { hit.push(name); break; }
    }
  }
  return hit;
}

/**
 * Does this change require the frontend, the worker, or migrations?
 *
 * Coarse on purpose. Vercel builds the whole app from one tree, the worker is
 * one service, and a migration is a migration: splitting those further would
 * be precision nobody can deploy on.
 */
export function componentsFor(changed, root = ROOT) {
  const any = (re) => changed.some((f) => re.test(f));
  const out = new Set();
  if (any(/^src\//) || any(/^index\.html$/) || any(/^vite\.config/) || any(/^package(-lock)?\.json$/)
    || any(/^public\//) || any(/^tailwind\.config/) || any(/^tsconfig/)) out.add('frontend');
  if (any(/^official-worker\//)) out.add('worker');
  if (any(/^supabase\/migrations\//)) out.add('migrations');
  const fns = affectedFunctions(changed, root);
  if (fns.length) out.add('edge');
  return { components: [...out], functions: fns };
}

/**
 * The commit a component was last deployed from, or null when unknown.
 *
 * Unknown means "deploy it": the first run after this lands has no refs, and a
 * component nobody can prove is current is a component that gets deployed.
 */
export function deployedRef(component) {
  try {
    return git('rev-parse', '--verify', `refs/deployed/${component}^{commit}`);
  } catch {
    return null;
  }
}

/**
 * Is `head` an ancestor of `base` -- that is, has this run been overtaken?
 *
 * THE DOWNGRADE THIS PREVENTS.
 *
 * `git diff A..B --name-only` names the files that DIFFER. It does not care
 * which way round they are, so a run whose deployed-edge base is a descendant
 * of its own HEAD sees a long list of "changes" and would happily upload the
 * older code over the newer, reporting success for a downgrade.
 *
 * Runs queue rather than cancel, so the ordinary case is safe by ordering.
 * This covers the ones that are not ordinary: a re-run of an old commit, a
 * pending run discarded and revived, and a deployed ref that is falsely ahead
 * -- which is not hypothetical, because refs/deployed/edge was falsely ahead
 * twice on 2026-09-19 and this is what a third occurrence would meet.
 *
 * Reported as SUPERSEDED, never as UP_TO_DATE. The two are opposite facts:
 * one means production already has this, the other means production has
 * something NEWER than this and the run should keep its hands off. Collapsing
 * them would hide precisely the situation that needs a person to look.
 */
export function isSuperseded(base, head = 'HEAD') {
  if (!base) return false;
  try {
    const a = git('rev-parse', `${head}^{commit}`);
    const b = git('rev-parse', `${base}^{commit}`);
    if (a === b) return false;
    git('merge-base', '--is-ancestor', a, b);
    return true;
  } catch {
    return false;
  }
}

export function changedSince(base, head = 'HEAD') {
  if (!base) return null;
  try {
    return git('diff', '--name-only', `${base}..${head}`).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * The work this run has to do, per component, against what is deployed.
 *
 * `null` from changedSince means the base is unreachable -- a force-push, a
 * pruned ref, a shallow clone. Deploying is the safe reading of "I cannot tell
 * what changed", and it is what the old pipeline did every time anyway.
 */
export function deploymentScope({ head = 'HEAD', root = ROOT } = {}) {
  const scope = { head: git('rev-parse', head), components: {}, functions: [] };
  const fns = new Set();

  for (const component of COMPONENTS) {
    const base = deployedRef(component);
    if (isSuperseded(base, head)) {
      scope.components[component] = { deploy: false, reason: 'SUPERSEDED', base };
      continue;
    }
    const changed = changedSince(base, head);
    if (base === null || changed === null) {
      scope.components[component] = { deploy: true, reason: base === null ? 'NEVER_RECORDED' : 'BASE_UNREACHABLE', base };
      if (component === 'edge') edgeFunctionNames(root).forEach((n) => fns.add(n));
      continue;
    }
    if (changed.length === 0) {
      scope.components[component] = { deploy: false, reason: 'UP_TO_DATE', base };
      continue;
    }
    const { components, functions } = componentsFor(changed, root);
    const needed = components.includes(component);
    scope.components[component] = {
      deploy: needed,
      reason: needed ? 'CHANGED' : 'UNAFFECTED',
      base,
      changedFiles: changed.length,
    };
    if (component === 'edge' && needed) functions.forEach((n) => fns.add(n));
  }

  scope.functions = [...fns].sort();
  return scope;
}

if (import.meta.url === `file://${process.argv[1]?.split('\\').join('/')}`
  || process.argv[1]?.endsWith('deploy-scope.mjs')) {
  const json = process.argv.includes('--json');
  const scope = deploymentScope();
  if (json) {
    console.log(JSON.stringify(scope));
  } else {
    console.log(`head ${scope.head.slice(0, 8)}`);
    for (const [name, c] of Object.entries(scope.components)) {
      const base = c.base ? c.base.slice(0, 8) : '--------';
      console.log(`  ${name.padEnd(11)} ${c.deploy ? 'DEPLOY' : 'skip  '}  from ${base}  ${c.reason}`);
    }
    if (scope.functions.length) {
      console.log(`  edge functions (${scope.functions.length}): ${scope.functions.join(' ')}`);
    }
  }
}
