/*
 * The repository facts the classifier needs, read from a real checkout:
 * file contents, diffs, the import graph and the edge import closure. The
 * PR plan, the post-merge provenance check and `homatch:release:plan` all
 * build their context here, so they classify identically.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildGraph, norm } from './graph.mjs';
import { affectedFunctions } from '../deploy-scope.mjs';

export const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, '\n').trim();

/**
 * base/head: the range whose diff is classified (for translations).
 * includeWorkingTree: local runs also diff uncommitted work.
 */
export function repoContext({ base, head = 'HEAD', includeWorkingTree = false, cwd = process.cwd() } = {}) {
  let graph = null;
  try { graph = buildGraph({ cwd }); } catch { graph = null; }
  return {
    graph,
    read: (f) => {
      if (existsSync(`${cwd}/${f}`)) return readFileSync(`${cwd}/${f}`, 'utf8');
      return git('show', `${head}:${f}`);
    },
    diff: (f) => {
      const parts = [];
      if (base) parts.push(git('diff', '-U0', `${base}..${head}`, '--', f));
      if (includeWorkingTree) parts.push(git('diff', '-U0', 'HEAD', '--', f));
      return parts.join('\n');
    },
    edgeFunctionsFor: (f) => affectedFunctions([norm(f)], cwd),
  };
}

/** Changed files between the merge base of `base` and `head` (+ local work). */
export function changedFiles({ base, head = 'HEAD', includeWorkingTree = false }) {
  const mergeBase = git('merge-base', base, head);
  const files = git('diff', '--name-only', `${mergeBase}..${head}`).split('\n');
  if (includeWorkingTree) {
    files.push(...git('diff', '--name-only', 'HEAD').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n'));
  }
  return { mergeBase, files: [...new Set(files.map(norm).filter(Boolean))] };
}
