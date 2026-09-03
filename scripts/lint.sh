#!/bin/bash
# Homatch lint gate — runs every check `npm run lint` is responsible for, and
# actually fails the moment one of them fails.
#
# This replaces a `;`-separated one-liner that used to live directly in
# package.json's "lint" script. With `;` as the separator, a failure in an
# earlier command (tsgo, biome, the .rules checks) was silently swallowed —
# the script's own exit code was whatever the LAST command happened to
# return, so `npm run lint` could report success even with real type errors
# or lint violations. `set -e` plus `&&`-equivalent sequencing here means the
# first failing check stops the run and `npm run lint` (and therefore CI)
# fails for real. Per the project's "no fake success" rule, a gate that can
# never fail is worse than no gate — it hides problems behind a green check.
set -e

echo "== TypeScript type-check (tsgo) =="
tsgo -p tsconfig.check.json

echo "== Biome lint =="
npx biome lint

echo "== Custom rule checks (.rules/check.sh) =="
.rules/check.sh

echo "== Tailwind CSS syntax check =="
# The previous version of this check piped through `grep ... || true`, which
# meant the `|| true` rescued the ENTIRE pipeline's exit status even when
# grep matched a real CssSyntaxError/Error line — so a Tailwind build error
# could never actually fail the lint step, only get printed. This version
# captures the matched output and fails explicitly when it's non-empty.
CSS_LINT_OUTPUT=$(npx tailwindcss -i ./src/index.css -o /dev/null 2>&1 | grep -E '^(CssSyntaxError|Error):.*' || true)
if [ -n "$CSS_LINT_OUTPUT" ]; then
  echo "$CSS_LINT_OUTPUT"
  echo "Tailwind CSS syntax error(s) found — see above."
  exit 1
fi

echo "== i18n gates (coverage, key-existence, hardcoded-string audit) =="
npm run i18n:all

echo "== Production build check =="
.rules/testBuild.sh

echo "All lint checks passed."
