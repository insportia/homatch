# Design Studio scene factory (Blender on Runpod)

HOMATCH's online 3D factory. AI and HOMATCH decide **what** the home is (the
reading of a picture or a floor plan, the measured camera, the calibrated
plan, the catalogue); HOMATCH compiles that into a strict **SceneBuildSpec**
(`src/lib/designStudio/hybrid/sceneSpec.ts` — data only). This worker runs
Blender headless and builds the scene from the spec:

| Stage | What Blender builds |
|---|---|
| Architecture | floor slabs for every room (any polygon: L-shapes included), walls with real openings, door frames and leaves, window frames, glass and sills, baseboards, balcony railings, ceilings |
| Furnishing | every piece at the size, form and colours read — sofas (straight, L, curved), shell chairs, beds with bedding, tables, kitchens with counters and wall cabinets, wardrobes, sanitaryware, appliances, curtains, plants, rugs — or a catalogue model when one genuinely looks like the piece |
| Materials | HOMATCH catalogue materials as PBR (albedo, normal, roughness from ORM, tile size, rotation, the colour a picture showed as a tint) |
| Lighting | sun and sky by time of day, a soft ceiling light per room |
| Checking | a Cycles render from the source picture's own camera (with its section cut and background) for the visual check |
| Views | optional `spec.views` (≤ 12): each planned view (an orthographic or long-lens dollhouse MASTER on a neutral studio ground, or an eye-level ROOM view) rendered at final quality (adaptive sampling, OptiX/OIDN denoiser), and with `objectMap` an exact id image (flat emission colours, 1 sample, Raw transform) plus its legend: every colour's canonical target (piece id, floor/ceiling surface, wall FACE SEGMENT surface, opening, stair), room, coverage and box (`worker/factory/views.py`). Job: `outputs.views[id] = {image, ids, legend}` signed PUTs; result: `outputs.views[id] = {ok, image, ids, legend, ms, idMs}` |
| Exporting | the whole home as GLB (semantic node names: `floor:`, `wall:`, `door:`, `window:`, `railing:`, `ceiling:`, `obj:<instance>`), and one GLB per group of identical walkthrough pieces |

Then every GLB is optimised (dedup, prune, KTX2 when textured, meshopt) and
passes the Khronos validator, and the outputs go only to the signed URLs the
job brought. The walkthrough stays HOMATCH's own (SceneController): the
factory's pieces replace HOMATCH's drawn pieces there; architecture is drawn
by HOMATCH from the same canonical geometry so walls remain editable surfaces.

No generative 3D, no model weights, no tokens: SAM/TRELLIS are not part of
this worker.

## Security

- The job carries **signed URLs only**, host-locked to
  `*.r2.cloudflarestorage.com`: GETs for the catalogue maps and models the
  spec names (resolved by the server from the catalogue, never by the
  browser), PUTs for exactly the outputs. No storage or database credentials
  ever reach the worker.
- Blender runs only `worker/factory/build.py` (HOMATCH-owned). The spec is
  validated before Blender starts (`worker/spec.py`) and again inside Blender;
  nothing in it is ever evaluated or executed. A test fails the build if any
  factory file calls eval/exec/compile/dynamic import/a shell.
- Inputs are size-, type- and magic-checked before Blender sees them; outputs
  are checked again on the server (size, hash, glTF inspection) before use.
- Temporary files live in one job directory that is always removed.

## Setup (owner, once)

1. Runpod → Serverless → New Endpoint → **GitHub repo**, Dockerfile
   `infra/design-studio-gpu-worker/Dockerfile`, build context
   `infra/design-studio-gpu-worker`. A 24 GB GPU is enough (RTX A5000 /
   4090 / L4 class); **min workers 0, max workers 1**, idle timeout 5 s,
   execution timeout 900 s. No endpoint secrets are needed.
2. Supabase edge secrets: `RUNPOD_API_KEY`, `RUNPOD_DS_ENDPOINT_ID`,
   `RUNPOD_DS_USD_PER_SECOND` (the endpoint's per-second price; compute cost
   lines are ESTIMATED from measured seconds × this rate).

Without (2) the app says the factory is unavailable: a picture reconstruction
still builds (HOMATCH's own walkthrough, checked on a browser still), and the
floor-plan "realistic 3D" action reports it is not available.

The image builds itself once at build time (`factory selftest`): if the
factory cannot build the fixture home, the image does not build.

## Tests

```bash
python -m pytest -q
```

Real Blender runs when installed (`HM_BLENDER`, or `blender` on PATH); the
glTF toolchain when `HM_GLTF_TRANSFORM` / `gltf-transform` and `NODE_PATH`
with `gltf-validator` are available. `tests/fixtures/apartment.spec.json` is
written by `node scripts/design-studio/factory-fixtures.mjs` from HOMATCH's
own builder, so the worker tests build what production sends.
