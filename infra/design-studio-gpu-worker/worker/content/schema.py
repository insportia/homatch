"""The Content Studio job a worker accepts, validated before anything runs.

A content job names an allowlisted asset (HOMI), an immutable version (v001…), an allowlisted stage and
bounded render numbers, plus one signed PUT per output. It carries no code, no paths and no spec: Blender
runs only worker/content/homi/build.py. Every output URL must be the storage endpoint over https AND point
inside homatch-content/3D/characters/<ASSET>/versions/<version>/ with the expected file type, so a job can
never be aimed at Design Studio's (or anyone's) objects. Anything malformed is refused, never repaired.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from ..schema import ALLOWED_HOST, UUID, JobError

ASSETS = ("HOMI",)
VERSION = re.compile(r"^v\d{3}$")
PREFIX = "homatch-content/3D/characters/{asset}/versions/{version}/"

# stage -> output name -> (required file suffix, size cap in bytes, content type)
STAGES = {
    "PREVIEW_360": {
        "blend": (".blend", 300 * 1024 * 1024, "application/x-blender"),
        "glb": (".glb", 200 * 1024 * 1024, "model/gltf-binary"),
        "turntable": (".mp4", 100 * 1024 * 1024, "video/mp4"),
        "contactSheet": (".png", 25 * 1024 * 1024, "image/png"),
        "face": (".png", 10 * 1024 * 1024, "image/png"),
        "manifest": (".json", 2 * 1024 * 1024, "application/json"),
    },
}
SIZES = (512, 720, 960, 1080)
DEVICES = ("AUTO", "GPU", "CPU")


@dataclass(frozen=True)
class ContentJob:
    job_id: str
    asset: str
    version: str
    stage: str
    size: int
    samples: int
    frames: int
    fps: int
    outputs: dict  # name -> signed PUT URL
    deadline_s: int = 900
    device: str = "AUTO"


def _int(raw: dict, key: str, lo: int, hi: int) -> int:
    v = raw.get(key)
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise JobError(f"render.{key}: {lo}..{hi}")
    return v


def _output_url(value: object, name: str, prefix: str, suffix: str) -> str:
    if not isinstance(value, str) or len(value) > 4096:
        raise JobError(f"outputs.{name}: not a URL")
    u = urlparse(value)
    if u.scheme != "https" or not u.hostname or not ALLOWED_HOST.match(u.hostname):
        raise JobError(f"outputs.{name}: only the storage endpoint, over https")
    # path-style R2 URL: /<bucket>/<key>
    parts = unquote(u.path).split("/", 2)
    key = parts[2] if len(parts) == 3 else ""
    if not key.startswith(prefix) or ".." in key or "//" in key or not key.endswith(suffix):
        raise JobError(f"outputs.{name}: not a {suffix} inside {prefix}")
    return value


def parse_content_job(raw: object) -> ContentJob:
    if not isinstance(raw, dict):
        raise JobError("contentStudio: an object")
    unknown = set(raw) - {"jobId", "asset", "version", "stage", "render", "outputs", "limits"}
    if unknown:
        raise JobError(f"contentStudio: unknown field {sorted(unknown)[0][:40]}")
    job_id = raw.get("jobId")
    if not isinstance(job_id, str) or not UUID.match(job_id):
        raise JobError("jobId: a uuid")
    asset = raw.get("asset")
    if asset not in ASSETS:
        raise JobError("asset: not an allowlisted asset")
    version = raw.get("version")
    if not isinstance(version, str) or not VERSION.match(version):
        raise JobError("version: v001..v999")
    stage = raw.get("stage")
    if stage not in STAGES:
        raise JobError("stage: not an allowlisted stage")
    render = raw.get("render")
    if not isinstance(render, dict) or set(render) != {"size", "samples", "frames", "fps"}:
        raise JobError("render: size, samples, frames and fps")
    size = render["size"]
    if type(size) is not int or size not in SIZES:  # 720.0 == 720, but Blender wants an int
        raise JobError(f"render.size: one of {SIZES}")
    samples = _int(render, "samples", 4, 256)
    frames = _int(render, "frames", 8, 144)
    fps = _int(render, "fps", 8, 30)
    want = STAGES[stage]
    outputs = raw.get("outputs")
    if not isinstance(outputs, dict) or set(outputs) != set(want):
        raise JobError(f"outputs: exactly {', '.join(sorted(want))}")
    prefix = PREFIX.format(asset=asset, version=version)
    urls = {name: _output_url(outputs[name], name, prefix, want[name][0]) for name in want}
    limits = raw.get("limits") or {}
    if not isinstance(limits, dict) or set(limits) - {"deadlineS", "device"}:
        raise JobError("limits: deadlineS and device only")
    deadline = limits.get("deadlineS", 900)
    if isinstance(deadline, bool) or not isinstance(deadline, int) or not 120 <= deadline <= 1500:
        raise JobError("limits.deadlineS: 120..1500")
    device = limits.get("device", "AUTO")
    if device not in DEVICES:
        raise JobError("limits.device: AUTO, GPU or CPU")
    return ContentJob(job_id, asset, version, stage, size, samples, frames, fps, urls, deadline, device)
