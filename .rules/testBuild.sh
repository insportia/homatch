#!/bin/bash

VITE_TEMP="node_modules/.vite-temp"
if [ -L "$VITE_TEMP" ]; then
    rm "$VITE_TEMP"
    mkdir -p "$VITE_TEMP"
elif [ ! -e "$VITE_TEMP" ]; then
    mkdir -p "$VITE_TEMP"
fi

# Use a writable output dir regardless of environment
OUT_DIR="${VITE_BUILD_OUTDIR:-/workspace/.dist}"
mkdir -p "$OUT_DIR" 2>/dev/null || OUT_DIR="$(pwd)/.dist-ci"
mkdir -p "$OUT_DIR"

OUTPUT=$(npx vite build --minify false --logLevel error --outDir "$OUT_DIR" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "$OUTPUT"
fi

exit $EXIT_CODE
