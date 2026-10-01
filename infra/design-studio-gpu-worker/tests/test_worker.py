"""The GPU worker without a GPU: schema, security, crops, and the whole pipeline with the mock generator.

The Blender stage runs for real when a Blender binary is available
(HM_BLENDER, or `blender` on PATH, or the Windows default install);
otherwise those tests are skipped and say so.
"""
from __future__ import annotations

import json
import os
import shutil
import struct
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from worker import pipeline as pipeline_mod
from worker.imaging import BoxSegmenter, object_rgba
from worker.models import MockGenerator
from worker.schema import Job, JobError, ObjectJob, parse_job

R2 = "https://abc123.r2.cloudflarestorage.com/homatch-storage/users/u/design-studio-models/p/x.glb?X-Amz-Signature=s"
UUID = "123e4567-e89b-42d3-a456-426614174000"


def blender_path() -> str | None:
    for c in (os.environ.get("HM_BLENDER"), shutil.which("blender"), r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"):
        if c and Path(c).exists():
            return c
    return None


def good(**over):
    job = {
        "jobId": UUID, "image": {"url": R2, "sha256": None},
        "objects": [{"key": "sofa", "type": "SOFA", "crop": [0.1, 0.1, 0.5, 0.5], "tight": [0.15, 0.15, 0.45, 0.45],
                     "sizeM": {"width": 2.6, "depth": 0.95, "height": 0.75}, "outputs": {"glb": R2}}],
        "limits": {"maxTriangles": 40000, "textureSize": 1024, "deadlineS": 900}, "model": "mock",
    }
    job.update(over)
    return job


def test_a_good_job_parses():
    j = parse_job(good())
    assert j.objects[0].size_m == (2.6, 0.95, 0.75) and j.model == "mock"


@pytest.mark.parametrize("mutate,why", [
    (lambda j: j.update(jobId="x"), "jobId"),
    (lambda j: j["image"].update(url="https://evil.example.com/x.jpg"), "only the storage endpoint"),
    (lambda j: j["image"].update(url="http://abc.r2.cloudflarestorage.com/x"), "https"),
    (lambda j: j["objects"][0].update(key="../../etc"), "key"),
    (lambda j: j["objects"][0].update(type="WARDROBE"), "generatable"),
    (lambda j: j["objects"][0].update(crop=[0.5, 0.1, 0.4, 0.5]), "left < right"),
    (lambda j: j["objects"][0]["outputs"].update(glb="https://attacker.r2.dev/x"), "storage endpoint"),
    (lambda j: j.update(objects=[]), "objects"),
    (lambda j: j.update(model="some-unlicensed-model"), "approved"),
    (lambda j: j.update(limits={"maxTriangles": 5_000_000}), "limits"),
])
def test_a_bad_job_is_refused_not_repaired(mutate, why):
    j = good()
    mutate(j)
    with pytest.raises(JobError, match=why):
        parse_job(j)


def test_too_many_objects_is_refused():
    o = good()["objects"][0]
    with pytest.raises(JobError):
        parse_job(good(objects=[{**o, "key": f"k{i}"} for i in range(17)]))


def test_the_crop_is_the_object_alone_rgba_and_square():
    img = Image.new("RGB", (800, 600), (240, 240, 240))
    img.paste((30, 140, 130), (200, 150, 400, 300))  # a teal "sofa"
    rgba, cov = object_rgba(img, (0.2, 0.2, 0.55, 0.55), (0.25, 0.25, 0.5, 0.5), BoxSegmenter(), size=256)
    assert rgba.mode == "RGBA" and rgba.size == (256, 256)
    a = np.asarray(rgba)[..., 3]
    assert 0.05 < cov < 0.95 and a.max() == 255 and a[0, 0] == 0


def fake_job(tmp: Path) -> Job:
    return Job(job_id=UUID, image_url=R2, image_sha256=None, objects=(
        ObjectJob(key="sofa", type="SOFA", crop=(0.2, 0.2, 0.55, 0.55), tight=(0.25, 0.25, 0.5, 0.5), size_m=(2.6, 0.95, 0.75), put_url=R2),
        ObjectJob(key="chair", type="CHAIR", crop=(0.6, 0.6, 0.7, 0.7), tight=(0.62, 0.62, 0.68, 0.68), size_m=(0.5, 0.5, 0.8), put_url=R2),
    ), model="mock")


@pytest.fixture
def offline(monkeypatch, tmp_path):
    img = Image.new("RGB", (800, 600), (240, 240, 240))
    img.paste((30, 140, 130), (200, 150, 400, 300))
    img.paste((240, 120, 30), (500, 380, 540, 420))
    uploads = {}
    monkeypatch.setattr(pipeline_mod, "download_image", lambda url, sha: img)
    monkeypatch.setattr(pipeline_mod, "upload", lambda url, path: uploads.setdefault(path.name, path.read_bytes()))
    return uploads


@pytest.mark.skipif(blender_path() is None, reason="no Blender binary available")
def test_the_whole_pipeline_runs_and_cleans_up(offline):
    out = pipeline_mod.run_job(fake_job(Path(".")), MockGenerator(), BoxSegmenter(), {"blender": blender_path(), "gltf_transform": None})
    assert [o["ok"] for o in out["objects"]] == [True, True], json.dumps(out, indent=1)
    sofa = out["objects"][0]
    # Normalised to the seen size: width along X, depth, height.
    w, d, h = sofa["dims_m"]
    assert abs(w - 2.6) / 2.6 < 0.05 and abs(d - 0.95) / 0.95 < 0.08 and abs(h - 0.75) / 0.75 < 0.08, sofa["dims_m"]
    # A chair-sized model asked to be a chair: each axis within the ±35 % bound of one uniform scale (never stretched into a caricature).
    cw, cd, ch = out["objects"][1]["dims_m"]
    assert max(cw, cd, ch) / min(cw / 0.5, cd / 0.5, ch / 0.8) <= 0.8 * 1.36 / 0.65 + 1e-6
    assert sofa["sha256"] and sofa["bytes"] == len(offline["sofa.glb"])
    # Everything intermediate is gone; only the final GLBs were uploaded.
    assert out["temporaryDirRemoved"] is True and out["temporaryBytesDeleted"] > 0
    assert sorted(offline) == ["chair.glb", "sofa.glb"]
    for t in ("download", "total"):
        assert t in out["timings"]


@pytest.mark.skipif(blender_path() is None, reason="no Blender binary available")
def test_the_piece_faces_homatch_front_and_stands_on_the_floor(offline):
    pipeline_mod.run_job(fake_job(Path(".")), MockGenerator(), BoxSegmenter(), {"blender": blender_path(), "gltf_transform": None})
    import trimesh

    scene = trimesh.load(file_obj=__import__("io").BytesIO(offline["sofa.glb"]), file_type="glb", force="mesh")
    v = scene.vertices
    assert abs(v[:, 1].min()) < 1e-3, "lowest point on the floor (glTF Y-up)"
    assert abs((v[:, 0].min() + v[:, 0].max()) / 2) < 1e-3 and abs((v[:, 2].min() + v[:, 2].max()) / 2) < 1e-3, "footprint centred"
    # The back (the high part) is at +Z: the front faces -Z, HOMATCH's convention.
    high = v[v[:, 1] > v[:, 1].max() * 0.75]
    assert high[:, 2].mean() > 0, high[:, 2].mean()


def test_one_object_failing_does_not_fail_the_apartment(offline, monkeypatch):
    calls = {"n": 0}

    class Flaky(MockGenerator):
        def generate(self, rgba, seed, out_glb, texture_size):
            calls["n"] += 1
            raise RuntimeError("GPU out of memory")

    monkeypatch.setattr(pipeline_mod, "blender_normalize", lambda *a, **k: {"dimsM": [1, 1, 1]})
    out = pipeline_mod.run_job(fake_job(Path(".")), Flaky(), BoxSegmenter(), {"blender": "x", "gltf_transform": None})
    assert [o["ok"] for o in out["objects"]] == [False, False]
    assert all(o["attempts"] == pipeline_mod.RETRIES + 1 for o in out["objects"]), "bounded retries"
    assert calls["n"] == 2 * (pipeline_mod.RETRIES + 1)
    assert out["temporaryDirRemoved"] is True and offline == {}, "nothing uploaded for failed objects"


def test_an_empty_mask_is_a_failed_object_not_a_hallucinated_one(offline, monkeypatch):
    class Nothing(BoxSegmenter):
        def mask(self, crop, prompt_box):
            return np.zeros((crop.size[1], crop.size[0]), dtype=bool)

    out = pipeline_mod.run_job(fake_job(Path(".")), MockGenerator(), Nothing(), {"blender": "x", "gltf_transform": None})
    assert all(not o["ok"] and "mask is empty" in o["error"] for o in out["objects"])


def test_the_deadline_stops_new_objects(offline, monkeypatch):
    t = {"now": 0.0}

    def clock():
        t["now"] += 400.0  # every call jumps 400 s
        return t["now"]

    monkeypatch.setattr(pipeline_mod, "blender_normalize", lambda *a, **k: {"dimsM": [1, 1, 1]})
    job = fake_job(Path("."))
    out = pipeline_mod.run_job(job, MockGenerator(), BoxSegmenter(), {"blender": "x", "gltf_transform": None}, now=clock)
    assert any(o["error"] == "deadline" for o in out["objects"])


def test_the_trellis_config_cannot_load_the_non_commercial_background_remover(tmp_path, monkeypatch):
    # The baked config must route background removal to the refusing stub; anything else is refused at load.
    cfg = {"args": {"rembg_model": {"name": "BiRefNet", "args": {"model_name": "briaai/RMBG-2.0"}}}}
    (tmp_path / "trellis2").mkdir()
    (tmp_path / "trellis2" / "pipeline.json").write_text(json.dumps(cfg))
    from worker import prepare_models

    patched = prepare_models.route_rembg_to_stub(cfg)
    assert patched["args"]["rembg_model"] == {"name": "Refused", "args": {}}
    assert "RMBG" not in json.dumps(patched)


def test_glb_facts_read_from_bytes(tmp_path):
    import trimesh

    p = tmp_path / "b.glb"
    trimesh.creation.box().export(p)
    from worker.optimize import facts

    f = facts(p)
    assert f["triangles"] == 12 and f["textures"] == 0 and f["compressed"] is True
    with open(p, "rb") as fh:
        assert fh.read(4) == b"glTF"
    assert struct.unpack_from("<I", p.read_bytes(), 12)[0] > 0
