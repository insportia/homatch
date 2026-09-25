// A COMMENT STRIPPER THAT DOES NOT EAT THE CODE.
//
// Several guards in this repository assert that something is ABSENT from a
// file — no fetch in the gate, no browser user-agent in the worker, no
// retired provider anywhere. Those assertions are only worth anything if the
// text they searched is the real code.
//
// The naive `src.replace(/\/\*[\s\S]*?\*\//g, '')` is not. It found `/*`
// inside this perfectly ordinary line in revalidate-evidence:
//
//     accept: 'text/html,application/xhtml+xml,*&#47;*'
//
// `*&#47;*` contains `/` followed by `*`, which opens a comment the stripper
// then closed at the next `*&#47;` — forty lines later, in the JSDoc of the
// following function. Everything between vanished, including the entire
// HTTP-status mapping.
//
// The failure mode is the dangerous direction. A test asserting code is
// PRESENT fails loudly, which is how this was found. A test asserting code is
// ABSENT passes silently, because the stripper deleted the thing it was
// looking for. Every `assert.equal(/forbidden/.test(code), false)` in the
// suite was potentially green for the wrong reason.
//
// So: a scanner that knows what a string is.

/**
 * Source with comments removed and string contents preserved.
 *
 * Walks the text once, tracking whether it is inside a single-quoted,
 * double-quoted or template string, and only treats `/​*` and `//` as comment
 * openers when it is not. Regex literals are not tracked — distinguishing
 * `/` as division from `/` as a regex opener needs a real parser — so a
 * regex containing a quote character could still confuse it. That is a much
 * rarer shape than a URL or a media type, and `assertStripped` below is the
 * backstop.
 */
export function stripComments(source) {
  const src = String(source);
  let out = '';
  let i = 0;
  let quote = null;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (quote) {
      // Inside a string: only an unescaped matching quote ends it, and a
      // backslash consumes whatever follows.
      if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
      if (ch === quote) quote = null;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i += 1; continue; }

    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      // An unterminated block comment eats the rest, which is what a compiler
      // would do too.
      i = end === -1 ? src.length : end + 2;
      // Keep a newline so line-anchored patterns elsewhere still behave.
      out += ' ';
      continue;
    }

    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i + 2);
      i = end === -1 ? src.length : end;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Strip, and refuse to return something that has clearly lost code.
 *
 * `markers` are strings that MUST survive. Passing the thing a test is about
 * to assert on turns "the guard passed because the stripper deleted its
 * subject" into a loud failure.
 */
export function assertStripped(source, markers = []) {
  const stripped = stripComments(source);
  for (const marker of markers) {
    if (!stripped.includes(marker)) {
      throw new Error(
        `stripComments removed "${marker}", which was supposed to survive. `
        + 'The stripper has eaten real code and any absence assertion on this '
        + 'text would be green for the wrong reason.',
      );
    }
  }
  return stripped;
}
