"""The Blender scene factory and its worker: spec, security, a real Blender build, outputs, failure handling.

Blender runs for real when a binary is available (HM_BLENDER, `blender` on
PATH, or the Windows default install); the glTF toolchain and the Khronos
validator run when installed (HM_GLTF_TRANSFORM / gltf-transform on PATH, and
NODE_PATH with gltf-validator). A test that needs a missing tool is skipped
and says which tool.
"""
from __future__ import annotations

import copy
import io
import json
import math
import os
import re
import shutil
import struct
import tempfile
from pathlib import Path

import pytest
from PIL import Image

from worker import pipeline as pipeline_mod
from worker.handler import handle
from worker.optimize import glb_json
from worker.schema import JobError, parse_job
from worker.spec import SpecError, validate_spec

HERE = Path(__file__).resolve().parent
WORKER = HERE.parent / "worker"
SPEC = json.loads((HERE / "fixtures" / "apartment.spec.json").read_text())
R2 = "https://abc123.r2.cloudflarestorage.com/homatch-storage/users/u/design-studio-models/p/x.glb?X-Amz-Signature=s"
UUID = "123e4567-e89b-42d3-a456-426614174000"


def blender_path() -> str | None:
    for c in (os.environ.get("HM_BLENDER"), shutil.which("blender"), r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"):
        if c and Path(c).exists():
            return c
    return None


def gltf_transform() -> str | None:
    return os.environ.get("HM_GLTF_TRANSFORM") or shutil.which("gltf-transform")


needs_blender = pytest.mark.skipif(blender_path() is None, reason="Blender is not installed here")


def spec(**over) -> dict:
    s = copy.deepcopy(SPEC)
    s["render"] = {"width": 360, "height": 258, "samples": 4}
    s.update(over)
    return s


def groups(s: dict) -> list[str]:
    return sorted({o["group"] for o in s["objects"] if o["runtime"] and o["group"]})


def job(s: dict | None = None, **over) -> dict:
    s = s or spec()
    j = {
        "jobId": UUID, "spec": s, "inputs": {"textures": {}, "models": {}},
        "outputs": {"render": R2, "scene": {"DESKTOP": R2, "MOBILE": R2}, "objects": {g: R2 for g in groups(s)}},
        "limits": {"deadlineS": 600, "textureSize": {"DESKTOP": 2048, "MOBILE": 1024}, "objectTextureSize": 1024, "device": "CPU"},
    }
    j.update(over)
    return j


# ── A. the spec ───────────────────────────────────────────────────────

def test_the_fixture_spec_is_valid_and_complete():
    v = validate_spec(SPEC)
    assert len(v["rooms"]) == 7 and len(v["walls"]) >= 10 and len(v["objects"]) >= 30
    assert any(r["outdoor"] for r in v["rooms"]), "the balcony is in the spec"
    assert sum(len(w["openings"]) for w in v["walls"]) >= 10


@pytest.mark.parametrize("mutate, why", [
    (lambda s: s.update(version="hm-scene-0"), "version"),
    (lambda s: s["objects"][0].update(kind="SPACESHIP"), "kind"),
    (lambda s: s["objects"][0].update(id="__import__('os').system('rm -rf /')"), "id"),
    (lambda s: s["objects"][0].update(at=[1e9, 0]), "number"),
    (lambda s: s["objects"][0].update(at=[float("nan"), 0]), "number"),
    (lambda s: s["objects"][0]["size"].update(w=True), "number"),
    (lambda s: s["objects"][0].update(colors={"body": "red"}), "colour"),
    (lambda s: s["objects"][0].update(colors={"Body; DROP": "#ffffff"}), "slot"),
    (lambda s: s["rooms"][0].update(floor="floor:nowhere"), "surface"),
    (lambda s: s["rooms"][0].update(polygon=[[0, 0], [1, 1]]), "3 points"),
    (lambda s: s["walls"][0].update(end=s["walls"][0]["start"]), "degenerate"),
    (lambda s: s["walls"][0]["openings"].append({"id": "x", "kind": "PORTAL", "offsetM": 0.5, "widthM": 0.4, "sillM": 0, "heightM": 1}), "allowed"),
    (lambda s: s.update(objects=s["objects"] * 10), "300"),
    (lambda s: s["surfaces"][0].update(material="not-declared"), "declared"),
    (lambda s: s["render"].update(width=99999), "render.width"),
])
def test_a_malicious_or_malformed_spec_is_refused(mutate, why):
    s = copy.deepcopy(SPEC)
    mutate(s)
    with pytest.raises(SpecError, match=re.escape(why) if why != "300" else "more than 300"):
        validate_spec(s)


def test_unknown_fields_never_reach_blender():
    s = copy.deepcopy(SPEC)
    s["script"] = "import os; os.system('id')"
    s["objects"][0]["python"] = "exec('1')"
    v = validate_spec(s)
    assert "script" not in v and "python" not in v["objects"][0]


def test_the_factory_executes_only_its_own_code():
    """No eval/exec/compile/dynamic import/shell anywhere in the factory or the spec reader."""
    banned = re.compile(r"(?<![\w.])(eval|exec|compile|__import__)\s*\(|\b(importlib|os\.system|os\.popen|subprocess|pickle|marshal)\b")
    allowed_import = re.compile(r"__import__\(\"mathutils\"\)")
    for f in [*(WORKER / "factory").glob("*.py"), WORKER / "spec.py"]:
        for i, line in enumerate(f.read_text().splitlines(), 1):
            code = line.split("#", 1)[0]
            if banned.search(code):
                pytest.fail(f"{f.name}:{i}: {line.strip()}")


# ── B. the job ────────────────────────────────────────────────────────

def test_a_good_job_parses():
    j = parse_job(job())
    assert j.render_url == R2 and set(j.scene_urls) == {"DESKTOP", "MOBILE"} and set(j.object_urls) == set(groups(spec()))


@pytest.mark.parametrize("mutate, why", [
    (lambda j: j.update(jobId="../../etc"), "jobId"),
    (lambda j: j["outputs"].update(render="https://evil.example.com/x"), "storage endpoint"),
    (lambda j: j["outputs"].update(render="http://abc.r2.cloudflarestorage.com/x"), "storage endpoint"),
    (lambda j: j["inputs"].update(textures={"mat-unknown": {"albedo": R2}}), "not a material"),
    (lambda j: j["inputs"].update(models={"x/y": R2}), "not a model"),
    (lambda j: j["outputs"].update(objects={"gextra": R2}), "one URL per walkthrough group"),
    (lambda j: j["outputs"].update(scene={"DESKTOP": R2}), "one URL per tier"),
    (lambda j: j["limits"].update(deadlineS=99999), "deadlineS"),
    (lambda j: j["limits"].update(device="TPU"), "device"),
    (lambda j: j["spec"].update(camera=None), "no camera"),
])
def test_a_bad_job_is_refused_not_repaired(mutate, why):
    j = job()
    mutate(j)
    with pytest.raises(JobError, match=why):
        parse_job(j)


def test_production_refuses_to_ship_unoptimised_models(monkeypatch):
    monkeypatch.delenv("HM_ALLOW_UNOPTIMIZED", raising=False)
    monkeypatch.setattr("worker.handler.tools", lambda: {"blender": "x", "gltf_transform": None, "node": None, "ktx": None})
    out = handle({"input": job()})
    assert out["ok"] is False and out["error"].startswith("TOOLCHAIN_MISSING")
    assert handle({"input": {"jobId": "nope"}})["error"].startswith("INVALID_JOB")


# ── C. a real Blender build ───────────────────────────────────────────

class FakeTransfer:
    def __init__(self, files: dict | None = None, fail_put: bool = False):
        self.files = files or {}
        self.puts: list[tuple[str, int, str, bytes]] = []
        self.fail_put = fail_put

    def get(self, url, limit):
        data = self.files[url]
        if len(data) > limit:
            raise JobError("input: too large")
        return data

    def put(self, url, data, content_type):
        if self.fail_put:
            raise RuntimeError("upload: HTTP 500")
        self.puts.append((url, len(data), content_type, data))


def tools() -> dict:
    return {"blender": blender_path(), "gltf_transform": gltf_transform(), "node": shutil.which("node")}


@pytest.fixture(scope="module")
def built():
    if blender_path() is None:
        pytest.skip("Blender is not installed here")
    tr = FakeTransfer()
    stages: list[str] = []
    # The factory's own export (positions exact); the optimisation toolchain is tested on its own below.
    out = pipeline_mod.run_job(parse_job(job()), {**tools(), "gltf_transform": None}, tr, progress=stages.append)
    out["_stages"] = stages
    return out, tr


def _glb_from(tr: FakeTransfer, ctype: str, nth: int = 0) -> dict:
    data = [p for p in tr.puts if p[2] == ctype][nth][3]
    length = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + length])


