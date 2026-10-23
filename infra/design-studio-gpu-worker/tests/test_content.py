"""Content Studio (HOMI) jobs on the scene-factory worker: allowlisted schema, isolation from the factory,
no code from the job, cleanup, and a real Blender build of HOMI (BUILD → FRAMES → ASSEMBLE) when installed."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import re
from pathlib import Path

import pytest
from PIL import Image

from worker import pipeline as factory_pipeline
from worker.content import pipeline as content_pipeline
from worker.content.schema import parse_content_job
from worker.handler import handle
from worker.schema import JobError

from test_worker import UUID, WORKER, blender_path, needs_blender

HOST = "https://abc123.r2.cloudflarestorage.com/homatch-storage/"
PREFIX = "homatch-content/3D/characters/HOMI/versions/v001/"
BUILD_FILES = {"blend": "blender/HOMI_MASTER_v001.blend", "glb": "models/HOMI_MODEL_v001.glb", "face": "previews/HOMI_FACE_v001.png",
               "build": "manifest/HOMI_BUILD_v001.json"}
ASSEMBLE_FILES = {"turntable": "previews/HOMI_TURNTABLE_360_v001.mp4", "contactSheet": "previews/HOMI_CONTACT_SHEET_v001.png",
                  "manifest": "manifest/HOMI_ASSET_MANIFEST_v001.json"}
RENDER = {"size": 512, "samples": 4, "frames": 8, "fps": 8}


def url(rel: str, prefix: str = PREFIX) -> str:
    return f"{HOST}{prefix}{rel}?X-Amz-Signature=secret-signature"


def frame_rel(i: int) -> str:
    return f"previews/frames/HOMI_TT_v001_f{i:04d}.png"


def cjob(stage="PREVIEW_360_BUILD", **over) -> dict:
    j = {"jobId": UUID, "asset": "HOMI", "version": "v001", "stage": stage, "render": dict(RENDER), "limits": {"deadlineS": 300, "device": "AUTO"}}
    if stage == "PREVIEW_360_BUILD":
        j["outputs"] = {k: url(v) for k, v in BUILD_FILES.items()}
    elif stage == "PREVIEW_360_FRAMES":
        j["chunk"] = {"start": 0, "count": 4}
        j["outputs"] = {f"f{i:04d}": url(frame_rel(i)) for i in range(4)}
    else:
        j["outputs"] = {k: url(v) for k, v in ASSEMBLE_FILES.items()}
        j["inputs"] = {"build": url(BUILD_FILES["build"]), "face": url(BUILD_FILES["face"]), "frames": {f"f{i:04d}": url(frame_rel(i)) for i in range(8)}}
    j.update(over)
    return j


def _tiny_png() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 10, 10)).save(b, "PNG")
    return b.getvalue()


TINY_PNG = _tiny_png()


class FakeR2:
    """Signed URL -> bytes: PUTs land, GETs read them back (what the dispatcher's signed URLs do in R2)."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.types: dict[str, str] = {}

    def put(self, url_: str, path: Path, content_type: str) -> None:
        self.objects[url_] = path.read_bytes()
        self.types[url_] = content_type

    def get(self, url_: str, limit: int) -> bytes:
        data = self.objects[url_]
        assert len(data) <= limit
        return data


# ── A. the schema ─────────────────────────────────────────────────────

def test_each_stage_parses():
    assert set(parse_content_job(cjob()).outputs) == set(BUILD_FILES)
    f = parse_content_job(cjob("PREVIEW_360_FRAMES"))
    assert f.chunk == (0, 4) and set(f.outputs) == {"f0000", "f0001", "f0002", "f0003"}
    a = parse_content_job(cjob("PREVIEW_360_ASSEMBLE"))
    assert set(a.outputs) == set(ASSEMBLE_FILES) and len(a.inputs["frames"]) == 8


@pytest.mark.parametrize("stage, mutate, why", [
    ("PREVIEW_360_BUILD", lambda j: j.update(asset="HUMAN"), "asset"),
    ("PREVIEW_360_BUILD", lambda j: j.update(version="../v001"), "version"),
    ("PREVIEW_360_BUILD", lambda j: j.update(stage="PREVIEW_360"), "stage"),
    ("PREVIEW_360_BUILD", lambda j: j.update(stage="RUN_SCRIPT"), "stage"),
    ("PREVIEW_360_BUILD", lambda j: j.update(script="import os"), "unknown field"),
    ("PREVIEW_360_BUILD", lambda j: j["render"].update(samples=100000), "render.samples"),
    ("PREVIEW_360_BUILD", lambda j: j["render"].update(frames=True), "render.frames"),
    ("PREVIEW_360_BUILD", lambda j: j["render"].update(size=720.0), "render.size"),
    ("PREVIEW_360_BUILD", lambda j: j["limits"].update(deadlineS=1500), "deadlineS"),
    ("PREVIEW_360_BUILD", lambda j: j.update(chunk={"start": 0, "count": 1}), "chunk"),
    ("PREVIEW_360_BUILD", lambda j: j.update(inputs={}), "inputs"),
    ("PREVIEW_360_BUILD", lambda j: j["outputs"].pop("build"), "outputs: exactly"),
    ("PREVIEW_360_BUILD", lambda j: j["outputs"].update(blend="https://evil.example.com/" + PREFIX + "a.blend"), "storage endpoint"),
    ("PREVIEW_360_BUILD", lambda j: j["outputs"].update(glb=f"{HOST}design-studio/catalog/public/models/x.glb"), "inside"),
    ("PREVIEW_360_BUILD", lambda j: j["outputs"].update(glb=url("x.glb", "homatch-content/3D/characters/HOMI/versions/v002/")), "inside"),
    ("PREVIEW_360_BUILD", lambda j: j["outputs"].update(glb=url("../../../../design-studio/x.glb")), "inside"),
    ("PREVIEW_360_BUILD", lambda j: j["outputs"].update(glb=url("models/%2e%2e/%2e%2e/x.glb")), "inside"),
    ("PREVIEW_360_BUILD", lambda j: j["outputs"].update(glb=url("models/HOMI.blend")), "inside"),
    ("PREVIEW_360_FRAMES", lambda j: j.update(chunk={"start": 6, "count": 4}), "past the last frame"),
    ("PREVIEW_360_FRAMES", lambda j: j.update(chunk={"start": 0, "count": 25}), "chunk.count"),
    ("PREVIEW_360_FRAMES", lambda j: j.pop("chunk"), "chunk"),
    ("PREVIEW_360_FRAMES", lambda j: j["outputs"].update(f0007=url(frame_rel(7))), "outputs: exactly"),
    ("PREVIEW_360_ASSEMBLE", lambda j: j["inputs"]["frames"].pop("f0003"), "one URL per turntable frame"),
    ("PREVIEW_360_ASSEMBLE", lambda j: j["inputs"].update(build=f"{HOST}design-studio/x.json"), "inside"),
    ("PREVIEW_360_ASSEMBLE", lambda j: j["inputs"]["frames"].update(f0000="https://evil.example.com/" + PREFIX + "f.png"), "storage endpoint"),
])
def test_a_malformed_content_job_is_refused(stage, mutate, why):
    j = copy.deepcopy(cjob(stage))
    mutate(j)
    with pytest.raises(JobError, match=re.escape(why)):
        parse_content_job(j)


# ── B. isolation from the scene factory ───────────────────────────────

def test_a_content_job_never_reaches_the_scene_factory(monkeypatch):
    monkeypatch.setattr(factory_pipeline, "run_job", lambda *a, **k: pytest.fail("the scene factory ran a content job"))
    monkeypatch.setattr("worker.handler.tools", lambda: {"blender": "x", "gltf_transform": None, "node": None, "ktx": None})
    seen = {}
    monkeypatch.setattr(content_pipeline, "run_content_job", lambda job, t, **k: seen.setdefault("job", job) and {"kind": "CONTENT_STUDIO"})
    out = handle({"input": {"contentStudio": cjob()}})
    assert out["ok"] is True and seen["job"].asset == "HOMI"


def test_a_content_job_cannot_smuggle_factory_fields(monkeypatch):
    monkeypatch.setattr(content_pipeline, "run_content_job", lambda *a, **k: pytest.fail("ran a mixed payload"))
    out = handle({"input": {"contentStudio": cjob(), "jobId": UUID, "spec": {}}})
    assert out["ok"] is False and out["error"].startswith("INVALID_JOB")


def test_an_invalid_content_job_is_refused_before_blender(monkeypatch):
    monkeypatch.setattr(content_pipeline, "run_blender", lambda *a, **k: pytest.fail("Blender ran on an invalid job"))
    out = handle({"input": {"contentStudio": cjob(stage="EVERYTHING")}})
    assert out["ok"] is False and "stage" in out["error"]


def test_factory_jobs_are_unchanged_by_the_content_route():
    assert handle({"input": {"jobId": "nope"}})["error"].startswith("INVALID_JOB: jobId")


def test_the_content_build_executes_only_its_own_code():
    """Same rule as the factory: no eval/exec/compile/dynamic import/shell in the Blender script or the schema."""
    banned = re.compile(r"(?<![\w.])(eval|exec|compile|__import__)\s*\(|\b(importlib|os\.system|os\.popen|subprocess|pickle|marshal)\b")
    files = [*(WORKER / "content" / "homi").glob("*.py"), WORKER / "content" / "schema.py"]
    assert len(files) >= 2
    for f in files:
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if banned.search(line.split("#", 1)[0]):
                pytest.fail(f"{f.name}:{i}: {line.strip()}")


# ── C. failure handling ───────────────────────────────────────────────

def test_a_failed_build_leaves_no_temporary_files_and_no_url_in_the_error(monkeypatch, tmp_path):
    made = []
    real = content_pipeline.tempfile.mkdtemp

    def spy(**k):
        d = real(dir=tmp_path, **k)
        made.append(Path(d))
        return d
    monkeypatch.setattr(content_pipeline.tempfile, "mkdtemp", spy)

    def boom(*a, **k):
        raise RuntimeError("blender: exit 1")
    monkeypatch.setattr(content_pipeline, "run_blender", boom)
    monkeypatch.setattr("worker.handler.tools", lambda: {"blender": "x", "gltf_transform": None, "node": None, "ktx": None})
    out = handle({"input": {"contentStudio": cjob()}})
    assert out["ok"] is False and out["error"].startswith("CONTENT_FAILED")
    assert "secret-signature" not in json.dumps(out)
    assert made and not any(d.exists() for d in made)


def test_network_failures_never_echo_the_signed_url(tmp_path, monkeypatch):
    import requests

    def fail(*a, **k):
        raise requests.ConnectionError(f"Max retries exceeded with url: {url('x.glb')}")
    monkeypatch.setattr(content_pipeline.requests, "put", fail)
    monkeypatch.setattr(content_pipeline.requests, "get", fail)
    f = tmp_path / "a.glb"
    f.write_bytes(b"glTF")
    for call in (lambda: content_pipeline.Transfer().put(url("x.glb"), f, "model/gltf-binary"), lambda: content_pipeline.Transfer().get(url("x.png"), 10)):
        with pytest.raises(RuntimeError) as e:
            call()
        assert "secret-signature" not in str(e.value) and "cloudflarestorage" not in str(e.value)


def test_a_silently_hanging_blender_is_killed_at_the_deadline(monkeypatch, tmp_path):
    import subprocess
    import sys
    import time

    real = subprocess.Popen
    # a "Blender" that prints nothing and never ends: only a watchdog can stop it
    monkeypatch.setattr(content_pipeline.subprocess, "Popen", lambda args, **k: real([sys.executable, "-c", "import time; time.sleep(60)"], **k))
    t0 = time.monotonic()
    with pytest.raises(RuntimeError, match="deadline"):
        content_pipeline.run_blender("blender", tmp_path / "p.json", timeout=2)
    assert time.monotonic() - t0 < 20


def test_assemble_refuses_an_input_that_is_not_a_png(monkeypatch):
    r2 = FakeR2()
    r2.objects[url(BUILD_FILES["build"])] = json.dumps({"asset": "HOMI", "version": "v001", "files": {}, "geometry": {"triangles": 1}, "worker": {"blender": "x"}, "checks": {}}).encode()
    r2.objects[url(BUILD_FILES["face"])] = TINY_PNG
    for i in range(8):
        r2.objects[url(frame_rel(i))] = TINY_PNG
    r2.objects[url(frame_rel(2))] = b"<html>not a png</html>"
    monkeypatch.setattr(content_pipeline, "run_blender", lambda *a, **k: pytest.fail("Blender ran on an unchecked input"))
    with pytest.raises(RuntimeError, match="f0002: not a PNG"):
        content_pipeline.run_content_job(parse_content_job(cjob("PREVIEW_360_ASSEMBLE")), {"blender": "x"}, transfer=r2)


def test_assemble_refuses_another_versions_build_report(monkeypatch):
    r2 = FakeR2()
    r2.objects[url(BUILD_FILES["build"])] = json.dumps({"asset": "HOMI", "version": "v002"}).encode()
    monkeypatch.setattr(content_pipeline, "run_blender", lambda *a, **k: pytest.fail("Blender ran"))
    with pytest.raises(RuntimeError, match="not this asset version"):
        content_pipeline.run_content_job(parse_content_job(cjob("PREVIEW_360_ASSEMBLE")), {"blender": "x"}, transfer=r2)


# ── D. a real build ───────────────────────────────────────────────────

@needs_blender
def test_homi_builds_in_chunks_and_assembles_for_real():
    r2 = FakeR2()
    tools = {"blender": blender_path()}
    cpu = {"deadlineS": 300, "device": "CPU"}
    b = content_pipeline.run_content_job(parse_content_job(cjob(limits=cpu)), tools, transfer=r2)
    assert set(b["outputs"]) == set(BUILD_FILES) and b["geometry"]["objects"] > 100
    for start in (0, 4):
        job = cjob("PREVIEW_360_FRAMES", chunk={"start": start, "count": 4}, outputs={f"f{i:04d}": url(frame_rel(i)) for i in range(start, start + 4)}, limits=cpu)
        content_pipeline.run_content_job(parse_content_job(job), tools, transfer=r2)
    a = content_pipeline.run_content_job(parse_content_job(cjob("PREVIEW_360_ASSEMBLE", limits=cpu)), tools, transfer=r2)
    assert set(a["outputs"]) == set(ASSEMBLE_FILES)

    blend, glb = r2.objects[url(BUILD_FILES["blend"])], r2.objects[url(BUILD_FILES["glb"])]
    assert glb[:4] == b"glTF" and r2.types[url(BUILD_FILES["glb"])] == "model/gltf-binary"
    assert blend[:7] == b"BLENDER" or blend[:4] == b"\x28\xb5\x2f\xfd"  # plain or zstd-compressed .blend
    mp4, sheet = r2.objects[url(ASSEMBLE_FILES["turntable"])], r2.objects[url(ASSEMBLE_FILES["contactSheet"])]
    assert mp4[4:8] == b"ftyp" and sheet[:8] == b"\x89PNG\r\n\x1a\n"
    m = json.loads(r2.objects[url(ASSEMBLE_FILES["manifest"])])
    for name, rel in {**BUILD_FILES, **ASSEMBLE_FILES}.items():
        if name in ("build", "manifest"):
            continue
        data = r2.objects[url(rel)]
        assert m["files"][name]["sha256"] == hashlib.sha256(data).hexdigest() and m["files"][name]["bytes"] == len(data), name
    g = m["geometry"]
    assert g["objects"] > 100 and 1.6 < g["height_m"] < 1.85 and abs(g["bbox_min"][2]) < 1e-3
    assert m["checks"]["glbReimport"]["meshes"] == g["objects"] and m["checks"]["blendReopen"]["missing_files"] == []
    assert "HOMI_Leg_Foot_L" in g["inferred"] and "HOMI_Head_Visor" not in g["inferred"]
