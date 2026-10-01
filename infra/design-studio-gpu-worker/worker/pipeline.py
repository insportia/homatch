"""One factory job: inputs once, Blender builds and renders, outputs optimised, validated, uploaded.

  download   the catalogue maps and models the spec names (bounded, type-checked)
  blender    the trusted factory script builds the scene from the validated spec,
             renders the source camera, exports the home and its walkthrough pieces
  composite  the render over the picture's own background → JPEG
  optimize   each GLB: dedup, prune, KTX2 (when textured), meshopt, Khronos validator;
             the home in two tiers (DESKTOP, MOBILE), each piece once
  upload     only to the signed URLs the job brought

Everything intermediate lives in one temporary directory that is removed when
the job ends, whatever happens. Blender gets one retry; a piece that fails is
reported and the home is still delivered. Every stage is timed; the worker
reports what it measured, nothing it did not.
"""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import requests
from PIL import Image

from .optimize import facts, optimize
from .schema import (
    MAX_MODEL_BYTES, MAX_OBJECT_BYTES, MAX_RENDER_BYTES, MAX_SCENE_BYTES, MAX_TEXTURE_BYTES, Job, JobError,
)

HERE = Path(__file__).resolve().parent
RETRIES = 1
Image.MAX_IMAGE_PIXELS = 60_000_000  # a decompression bomb is refused, not decoded
IMAGE_MAGIC = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"RIFF")


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


class Transfer:
    """Signed transfers only. Bounded reads; writes with the exact content type."""

    def get(self, url: str, limit: int) -> bytes:
        with requests.get(url, stream=True, timeout=60) as r:
            if r.status_code != 200:
                raise JobError(f"input: HTTP {r.status_code}")
            buf = io.BytesIO()
            for chunk in r.iter_content(1 << 16):
                buf.write(chunk)
                if buf.tell() > limit:
                    raise JobError("input: too large")
        return buf.getvalue()

    def put(self, url: str, data: bytes, content_type: str) -> None:
        r = requests.put(url, data=data, headers={"content-type": content_type}, timeout=120)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"upload: HTTP {r.status_code}")


def _image_ok(data: bytes) -> str:
    if not any(data.startswith(m) for m in IMAGE_MAGIC) or (data.startswith(b"RIFF") and data[8:12] != b"WEBP"):
        raise JobError("texture: not a JPEG, PNG or WEBP")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
    except Exception as e:  # noqa: BLE001 - any decode failure is the same refusal
        raise JobError("texture: unreadable") from e
    return {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}.get(img.format or "", ".png")


def _glb_ok(data: bytes) -> None:
    if len(data) < 20 or data[:4] != b"glTF":
        raise JobError("model: not a GLB")


def composite_jpeg(png: Path, background: str | None, out: Path) -> dict:
    """The render over the picture's own background (or white), as a JPEG under the size limit."""
    im = Image.open(png).convert("RGBA")
    bg_hex = (background or "#ffffff").lstrip("#")
    bg = Image.new("RGBA", im.size, (int(bg_hex[0:2], 16), int(bg_hex[2:4], 16), int(bg_hex[4:6], 16), 255))
    bg.alpha_composite(im)
    rgb = bg.convert("RGB")
    for q in (90, 85, 78, 70, 60):
        rgb.save(out, "JPEG", quality=q, optimize=True)
        if out.stat().st_size <= MAX_RENDER_BYTES:
            return {"width": im.size[0], "height": im.size[1], "quality": q}
    raise RuntimeError("render over the size limit")


STAGES = {"ARCHITECTURE", "FURNISHING", "MATERIALS", "LIGHTING", "RENDERING", "EXPORTING"}