@needs_blender
def test_the_factory_builds_the_l_shaped_home_renders_and_exports(built):
    out, tr = built
    c = out["build"]["counts"]
    assert c["rooms"] == 7 and c["railings"] >= 1 and c["openings"] >= 10
    assert c["piecesFailed"] == 0 and c["pieces"] == len(SPEC["objects"])
    assert out["temporaryDirRemoved"] is True and out["temporaryBytesDeleted"] > 0
    assert out["attempts"] == 1
    kinds = {p[2] for p in tr.puts}
    assert kinds == {"image/jpeg", "model/gltf-binary"}


@needs_blender
def test_progress_is_the_factory_s_real_stages_in_order(built):
    out, _ = built
    assert out["_stages"] == ["ARCHITECTURE", "FURNISHING", "MATERIALS", "LIGHTING", "RENDERING", "EXPORTING", "OPTIMIZING"]


@needs_blender
def test_the_render_is_the_source_camera_at_the_spec_size_and_not_blank(built):
    out, tr = built
    jpg = next(p[3] for p in tr.puts if p[2] == "image/jpeg")
    im = Image.open(io.BytesIO(jpg))
    assert im.size == (360, 258) and im.format == "JPEG"
    assert out["outputs"]["render"]["bytes"] <= 2 * 1024 * 1024
    px = list(im.convert("L").getdata())
    mean = sum(px) / len(px)
    assert sum((v - mean) ** 2 for v in px) / len(px) > 50, "the home is in the picture, not an empty frame"


@needs_blender
def test_the_scene_keeps_semantic_names_and_places_every_piece_where_the_spec_says(built):
    _, tr = built
    gl = _glb_from(tr, "model/gltf-binary", 0)
    names = {n.get("name", "") for n in gl["nodes"]}
    floors = {n for n in names if n.startswith("floor:")}
    assert len(floors) == 7, "every room's floor, the L-shape included"
    assert any(n.startswith("wall:") for n in names) and any(n.startswith("window:") for n in names) and any(n.startswith("door:") for n in names)
    assert any(n.startswith("railing:") for n in names) and any(n.startswith("ceiling:") for n in names)
    by_name = {n.get("name"): n for n in gl["nodes"]}
    for o in SPEC["objects"]:
        node = by_name.get(f"obj:{o['id']}"[:63])
        assert node is not None, o["id"]
        t = node.get("translation", [0, 0, 0])
        # glTF is three.js's convention: (x, up, −north).
        assert abs(t[0] - o["at"][0]) < 1e-3 and abs(t[1] - o["elevationM"]) < 1e-3 and abs(t[2] + o["at"][1]) < 1e-3


