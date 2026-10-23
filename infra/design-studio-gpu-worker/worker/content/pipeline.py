"""One Content Studio job: Blender builds HOMI (or one chunk of its turntable), the worker checks, packages and uploads.

  BUILD     model → master .blend, GLB (re-imported as a check), face close-up; the build report (sizes, sha256,
            geometry, checks) is uploaded last, so its presence means the rest landed
  FRAMES    one chunk of turntable frames → PNGs
  ASSEMBLE  build report, face and every frame downloaded (bounded, type-checked) → MP4, contact sheet, manifest
            (uploaded last)

Each job is short on purpose: the endpoint is shared with Design Studio customers, and the dispatcher checks
for customer work before every step. Everything lives in one temporary directory that is removed when the job
ends, whatever happens.
"""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import requests
from PIL import Image, ImageDraw

from .schema import ASSEMBLE_INPUTS, FRAME, STAGES, ContentJob, frame_name

HERE = Path(__file__).resolve().parent
BUILD = HERE / "homi" / "build.py"
PNG = b"\x89PNG\r\n\x1a\n"
Image.MAX_IMAGE_PIXELS = 20_000_000  # a decompression bomb is refused, not decoded


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Transfer:
    """Signed transfers only: bounded GETs, PUTs streamed from disk with the exact content type.
    Network errors are reported without their text, which would carry the signed URL."""

    def get(self, url: str, limit: int) -> bytes:
        try:
            with requests.get(url, stream=True, timeout=60) as r:
                if r.status_code != 200:
                    raise RuntimeError(f"download: HTTP {r.status_code}")
                buf = io.BytesIO()
                for chunk in r.iter_content(1 << 16):
                    buf.write(chunk)
                    if buf.tell() > limit:
                        raise RuntimeError("download: too large")
        except requests.RequestException:
            raise RuntimeError("download: network") from None
        return buf.getvalue()

    def put(self, url: str, path: Path, content_type: str) -> None:
        try:
            with path.open("rb") as f:
                r = requests.put(url, data=f, headers={"content-type": content_type, "content-length": str(path.stat().st_size)}, timeout=600)
        except requests.RequestException:
            raise RuntimeError("upload: network") from None
        if r.status_code not in (200, 201):
            raise RuntimeError(f"upload: HTTP {r.status_code}")


