#!/usr/bin/env node
/*
 * Syntax/type-shape check for Supabase Edge Functions.
 *
 * WHY NOT `deno check`
 *
 * Deno is not installed in every environment this repo is worked in, and the
 * edge functions import from https:// and jsr: specifiers that a plain tsc
 * project cannot resolve offline. transpileModule parses and reports real
 * syntax and grammar errors without needing to resolve a single import, which
 * is the class of mistake that actually ships broken here (a stray brace, a
 * bad generic, an unterminated template).
 *
 * It does NOT type-check across modules. That limitation is real and is why
 * the billing RPC contracts are additionally covered by tests that read the
 * migration SQL and assert the call sites agree with it.
 */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const roots = process.argv.slice(2);
const files = [];
const walk = (p) => {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p)) walk(path.join(p, e));
  } else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) files.push(p);
};
for (const r of roots.length ? roots : ['supabase/functions']) walk(r);

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: f,
  });
  const errs = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length) {
    bad++;
    console.log(`FAIL ${f}`);
    for (const d of errs.slice(0, 6)) {
      const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
      console.log(`   ${pos ? `${pos.line + 1}:${pos.character + 1} ` : ''}${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    }
  }
}
console.log(`${files.length} edge function files checked, ${bad} with syntax errors.`);
process.exit(bad ? 1 : 0);
