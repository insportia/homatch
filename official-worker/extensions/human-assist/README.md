# human-assist — bundled Verify Chromium extension

This directory is where the **reviewed, first-party Manifest V3 extension**
lives. Every Verify job launches its local Chromium with

```
--disable-extensions-except=<this directory>
--load-extension=<this directory>
```

so the extension is loaded from this repository and **only** from this
repository — never from a developer's Chrome profile, never from the Chrome
Web Store, never downloaded at runtime.

## Required contents

```
extensions/human-assist/
  manifest.json      <- manifest_version: 3, with background.service_worker
  <the extension's own assets>
```

`LocalBrowserRuntime.validateBundledExtension()` checks, on every launch and
on every `GET /health/browser`:

- the directory exists,
- `manifest.json` parses,
- `manifest_version === 3`,
- whether a background service worker is declared,

and `confirmExtensionRuntime()` then proves the extension is actually
**running** by waiting for its service worker to register in the launched
context. The launch flags alone are never treated as proof.

## Current status — assets are NOT vendored in git

The reviewed package (`homatch-chrome-extension.zip`) is placed in this
directory at **image build time**, not committed. `extensions/.gitignore`
tracks only this README.

| | |
|---|---|
| Name (`_locales/en`) | Buster: Captcha Solver for Humans |
| `version` | 3.4.0 |
| `manifest_version` | 3 |
| Background service worker | `src/background/script.js` |
| Files | 58 (~26 MB, incl. a 23 MB ONNX wasm) |

### Why it is not committed

1. **GitHub push protection blocks it, on a false positive.** The detector
   flags a "Mistral AI API Key" in the three minified bundles. There is no
   Mistral integration: no `api.mistral.ai` reference exists anywhere, and
   every 32-char alphanumeric literal in those files is a HuggingFace model
   class or a WebGPU limit name. The specific match is a 32-character HuggingFace model-class identifier (the ConvNeXt-V2 image-classification class).
   Bypassing push protection was ruled out, so the bundle is not tracked.
2. **`secrets.txt` is a real third-party credential.** A 2048-byte encrypted
   blob (entropy 5.98) that the service worker fetches at runtime
   (`fetch("/secrets.txt")`) to obtain the extension author's default wit.ai
   speech keys. Homatch does not own those keys, so they must not enter this
   repository or Homatch's environment variables.
3. **Size**: ~26 MB would live in git history permanently.

### How the image gets it

`Dockerfile` still does `COPY extensions ./extensions`, so whatever is present
in this directory at build time ships in the image. Supply it by one of:

- placing the reviewed ZIP's contents here in the build context before
  `docker build` / the Railway build, or
- fetching it in a build step from an internal artifact store.

Until it is supplied, `launchJobBrowser()` logs
`human_assist_extension_unavailable`, `GET /health/browser` reports
`extensionPresent: false, extensionRuntimeConfirmed: false`, and research runs
normally without the assist icon. No code change is needed either way.

Verified in REAL Chromium by `test/chromiumSmoke.test.mjs` with the assets
present: the MV3 service worker registers at
`chrome-extension://<id>/src/background/script.js`, for every job, and normal
browsing still works with it loaded.

2. **This extension is itself a CAPTCHA solver**, activated when a human
   clicks its toolbar button. Homatch's own code solves and bypasses nothing:
   the worker pauses at WAITING_HUMAN, preserves the exact Chromium /
   context / page / cookies, and the customer decides whether to use the
   button. No application-level solving exists anywhere in this repository.

## Rules

- Do not add code here that solves or bypasses a CAPTCHA. The extension's
  role is to assist the **human** who is completing it.
- Extension binary/assets are bundled globally; per-job runtime state is
  isolated because every job gets a fresh throwaway Chromium profile
  directory, which is deleted when the job ends.