@needs_blender
def test_identical_tiers_are_stored_once_and_every_walkthrough_group_is_delivered(built):
    out, tr = built
    sc = out["outputs"]["scene"]
    assert "DESKTOP" in sc and (sc["MOBILE"].get("sameAs") == "DESKTOP" or sc["MOBILE"]["sha256"] != sc["DESKTOP"]["sha256"])
    assert set(out["outputs"]["objects"]) == set(groups(spec()))
    assert all(v["ok"] for v in out["outputs"]["objects"].values())


@needs_blender
def test_a_walkthrough_piece_is_at_the_origin_front_toward_minus_z_and_sized_as_read(built):
    out, tr = built
    sofa = next(o for o in SPEC["objects"] if o["kind"] == "SOFA" and o["runtime"])
    sha = out["outputs"]["objects"][sofa["group"]]["sha256"]
    import hashlib

    data = next(p[3] for p in tr.puts if hashlib.sha256(p[3]).hexdigest() == sha)
    length = struct.unpack_from("<I", data, 12)[0]
    gl = json.loads(data[20:20 + length])
    node = gl["nodes"][gl["scenes"][0]["nodes"][0]]
    assert not node.get("translation") or max(abs(v) for v in node["translation"]) < 1e-4
    acc = gl["accessors"][gl["meshes"][node["mesh"]]["primitives"][0]["attributes"]["POSITION"]]
    lo, hi = acc["min"], acc["max"]
    mins = [min(gl["accessors"][p["attributes"]["POSITION"]]["min"][i] for p in gl["meshes"][node["mesh"]]["primitives"]) for i in range(3)]
    maxs = [max(gl["accessors"][p["attributes"]["POSITION"]]["max"][i] for p in gl["meshes"][node["mesh"]]["primitives"]) for i in range(3)]
    assert abs((maxs[0] - mins[0]) - sofa["size"]["w"]) < 0.01
    assert abs((maxs[1] - mins[1]) - sofa["size"]["h"]) < 0.01 and abs(mins[1]) < 0.01, "stands on the floor"
    assert abs((maxs[2] - mins[2]) - sofa["size"]["d"]) < 0.01
    assert lo and hi


@needs_blender
def test_catalogue_pbr_maps_become_textured_materials_that_survive_export(tmp_path):
    s = spec()
    s["outputs"] = {"render": False, "scene": True, "objects": False}
    for o in s["objects"]:
        o["runtime"] = False
        o["group"] = None
    mid = "mat-oak-test"
    s["materials"].append({"id": mid, "baseColor": "#b08a62", "roughness": 0.6, "metalness": 0.0, "tileM": [1.2, 1.2], "rotationDeg": 90, "normalScale": 1.0})
    floor_id = s["rooms"][0]["floor"]
    for sf in s["surfaces"]:
        if sf["id"] == floor_id:
            sf["material"] = mid
            sf["tint"] = "#a07850"
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (180, 140, 100)).save(buf, "PNG")
    files = {R2 + "&albedo": buf.getvalue(), R2 + "&normal": buf.getvalue()}
    j = job(s)
    j["inputs"]["textures"] = {mid: {"albedo": R2 + "&albedo", "normal": R2 + "&normal", "orm": None}}
    j["outputs"] = {"scene": {"DESKTOP": R2, "MOBILE": R2}}
    tr = FakeTransfer(files)
    out = pipeline_mod.run_job(parse_job(j), {**tools(), "gltf_transform": None}, tr)
    gl = _glb_from(tr, "model/gltf-binary")
    assert gl.get("images"), "the map is in the file"
    mats = [m for m in gl["materials"] if (m.get("pbrMetallicRoughness") or {}).get("baseColorTexture")]
    assert mats, "a material wears the albedo"
    tex = mats[0]["pbrMetallicRoughness"]["baseColorTexture"]
    assert "KHR_texture_transform" in (tex.get("extensions") or {}), "the tile size travels with it"
    assert mats[0].get("normalTexture"), "and the normal map"
    assert out["build"]["counts"]["texturedMaterials"] >= 1


@needs_blender
@pytest.mark.skipif(gltf_transform() is None or shutil.which("node") is None, reason="the glTF toolchain is not installed here")
def test_runtime_glbs_are_meshopt_compressed_and_pass_the_khronos_validator():
    out = pipeline_mod.run_job(parse_job(job()), tools(), FakeTransfer())
    d = out["outputs"]["scene"]["DESKTOP"]
    assert d["meshopt"] is True and d["validator"]["errors"] == 0
    for v in out["outputs"]["objects"].values():
        assert v["meshopt"] is True and v["validator"]["errors"] == 0


# ── D. failure handling ───────────────────────────────────────────────

