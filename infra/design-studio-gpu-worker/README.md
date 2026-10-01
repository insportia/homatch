# Design Studio GPU worker

Builds the high-impact pieces of a picture reconstruction (a distinctive sofa,
shell chairs, beds, plants…) as 3D models, from the customer's own picture.
It is a Runpod Serverless worker: **min workers 0, max workers 1**, so it costs
nothing while idle. It is not a Railway service and has nothing to do with
`homatch-official-worker`.

## What runs inside

| Step | Tool | Licence |
|---|---|---|
| Mask from the object's box | SAM 2.1 hiera-small | Apache-2.0 |
| Image → 3D (PBR GLB) | TRELLIS.2-4B | MIT (code and weights) |
| Image encoder (inside TRELLIS.2) | DINOv3 (gated) | DINOv3 licence, commercial use allowed — "Built with DINOv3" |
| Clean-up, orientation, size, floor, decimation | Blender 4.2 LTS, headless, our own script only | GPL (tool, not linked) |
| Runtime GLB (KTX2, meshopt, validation) | glTF-Transform 4.5.1, KTX-Software 4.4.2, gltf-validator | MIT / Apache-2.0 |

TRELLIS.2's default background remover (RMBG-2.0) is CC BY-NC: it is replaced
by a stub that refuses to run, and the worker asserts that at load.

## Security

- The job carries **signed URLs only** (one GET for the picture, one PUT per
  model), host-locked to `*.r2.cloudflarestorage.com`. No storage credentials
  ever reach the worker.
- Blender runs only `worker/blender_normalize.py` with a JSON parameter file;
  nothing from the customer or a model is executed.
- Every input is bounded (`worker/schema.py`); downloads are size-, type- and
  hash-checked; outputs are validated before upload and again on the server.
- Temporary files live in one job directory that is always removed.

## Setup (owner, once)

1. Runpod → Serverless → New Endpoint → **GitHub repo**, Dockerfile
   `infra/design-studio-gpu-worker/Dockerfile`, build context
   `infra/design-studio-gpu-worker`. GPU 48 GB (A6000/L40S) or 80 GB;
   min workers 0, max workers 1, idle timeout 5 s, execution timeout 900 s.
   Optional: attach a network volume (weights are cached under
   `/runpod-volume/homatch-ds-models`).
2. Endpoint secret `HF_TOKEN`: a Hugging Face read token on an account that
   has accepted the DINOv3 and SAM licences.
3. Supabase edge secrets: `RUNPOD_API_KEY`, `RUNPOD_DS_ENDPOINT_ID`,
   `RUNPOD_DS_USD_PER_SECOND` (the endpoint's per-second GPU price; GPU cost
   lines are ESTIMATED from measured seconds × this rate).

Without (3) the app reports generation as unavailable and every piece is drawn
by HOMATCH, marked approximate.

## Tests

```bash
python -m pytest -q
```

Runs the whole pipeline with a mock generator and a box segmenter, with real
Blender when it is installed (`HM_BLENDER`, or `blender` on PATH).
