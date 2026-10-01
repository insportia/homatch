"""One job: the picture once, then each object — mask, generate, normalise, optimise, validate, upload.

Everything intermediate lives in one temporary directory and is deleted when
the job ends, whatever happens. Only the final runtime GLB of each object is
written, to the signed URL the job brought. Every stage is timed; the worker
reports what it measured, nothing it did not.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import requests

from .imaging import download_image, object_rgba
from .optimize import facts, optimize
from .schema import MAX_OUTPUT_BYTES, Job, ObjectJob

HERE = Path(__file__).resolve().parent
RETRIES = 1  # one more try with another seed, then the object is reported failed (the apartment is not)


@dataclass
class ObjectResult:
    key: str
    ok: bool
    error: str | None = None
    bytes: int = 0
    sha256: str | None = None
    triangles: int = 0
    textures: int = 0
    dims_m: list[float] = field(default_factory=list)
    mask_coverage: float = 0.0
    attempts: int = 0
    ms: dict = field(default_factory=dict)


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def blender_normalize(blender: str, raw: Path, out: Path, obj: ObjectJob, job: Job, work: Path) -> dict:
    params = work / f"{obj.key}.params.json"
    rep = work / f"{obj.key}.report.json"
    params.write_text(json.dumps({
        "input": str(raw), "output": str(out), "report": str(rep), "type": obj.type, "sizeM": list(obj.size_m),
        "maxTriangles": job.max_triangles, "textureSize": job.texture_size, "name": obj.key,
    }))
    r = subprocess.run([blender, "-b", "--factory-startup", "--python", str(HERE / "blender_normalize.py"), "--", str(params)],
                       capture_output=True, text=True, timeout=300, check=False)
    if r.returncode != 0 or not rep.exists():
        raise RuntimeError(f"blender failed: {(r.stderr or r.stdout)[-400:]}")
    return json.loads(rep.read_text())


def upload(url: str, path: Path) -> None:
    data = path.read_bytes()
    if len(data) > MAX_OUTPUT_BYTES:
        raise RuntimeError("output over the size limit")
    r = requests.put(url, data=data, headers={"content-type": "model/gltf-binary"}, timeout=120)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"upload: HTTP {r.status_code}")


def run_job(job: Job, generator, segmenter, tools: dict, now=time.perf_counter) -> dict:
    started = now()
    timings: dict[str, int] = {}
    results: list[ObjectResult] = []
    work = Path(tempfile.mkdtemp(prefix="hm-ds-"))
    temp_bytes = 0
    try:
        t0 = now()
        img = download_image(job.image_url, job.image_sha256)
        timings["download"] = _ms(t0)
        for i, obj in enumerate(job.objects):
            res = ObjectResult(key=obj.key, ok=False)
            # Deadline: never start an object that cannot finish in time.
            if (now() - started) > job.deadline_s - 90:
                res.error = "deadline"
                results.append(res)
                continue
            for attempt in range(RETRIES + 1):
                res.attempts = attempt + 1
                try:
                    t = now()
                    rgba, cov = object_rgba(img, obj.crop, obj.tight, segmenter)
                    res.mask_coverage = round(cov, 3)
                    res.ms["segment"] = _ms(t)
                    if cov < 0.03:
                        raise RuntimeError("the mask is empty (the object was not found in its crop)")
                    raw = work / f"{obj.key}.raw.glb"
                    t = now()
                    generator.generate(rgba, seed=1000 + 7919 * attempt + i, out_glb=raw, texture_size=job.texture_size)
                    res.ms["generate"] = _ms(t)
                    norm = work / f"{obj.key}.norm.glb"
                    t = now()
                    rep = blender_normalize(tools["blender"], raw, norm, obj, job, work)
                    res.ms["blender"] = _ms(t)
                    res.dims_m = rep["dimsM"]
                    final = work / f"{obj.key}.glb"
                    t = now()
                    f = optimize(norm, final, job.texture_size, tools) if tools.get("gltf_transform") else facts(norm) | {"_copied": True}
                    if f.get("_copied"):
                        shutil.copyfile(norm, final)
                    res.ms["optimize"] = _ms(t)
                    data = final.read_bytes()
                    res.bytes, res.triangles, res.textures = len(data), f["triangles"], f["textures"]
                    res.sha256 = hashlib.sha256(data).hexdigest()
                    t = now()
                    upload(obj.put_url, final)
                    res.ms["upload"] = _ms(t)
                    res.ok, res.error = True, None
                    break
                except Exception as e:  # noqa: BLE001 - one object's failure is reported, the job goes on
                    res.error = str(e)[:300]
            results.append(res)
    finally:
        temp_bytes = sum(p.stat().st_size for p in work.rglob("*") if p.is_file()) if work.exists() else 0
        shutil.rmtree(work, ignore_errors=True)
    timings["total"] = _ms(started)
    return {
        "jobId": job.job_id, "model": getattr(generator, "version", generator.name), "segmenter": getattr(segmenter, "name", "?"),
        "objects": [asdict(r) for r in results], "timings": timings,
        "temporaryBytesDeleted": temp_bytes, "temporaryDirRemoved": not work.exists(),
    }
