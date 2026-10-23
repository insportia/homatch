"""The Content Studio job a worker accepts, validated before anything runs.

A content job names an allowlisted asset (HOMI), an immutable version (v001…), an allowlisted stage and
bounded render numbers, plus one signed PUT per output (and, for ASSEMBLE, one signed GET per input). It
carries no code, no paths and no spec: Blender runs only worker/content/homi/build.py. Every URL must be
the storage endpoint over https AND point inside homatch-content/3D/characters/<ASSET>/versions/<version>/
with the expected file type, so a job can never be aimed at Design Studio's (or anyone's) objects.

A preview is several SHORT jobs, so a customer's Design Studio job never waits long behind HOMI:
  PREVIEW_360_BUILD     the model: master .blend, GLB (re-imported as a check), face close-up, build report
  PREVIEW_360_FRAMES    one chunk (≤ MAX_CHUNK) of turntable frames, as PNGs
  PREVIEW_360_ASSEMBLE  frames + face + build report in; turntable MP4, contact sheet and manifest out
Anything malformed is refused, never repaired.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import unquote, urlparse

from ..schema import ALLOWED_HOST, UUID, JobError

ASSETS = ("HOMI",)
VERSION = re.compile(r"^v\d{3}$")
PREFIX = "homatch-content/3D/characters/{asset}/versions/{version}/"
MAX_CHUNK = 24
FRAME = (".png", 10 * 1024 * 1024, "image/png")

# stage -> output name -> (required file suffix, size cap in bytes, content type); FRAMES outputs are the frames
STAGES = {
    "PREVIEW_360_BUILD": {
        "blend": (".blend", 300 * 1024 * 1024, "application/x-blender"),
        "glb": (".glb", 200 * 1024 * 1024, "model/gltf-binary"),
        "face": (".png", 10 * 1024 * 1024, "image/png"),
        "build": (".json", 2 * 1024 * 1024, "application/json"),
    },
    "PREVIEW_360_FRAMES": {},
    "PREVIEW_360_ASSEMBLE": {
        "turntable": (".mp4", 100 * 1024 * 1024, "video/mp4"),
        "contactSheet": (".png", 25 * 1024 * 1024, "image/png"),
        "manifest": (".json", 2 * 1024 * 1024, "application/json"),
    },
}
# ASSEMBLE's inputs: the BUILD stage's report and face, and every frame
ASSEMBLE_INPUTS = {"build": STAGES["PREVIEW_360_BUILD"]["build"], "face": STAGES["PREVIEW_360_BUILD"]["face"]}
SIZES = (512, 720, 960, 1080)
DEVICES = ("AUTO", "GPU", "CPU")


def frame_name(i: int) -> str:
    return f"f{i:04d}"


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
    inputs: dict = field(default_factory=dict)  # ASSEMBLE: build, face -> GET URL; frames -> {f0000: GET URL}
    chunk: tuple = (0, 0)  # FRAMES: (start, count)
    deadline_s: int = 300
    device: str = "AUTO"


def _int(raw: dict, key: str, lo: int, hi: int, where: str = "render") -> int:
    v = raw.get(key)
    if type(v) is not int or not lo <= v <= hi:
        raise JobError(f"{where}.{key}: {lo}..{hi}")
    return v


def _url(value: object, name: str, prefix: str, suffix: str) -> str:
    if not isinstance(value, str) or len(value) > 4096:
        raise JobError(f"{name}: not a URL")
    u = urlparse(value)
    if u.scheme != "https" or not u.hostname or not ALLOWED_HOST.match(u.hostname):
        raise JobError(f"{name}: only the storage endpoint, over https")
    # path-style R2 URL: /<bucket>/<key>
    parts = unquote(u.path).split("/", 2)
    key = parts[2] if len(parts) == 3 else ""
    if not key.startswith(prefix) or ".." in key or "//" in key or not key.endswith(suffix):
        raise JobError(f"{name}: not a {suffix} inside {prefix}")
    return value


def parse_content_job(raw: object) -> ContentJob:
    if not isinstance(raw, dict):
        raise JobError("contentStudio: an object")
    unknown = set(raw) - {"jobId", "asset", "version", "stage", "render", "chunk", "inputs", "outputs", "limits"}
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
    if not isinstance(stage, str) or stage not in STAGES:
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
    prefix = PREFIX.format(asset=asset, version=version)

    chunk = (0, 0)
    if stage == "PREVIEW_360_FRAMES":
        c = raw.get("chunk")
        if not isinstance(c, dict) or set(c) != {"start", "count"}:
            raise JobError("chunk: start and count")
        start = _int(c, "start", 0, frames - 1, "chunk")
        count = _int(c, "count", 1, MAX_CHUNK, "chunk")
        if start + count > frames:
            raise JobError("chunk: past the last frame")
        chunk = (start, count)
        want = {frame_name(i): FRAME for i in range(start, start + count)}
    elif "chunk" in raw:
        raise JobError("chunk: only for PREVIEW_360_FRAMES")
    else:
        want = STAGES[stage]

    outputs = raw.get("outputs")
    if not isinstance(outputs, dict) or set(outputs) != set(want):
        raise JobError(f"outputs: exactly {', '.join(sorted(want))[:120]}")
    urls = {name: _url(outputs[name], f"outputs.{name}", prefix, want[name][0]) for name in want}

    inputs: dict = {}
    if stage == "PREVIEW_360_ASSEMBLE":
        raw_in = raw.get("inputs")
        if not isinstance(raw_in, dict) or set(raw_in) != {"build", "face", "frames"}:
            raise JobError("inputs: build, face and frames")
        inputs = {k: _url(raw_in[k], f"inputs.{k}", prefix, ASSEMBLE_INPUTS[k][0]) for k in ("build", "face")}
        fr = raw_in["frames"]
        if not isinstance(fr, dict) or set(fr) != {frame_name(i) for i in range(frames)}:
            raise JobError("inputs.frames: exactly one URL per turntable frame")
        inputs["frames"] = {k: _url(v, f"inputs.frames.{k}", prefix, ".png") for k, v in sorted(fr.items())}
    elif "inputs" in raw:
        raise JobError("inputs: only for PREVIEW_360_ASSEMBLE")

    limits = raw.get("limits") or {}
    if not isinstance(limits, dict) or set(limits) - {"deadlineS", "device"}:
        raise JobError("limits: deadlineS and device only")
    deadline = limits.get("deadlineS", 300)
    if type(deadline) is not int or not 60 <= deadline <= 600:
        raise JobError("limits.deadlineS: 60..600")
    device = limits.get("device", "AUTO")
    if device not in DEVICES:
        raise JobError("limits.device: AUTO, GPU or CPU")
    return ContentJob(job_id, asset, version, stage, size, samples, frames, fps, urls, inputs, chunk, deadline, device)