@needs_blender
def test_a_failed_upload_leaves_no_temporary_files(monkeypatch):
    made: list[str] = []
    real = tempfile.mkdtemp

    def spy(*a, **k):
        d = real(*a, **k)
        made.append(d)
        return d

    monkeypatch.setattr(pipeline_mod.tempfile, "mkdtemp", spy)
    with pytest.raises(RuntimeError, match="upload"):
        pipeline_mod.run_job(parse_job(job()), tools(), FakeTransfer(fail_put=True))
    assert made and not Path(made[0]).exists()


def test_blender_is_retried_once_then_the_job_fails_with_the_reason(monkeypatch):
    calls = {"n": 0}

    def boom(*a, **k):
        calls["n"] += 1
        raise RuntimeError("factory: crashed")

    monkeypatch.setattr(pipeline_mod, "run_blender", boom)
    with pytest.raises(RuntimeError, match="crashed"):
        pipeline_mod.run_job(parse_job(job()), {"blender": "x"}, FakeTransfer())
    assert calls["n"] == pipeline_mod.RETRIES + 1 == 2


def test_the_deadline_stops_blender_from_starting(monkeypatch):
    t = {"now": 0.0}

    def clock():
        t["now"] += 400.0
        return t["now"]

    monkeypatch.setattr(pipeline_mod, "run_blender", lambda *a, **k: pytest.fail("Blender started past the deadline"))
    j = job()
    j["limits"]["deadlineS"] = 120
    with pytest.raises(RuntimeError, match="deadline"):
        pipeline_mod.run_job(parse_job(j), {"blender": "x"}, FakeTransfer(), now=clock)


def test_inputs_are_type_checked_before_blender(monkeypatch):
    s = spec()
    s["materials"].append({"id": "m1", "baseColor": "#ffffff", "roughness": 0.5, "metalness": 0.0, "tileM": [1, 1], "rotationDeg": 0, "normalScale": 1})
    j = job(s)
    j["inputs"]["textures"] = {"m1": {"albedo": R2 + "&a"}}
    monkeypatch.setattr(pipeline_mod, "run_blender", lambda *a, **k: pytest.fail("Blender ran on an unchecked input"))
    with pytest.raises(JobError, match="texture"):
        pipeline_mod.run_job(parse_job(j), {"blender": "x"}, FakeTransfer({R2 + "&a": b"#!/bin/sh\nrm -rf /\n"}))


def test_glb_json_reads_the_chunk(tmp_path):
    body = json.dumps({"asset": {"version": "2.0"}}).encode()
    body += b" " * ((4 - len(body) % 4) % 4)
    data = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(body)) + struct.pack("<II", len(body), 0x4E4F534A) + body
    p = tmp_path / "x.glb"
    p.write_bytes(data)
    assert glb_json(p)["asset"]["version"] == "2.0"


@needs_blender
def test_a_curved_sofa_is_a_curve_not_a_row_of_boxes():
    """A bend needs geometry to bend: the golden run's curved sofa came out as fragmented straight boxes."""
    s = spec()
    s["outputs"] = {"render": False, "scene": False, "objects": True}
    base = next(o for o in s["objects"] if o["kind"] == "SOFA")
    s["objects"] = [
        {**base, "id": "sofa-straight", "form": "STRAIGHT", "at": [2.0, 2.0], "runtime": True, "group": "gsofastraight"},
        {**base, "id": "sofa-curved", "form": "CURVED", "at": [5.0, 2.0], "runtime": True, "group": "gsofacurved"},
    ]
    tr = FakeTransfer()
    out = pipeline_mod.run_job(parse_job(job(s, outputs={"objects": {"gsofastraight": R2 + "&a", "gsofacurved": R2 + "&b"}})), {**tools(), "gltf_transform": None}, tr)
    def largest_gap(data: bytes) -> float:
        """The longest stretch of the piece's length with no vertex, as a share of it. A bend only curves
        what has vertices: a box with corners alone stays a flat chord between its ends."""
        length = struct.unpack_from("<I", data, 12)[0]
        gl = json.loads(data[20:20 + length])
        bin_start = 20 + length + 8
        pts = []
        for m in gl["meshes"]:
            for prim in m["primitives"]:
                acc = gl["accessors"][prim["attributes"]["POSITION"]]
                view = gl["bufferViews"][acc["bufferView"]]
                off = bin_start + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
                stride = view.get("byteStride", 12)
                pts += [struct.unpack_from("<3f", data, off + k * stride) for k in range(acc["count"])]
        xs = sorted({round(q[0], 4) for q in pts})
        return max(b - a for a, b in zip(xs, xs[1:])) / (xs[-1] - xs[0])

    gaps = {url[-1]: largest_gap(data) for url, _n, _ct, data in tr.puts}
    assert gaps["b"] < 0.12, f"a curved sofa has geometry along its whole length (largest empty span {gaps['b']:.2f})"
    assert out["outputs"]["objects"]["gsofacurved"]["ok"] is True


