# Homatch Digital Twin — performance and cost budgets

These are limits, not aspirations. A scene version records what it actually
measured in `dt_scene_versions.budget`, and a version that exceeds a hard limit
should not be published.

"Optimised" is not a number. Everything below is.

---

## Why these numbers and not others

The buyer we are designing for is on a mid-range Android phone, on mobile data,
who has just tapped a link in WhatsApp. Everything here is derived from that
person, not from a workstation.

The cost model follows from the same place: rendering happens on their device,
our infrastructure serves static bytes and a few kilobytes of JSON, and the
bytes are immutable so a CDN answers almost all of it.

---

## Stage budgets

Each stage is what the visitor pays *at the moment they ask for it*. Nothing
below is fetched before that.

| Stage | What it is | Target | Hard limit |
|---|---|---|---|
| App shell | JS/CSS for the viewer route, gzipped | ≤ 180 KB | 250 KB |
| Manifest | `dt_experience_manifest()` — project, branding, per-building counts | ≤ 8 KB | 32 KB |
| Building floors | `dt_building_floors()` — counts per floor | ≤ 4 KB | 16 KB |
| Floor units | `dt_floor_units()` — one floor's units | ≤ 24 KB | 64 KB |
| Masterplan scene | Site geometry + low-detail building shells | ≤ 2.5 MB | 5 MB |
| Building scene | One building at viewing detail | ≤ 3 MB | 6 MB |
| Apartment template | One *unit type*, shared by every unit of that layout | ≤ 4 MB | 8 MB |
| Interior template | Furniture/material set, shared across projects | ≤ 3 MB | 6 MB |

**Measured today** (the test project, 17 units / 6 layouts / 2 buildings):

- manifest: **1,159 bytes**
- building floors: **299 bytes**
- one floor's units: **1,398 bytes**

The manifest is a function of building count, not unit count. Adding twelve
apartments to the test project moved it by 238 bytes, and that was because a
second *building* appeared.

## Requests

| Interaction | Target | Hard limit |
|---|---|---|
| Opening a project | ≤ 4 requests before first paint | 8 |
| Selecting a building | ≤ 3 | 6 |
| Selecting a floor | 1 | 2 |
| Entering an apartment | ≤ 6 (shared assets are usually cached) | 12 |

## Runtime

| Metric | Target | Hard limit |
|---|---|---|
| Time to interactive, mid-range Android, 4G | ≤ 3.0 s | 5.0 s |
| Frame rate, exterior orbit | ≥ 45 fps | 30 fps |
| Frame rate, interior walkthrough | ≥ 40 fps | 28 fps |
| JS heap, after one walkthrough | ≤ 350 MB | 500 MB |
| Triangles on screen, exterior | ≤ 900 k | 1.6 M |
| Triangles on screen, interior | ≤ 600 k | 1.2 M |
| Texture memory | ≤ 180 MB | 300 MB |

## Per-project storage

| Metric | Target |
|---|---|
| Deliverable bytes, 500-unit / 3-building scheme | ≤ 120 MB |
| Unique apartment templates for 500 units | 15–30 |
| Storage growth per additional unit | ≤ 2 KB (a database row) |

The last line is the economic requirement stated as a number: a unit is a row
that points at shared geometry, so doubling the unit count must not come close
to doubling storage.

---

## Rules that make the numbers reachable

**Nothing loads before intent.** Opening a project loads the manifest and the
masterplan. It does not load buildings, floors, units, apartments, furniture or
textures.

**Geometry is authored per unit type, never per unit.** Four hundred apartments
of layout B2 share one asset, which the browser caches the first time anybody
opens one of them.

**Heavy assets are immutable.** The URL carries a content hash
(`assetUrl()` in `src/services/developer/twin.ts`), so a CDN may hold it
indefinitely. Marking apartment #694 SOLD invalidates nothing, because
availability never travels on that path — it comes from `dt_floor_units()`,
which is small and never cached.

**Textures are compressed for the GPU** (KTX2/Basis), geometry with Draco or
Meshopt. A JPEG decoded to RGBA costs several times its download size in VRAM.

**Quality adapts to the device.** Capability detection picks LOD, texture
resolution and shadow quality. A weak phone gets fewer triangles — and still
gets the project, the building, the floor, the unit, the floor plan and the
contact button, because those are DOM and data, not 3D.

**Analytics are batched.** `TwinTracker` sends one request per few seconds, not
one per event, and nothing frame-based is collected at all. There is no
camera-position method and there will not be one.

**No per-view third-party 3D service, and no GPU streaming.** The runtime is
ours. External tools may be used offline while preparing assets; none is in the
serving path.

**No AI at view time.** Model inference may help a Homatch representative build
a project. Once published, opening an apartment is static assets and metadata.

---

## What is measured and what is not

`dt_scene_versions.budget` holds the numbers a build step measured for that
version: payload bytes, request count, triangles, texture megabytes.
`dt_cost_rollup` holds what a project cost over a period: stored bytes,
deliverable bytes, asset requests, bandwidth, viewer opens, preparation cost.
Both are internal; a developer never sees our margin.

**Not yet measured, and therefore not claimed:**

- Frame rate and memory on real devices. There is no renderer yet, so every
  runtime row above is a target the viewer must be held to, not a result.
- Behaviour at 1,000,000 monthly opens. The architecture is built for it —
  client-side rendering, immutable assets, CDN-cacheable bytes, small dynamic
  payloads — but it has not been load-tested, and until it has, "designed for"
  is the honest phrase and "proven at" is not.
- Real per-project storage. The 120 MB target comes from the asset budgets
  above, not from a project that has been through the pipeline.

Before claiming 1M-view readiness we need: a representative project built end to
end, a synthetic load test against the CDN and the four public RPCs, and device
testing on at least one low-end Android and one older iPhone.
