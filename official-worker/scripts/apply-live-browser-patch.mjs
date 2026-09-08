/*
 * QUARANTINED 2026-09-08 — this script no longer patches anything.
 *
 * WHAT IT USED TO DO, AND WHY IT WAS HARMFUL
 * ------------------------------------------
 * The live Railway service (homatch-official-worker,
 * 3e7f132b-d0be-4804-9bc0-0b6ad368ad15) carried a dashboard start-command
 * override, `node scripts/apply-live-browser-patch.mjs --run`, which took
 * precedence over the image's own CMD. This script then REWROTE
 * src/index.ts on the container filesystem at boot and imported the mutated
 * source.
 *
 * One of those injected edits registered a legacy handler
 *
 *     app.post('/research/:id/live', auth, async (req, res) => {
 *       const s = orchestrator.getSession(req.params.id);
 *       if (!s) return res.status(404).json({ error: 'active human session not found' });
 *       ... Browserless.liveURL with a hardcoded timeout: 900000 ...
 *     });
 *
 * anchored BEFORE `app.get('/research/:id/screenshot'` — i.e. at line ~171,
 * whereas the real implementation registers at line ~275. Express dispatches
 * to the FIRST matching route, so every production
 * `POST /research/:id/live` was served by that legacy handler, which:
 *
 *   - 404s whenever there is no WAITING_HUMAN session, which is ALWAYS true
 *     for a RUNNING visualWatch job. This is the proven cause of the
 *     repeated 404s in jobs aaf11509…, 785134fd… and
 *     9bd269c2-b6a3-49ee-aec1-e09f462131ca, while the worker's own logs
 *     showed healthy `visual_watch_attached generation=1/2` — three separate
 *     fixes landed in code the request never reached;
 *   - hardcodes timeout: 900000, which the current Browserless plan rejects
 *     (max 120000), so even the CAPTCHA path could only 503;
 *   - bypasses the trusted LiveCapability provenance model entirely.
 *
 * Everything the patch used to add now lives in real source: the
 * /health `liveInteractiveBrowser` flag, the live endpoints (with the
 * bounded plan-timeout fallback and the capability trust boundary), and the
 * native Browserless CDP connection in BrowserlessRuntime.ts. The script's
 * own note said as much: "ResearchOrchestrator Browserless lifecycle now
 * lives in source code."
 *
 * WHY THE FILE STILL EXISTS
 * -------------------------
 * Deleting it while a stale start-command override still referenced it would
 * crash the container on boot. It is therefore kept as a HARMLESS launcher:
 * it mutates nothing, and `--run` simply starts the real worker, so the
 * service boots correctly whether Railway uses the Dockerfile CMD or a
 * leftover override. Once the override is confirmed gone from every
 * environment, this file can be deleted outright.
 *
 * It must never patch source again — startupIntegrity.test.mjs enforces that.
 */

const RUN = process.argv.includes('--run');

console.log(
  JSON.stringify({
    at: new Date().toISOString(),
    scope: 'worker_startup',
    event: 'legacy_patch_script_disabled',
    note: 'no source patching; Dockerfile CMD / npm start is authoritative',
    starting: RUN,
  })
);

if (RUN) {
  const { register } = await import('tsx/esm/api');
  register();
  await import('../src/index.ts');
}