def run_blender(blender: str, params: Path, timeout: int, progress=None) -> dict:
    """The trusted factory script in a fresh Blender; its stage markers are relayed as they happen."""
    report = json.loads(params.read_text())["report"]
    proc = subprocess.Popen([blender, "-b", "--factory-startup", "--python", str(HERE / "factory" / "build.py"), "--", str(params)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    tail: list[str] = []
    deadline = time.monotonic() + timeout
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if time.monotonic() > deadline:
                proc.kill()
                raise RuntimeError("blender: deadline")
            if line.startswith("HMSTAGE "):
                name = line.split()[1] if len(line.split()) > 1 else ""
                if progress and name in STAGES:
                    progress(name)
            tail = (tail + [line.rstrip()])[-20:]
        proc.wait(timeout=max(1, deadline - time.monotonic()))
    finally:
        if proc.poll() is None:
            proc.kill()
    rep = Path(report)
    if not rep.exists():
        raise RuntimeError(f"blender exited {proc.returncode} without a report: {' | '.join(tail)[-400:]}")
    data = json.loads(rep.read_text())
    if not data.get("ok"):
        raise RuntimeError(f"factory: {data.get('error', 'failed')}")
    return data


def run_job(job: Job, tools: dict, transfer: Transfer | None = None, now=time.perf_counter, progress=None) -> dict:
    transfer = transfer or Transfer()
    tell = progress or (lambda _stage: None)
    started = now()
    timings: dict[str, int] = {}
    outputs: dict = {"render": None, "scene": {}, "objects": {}}
    work = Path(tempfile.mkdtemp(prefix="hm-ds-factory-"))
    temp_bytes = 0
    build: dict = {}
    attempts = 0
    try:
        # ── inputs ────────────────────────────────────────────────
        t = now()
        textures: dict = {}
        for mid, maps in job.textures.items():
            entry = {}
            for k, url in maps.items():
                if not url:
                    entry[k] = None
                    continue
                data = transfer.get(url, MAX_TEXTURE_BYTES)
                ext = _image_ok(data)
                p = work / "in" / f"{hashlib.sha256(mid.encode()).hexdigest()[:16]}-{k}{ext}"
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
                entry[k] = str(p)
            textures[mid] = entry
        models: dict = {}
        for code, url in job.models.items():
            data = transfer.get(url, MAX_MODEL_BYTES)
            _glb_ok(data)
            p = work / "in" / f"{hashlib.sha256(code.encode()).hexdigest()[:16]}.glb"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
            models[code] = str(p)
        timings["download"] = _ms(t)

        # ── Blender ───────────────────────────────────────────────
        spec_path = work / "spec.json"
        spec_path.write_text(json.dumps({**job.spec, "version": "hm-scene-1", "units": "m", "coordinateSystem": "PLAN_XY_Z_UP"}))
        out = work / "out"
        params = work / "params.json"
        params.write_text(json.dumps({"spec": str(spec_path), "textures": textures, "models": models, "out": str(out),
                                      "device": job.device, "report": str(work / "report.json")}))
        t = now()
        last: Exception | None = None
        for attempt in range(RETRIES + 1):
            attempts = attempt + 1
            remaining = job.deadline_s - (now() - started) - 60
            if remaining < 30:
                last = RuntimeError("deadline")
                break
            try:
                shutil.rmtree(out, ignore_errors=True)
                build = run_blender(tools["blender"], params, int(remaining), tell)
                last = None
                break
            except Exception as e:  # noqa: BLE001 - one retry, then the job reports the reason
                last = e
        timings["blender"] = _ms(t)
        if last is not None:
            raise RuntimeError(str(last)[:400])

        # ── outputs ───────────────────────────────────────────────
        t = now()
        if job.render_url:
            jpg = work / "render.jpg"
            info = composite_jpeg(out / "render.png", (job.spec.get("camera") or {}).get("background"), jpg)
            data = jpg.read_bytes()
            transfer.put(job.render_url, data, "image/jpeg")
            outputs["render"] = {**info, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        timings["render_output"] = _ms(t)

        if job.scene_urls or job.object_urls:
            tell("OPTIMIZING")
        t = now()
        if job.scene_urls:
            done: dict[str, dict] = {}
            for tier in ("DESKTOP", "MOBILE"):
                dst = work / f"scene.{tier.lower()}.glb"
                f = _optimized(out / "scene.glb", dst, job.texture_size[tier], tools)
                data = dst.read_bytes()
                if len(data) > MAX_SCENE_BYTES:
                    raise RuntimeError("scene over the size limit")
                sha = hashlib.sha256(data).hexdigest()
                same = next((k for k, v in done.items() if v["sha256"] == sha), None)
                if same:
                    # Identical bytes are stored once: the tier points at the other.
                    outputs["scene"][tier] = {"sameAs": same, "sha256": sha, "bytes": len(data)}
                    continue
                transfer.put(job.scene_urls[tier], data, "model/gltf-binary")
                done[tier] = outputs["scene"][tier] = {**f, "bytes": len(data), "sha256": sha}
        timings["scene"] = _ms(t)

        t = now()
        for group, url in job.object_urls.items():
            if (now() - started) > job.deadline_s - 30:
                outputs["objects"][group] = {"ok": False, "error": "deadline"}
                continue
            src = out / "objects" / f"{group}.glb"
            try:
                if not src.exists():
                    raise RuntimeError((build.get("groups", {}).get(group) or {}).get("error") or "not exported")
                dst = work / f"obj-{group}.glb"
                f = _optimized(src, dst, job.object_texture_size, tools)
                data = dst.read_bytes()
                if len(data) > MAX_OBJECT_BYTES:
                    raise RuntimeError("piece over the size limit")
                transfer.put(url, data, "model/gltf-binary")
                outputs["objects"][group] = {"ok": True, **f, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            except Exception as e:  # noqa: BLE001 - one piece's failure is reported; the home is delivered
                outputs["objects"][group] = {"ok": False, "error": str(e)[:200]}
        timings["objects"] = _ms(t)
    finally:
        temp_bytes = sum(p.stat().st_size for p in work.rglob("*") if p.is_file()) if work.exists() else 0
        shutil.rmtree(work, ignore_errors=True)
    timings["total"] = _ms(started)
    return {
        "jobId": job.job_id, "outputs": outputs, "timings": timings, "attempts": attempts,
        "build": {k: build.get(k) for k in ("counts", "warnings", "timings", "objects", "groups", "device", "blender", "render")},
        "temporaryBytesDeleted": temp_bytes, "temporaryDirRemoved": not work.exists(),
    }


def _optimized(src: Path, dst: Path, texture_size: int, tools: dict) -> dict:
    if tools.get("gltf_transform"):
        return optimize(src, dst, texture_size, tools)
    # Without the toolchain (a local test), the file is passed through and says so.
    shutil.copyfile(src, dst)
    return facts(dst) | {"optimized": False}
