# Free local automation toolkit — actual verification

All probes use `C:/HOMATCH-Automation` without installation or paid services. Permanent publishing jobs use the isolated pinned Playwright worker; local AI, rrweb and the automation toolkit are not worker dependencies. [Machine-readable actual results](TOOLKIT-RESULTS.json).

| Tool/version | Result and actual test | HOMATCH role | Cost / remaining dependency |
|---|---|---|---|
| Playwright 1.64.0 installed; production worker pinned 1.55.0 | **PASS local fixture**: selected only MyHome, confirmed actual output, file input upload, masked screenshot, separate contexts did not share cookie. MyHome/SS real navigation both failed `ERR_NETWORK_ACCESS_DENIED`. | Deterministic portal execution and adapter tests. Existing browser pool handles isolation, concurrency, deadlines and cleanup; operational portal adapters still absent. | Self-hosted CPU/RAM only. No paid browser/API dependency. Production portal operation not verified. |
| Playwright MCP 0.0.83 / bundled 1.64.0-alpha-1790635538000 | **FAIL browser operation**: stdio initialized and listed 26 tools; actual `browser_navigate` on `about:blank` failed closed-target before networking. Native tool catalogue has zero browser tools. | Interactive rendered-DOM discovery once browser/session configuration works. | No API fee. Native connection reload and browser/backend diagnosis required; see MCP-SETUP.md. |
| Stagehand 4.2.1 | **FAIL**: imported SDK and attempted `localBrowser.launch` with installed Chrome and disposable QA profile. Chrome exited code `2147483651` before debugging port ready. `Stagehand.create`/fixture navigation not reached. No AI call made. | Optional development form discovery/selector generation; only adopt after selectors are independently validated by deterministic tests. | Local compute only when using a compatible local model. Installed SDK supports custom `ClientLLM.generate`; model integration not yet validated. No cloud fallback. |
| Browser Use 0.13.11 / existing Python venv | **FAIL**: imported package and initialized BrowserSession configuration; harmless local fixture launch failed before CDP ready. Initial protected `.config` write resolved via ignored QA config; automatic extension downloads explicitly disabled. No Agent/model call made. | Optional secondary development recovery experiments. No measurable advantage demonstrated, so excluded from production/runtime. | Local compute with compatible model. No cloud fallback; local CDP startup unresolved. |
| Ollama 0.40.3 | **PARTIAL**: CLI version/list and HTTP `/api/tags` succeeded; installed model list empty. No inference performed. | Optional developer intelligence. Never a dependency of customer publishing jobs. | Local CPU/GPU/RAM/disk, no per-call API charge. Owner approval requested before model download. |
| rrweb record/replay 2.1.7 | **PASS isolated fixture**: 14 real recording events replayed; restored checked MyHome state. Three OTP/password/contact canaries absent from serialized events; private inputs absent in replay. Screenshot inspected. | Optional owned QA replay for regression debugging, never third-party recording or production analytics. | No service fee. Local QA artifacts only. |

## Reproduce

Run from repository root:

```powershell
node publisher-worker/scripts/toolkit-probe.mjs playwright
node publisher-worker/scripts/toolkit-probe.mjs playwright-rrweb
node publisher-worker/scripts/toolkit-probe.mjs stagehand
C:/HOMATCH-Automation/browser-use/.venv/Scripts/python.exe publisher-worker/scripts/browser-use-probe.py
node publisher-worker/scripts/toolkit-probe.mjs ollama
node publisher-worker/scripts/probe-local-mcp.mjs local
node publisher-worker/scripts/discover.mjs --toolkit myhome.ge ss.ge
node publisher-worker/scripts/toolkit-report.mjs
```

Do not repeatedly retry environment-denied external discovery. The local fixture in `publisher-worker/qa/toolkit-fixture.html` contains synthetic data only. rrweb masks all inputs and text and blocks the entire private container. Recording, screenshot and tool profiles stay under ignored `publisher-worker/artifacts/toolkit`; no customer session, credential, OTP or token is recorded. The recorder is not imported by product pages or injected into portals.

Local Playwright succeeded where CDP-based tool startup failed. Stagehand and Browser Use therefore provide no demonstrated improvement yet; installation is not acceptance. The reported failures are environment/startup results, not evidence that portals forbid automation. No sandbox/security override was applied.

Recommended initial local model, pending owner approval: `qwen3.5:4b`, approximately 3.4 GB, with text/image capability per the [official Ollama library](https://ollama.com/library/qwen3.5). Hardware sizing and Stagehand/Browser Use compatibility still require benchmarking. No model downloaded and no inference success claimed.
