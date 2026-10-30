// The render shell defines esbuild's __name helper (2026-10-30): without it every TAS page render
// failed in production with "ReferenceError: __name is not defined" (tsx keepNames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { PAGE_SHELL_HTML } from '../.tstest-build/workflows/tas/api/pdfRender.js';

const src = readFileSync(new URL('../src/workflows/tas/api/pdfRender.ts', import.meta.url), 'utf8');

test('tsx-style transform puts __name into the in-page render function; the shell shim makes it run', () => {
  // What tsx does to this file: esbuild with keepNames.
  const out = transformSync(src, { loader: 'ts', format: 'esm', keepNames: true, target: 'es2022' }).code;
  const at = out.indexOf('const textOf = ');
  assert.ok(at > 0, 'render has its named inner function');
  assert.match(out.slice(at, at + 200), /__name\(/, 'keepNames wraps it, exactly as in production');

  // A page without the shim: the production failure.
  const bare = vm.createContext({});
  assert.throws(() => vm.runInContext('__name(async (p) => p, "textOf")', bare), /__name is not defined/);

  // The shell's inline script, run first as the browser does, then the same call.
  const shim = /<script>([^<]+)<\/script>/.exec(PAGE_SHELL_HTML)[1];
  const page = vm.createContext({});
  vm.runInContext('globalThis.globalThis = this;' + shim, page);
  const fn = vm.runInContext('__name(function textOf(p) { return p * 2; }, "textOf")', page);
  assert.equal(fn(21), 42);
  // Defined before pdf.js loads, and never replaces an existing helper.
  assert.ok(PAGE_SHELL_HTML.indexOf('__name') < PAGE_SHELL_HTML.indexOf('/pdf.js'));
  assert.match(shim, /globalThis\.__name=globalThis\.__name\|\|/);
});

test('the route serves this shell for the render origin', () => {
  assert.match(src, /if \(p === '\/'\) return route\.fulfill\(\{ contentType: 'text\/html', body: PAGE_SHELL_HTML \}\);/);
});
