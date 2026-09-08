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
FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
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
# Invoked through /bin/sh so a lost executable bit (Windows checkouts do not
# preserve one) can never make the image unbootable.
CMD ["/bin/sh","/app/docker-entrypoint.sh"]