def run_blender(blender: str, params: Path, timeout: int, progress=None) -> None:
    proc = subprocess.Popen([blender, "-b", "--factory-startup", "--python", str(BUILD), "--", str(params)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    tail: list[str] = []
    # A watchdog, not a per-line check: a Blender that hangs silently prints nothing to check against.
    fired = threading.Event()

    def kill() -> None:
        fired.set()
        proc.kill()

    watchdog = threading.Timer(timeout, kill)
    watchdog.start()
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            tail = (tail + [line.rstrip()])[-40:]
            if progress and "Saved:" in line:
                progress("RENDERING")
        proc.wait()
    finally:
        watchdog.cancel()
    if fired.is_set():
        raise RuntimeError("blender: deadline")
    if proc.returncode != 0:
        last = next((t for t in reversed(tail) if "Error" in t or "error" in t), "exit " + str(proc.returncode))
        raise RuntimeError(f"blender: {last[:200]}")


def _blender_stage(job: ContentJob, tools: dict, work: Path, stage: str, extra: dict, progress) -> dict:
    out = work / "out"
    params = work / f"{stage.lower()}.json"
    report = work / f"{stage.lower()}-report.json"
    params.write_text(json.dumps({"stage": stage, "out": str(out), "report": str(report), "device": job.device,
                                  "size": job.size, "samples": job.samples, "frames": job.frames, "fps": job.fps, **extra}))
    run_blender(tools["blender"], params, timeout=max(30, job.deadline_s - 60), progress=progress)
    r = json.loads(report.read_text())
    if not r.get("ok"):
        raise RuntimeError(f"{stage.lower()} checks failed: " + json.dumps({k: r.get(k) for k in ("glb_reimport", "blend_reopen")})[:240])
    return r


def _png(data: bytes, what: str) -> bytes:
    if not data.startswith(PNG):
        raise RuntimeError(f"{what}: not a PNG")
    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:  # noqa: BLE001 - any decode failure is the same refusal
        raise RuntimeError(f"{what}: unreadable") from None
    return data


def contact_sheet(frame_files: list[Path], face: Path, out: Path, title: str) -> None:
    """Eight angles of the turntable (every 45°) and the face close-up, labelled."""
    if len(frame_files) < 8:
        raise RuntimeError("contact sheet: too few frames")
    picks = [frame_files[round(i * len(frame_files) / 8) % len(frame_files)] for i in range(8)]
    tiles = [(Image.open(p).convert("RGB"), f"{i * 45}°") for i, p in enumerate(picks)] + [(Image.open(face).convert("RGB"), "face 3/4")]
    w = tiles[0][0].width
    head = 56
    sheet = Image.new("RGB", (w * 3, w * 3 + head), (14, 15, 18))
    d = ImageDraw.Draw(sheet)
    d.text((16, 18), title, fill=(230, 214, 170))
    for i, (im, label) in enumerate(tiles):
        im = im.resize((w, w))
        x, y = (i % 3) * w, head + (i // 3) * w
        sheet.paste(im, (x, y))
        d.text((x + 12, y + 10), label, fill=(240, 240, 240))
    sheet.save(out, optimize=True)


def _listing(path: Path, content_type: str) -> dict:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": _sha256(path), "contentType": content_type}


def _check_size(name: str, path: Path, cap: int) -> None:
    size = path.stat().st_size
    if size == 0 or size > cap:
        raise RuntimeError(f"{name}: size {size} outside the limit")


def run_content_job(job: ContentJob, tools: dict, transfer: Transfer | None = None, progress=None, revision: str | None = None) -> dict:
    transfer = transfer or Transfer()
    t0 = time.perf_counter()
    work = Path(tempfile.mkdtemp(prefix="hm-content-"))
    v = job.version
    try:
        out = work / "out"
        if progress:
            progress(job.stage)

        if job.stage == "PREVIEW_360_BUILD":
            want = STAGES[job.stage]
            files = {"blend": out / f"HOMI_MASTER_{v}.blend", "glb": out / f"HOMI_MODEL_{v}.glb", "face": out / f"HOMI_FACE_{v}.png"}
            r = _blender_stage(job, tools, work, "BUILD", {"files": {k: p.name for k, p in files.items()}}, progress)
            listing = {}
            for name, path in files.items():
                _check_size(name, path, want[name][1])
                listing[name] = _listing(path, want[name][2])
            build = out / f"HOMI_BUILD_{v}.json"
            build.write_text(json.dumps({"asset": job.asset, "version": v, "jobId": job.job_id, "files": listing,
                                         "worker": {"revision": revision, "blender": r["blender"], "device": r.get("device")},
                                         "geometry": r["geometry"], "joints": r.get("joints"),
                                         "checks": {"glbReimport": r["glb_reimport"], "blendReopen": r["blend_reopen"]}, "timings": r["timings"]}, indent=1))
            _check_size("build", build, want["build"][1])
            for name, path in files.items():
                transfer.put(job.outputs[name], path, want[name][2])
            transfer.put(job.outputs["build"], build, want["build"][2])
            outputs = {**{k: {"bytes": x["bytes"], "sha256": x["sha256"]} for k, x in listing.items()},
                       "build": {"bytes": build.stat().st_size, "sha256": _sha256(build)}}
            summary = {"geometry": {k: r["geometry"][k] for k in ("objects", "triangles", "height_m", "non_manifold", "inferred")}}

        elif job.stage == "PREVIEW_360_FRAMES":
            start, count = job.chunk
            r = _blender_stage(job, tools, work, "FRAMES", {"start": start, "count": count}, progress)
            outputs = {}
            for i in range(start, start + count):
                path = out / f"f{i:04d}.png"
                _check_size(frame_name(i), path, FRAME[1])
                _png(path.read_bytes(), frame_name(i))
                transfer.put(job.outputs[frame_name(i)], path, FRAME[2])
                outputs[frame_name(i)] = {"bytes": path.stat().st_size, "sha256": _sha256(path)}
            summary = {"chunk": {"start": start, "count": count}}

        else:  # PREVIEW_360_ASSEMBLE
            want = STAGES[job.stage]
            build = json.loads(transfer.get(job.inputs["build"], ASSEMBLE_INPUTS["build"][1]))
            if build.get("version") != v or build.get("asset") != job.asset:
                raise RuntimeError("build report: not this asset version")
            frames_dir = work / "frames"
            frames_dir.mkdir(parents=True)
            face = work / f"HOMI_FACE_{v}.png"
            face.write_bytes(_png(transfer.get(job.inputs["face"], ASSEMBLE_INPUTS["face"][1]), "face"))
            frame_files = []
            for name, url in sorted(job.inputs["frames"].items()):
                p = frames_dir / f"{name}.png"
                p.write_bytes(_png(transfer.get(url, FRAME[1]), name))
                frame_files.append(p)
            mp4 = out / f"HOMI_TURNTABLE_360_{v}.mp4"
            _blender_stage(job, tools, work, "ENCODE", {"frames_dir": str(frames_dir), "files": {"mp4": mp4.name}}, progress)
            sheet = out / f"HOMI_CONTACT_SHEET_{v}.png"
            contact_sheet(frame_files, face, sheet, f"HOMI {v} · PREVIEW_360 · {build['geometry']['triangles']:,} triangles · Blender {build['worker']['blender']}")
            _check_size("turntable", mp4, want["turntable"][1])
            _check_size("contactSheet", sheet, want["contactSheet"][1])
            listing = {**build["files"], "turntable": _listing(mp4, want["turntable"][2]), "contactSheet": _listing(sheet, want["contactSheet"][2])}
            manifest = {
                "asset": job.asset, "version": v, "stage": "PREVIEW_360", "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "buildJobId": build.get("jobId"), "assembleJobId": job.job_id,
                "worker": {**build["worker"], "assembleRevision": revision},
                "render": {"size": job.size, "samples": job.samples, "frames": job.frames, "fps": job.fps},
                "files": listing, "geometry": build["geometry"], "joints": build.get("joints"), "checks": build["checks"],
                "reference": "homatch-content/3D/characters/HOMI/references/HOMI_REF_hero_v001.png",
                "notes": "Procedural model scripted in Blender from one 3/4 reference view (no image-to-3D); objects tagged homi_inferred were not visible in the reference.",
            }
            mpath = out / f"HOMI_ASSET_MANIFEST_{v}.json"
            mpath.write_text(json.dumps(manifest, indent=1))
            _check_size("manifest", mpath, want["manifest"][1])
            transfer.put(job.outputs["turntable"], mp4, want["turntable"][2])
            transfer.put(job.outputs["contactSheet"], sheet, want["contactSheet"][2])
            transfer.put(job.outputs["manifest"], mpath, want["manifest"][2])
            outputs = {"turntable": {k: listing["turntable"][k] for k in ("bytes", "sha256")},
                       "contactSheet": {k: listing["contactSheet"][k] for k in ("bytes", "sha256")},
                       "manifest": {"bytes": mpath.stat().st_size, "sha256": _sha256(mpath)}}
            summary = {}

        return {"kind": "CONTENT_STUDIO", "asset": job.asset, "version": v, "stage": job.stage, "outputs": outputs, **summary,
                "timings": {"job_s": round(time.perf_counter() - t0, 2)}}
    finally:
        shutil.rmtree(work, ignore_errors=True)
