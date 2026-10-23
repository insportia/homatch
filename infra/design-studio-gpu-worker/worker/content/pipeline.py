"""One Content Studio job: Blender builds HOMI, the worker checks and packages the outputs, then uploads them.

  blender    worker/content/homi/build.py (HOMATCH-owned) builds the model, saves the master .blend,
             exports and re-imports the GLB, renders the turntable and the face close-up, encodes the MP4
  check      the build report must say ok (GLB re-import and .blend reopen complete, no missing files)
  package    contact sheet (eight turntable angles + face), manifest with size and sha256 of every file
  upload     only to the signed URLs the job brought; the manifest last, so its presence means the rest landed

Everything lives in one temporary directory that is removed when the job ends, whatever happens.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import requests
from PIL import Image, ImageDraw

from .schema import STAGES, ContentJob

HERE = Path(__file__).resolve().parent
BUILD = HERE / "homi" / "build.py"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Uploader:
    """Signed PUTs only, streamed from disk with the exact content type."""

    def put(self, url: str, path: Path, content_type: str) -> None:
        try:
            with path.open("rb") as f:
                r = requests.put(url, data=f, headers={"content-type": content_type, "content-length": str(path.stat().st_size)}, timeout=600)
        except requests.RequestException:
            raise RuntimeError("upload: network") from None  # the exception text would carry the signed URL
        if r.status_code not in (200, 201):
            raise RuntimeError(f"upload: HTTP {r.status_code}")


def run_blender(blender: str, params: Path, timeout: int, progress=None) -> None:
    proc = subprocess.Popen([blender, "-b", "--factory-startup", "--python", str(BUILD), "--", str(params)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    deadline = time.monotonic() + timeout
    tail: list[str] = []
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            tail = (tail + [line.rstrip()])[-40:]
            if progress and "Saved:" in line and "f_" in line:
                progress("RENDERING")
            if time.monotonic() > deadline:
                proc.kill()
                raise RuntimeError("blender: deadline")
        proc.wait(timeout=max(1, deadline - time.monotonic()))
    except subprocess.TimeoutExpired as e:
        proc.kill()
        raise RuntimeError("blender: deadline") from e
    if proc.returncode != 0:
        last = next((t for t in reversed(tail) if "Error" in t or "error" in t), "exit " + str(proc.returncode))
        raise RuntimeError(f"blender: {last[:200]}")


def contact_sheet(frames_dir: Path, face: Path, out: Path, title: str) -> None:
    """Eight angles of the turntable (every 45°) and the face close-up, labelled."""
    files = sorted(frames_dir.glob("f_*.png"))
    if len(files) < 8:
        raise RuntimeError("contact sheet: too few frames")
    picks = [files[round(i * len(files) / 8) % len(files)] for i in range(8)]
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


def run_content_job(job: ContentJob, tools: dict, uploader: Uploader | None = None, progress=None, revision: str | None = None) -> dict:
    uploader = uploader or Uploader()
    t0 = time.perf_counter()
    work = Path(tempfile.mkdtemp(prefix="hm-content-"))
    try:
        v = job.version
        names = {"blend": f"HOMI_MASTER_{v}.blend", "glb": f"HOMI_MODEL_{v}.glb", "mp4": f"HOMI_TURNTABLE_360_{v}.mp4"}
        out = work / "out"
        params = work / "params.json"
        report_path = work / "report.json"
        params.write_text(json.dumps({
            "stage": job.stage, "out": str(out), "report": str(report_path), "device": job.device,
            "size": job.size, "samples": job.samples, "frames": job.frames, "fps": job.fps, "files": names,
        }))
        if progress:
            progress("BUILDING")
        run_blender(tools["blender"], params, timeout=max(60, job.deadline_s - 90), progress=progress)
        report = json.loads(report_path.read_text())
        if not report.get("ok"):
            raise RuntimeError("build checks failed: " + json.dumps({k: report.get(k) for k in ("glb_reimport", "blend_reopen")})[:240])

        if progress:
            progress("PACKAGING")
        sheet = out / f"HOMI_CONTACT_SHEET_{v}.png"
        contact_sheet(out / "frames", out / "face.png", sheet, f"HOMI {v} · {job.stage} · {report['geometry']['triangles']:,} triangles · Blender {report['blender']}")
        face = out / f"HOMI_FACE_{v}.png"
        shutil.copyfile(out / "face.png", face)
        files = {"blend": out / names["blend"], "glb": out / names["glb"], "turntable": out / names["mp4"], "contactSheet": sheet, "face": face}
        want = STAGES[job.stage]
        listing = {}
        for name, path in files.items():
            size = path.stat().st_size
            if size == 0 or size > want[name][1]:
                raise RuntimeError(f"{name}: size {size} outside the limit")
            listing[name] = {"file": path.name, "bytes": size, "sha256": _sha256(path), "contentType": want[name][2]}
        manifest = {
            "asset": job.asset, "version": v, "stage": job.stage, "jobId": job.job_id,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "worker": {"revision": revision, "blender": report["blender"], "device": report.get("device")},
            "render": {"size": job.size, "samples": job.samples, "frames": job.frames, "fps": job.fps},
            "files": listing,
            "geometry": report["geometry"], "joints": report.get("joints"),
            "checks": {"glbReimport": report["glb_reimport"], "blendReopen": report["blend_reopen"]},
            "timings": report["timings"],
            "reference": "homatch-content/3D/characters/HOMI/references/HOMI_REF_hero_v001.png",
            "notes": "Scripted procedural model built from one 3/4 reference view; objects tagged homi_inferred were not visible in the reference.",
        }
        mpath = out / f"HOMI_ASSET_MANIFEST_{v}.json"
        mpath.write_text(json.dumps(manifest, indent=1))
        if mpath.stat().st_size > want["manifest"][1]:
            raise RuntimeError("manifest: too large")

        if progress:
            progress("UPLOADING")
        for name, path in files.items():
            uploader.put(job.outputs[name], path, want[name][2])
        uploader.put(job.outputs["manifest"], mpath, want["manifest"][2])
        result = {name: {k: listing[name][k] for k in ("bytes", "sha256")} for name in listing}
        result["manifest"] = {"bytes": mpath.stat().st_size, "sha256": _sha256(mpath)}
        return {
            "kind": "CONTENT_STUDIO", "asset": job.asset, "version": v, "stage": job.stage,
            "outputs": result, "geometry": {k: report["geometry"][k] for k in ("objects", "triangles", "height_m", "non_manifold", "inferred")},
            "timings": {**report["timings"], "job_s": round(time.perf_counter() - t0, 2)}, "device": report.get("device"),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)