@needs_blender
def test_a_tint_balances_the_texture_and_exports_a_valid_factor():
    """The picture's colour is reached by balancing against the texture's real average (never the
    catalogue's placeholder base colour); the export keeps glTF's baseColorFactor within 1."""
    s = spec()
    s["outputs"] = {"render": False, "scene": True, "objects": False}
    for o in s["objects"]:
        o["runtime"] = False
        o["group"] = None
    mid = "mat-oak-dark"
    s["materials"].append({"id": mid, "baseColor": "#ffffff", "roughness": 1.0, "metalness": 0.0, "tileM": [1.5, 1.5], "rotationDeg": 0, "normalScale": 1.0})
    floor = s["rooms"][0]["floor"]
    for sf in s["surfaces"]:
        if sf["id"] == floor:
            sf["material"] = mid
            sf["tint"] = "#d9d1c2"
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (110, 80, 50)).save(buf, "PNG")  # a mid-brown oak, much darker than the pale floor seen
    j = job(s)
    j["inputs"]["textures"] = {mid: {"albedo": R2 + "&albedo", "normal": None, "orm": None}}
    j["outputs"] = {"scene": {"DESKTOP": R2, "MOBILE": R2}}
    tr = FakeTransfer({R2 + "&albedo": buf.getvalue()})
    pipeline_mod.run_job(parse_job(j), {**tools(), "gltf_transform": None}, tr)
    gl = _glb_from(tr, "model/gltf-binary")
    factors = [m["pbrMetallicRoughness"].get("baseColorFactor") for m in gl["materials"] if (m.get("pbrMetallicRoughness") or {}).get("baseColorTexture")]
    assert factors and all(f is None or max(f[:3]) <= 1.0 + 1e-6 for f in factors), factors
    if shutil.which("node") and os.environ.get("NODE_PATH"):
        p = Path(tempfile.mkdtemp()) / "scene.glb"
        p.write_bytes([x for x in tr.puts if x[2] == "model/gltf-binary"][0][3])
        import subprocess as sp

        r = sp.run([shutil.which("node"), str(WORKER / "validate.mjs"), str(p)], capture_output=True, text=True, check=False)
        assert json.loads(r.stdout)["errors"] == 0, r.stdout


# ── D. stairs, door leaves, the image revision ────────────────────────

STAIRS = json.loads((HERE / "fixtures" / "stairs.spec.json").read_text())
PARTS = json.loads((HERE / "fixtures" / "stairs.parts.json").read_text())


def test_stairs_and_leaves_are_read_and_absent_means_none():
    v = validate_spec(STAIRS)
    assert len(v["stairs"]) == 1 and v["stairs"][0]["treads"] == 15 and v["stairs"][0]["direction"] == "UP"
    leaves = {o["id"]: o["leaf"] for w in v["walls"] for o in w["openings"] if o["leaf"]}
    assert leaves == {"d-bed": "DOUBLE", "d-bath": "SLIDING", "d-hall": "HINGED", "win-bed": "FIXED"}
    plain = validate_spec(SPEC)
    assert plain["stairs"] == [] and all(o["leaf"] is None and o["swing"] is None for w in plain["walls"] for o in w["openings"])


@pytest.mark.parametrize("mutate, why", [
    (lambda s: s["stairs"][0].update(treads=2), "treads"),
    (lambda s: s["stairs"][0].update(treads=26), "treads"),
    (lambda s: s["stairs"][0].update(treads=12.5), "whole number"),
    (lambda s: s["stairs"][0].update(runM=0.2), "runM"),
    (lambda s: s["stairs"][0].update(riseM=9), "riseM"),
    (lambda s: s["stairs"][0].update(direction="SIDEWAYS"), "direction"),
    (lambda s: s["stairs"][0].update(b=s["stairs"][0]["a"]), "width"),
    (lambda s: s["stairs"][0].update(id="x y"), "id"),
    (lambda s: s.update(stairs=[dict(s["stairs"][0], id=f"s-{i}") for i in range(9)]), "more than 8"),
    (lambda s: s["stairs"].append(dict(s["stairs"][0])), "duplicate"),
    (lambda s: s.update(stairs="many"), "list"),
    (lambda s: next(w for w in s["walls"] if w["openings"])["openings"][0].update(leaf="REVOLVING"), "leaf"),
    (lambda s: next(w for w in s["walls"] if w["openings"])["openings"][0].update(swing="UP"), "swing"),
])
def test_a_malformed_stair_or_leaf_is_refused(mutate, why):
    s = copy.deepcopy(STAIRS)
    mutate(s)
    with pytest.raises(SpecError, match=re.escape(why)):
        validate_spec(s)


def test_stair_parts_match_the_walkthrough_exactly():
    """worker/stair_parts.py and src/lib/designStudio/stairParts.ts build the same staircase (shared fixture)."""
    from worker.stair_parts import stair_parts, stair_sides

    st = validate_spec(STAIRS)["stairs"][0]
    sides = stair_sides(st, validate_spec(STAIRS)["walls"])
    assert sides == (PARTS["sides"]["openA"], PARTS["sides"]["openB"])
    for got, want in ((stair_parts(st, *sides), PARTS["up"]), (stair_parts(dict(st, direction="DOWN"), True, True), PARTS["down"]),
                      (stair_parts(st, False, False), PARTS["walled"])):
        assert [p["kind"] for p in got] == [p["kind"] for p in want]
        for g, w in zip(got, want):
            for a, b in zip([*g["centre"], *g["size"], g["pitch"]], [*w["centre"], *w["size"], w["pitch"]]):
                assert abs(a - b) < 2e-4, (g, w)


def test_every_job_reports_the_image_revision_and_is_safe_without_it(monkeypatch):
    monkeypatch.setenv("HM_IMAGE_REVISION", "0123456789abcdef0123456789abcdef01234567")
    assert handle({"input": {"jobId": "nope"}})["worker"] == {"revision": "0123456789abcdef0123456789abcdef01234567"}
    monkeypatch.setenv("HM_IMAGE_REVISION", "not a sha; rm -rf /")
    assert handle({"input": {"jobId": "nope"}})["worker"] == {"revision": None}
    monkeypatch.delenv("HM_IMAGE_REVISION", raising=False)
    assert handle({"input": {"jobId": "nope"}})["worker"] == {"revision": None}


