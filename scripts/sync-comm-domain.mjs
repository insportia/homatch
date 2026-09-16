#!/usr/bin/env node
/*
 * Keep the edge copy of the communications domain logic identical to the
 * browser's.
 *
 * WHY THIS EXISTS
 *
 * The real-estate boundary, the risk engine, the cost engine and the status
 * maps all have to run in two places:
 *
 *   the browser, so the campaign builder can show a live verdict and a live
 *   estimate without a round trip;
 *   the SERVER, because §6 and §32 are explicit that a frontend check is not
 *   enforcement and the server is authoritative.
 *
 * Vite cannot bundle from supabase/functions, and Deno cannot import from src/
 * through the '@/' alias, so the same code genuinely has to exist twice on
 * disk. The repository already does this by hand in a couple of places —
 * _shared/suppression.ts says so in a comment, and three copies of the
 * unsubscribe signing code are kept in sync by hope.
 *
 * Hope is not a mechanism. This script GENERATES the edge copies from the
 * canonical source, and scripts/check-comm-sync.mjs fails CI when the two
 * differ. A developer editing the classifier in src/ and forgetting the edge
 * copy gets a red build rather than a campaign that is allowed in the browser
 * and blocked on the server.
 *
 * Run with --check to verify without writing (what CI does).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SRC = 'src/lib/comm';
const DEST = 'supabase/functions/_shared/comm/generated';

/*
 * Only files that are PURE — no React, no Supabase client, no browser API.
 * phone.ts is included and its one npm import is rewritten to a pinned CDN
 * URL, because the alternative is a second phone parser on the server and
 * §14's whole point is that there should be exactly one.
 */
const FILES = [
  'vocabulary.ts',
  'domainClassifier.ts',
  'risk.ts',
  'cost.ts',
  // The fail-closed gate every billable provider action passes. It runs in the
  // dispatcher, so the edge copy is the one that actually guards the money.
  'executionGate.ts',
  'statusMap.ts',
  'transcript.ts',
  'handoff.ts',
  'entities.ts',
  'extraction.ts',
  'talkAllowance.ts',
  // Where AI TALK may send somebody, and when the call should end. It lives
  // beside the router because that is where a renamed route gets renamed.
  'talkActions.ts',
  // The one place a turn's language is decided. Mirrored because the edge
  // function must re-check what the browser resolved rather than trust it.
  'talkLanguage.ts',
  // How the brand is SAID, per language. Mirrored because the edge function
  // is what hands text to the voice provider, so the edge copy is the one
  // standing between "Homatch" and sonic-3 spelling it out letter by letter.
  'speechText.ts',
  'researchPlan.ts',
  'phone.ts',
  'goLive.ts',
  // What the AI TALK conversation already knows, so the assistant stops
  // asking for facts it has been given. The edge function builds the prompt,
  // so the edge copy is the one that decides what gets re-asked.
  'conversationState.ts',
  // Which of the thousand-term corpus a live session actually tells the
  // transcriber about. The edge function builds the socket URL, so the edge
  // copy is the one that decides.
  'keyterms.ts',
  // An email reply, verified and parsed. The signature check and the payload
  // shape run only on the server — but they are pure, and a webhook verifier
  // that can only be exercised by sending it a real webhook is a webhook
  // verifier nobody exercises.
  'inboundEmail.ts',
];

/* Pinned, matching package.json. A floating version here would be a second,
 * silently different parser. */
const IMPORT_REWRITES = [
  [/from 'libphonenumber-js'/g, "from 'https://esm.sh/libphonenumber-js@1.13.13'"],
];

const BANNER = (name) => `// GENERATED FILE — DO NOT EDIT.
//
// Copied from ${SRC}/${name} by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run \`node scripts/sync-comm-domain.mjs\`; scripts/check-comm-sync.mjs
// fails the build if these drift.

`;

function render(name) {
  let body = readFileSync(join(SRC, name), 'utf8');
  for (const [pattern, replacement] of IMPORT_REWRITES) body = body.replace(pattern, replacement);
  return BANNER(name) + body;
}

const check = process.argv.includes('--check');
let mismatches = 0;

for (const name of FILES) {
  const target = join(DEST, name);
  const expected = render(name);

  if (check) {
    /*
     * Compared with line endings normalised, because otherwise this guard is
     * only correct on Linux.
     *
     * The repository has core.autocrlf=true and no .gitattributes, so every
     * one of these files is committed as LF and checked out on Windows as
     * CRLF. The generator writes '\n'. So a byte-for-byte comparison says
     * "out of date" for all thirteen files on any Windows machine that has
     * done a fresh checkout — while the content is identical — and says
     * nothing on the Linux runner, where both sides happen to be LF.
     *
     * A drift guard that fires on every Windows clone is a guard people learn
     * to ignore, which is worse than not having one. What it is actually for
     * is catching a CHANGE to src/lib/comm that was not mirrored, and a line
     * ending is not that.
     */
    const normalise = (s) => s.replace(/\r\n/g, '\n');
    const actual = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (actual === null || normalise(actual) !== normalise(expected)) {
      console.error(`[comm-sync] ${target} is out of date with ${SRC}/${name}`);
      mismatches++;
    }
    continue;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, expected, 'utf8');
  console.log(`[comm-sync] wrote ${target}`);
}

if (check) {
  if (mismatches) {
    console.error(`\n[comm-sync] ${mismatches} file(s) differ. Run: node scripts/sync-comm-domain.mjs`);
    process.exit(1);
  }
  console.log(`[comm-sync] all ${FILES.length} generated files match their source.`);
}
