"""Content Studio (HOMI) jobs on the scene-factory worker: allowlisted schema, isolation from the factory,
no code from the job, cleanup, and a real Blender build of HOMI when Blender is installed."""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path

import pytest

from worker import pipeline as factory_pipeline
from worker.content import pipeline as content_pipeline
from worker.content.schema import parse_content_job
from worker.handler import handle
from worker.schema import JobError

from test_worker import UUID, WORKER, blender_path, needs_blender

HOST = "https://abc123.r2.cloudflarestorage.com/homatch-storage/"
PREFIX = "homatch-content/3D/characters/HOMI/versions/v001/"
FILES = {"blend": "blender/HOMI_MASTER_v001.blend", "glb": "models/HOMI_MODEL_v001.glb", "turntable": "previews/HOMI_TURNTABLE_360_v001.mp4",
         "contactSheet": "previews/HOMI_CONTACT_SHEET_v001.png", "face": "previews/HOMI_FACE_v001.png", "manifest": "manifest/HOMI_ASSET_MANIFEST_v001.json"}


def url(rel: str, prefix: str = PREFIX) -> str:
    return f"{HOST}{prefix}{rel}?X-Amz-Signature=secret-signature"


def cjob(**over) -> dict:
    j = {"jobId": UUID, "asset": "HOMI", "version": "v001", "stage": "PREVIEW_360",
         "render": {"size": 512, "samples": 4, "frames": 8, "fps": 8},
         "outputs": {k: url(v) for k, v in FILES.items()}, "limits": {"deadlineS": 900, "device": "AUTO"}}
    j.update(over)
    return j


# ── A. the schema ─────────────────────────────────────────────────────

def test_a_good_content_job_parses():
    j = parse_content_job(cjob())
    assert (j.asset, j.version, j.stage, j.frames) == ("HOMI", "v001", "PREVIEW_360", 8) and set(j.outputs) == set(FILES)


@pytest.mark.parametrize("mutate, why", [
    (lambda j: j.update(asset="HUMAN"), "asset"),
    (lambda j: j.update(version="v1"), "version"),
    (lambda j: j.update(version="../v001"), "version"),
    (lambda j: j.update(stage="RUN_SCRIPT"), "stage"),
    (lambda j: j.update(jobId="x"), "jobId"),
    (lambda j: j.update(script="import os"), "unknown field"),
    (lambda j: j["render"].update(samples=100000), "render.samples"),
    (lambda j: j["render"].update(frames=True), "render.frames"),
    (lambda j: j["render"].update(size=4096), "render.size"),
    (lambda j: j["render"].update(python="x"), "render:"),
    (lambda j: j["limits"].update(deadlineS=99999), "deadlineS"),
    (lambda j: j["limits"].update(shell="x"), "limits:"),
    (lambda j: j["outputs"].pop("manifest"), "outputs: exactly"),
    (lambda j: j["outputs"].update(extra=url("x.blend")), "outputs: exactly"),
    (lambda j: j["outputs"].update(blend="https://evil.example.com/" + PREFIX + "a.blend"), "storage endpoint"),
    (lambda j: j["outputs"].update(blend="http://abc123.r2.cloudflarestorage.com/b/" + PREFIX + "a.blend"), "storage endpoint"),
    # aimed outside the version's prefix: Design Studio's objects, another version, another asset, traversal
    (lambda j: j["outputs"].update(glb=f"{HOST}design-studio/catalog/public/models/x.glb"), "inside"),
    (lambda j: j["outputs"].update(glb=url("models/HOMI_MODEL.glb", "homatch-content/3D/characters/HOMI/versions/v002/")), "inside"),
    (lambda j: j["outputs"].update(glb=url("x.glb", "homatch-content/3D/characters/HUMAN/versions/v001/")), "inside"),
    (lambda j: j["outputs"].update(glb=url("../../../../design-studio/x.glb")), "inside"),
    (lambda j: j["outputs"].update(glb=url("models/%2e%2e/%2e%2e/x.glb")), "inside"),
    (lambda j: j["outputs"].update(glb=url("models/HOMI.blend")), "inside"),
])
def test_a_malformed_content_job_is_refused(mutate, why):
    j = copy.deepcopy(cjob())
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


def test_a_network_failure_on_upload_never_echoes_the_signed_url(tmp_path, monkeypatch):
    import requests

    def fail(*a, **k):
        raise requests.ConnectionError(f"Max retries exceeded with url: {url('x.glb')}")
    monkeypatch.setattr(content_pipeline.requests, "put", fail)
    f = tmp_path / "a.glb"
    f.write_bytes(b"glTF")
    with pytest.raises(RuntimeError) as e:
        content_pipeline.Uploader().put(url("x.glb"), f, "model/gltf-binary")
    assert "secret-signature" not in str(e.value) and "cloudflarestorage" not in str(e.value)


# ── D. a real build ───────────────────────────────────────────────────

class Capture:
    def __init__(self):
        self.puts = {}

    def put(self, url_: str, path: Path, content_type: str) -> None:
        self.puts[url_] = (path.read_bytes(), content_type)


@needs_blender
def test_homi_builds_renders_exports_and_reports_for_real():
    cap = Capture()
    job = parse_content_job(cjob(limits={"deadlineS": 900, "device": "CPU"}))
    out = content_pipeline.run_content_job(job, {"blender": blender_path()}, uploader=cap, revision=None)
    assert out["kind"] == "CONTENT_STUDIO" and set(out["outputs"]) == set(FILES)
    by_name = {name: cap.puts[url(rel)] for name, rel in FILES.items()}
    blend, glb, mp4, sheet, face, manifest = (by_name[k] for k in ("blend", "glb", "turntable", "contactSheet", "face", "manifest"))
    assert glb[0][:4] == b"glTF" and glb[1] == "model/gltf-binary"
    assert blend[0][:7] == b"BLENDER" or blend[0][:4] == b"\x28\xb5\x2f\xfd"  # plain or zstd-compressed .blend
    assert mp4[0][4:8] == b"ftyp" and sheet[0][:8] == b"\x89PNG\r\n\x1a\n" and face[0][:8] == b"\x89PNG\r\n\x1a\n"
    m = json.loads(manifest[0])
    for name in ("blend", "glb", "turntable", "contactSheet", "face"):
        assert m["files"][name]["sha256"] == hashlib.sha256(by_name[name][0]).hexdigest()
        assert m["files"][name]["bytes"] == len(by_name[name][0])
    g = m["geometry"]
    assert g["objects"] > 100 and 1.6 < g["height_m"] < 1.85 and abs(g["bbox_min"][2]) < 1e-3
    assert m["checks"]["glbReimport"]["meshes"] == g["objects"] and m["checks"]["blendReopen"]["missing_files"] == []
    assert "HOMI_Leg_Foot_L" in g["inferred"] and "HOMI_Head_Visor" not in g["inferred"]


def test_a_float_size_is_refused():
    j = cjob()
    j["render"]["size"] = 720.0
    with pytest.raises(JobError, match="render.size"):
        parse_content_job(j)


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