def test_the_image_bakes_its_revision_from_the_workflow():
    docker = (HERE.parent / "Dockerfile").read_text()
    assert "ARG HM_IMAGE_REVISION" in docker and "ENV HM_IMAGE_REVISION=${HM_IMAGE_REVISION}" in docker
    wf = (HERE.parents[2] / ".github" / "workflows" / "design-studio-gpu-worker-image.yml").read_text()
    assert "HM_IMAGE_REVISION=${{ github.sha }}" in wf


def _accessor_bounds(gl: dict, node: dict):
    mesh = gl["meshes"][node["mesh"]]
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for prim in mesh["primitives"]:
        acc = gl["accessors"][prim["attributes"]["POSITION"]]
        lo = [min(a, b) for a, b in zip(lo, acc["min"])]
        hi = [max(a, b) for a, b in zip(hi, acc["max"])]
    t = node.get("translation", [0, 0, 0])
    return [a + o for a, o in zip(lo, t)], [b + o for b, o in zip(hi, t)]


@pytest.fixture(scope="module")
def built_stairs():
    if blender_path() is None:
        pytest.skip("Blender is not installed here")
    s = copy.deepcopy(STAIRS)
    s["outputs"] = {"render": False, "scene": True, "objects": False}
    j = job(s)
    j["outputs"] = {"scene": {"DESKTOP": R2, "MOBILE": R2}}
    tr = FakeTransfer()
    out = pipeline_mod.run_job(parse_job(j), {**tools(), "gltf_transform": None}, tr)
    return out, _glb_from(tr, "model/gltf-binary")


@needs_blender
def test_the_factory_builds_a_staircase_inside_its_footprint(built_stairs):
    out, gl = built_stairs
    assert out["build"]["counts"]["stairs"] == 1
    by = {n.get("name", ""): n for n in gl["nodes"] if "mesh" in n}
    for role in ("wood", "paint", "metal", "well"):
        assert f"stair:s-1:{role}" in by, sorted(n for n in by if n.startswith("stair"))
    st = STAIRS["stairs"][0]
    # Footprint in plan: x 1..4, y 0.15..1.15; glTF is (x, up, -north).
    lo, hi = _accessor_bounds(gl, by["stair:s-1:wood"])
    assert 0.9 < lo[0] and hi[0] < 4.1, (lo, hi)
    assert -1.2 < lo[2] and hi[2] < -0.1, (lo, hi)
    assert lo[1] > -0.01 and abs(hi[1] - st["riseM"]) < 0.02, "the top tread is the upper floor; the rail stops below the ceiling"
    # Treads and risers: two boxes per step at least (8 vertices each, before bevels).
    wood_verts = sum(gl["accessors"][p["attributes"]["POSITION"]]["count"] for p in gl["meshes"][by["stair:s-1:wood"]["mesh"]]["primitives"])
    paint_verts = sum(gl["accessors"][p["attributes"]["POSITION"]]["count"] for p in gl["meshes"][by["stair:s-1:paint"]["mesh"]]["primitives"])
    assert wood_verts >= 15 * 8 and paint_verts >= (15 + 2) * 8


@needs_blender
def test_the_factory_hangs_door_leaves_by_how_they_close(built_stairs):
    _, gl = built_stairs
    names = [n.get("name", "") for n in gl["nodes"] if "mesh" in n]

    def parts_of(oid):
        return [n for n in names if n.startswith(f"door:{oid}:")]

    # Every door has its frame (two jambs and a head = 3 parts); leaves add to that.
    assert len(parts_of("d-bed")) == 3 + 4, "DOUBLE: two panelled leaves, each a slab and handles"
    assert len(parts_of("d-hall")) == 3 + 2, "HINGED: one leaf and its handles"
    assert len(parts_of("d-bath")) == 3 + 2, "SLIDING: one panel and its handles, slid along the wall"
    assert len(parts_of("d-entry")) == 3 + 2, "an undescribed door keeps one hinged leaf"
    assert any(n.startswith("window:win-bed:") for n in names), "a FIXED window keeps its glass"


def _verts(gl: dict, node: dict) -> int:
    return sum(gl["accessors"][p["attributes"]["POSITION"]]["count"] for p in gl["meshes"][node["mesh"]]["primitives"])


@needs_blender
def test_a_flight_cuts_its_hole_in_the_ceiling_going_up_and_the_floor_going_down(built_stairs):
    _, gl = built_stairs
    by = {n.get("name", ""): n for n in gl["nodes"] if "mesh" in n}
    assert _verts(gl, by["ceiling:r-living"]) > _verts(gl, by["ceiling:r-bed"]), "the living room's ceiling is cut over the flight"
    assert _verts(gl, by["floor:r-living"]) == _verts(gl, by["floor:r-bed"]), "an UP flight leaves the floor whole"
    s = copy.deepcopy(STAIRS)
    s["stairs"][0]["direction"] = "DOWN"
    s["outputs"] = {"render": False, "scene": True, "objects": False}
    j = job(s)
    j["outputs"] = {"scene": {"DESKTOP": R2, "MOBILE": R2}}
    tr = FakeTransfer()
    pipeline_mod.run_job(parse_job(j), {**tools(), "gltf_transform": None}, tr)
    down = _glb_from(tr, "model/gltf-binary")
    dby = {n.get("name", ""): n for n in down["nodes"] if "mesh" in n}
    assert _verts(down, dby["floor:r-living"]) > _verts(down, dby["floor:r-bed"]), "a DOWN flight opens the floor"
    lo, hi = _accessor_bounds(down, dby["stair:s-1:wood"])
    assert lo[1] < -2.0 and abs(hi[1]) < 1.2, "it descends below the floor; its rail rises above it"
    assert "stair:s-1:metal" in dby, "guarded round the well"


