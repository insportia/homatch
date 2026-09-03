#!/usr/bin/env node
// i18n-keys-check.mjs — finds every literal t('some_key') call site in src/
// and verifies the key actually exists in the English translation bundle.
//
// This catches a DIFFERENT bug class than the other two i18n scripts:
//   - i18n-check.mjs compares languages against each other (missing/empty/
//     duplicate translations for keys that DO exist in English).
//   - i18n-audit.mjs finds hardcoded UI strings that never call t() at all.
//   - THIS script finds the opposite: a t('key') call whose key was never
//     added to translations.ts anywhere, so `t()` silently falls back to
//     returning the raw key string itself (see LanguageContext.tsx) and
//     every user, in every language including English, sees literal text
//     like "view_status_pending" instead of a real word. Found in production
//     across ViewingsPage, DeveloperProfilePage, ChatPage and others before
//     this script existed — it must not be able to regress silently again.
//
// Only literal string arguments are checked (t('key'), t(`key`)) — a
// dynamically computed key (t(someVar)) can't be statically verified and is
// skipped, not flagged.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSourceFile } from './i18n-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const TRANSLATIONS_FILE = path.join(ROOT, 'src/i18n/translations.ts');

function getEnglishKeySet() {
  const sourceFile = parseSourceFile(TRANSLATIONS_FILE);
  const keys = new Set();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name && ts.isIdentifier(node.name) && node.name.text === 'en' &&
      node.initializer && ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) keys.add(prop.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return keys;
}

function walkDir(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && full !== TRANSLATIONS_FILE) out.push(full);
  }
  return out;
}

function findTCalls(sourceFile) {
  const calls = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        calls.push({ key: arg.text, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return calls;
}

function main() {
  const englishKeys = getEnglishKeySet();
  console.log(`\n=== i18n key-existence check ===`);
  console.log(`Canonical English keys: ${englishKeys.size}`);

  const files = walkDir(SRC_DIR);
  const missing = new Map(); // key -> [{file, line}]

  for (const file of files) {
    const sourceFile = parseSourceFile(file);
    for (const { key, line } of findTCalls(sourceFile)) {
      if (!englishKeys.has(key)) {
        const rel = path.relative(ROOT, file);
        if (!missing.has(key)) missing.set(key, []);
        missing.get(key).push(`${rel}:${line}`);
      }
    }
  }

  if (missing.size === 0) {
    console.log('\n[i18n:keys] PASSED — every literal t() call resolves to a real key.\n');
    return;
  }

  console.log(`\n${missing.size} MISSING key(s) — referenced by t() but absent from translations.ts:\n`);
  for (const key of [...missing.keys()].sort()) {
    const locs = missing.get(key);
    const shown = locs.slice(0, 3).join(', ');
    const more = locs.length > 3 ? ` (+${locs.length - 3} more)` : '';
    console.log(`  ${key}  <-  ${shown}${more}`);
  }
  console.log('\n[i18n:keys] FAILED — add these keys (with real translations in all languages) to translations.ts.');
  process.exit(1);
}

main();
