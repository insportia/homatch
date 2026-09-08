#!/bin/sh
# docker-entrypoint.sh — the ONE canonical container startup path.
#
# WHY THIS EXISTS (production incident 2026-09-08)
# ------------------------------------------------
# The image previously started with
#
#     CMD ["xvfb-run","-a","npm","start"]
#
# That CMD had never actually executed in this Railway service: the service
# carried a dashboard start-command override
# (`node scripts/apply-live-browser-patch.mjs --run`) which takes precedence
# over the image CMD entirely, so every historical production container ran
# the patcher instead. When the override was removed during debugging, this
# never-exercised path became live for the first time and every deployment
# from 1ac14835 onward failed with a container that printed NOTHING at all
# and never bound its port — Railway logged only "Starting Container",
# then the healthcheck failed for its full 2-minute window.
#
# `xvfb-run` cannot report why. Its own source (Debian xorg-server,
# debian/local/xvfb-run) sets
#
#     ERRORFILE=/dev/null                     # line 15
#     ...
#     exec 3>>"$ERRORFILE"                    # fd 3 == /dev/null
#     XAUTHORITY=$AUTHFILE xauth source - ... >&3 2>&3
#     (trap '' USR1; exec Xvfb ":$SERVERNUM" ... >&3 2>&3 3>&-) &
#     wait || :
#
# so EVERY diagnostic from both `xauth` and `Xvfb` is discarded by default,
# and the wrapper then blocks in `wait` for the X server's readiness SIGUSR1.
# An X server that fails or never signals therefore produces a container that
# is alive, silent, and has not yet run a single line of application code —
# exactly the observed failure. Nothing downstream can diagnose it.
#
# Three further defects of that chain, independent of which one bit:
#
#   1. `xvfb-run` -> `npm` -> `node` puts two non-exec layers between PID 1
#      and the application, so SIGTERM never reaches Node. That makes
#      installProcessCleanup()'s SIGINT/SIGTERM handlers — the ones that must
#      close Chromium and delete the throwaway profile directories — dead code
#      in production, in direct violation of the browser-lifecycle mandate.
#   2. HTTP availability was coupled to X startup: if the display did not come
#      up, /health never answered and the service was a black box rather than
#      an honest one.
#   3. Any failure was invisible, so the same class of incident could recur
#      silently forever.
#
# WHAT THIS SCRIPT DOES INSTEAD
# -----------------------------
#   * logs every startup step as a structured line, unconditionally, so
#     "Starting Container" can never again be followed by silence;
#   * starts Xvfb itself with its output on stdout/stderr where it is visible;
#   * waits a bounded time for the X socket and reports the outcome honestly;
#   * ALWAYS execs the application, even when X did not come up, so /health
#     answers and /health/browser reports the real browser state instead of
#     the container being unreachable;
#   * uses `exec` so Node becomes the process that receives SIGTERM/SIGINT
#     directly and installProcessCleanup() actually runs on shutdown.
#
# It patches nothing, writes nothing, and reads no application source.
# test/startupIntegrity.test.mjs enforces all of that.
set -eu

emit() {
  printf '{"at":"%s","scope":"worker_startup","event":"%s","detail":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}"
}

emit container_started "entrypoint=docker-entrypoint.sh cwd=$(pwd)"

# Non-secret startup surface only. Credential VALUES are never printed. For
# NODE_OPTIONS only the character count is reported: a malformed value there is
# a classic silent-startup killer, so its presence must be visible, while its
# content is arbitrary and may not be safe to log.
NODE_OPTIONS_CHARS=$(printf %s "${NODE_OPTIONS:-}" | wc -c | tr -d ' ')
BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-unset}"
if [ "$BROWSERS_PATH" != "unset" ] && [ ! -d "$BROWSERS_PATH" ]; then
  emit browsers_path_missing "PLAYWRIGHT_BROWSERS_PATH points at a directory that does not exist in this image; Chromium will not be found"
fi
emit env_surface "node=$(node --version) port=${PORT:-3000} nodeEnv=${NODE_ENV:-unset} nodeOptionsChars=${NODE_OPTIONS_CHARS} browsersPath=${BROWSERS_PATH}"

# ---- X display -------------------------------------------------------------
# Verify runs Chromium HEADED so the bundled Manifest V3 human-assist
# extension loads and the human CAPTCHA flow drives a real rendered page.
DISPLAY_NUM="${VERIFY_DISPLAY_NUM:-99}"
X_SOCKET="/tmp/.X11-unix/X${DISPLAY_NUM}"

if command -v Xvfb >/dev/null 2>&1; then
  rm -f "/tmp/.X${DISPLAY_NUM}-lock" 2>/dev/null || true
  # Output is deliberately NOT redirected: this is the diagnostic xvfb-run
  # threw away.
  Xvfb ":${DISPLAY_NUM}" -screen 0 1440x1000x24 -nolisten tcp &
  XVFB_PID=$!
  emit xvfb_spawned "display=:${DISPLAY_NUM} pid=${XVFB_PID} screen=1440x1000x24"

  # Every test sits inside `if`, never in an `A && B` list: under `set -e` a
  # failing AND-OR list would terminate the script instead of looping.
  waited=0
  while [ "$waited" -lt 150 ]; do
    if [ -S "$X_SOCKET" ]; then
      break
    fi
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
      break
    fi
    waited=$((waited + 1))
    sleep 0.1
  done

  if [ -S "$X_SOCKET" ]; then
    export DISPLAY=":${DISPLAY_NUM}"
    emit xvfb_ready "display=${DISPLAY} waitedMs=$((waited * 100))"
  else
    emit xvfb_unavailable "display=:${DISPLAY_NUM} waitedMs=$((waited * 100)) — headed Chromium cannot launch; the HTTP server still starts so /health and /health/browser report the truth"
  fi
else
  emit xvfb_missing "no Xvfb binary in the image — headed Chromium cannot launch; the HTTP server still starts so /health and /health/browser report the truth"
fi

# ---- application -----------------------------------------------------------
# `exec` so Node replaces this shell and receives SIGTERM/SIGINT directly.
# node --import tsx (not `npm start`) keeps npm out of the signal path; the
# npm `start` script stays the identical command for local development.
emit exec_app "cmd=node --import tsx src/index.ts"
exec node --import tsx src/index.ts
