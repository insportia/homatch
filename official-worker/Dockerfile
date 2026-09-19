# Homatch official-worker image.
#
# STARTUP: docker-entrypoint.sh is the ONE canonical path. It starts Xvfb with
# VISIBLE diagnostics, waits a bounded time for the display, then `exec`s the
# checked-in application unpatched. See that file's header for the 2026-09-08
# incident it fixes — the previous `CMD ["xvfb-run","-a","npm","start"]`
# discarded every X-server diagnostic to /dev/null (xvfb-run's default
# ERRORFILE), so a container that could not bring up a display was alive,
# silent and unreachable, and Node never received SIGTERM through the
# xvfb-run -> npm -> node chain.
#
# The historical Railway start-command override
# (`node scripts/apply-live-browser-patch.mjs --run`) rewrote src/index.ts at
# boot and shadowed real routes; that script is quarantined and inert, and
# test/startupIntegrity.test.mjs keeps it that way.
#
# Verify runs local Chromium HEADED so the bundled Manifest V3 extension loads
# and the human CAPTCHA flow drives a real rendered page. The playwright base
# image ships Chromium, its Linux dependencies and Xvfb, so no browser
# download happens at build time (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1). No
# Browserless service, token or bridge is involved anywhere.
#
# PID 1 MUST REAP — production incident 2026-09-19, job
# e1b5d95c-b127-4baa-82a0-f89c1b4a0f8c and every other job in that window.
# ---------------------------------------------------------------------------
# The 2026-09-08 fix above was right about signals and created a second,
# slower defect. `exec node` makes NODE the container's PID 1, and PID 1
# inherits every orphaned process in the container. Node only ever calls
# waitpid() for children IT spawned (libuv's SIGCHLD handler walks its own
# process-handle queue), so an orphan it did not spawn stays a ZOMBIE
# forever.
#
# Chromium is a process tree, not a process. The browser process forks a
# zygote which forks renderers, GPU and utility processes. Whenever the
# browser process dies without reaping them — a crash, a kill, a context
# closed mid-navigation — those grandchildren are reparented to PID 1. Under
# Node that is a permanent zombie each time. Nothing frees the PID slot; a
# zombie costs no memory, which is why this failure is invisible in the
# memory graph.
#
# After ~2 days of uptime the service reached the container's pid limit and
# EVERY Chromium launch began failing at
#
#   FATAL:content/browser/scheduler/browser_task_executor.cc:299]
#         Failed to start BrowserThread:IO
#
# i.e. clone() refused; Chromium could not create its IO thread. Playwright
# surfaces that as the far less helpful `launchPersistentContext: Target
# page, context or browser has been closed`. The worker stayed healthy on
# /health and answered every request, so jobs ran to COMPLETE with
# browserOfficial.unavailable = true and zero official results — company id,
# director and shareholders were never collected for any of them. Memory at
# the time was 1.6 GB of 8 GB, which is exactly why this looked like
# anything but a resource limit.
#
# The failure is also self-accelerating: each failed launch leaves more
# orphans behind, so a container that starts failing never recovers.
#
# tini is a real init — it reaps every orphan it inherits, and `-g` forwards
# signals to the whole process group so Node still receives SIGTERM directly
# and installProcessCleanup() still closes Chromium and deletes the
# throwaway profiles. Both properties are required; neither replaces the
# other. It sits in ENTRYPOINT rather than in docker-entrypoint.sh so that it
# also prefixes a Railway dashboard start-command override, which replaces
# CMD but never ENTRYPOINT.
FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
# Bundled, reviewed human-assist extension — loaded into every Verify job.
COPY extensions ./extensions
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
ENV NODE_ENV=production
# tini is PID 1: it reaps orphaned Chromium grandchildren (see the header) and
# `-g` forwards SIGTERM/SIGINT to the whole process group, so Node still gets
# the signal it needs to close browsers and delete profile directories.
ENTRYPOINT ["/usr/bin/tini","-g","--"]
# Invoked through /bin/sh so a lost executable bit (Windows checkouts do not
# preserve one) can never make the image unbootable.
CMD ["/bin/sh","/app/docker-entrypoint.sh"]
