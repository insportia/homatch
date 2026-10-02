"""The job a Design Studio factory worker accepts, validated before anything runs.

A job is a SceneBuildSpec (data, validated by spec.py) plus URLs: signed GETs
for the catalogue maps and models the spec names, and signed PUTs for exactly
the files the worker may write. The worker holds no storage credentials and
decides no paths. Every input must belong to the spec (no stray URLs), every
URL is the storage endpoint over https, every limit is bounded. Anything
malformed is refused, never repaired.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from .spec import ID, SpecError, validate_spec

MAX_TEXTURE_BYTES = 32 * 1024 * 1024
MAX_MODEL_BYTES = 100 * 1024 * 1024
MAX_RENDER_BYTES = 2 * 1024 * 1024
MAX_SCENE_BYTES = 100 * 1024 * 1024
MAX_OBJECT_BYTES = 12 * 1024 * 1024
# A planned view (spec.views): the picture (JPEG), its id image (lossless PNG) and the legend (JSON).
MAX_VIEW_BYTES = 6 * 1024 * 1024
MAX_VIEW_IDS_BYTES = 8 * 1024 * 1024
MAX_VIEW_LEGEND_BYTES = 1024 * 1024
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# Only the storage endpoint may be fetched or written (no arbitrary URLs from a job).
ALLOWED_HOST = re.compile(r"^[a-z0-9]+\.r2\.cloudflarestorage\.com$")
TIERS = ("DESKTOP", "MOBILE")


class JobError(ValueError):
    """A job that cannot run as given."""


@dataclass(frozen=True)
class Job:
    job_id: str
    spec: dict
    textures: dict  # materialId -> {albedo, normal, orm} URLs (or None)
    models: dict  # assetCode -> URL
    render_url: str | None
    scene_urls: dict  # tier -> URL
    object_urls: dict  # group -> URL
    view_urls: dict = field(default_factory=dict)  # view id -> {image, ids, legend} URLs (ids/legend: only with objectMap)
    deadline_s: int = 900
    texture_size: dict = field(default_factory=lambda: {"DESKTOP": 2048, "MOBILE": 1024})
    object_texture_size: int = 1024
    device: str = "AUTO"


def _url(value: object, what: str) -> str:
    if not isinstance(value, str) or len(value) > 4096:
        raise JobError(f"{what}: not a URL")
    u = urlparse(value)
    if u.scheme != "https" or not u.hostname or not ALLOWED_HOST.match(u.hostname):
        raise JobError(f"{what}: only the storage endpoint, over https")
    return value


def parse_job(raw: object) -> Job:
    if not isinstance(raw, dict):
        raise JobError("job: an object")
    job_id = raw.get("jobId")
    if not isinstance(job_id, str) or not UUID.match(job_id):
        raise JobError("jobId: a uuid")
    try:
        spec = validate_spec(raw.get("spec"))
    except SpecError as e:
        raise JobError(f"spec: {e}") from e

    material_ids = {m["id"] for m in spec["materials"]}
    model_codes = {o["model"] for o in spec["objects"] if o["kind"] == "MODEL"}
    groups = {o["group"] for o in spec["objects"] if o["runtime"] and o["group"]}
    inputs = raw.get("inputs") or {}
    if not isinstance(inputs, dict):
        raise JobError("inputs: an object")
    textures: dict = {}
    for mid, maps in (inputs.get("textures") or {}).items():
        if mid not in material_ids or not isinstance(maps, dict):
            raise JobError(f"inputs.textures.{str(mid)[:40]}: not a material of this spec")
        entry = {}
        for k in ("albedo", "normal", "orm"):
            v = maps.get(k)
            entry[k] = None if v is None else _url(v, f"inputs.textures.{mid}.{k}")
        if not entry["albedo"]:
            raise JobError(f"inputs.textures.{mid}: maps without an albedo")
        textures[mid] = entry
    models: dict = {}
    for code, url in (inputs.get("models") or {}).items():
        if code not in model_codes:
            raise JobError(f"inputs.models.{str(code)[:40]}: not a model of this spec")
        models[code] = _url(url, f"inputs.models.{code}")

    outputs = raw.get("outputs") or {}
    if not isinstance(outputs, dict):
        raise JobError("outputs: an object")
    want = spec["outputs"]
    if want["render"] and spec["camera"] is None:
        raise JobError("outputs.render: the spec has no camera")
    render_url = _url(outputs.get("render"), "outputs.render") if want["render"] else None
    scene_urls: dict = {}
    if want["scene"]:
        scene = outputs.get("scene") or {}
        if not isinstance(scene, dict) or set(scene) != set(TIERS):
            raise JobError("outputs.scene: one URL per tier (DESKTOP, MOBILE)")
        scene_urls = {t: _url(scene[t], f"outputs.scene.{t}") for t in TIERS}
    object_urls: dict = {}
    if want["objects"]:
        objs = outputs.get("objects") or {}
        if not isinstance(objs, dict) or set(objs) != groups or not all(isinstance(g, str) and ID.match(g) for g in objs):
            raise JobError("outputs.objects: exactly one URL per walkthrough group")
        object_urls = {g: _url(u, f"outputs.objects.{g}") for g, u in objs.items()}

    view_urls: dict = {}
    if spec["views"]:
        vs = outputs.get("views") or {}
        if not isinstance(vs, dict) or set(vs) != {v["id"] for v in spec["views"]}:
            raise JobError("outputs.views: exactly one entry per planned view")
        for v in spec["views"]:
            entry = vs[v["id"]]
            want_map = v["objectMap"]
            keys = {"image", "ids", "legend"} if want_map else {"image"}
            if not isinstance(entry, dict) or {k for k, u in entry.items() if u is not None} != keys:
                raise JobError(f"outputs.views.{v['id']}: an image URL, and ids and legend URLs exactly when it has an object map")
            view_urls[v["id"]] = {k: (_url(entry[k], f"outputs.views.{v['id']}.{k}") if k in keys else None) for k in ("image", "ids", "legend")}
    elif outputs.get("views"):
        raise JobError("outputs.views: the spec plans no views")

    limits = raw.get("limits") or {}
    if not isinstance(limits, dict):
        raise JobError("limits: an object")
    deadline = limits.get("deadlineS", 900)
    tex = limits.get("textureSize", {"DESKTOP": 2048, "MOBILE": 1024})
    obj_tex = limits.get("objectTextureSize", 1024)
    device = limits.get("device", "AUTO")
    if isinstance(deadline, bool) or not isinstance(deadline, int) or not 60 <= deadline <= 1800:
        raise JobError("limits.deadlineS: 60..1800")
    if not isinstance(tex, dict) or set(tex) != set(TIERS) or any(tex[t] not in (512, 1024, 2048) for t in TIERS) or obj_tex not in (512, 1024, 2048):
        raise JobError("limits.textureSize: 512, 1024 or 2048 per tier")
    if device not in ("AUTO", "CPU"):
        raise JobError("limits.device: AUTO or CPU")
    return Job(job_id=job_id, spec=spec, textures=textures, models=models, render_url=render_url, scene_urls=scene_urls,
               object_urls=object_urls, view_urls=view_urls, deadline_s=deadline, texture_size=dict(tex), object_texture_size=obj_tex, device=device)
