# Homatch official-worker image.
#
# The CMD below is the ONE canonical startup path: it runs the checked-in
# application, unpatched. The historical Railway start-command override
# (`node scripts/apply-live-browser-patch.mjs --run`) rewrote src/index.ts at
# boot and shadowed real routes; that script is quarantined and inert, and
# test/startupIntegrity.test.mjs keeps it that way.
#
# xvfb-run is REQUIRED, not incidental: Verify runs local Chromium HEADED so
# that the bundled Manifest V3 extension loads and the human CAPTCHA flow
# drives a real rendered page. The playwright base image ships Chromium, its
# Linux dependencies and xvfb, so no browser download happens at build time
# (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1). No Browserless service, token or
# bridge is involved anywhere.
FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
# Bundled, reviewed human-assist extension — loaded into every Verify job.
COPY extensions ./extensions
ENV NODE_ENV=production
CMD ["xvfb-run","-a","npm","start"]