# ── E. planned views and their object maps ───────────────────────────

VIEWS = json.loads((HERE / "fixtures" / "apartment.views.json").read_text())


def views_spec() -> dict:
    s = spec()
    s["outputs"] = {"render": False, "scene": False, "objects": False}
    for o in s["objects"]:
        o["runtime"] = False
        o["group"] = None
    # The two views the TS side validates too (src/lib/designStudio/__tests__/factoryViews.test.mjs).
    s["views"] = copy.deepcopy(VIEWS)
    return s


def views_job(s: dict | None = None) -> dict:
    s = s or views_spec()
    j = job(s)
    j["outputs"] = {"views": {v["id"]: {"image": R2 + f"&{v['id']}-image", "ids": R2 + f"&{v['id']}-ids", "legend": R2 + f"&{v['id']}-legend"} for v in s["views"]}}
    return j


def test_planned_views_are_read_and_absent_means_none():
    v = validate_spec(views_spec())
    assert [x["id"] for x in v["views"]] == ["v-master", "v-living"]
    assert v["views"][0]["orthoScale"] == 17.0 and v["views"][0]["fovDeg"] is None and v["views"][1]["roomId"] == "r-living"
    assert validate_spec(SPEC)["views"] == []
    j = parse_job(views_job())
    assert set(j.view_urls) == {"v-master", "v-living"} and all(set(u) == {"image", "ids", "legend"} for u in j.view_urls.values())
    assert parse_job(job()).view_urls == {}


@pytest.mark.parametrize("mutate, why", [
    (lambda s: s["views"][0].update(fovDeg=40.0), "either fovDeg or orthoScale"),
    (lambda s: s["views"][1].update(fovDeg=None), "either fovDeg or orthoScale"),
    (lambda s: s["views"][1].update(fovDeg=5), "fovDeg"),
    (lambda s: s["views"][0].update(orthoScale=500), "orthoScale"),
    (lambda s: s["views"][0].update(width=4096), "width"),
    (lambda s: s["views"][0].update(height=300.5), "whole number"),
    (lambda s: s["views"][0].update(samples=2048), "samples"),
    (lambda s: s["views"][0].update(aspect=9), "aspect"),
    (lambda s: s["views"][0].update(position=[float("nan"), 0, 0]), "position"),
    (lambda s: s["views"][0].update(position=[9999, 0, 0]), "position"),
    (lambda s: s["views"][0].update(target=s["views"][0]["position"]), "looks at itself"),
    (lambda s: s["views"][0].update(kind="DRONE"), "kind"),
    (lambda s: s["views"][0].update(purpose="ART"), "purpose"),
    (lambda s: s["views"][0].update(roomId="r-nowhere"), "unknown room"),
    (lambda s: s["views"][0].update(cut={"exteriorM": 0.1, "interiorM": 1}), "cut"),
    (lambda s: s["views"][0].update(hideCeilings="yes"), "hideCeilings"),
    (lambda s: s["views"][0].update(objectMap=1), "objectMap"),
    (lambda s: s["views"][0].update(id="v master"), "id"),
    (lambda s: s["views"].append(dict(s["views"][0])), "duplicate"),
    (lambda s: s.update(views=[dict(s["views"][0], id=f"v-{i}") for i in range(13)]), "more than 12"),
])
def test_a_malformed_view_is_refused(mutate, why):
    s = views_spec()
    mutate(s)
    with pytest.raises(SpecError, match=re.escape(why)):
        validate_spec(s)


@pytest.mark.parametrize("mutate, why", [
    (lambda j: j["outputs"]["views"].pop("v-living"), "one entry per planned view"),
    (lambda j: j["outputs"]["views"]["v-master"].pop("legend"), "object map"),
    (lambda j: j["outputs"]["views"]["v-master"].update(image="https://evil.example.com/x"), "storage endpoint"),
    (lambda j: j["outputs"].update(views={"v-other": {"image": R2}}), "one entry per planned view"),
])
def test_a_view_output_set_must_match_the_plan(mutate, why):
    j = views_job()
    mutate(j)
    with pytest.raises(JobError, match=why):
        parse_job(j)


def test_view_outputs_without_planned_views_are_refused():
    j = job()
    j["outputs"]["views"] = {"v": {"image": R2}}
    with pytest.raises(JobError, match="plans no views"):
        parse_job(j)


VIEWS_SAMPLES = os.environ.get("HM_VIEWS_SAMPLES_DIR")
EXT = {"image/jpeg": "jpg", "image/png": "png", "application/json": "json"}


@pytest.fixture(scope="module")
def built_views():
    if blender_path() is None:
        pytest.skip("Blender is not installed here")
    tr = FakeTransfer()
    stages: list[str] = []
    out = pipeline_mod.run_job(parse_job(views_job()), {**tools(), "gltf_transform": None}, tr, progress=stages.append)
    by_url = {p[0]: p for p in tr.puts}
    if VIEWS_SAMPLES:
        d = Path(VIEWS_SAMPLES)
        d.mkdir(parents=True, exist_ok=True)
        for url, (_, _, ctype, data) in by_url.items():
            (d / (url.split("&")[-1] + "." + EXT[ctype])).write_bytes(data)
        (d / "build-report.json").write_text(json.dumps({"views": out["outputs"]["views"], "build": out["build"].get("views"), "timings": out["build"].get("timings")}, indent=1))
    return out, by_url, stages


