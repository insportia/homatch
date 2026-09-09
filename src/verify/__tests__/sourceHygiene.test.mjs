// A stray control character in source is invisible and silently wrong.
//
// Twice in this codebase a regex has shipped with a literal BACKSPACE byte
// (0x08) where `\b` was intended, written by a tooling layer that ate the
// backslash. The regex then matches a control character that no real string
// contains, so it silently never fires — and it reads correctly in every
// editor, in grep, and in review.
//
// The most recent one put portal URLs into a customer's report: BARE_URL was
// `/<BS>https?:.../` and stripped nothing.
//
// Nothing legitimate in this source tree needs a raw control character. Tab,
// newline and carriage return are the only ones allowed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js', '.sql']);
const SKIP = new Set(['node_modules', 'dist', '.git', '.dist-ci', 'coverage', 'build']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(name))) yield full;
  }
}

test('no source file contains a raw control character', () => {
  // Everything below 0x20 except tab (09), newline (0A) and CR (0D), plus DEL.
  const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
  const offenders = [];

  for (const file of walk(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    const m = CONTROL.exec(text);
    if (!m) continue;
    const line = text.slice(0, m.index).split('\n').length;
    offenders.push(
      `${file.slice(ROOT.length + 1)}:${line} contains U+${m[0]
        .charCodeAt(0)
        .toString(16)
        .padStart(4, '0')
        .toUpperCase()}`
    );
  }

  assert.deepEqual(offenders, [], `raw control characters in source:\n${offenders.join('\n')}`);
});

test('the URL strip that this gate exists for actually strips a URL', () => {
  // The gate above catches the character; this catches the consequence, so a
  // future rewrite that merely looks right still has to work.
  const bundle = readFileSync(join(ROOT, 'src/verify/intelligence/bundle.ts'), 'utf8');
  const line = bundle.split('\n').find((l) => l.startsWith('const BARE_URL'));
  assert.ok(line, 'BARE_URL is gone');
  const re = new RegExp(line.slice(line.indexOf('/') + 1, line.lastIndexOf('/')), 'gi');
  assert.equal('a https://x.example/y b'.replace(re, '').trim(), 'a  b'.trim());
});