"""The job a Design Studio GPU worker accepts, validated before anything runs.

The worker is given everything it may touch as URLs: one signed GET for the
source picture and, per object, signed PUT URLs for the files it may write.
It holds no storage credentials and decides no paths. Everything is bounded:
counts, sizes, crops, deadlines. Anything malformed is refused, never repaired.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

MAX_OBJECTS = 16
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_OUTPUT_BYTES = 12 * 1024 * 1024
KEY = re.compile(r"^[A-Za-z0-9_-]{1,24}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
# Only the storage endpoint may be fetched or written (no arbitrary URLs from a job).
ALLOWED_HOST = re.compile(r"^[a-z0-9]+\.r2\.cloudflarestorage\.com$")
TYPES = {
    "SOFA", "ARMCHAIR", "CHAIR", "OFFICE_CHAIR", "BAR_STOOL", "BED_DOUBLE", "BED_SINGLE", "PLANT", "PLANTER", "FLOOR_LAMP",
    "OUTDOOR_CHAIR", "OUTDOOR_SOFA", "DECOR", "COFFEE_TABLE", "DINING_TABLE", "SIDE_TABLE", "OUTDOOR_TABLE", "BEDSIDE",
}


class JobError(ValueError):
    """A job that cannot run as given."""


@dataclass(frozen=True)
class ObjectJob:
    key: str
    type: str
    crop: tuple[float, float, float, float]
    tight: tuple[float, float, float, float]
    size_m: tuple[float, float, float]  # width, depth, height
    put_url: str


@dataclass(frozen=True)
class Job:
    job_id: str
    image_url: str
    image_sha256: str | None
    objects: tuple[ObjectJob, ...]
    max_triangles: int = 40000
    texture_size: int = 1024
    deadline_s: int = 900
    model: str = "trellis2"
    extra: dict = field(default_factory=dict)


def _url(value: object, what: str) -> str:
    if not isinstance(value, str) or len(value) > 4096:
        raise JobError(f"{what}: not a URL")
    u = urlparse(value)
    if u.scheme != "https" or not u.hostname or not ALLOWED_HOST.match(u.hostname):
        raise JobError(f"{what}: only the storage endpoint, over https")
    return value


def _box(value: object, what: str) -> tuple[float, float, float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 4 or not all(isinstance(v, (int, float)) for v in value):
        raise JobError(f"{what}: four numbers")
    left, top, right, bottom = (float(v) for v in value)
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        raise JobError(f"{what}: fractions, left < right, top < bottom")
    return left, top, right, bottom


def parse_job(raw: object) -> Job:
    if not isinstance(raw, dict):
        raise JobError("job: an object")
    job_id = raw.get("jobId")
    if not isinstance(job_id, str) or not UUID.match(job_id):
        raise JobError("jobId: a uuid")
    image = raw.get("image") or {}
    if not isinstance(image, dict):
        raise JobError("image: an object")
    sha = image.get("sha256")
    if sha is not None and (not isinstance(sha, str) or not SHA256.match(sha)):
        raise JobError("image.sha256: hex")
    objects_raw = raw.get("objects")
    if not isinstance(objects_raw, list) or not 1 <= len(objects_raw) <= MAX_OBJECTS:
        raise JobError(f"objects: 1..{MAX_OBJECTS}")
    objects: list[ObjectJob] = []
    seen: set[str] = set()
    for i, o in enumerate(objects_raw):
        if not isinstance(o, dict):
            raise JobError(f"objects[{i}]: an object")
        key = o.get("key")
        if not isinstance(key, str) or not KEY.match(key) or key in seen:
            raise JobError(f"objects[{i}].key: unique, [A-Za-z0-9_-]{{1,24}}")
        seen.add(key)
        if o.get("type") not in TYPES:
            raise JobError(f"objects[{i}].type: not a generatable type")
        size = o.get("sizeM") or {}
        dims = tuple(size.get(k) for k in ("width", "depth", "height")) if isinstance(size, dict) else ()
        if len(dims) != 3 or not all(isinstance(d, (int, float)) and 0.03 <= d <= 8 for d in dims):
            raise JobError(f"objects[{i}].sizeM: width, depth, height in metres")
        objects.append(ObjectJob(
            key=key, type=o["type"], crop=_box(o.get("crop"), f"objects[{i}].crop"), tight=_box(o.get("tight"), f"objects[{i}].tight"),
            size_m=tuple(float(d) for d in dims),  # type: ignore[arg-type]
            put_url=_url((o.get("outputs") or {}).get("glb"), f"objects[{i}].outputs.glb"),
        ))
    limits = raw.get("limits") or {}
    if not isinstance(limits, dict):
        raise JobError("limits: an object")
    max_tris = int(limits.get("maxTriangles", 40000))
    tex = int(limits.get("textureSize", 1024))
    deadline = int(limits.get("deadlineS", 900))
    if not 2000 <= max_tris <= 200000 or tex not in (512, 1024, 2048) or not 60 <= deadline <= 1800:
        raise JobError("limits: out of bounds")
    model = raw.get("model", "trellis2")
    if model not in ("trellis2", "mock"):
        raise JobError("model: not an approved model")
    return Job(job_id=job_id, image_url=_url(image.get("url"), "image.url"), image_sha256=sha, objects=tuple(objects),
               max_triangles=max_tris, texture_size=tex, deadline_s=deadline, model=model)