def _put(by_url: dict, vid: str, what: str) -> bytes:
    return by_url[R2 + f"&{vid}-{what}"][3]


@needs_blender
def test_every_planned_view_is_rendered_opaque_at_its_size_with_its_object_map(built_views):
    out, by_url, stages = built_views
    assert stages.count("RENDERING") == 2, stages
    views = out["outputs"]["views"]
    assert set(views) == {"v-master", "v-living"}
    for v in views_spec()["views"]:
        o = views[v["id"]]
        assert o["ok"] is True, o
        jpg = Image.open(io.BytesIO(_put(by_url, v["id"], "image")))
        assert jpg.format == "JPEG" and jpg.size == (v["width"], v["height"]) and o["image"]["width"] == v["width"]
        assert o["image"]["bytes"] == len(_put(by_url, v["id"], "image")) and o["image"]["quality"] >= 88
        px = list(jpg.convert("L").getdata())
        mean = sum(px) / len(px)
        assert sum((q - mean) ** 2 for q in px) / len(px) > 50, "a picture of the home, not an empty frame"
        ids = Image.open(io.BytesIO(_put(by_url, v["id"], "ids")))
        assert ids.format == "PNG" and ids.size == (v["width"], v["height"]) and ids.mode == "RGB"
        assert o["ms"] > 0 and o["idMs"] > 0
    assert out["build"]["views"]["v-master"]["unmatchedPixels"] == 0


@needs_blender
def test_the_id_picture_holds_exactly_the_legend_s_colours(built_views):
    _, by_url, _ = built_views
    for vid in ("v-master", "v-living"):
        ids = Image.open(io.BytesIO(_put(by_url, vid, "ids"))).convert("RGB")
        legend = json.loads(_put(by_url, vid, "legend"))
        assert legend["width"] == ids.size[0] and legend["height"] == ids.size[1]
        counts = {f"#{r:02x}{g:02x}{b:02x}": n for n, (r, g, b) in ids.getcolors(1 << 20)}
        legend_colours = [e["color"] for e in legend["entries"]]
        assert len(legend_colours) == len(set(legend_colours)), "no two targets share a colour"
        assert set(counts) - {"#000000"} == set(legend_colours), "no blended colours: every pixel is one target's"
        assert sum(e["coverage"] for e in legend["entries"]) <= 1.0 + 1e-6
        total = ids.size[0] * ids.size[1]
        for e in legend["entries"]:
            assert abs(e["coverage"] - counts[e["color"]] / total) < 1e-5
            x0, y0, x1, y1 = e["box"]
            assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1
        assert {e["kind"] for e in legend["entries"]} <= {"OBJECT", "FLOOR", "WALL", "CEILING", "STAIRS", "DOOR", "WINDOW", "OTHER"}


@needs_blender
def test_the_dollhouse_map_names_the_pieces_floors_and_wall_faces_by_their_spec_ids(built_views):
    _, by_url, _ = built_views
    s = views_spec()
    legend = json.loads(_put(by_url, "v-master", "legend"))
    by_kind: dict = {}
    for e in legend["entries"]:
        by_kind.setdefault(e["kind"], {})[e["id"]] = e
    spec_ids = {o["id"] for o in s["objects"]}
    assert set(by_kind["OBJECT"]) <= spec_ids
    # From above with the ceilings off and the walls cut, every piece of a real footprint is in sight.
    big = {o["id"] for o in s["objects"] if o["size"]["w"] * o["size"]["d"] >= 0.3}
    assert big <= set(by_kind["OBJECT"]), sorted(big - set(by_kind["OBJECT"]))
    assert by_kind["OBJECT"]["rc-9-bed1x"]["roomId"] == "r-bed1"
    assert set(by_kind["FLOOR"]) == {r["floor"] for r in s["rooms"]}, "every room's floor"
    assert "CEILING" not in by_kind, "ceilings are hidden in a dollhouse"
    faces = {f["surface"] for w in s["walls"] for f in w["faces"]}
    walls = set(by_kind["WALL"])
    assert walls <= faces and len(walls) >= 6, walls
    assert all(by_kind["WALL"][sid]["roomId"] == sid.rsplit(":", 1)[-1] for sid in walls)
    # One wall, several rooms: each room's face segment of it is its own region.
    assert any(len({f["surface"] for f in w["faces"] if f["side"] == side} & walls) >= 2 for w in s["walls"] for side in ("L", "R")), walls
    assert "WINDOW" in by_kind or "DOOR" in by_kind


@needs_blender
def test_a_room_view_keeps_its_ceiling_and_full_height_walls(built_views):
    _, by_url, _ = built_views
    legend = json.loads(_put(by_url, "v-living", "legend"))
    kinds = {e["kind"] for e in legend["entries"]}
    ids = {e["id"] for e in legend["entries"]}
    assert "ceiling:r-living" in ids and "floor:r-living" in ids
    assert "WALL" in kinds and "OBJECT" in kinds
    assert sum(e["coverage"] for e in legend["entries"] if e["kind"] == "WALL") > 0.1, "an eye-level room picture is mostly walls"


@needs_blender
def test_a_spec_without_views_builds_exactly_as_before(built):
    out, _ = built
    assert "views" not in out["outputs"] and "views" not in out["build"]
