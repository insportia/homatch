# NOTE (documented 2026-09-07, Verify production-readiness audit — zero
# behavior change, comment only): this Dockerfile's own CMD below starts the
# service directly (`npm start` -> `tsx src/index.ts`), which launches a
# real local Chromium via Playwright. The LIVE Railway production service
# (homatch-official-worker) does NOT actually run this CMD — Railway's own
# per-service dashboard config carries a `deploy.startCommand` override
# ("node scripts/apply-live-browser-patch.mjs --run") that takes precedence
# over the image's CMD entirely. That script patches `chromium.launch()`
# calls in the already-built dist to instead connect over CDP to a
# Browserless.io session (see scripts/apply-live-browser-patch.mjs's own
# header) and then starts the service itself. This is safe today only
# because the Railway service has no persistent volume (hasVolume:false):
# every container restart gets a fresh, unpatched filesystem from this
# image, and the patch runs exactly once per boot. Neither this file nor
# package.json reference the patch script directly — that override lives
# only in Railway's dashboard/API config, invisible from the repository
# alone (confirmed via `railway get-service-config` and this service's
# git history — the patch was never wired into an npm script or this
# Dockerfile). Local `docker build`/`docker run` of this image, or any
# future deploy target other than that specific Railway service, will run
# real local Chromium via this Dockerfile's own CMD, not Browserless.
FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production
CMD ["xvfb-run","-a","npm","start"]
