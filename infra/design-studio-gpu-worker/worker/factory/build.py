"""Blender entry: blender -b --factory-startup --python worker/factory/build.py -- params.json

params.json (written by the worker, never by a customer or a model):
  spec        path of the SceneBuildSpec JSON (validated again here)
  textures    {materialId: {albedo, normal, orm}} local image paths
  models      {assetCode: path} local GLB paths of catalogue models
  out         output directory
  device      "AUTO" | "CPU"
  report      path of the build report JSON

Writes: render.png (the source camera, transparent background), scene.glb (the
whole home, semantic node names), objects/<group>.glb (one model per group of
identical walkthrough pieces), and the report.
"""
from __future__ import annotations

import json
import math
import sys
import time
import traceback
from pathlib import Path

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from worker.factory import arch, furniture  # noqa: E402
from worker.factory.materials import Library, rgba  # noqa: E402
from worker.spec import validate_spec  # noqa: E402


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def stage(name: str) -> None:
    """A real progress marker the worker relays (the customer sees which stage is running, never a percentage)."""
    print(f"HMSTAGE {name}", flush=True)


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.lights, bpy.data.cameras):
        for x in list(coll):
            coll.remove(x)


def collection(name: str):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    return col


# Sky colour, sky strength, sun strength (W/m²), per time of day: a soft daylight interior,
# with the sun doing the modelling (contact shadows, directional light) rather than flat sky.
SKY = {"DAY": ("#dbe5f0", 0.55, 4.0), "SUNSET": ("#e9b48a", 0.4, 2.4), "EVENING": ("#4a4f66", 0.25, 1.1), "NIGHT": ("#1c2230", 0.08, 0.25)}
KELVIN = {"WARM": "#ffd8a8", "NEUTRAL": "#fff3e2", "COOL": "#dfe9ff"}


def light(spec: dict) -> None:
    lt = spec["lighting"]
    sky, sky_strength, sun_strength = SKY[lt["timeOfDay"]]
    world = bpy.data.worlds.new("hm-world")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = rgba(sky)
    bg.inputs["Strength"].default_value = sky_strength
    # The sun from where the walkthrough puts it (high from the north-west by day).
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = sun_strength
    sun.angle = math.radians(1.2)
    ob = bpy.data.objects.new("sun", sun)
    bpy.context.scene.collection.objects.link(ob)
    d = Vector(lt["sun"]).normalized()
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    # Interior light: a soft ceiling panel per indoor room, as strong as the design asks.
    if lt["interior"] > 0.01:
        h = spec["ceilingHeightM"]
        for room in spec["rooms"]:
            if room["outdoor"]:
                continue
            xs = [p[0] for p in room["polygon"]]
            ys = [p[1] for p in room["polygon"]]
            area_m2 = abs(sum(room["polygon"][i][0] * room["polygon"][(i + 1) % len(xs)][1] - room["polygon"][(i + 1) % len(xs)][0] * room["polygon"][i][1] for i in range(len(xs)))) / 2
            panel = bpy.data.lights.new(f"room:{room['id']}", "AREA")
            panel.shape = "RECTANGLE"
            panel.size = max(0.3, (max(xs) - min(xs)) * 0.5)
            panel.size_y = max(0.3, (max(ys) - min(ys)) * 0.5)
            # By day the sun lights the home and the ceiling lights only lift the shadows; at night they lead.
            daylight = {"DAY": 0.25, "SUNSET": 0.6, "EVENING": 1.0, "NIGHT": 1.2}[lt["timeOfDay"]]
            panel.energy = 14.0 * area_m2 * lt["interior"] * daylight
            panel.color = rgba(KELVIN[lt["temperature"]])[:3]
            lo = bpy.data.objects.new(f"room-light:{room['id']}", panel)
            lo.location = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, h - 0.05)
            bpy.context.scene.collection.objects.link(lo)


def camera(spec: dict):
    c = spec["camera"]
    cam = bpy.data.cameras.new("source")
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(c["fovDeg"])
    cam.clip_start = c["near"]
    cam.clip_end = c["far"]
    ob = bpy.data.objects.new("source-camera", cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(c["position"])
    direction = Vector(c["target"]) - Vector(c["position"])
    ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = ob
    return ob


def configure_render(spec: dict, device: str) -> str:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    used = "CPU"
    if device != "CPU":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type == kind]
                if gpus:
                    for d in prefs.devices:
                        d.use = d.type == kind
                    used = kind
                    break
            except Exception:  # noqa: BLE001 - no such backend here: try the next
                continue
    sc.cycles.device = "GPU" if used != "CPU" else "CPU"
    sc.cycles.samples = spec["render"]["samples"]
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except TypeError:
        pass
    sc.cycles.max_bounces = 6
    sc.render.resolution_x = spec["render"]["width"]
    sc.render.resolution_y = spec["render"]["height"]
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    # Glass (windows, railings) shows what is behind it, not a hole in the picture.
    sc.cycles.film_transparent_glass = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    # The walkthrough's own tone mapping (three.js NeutralToneMapping = Khronos PBR Neutral, exposure
    # 0.88): a colour the picture showed looks the same in the render, the walkthrough and the check.
    try:
        sc.view_settings.view_transform = "Khronos PBR Neutral"
    except TypeError:
        sc.view_settings.view_transform = "AgX"
    sc.view_settings.exposure = math.log2(0.88)
    return used


def hide(objs, hidden: bool) -> None:
    for o in objs:
        o.hide_render = hidden
        o.hide_set(hidden)


def export_glb(path: Path, objs) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    kwargs = dict(filepath=str(path), export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                  export_cameras=False, export_lights=False, export_extras=False)
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_materials="EXPORT")
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)


def main(params_path: str) -> dict:
    t0 = time.perf_counter()
    params = json.loads(Path(params_path).read_text())
    spec = validate_spec(json.loads(Path(params["spec"]).read_text()))
    out = Path(params["out"])
    out.mkdir(parents=True, exist_ok=True)
    report: dict = {"ok": False, "timings": {}, "counts": {}, "warnings": [], "objects": {}, "groups": {}}
    reset()
    lib = Library(spec, params.get("textures") or {})

    stage("ARCHITECTURE")
    t = time.perf_counter()
    floors = arch.build_floors(spec, lib)
    walls = arch.build_walls(spec, lib, name="walls")
    trim = arch.build_baseboards(spec, lib)
    rails = arch.build_railings(spec, lib)
    ceilings = arch.build_ceilings(spec, lib)
    report["timings"]["architecture"] = _ms(t)

    stage("FURNISHING")
    t = time.perf_counter()
    col = collection("objects")
    pieces: dict[str, object] = {}
    for o in spec["objects"]:
        try:
            if o["kind"] == "MODEL":
                path = (params.get("models") or {}).get(o["model"])
                if not path:
                    raise RuntimeError("catalogue model not provided")
                ob = furniture.import_model(o, path, col)
            else:
                ob = furniture.build_piece(o, lib, col)
            ob.location = (o["at"][0], o["at"][1], o["elevationM"])
            ob.rotation_euler = (0.0, 0.0, o["rotation"])
            ob["homatch"] = {"kind": o["kind"], "instance": o["id"], "provenance": o["provenance"]}
            pieces[o["id"]] = ob
            report["objects"][o["id"]] = {"ok": True, "triangles": sum(len(p.vertices) - 2 for p in ob.data.polygons)}
        except Exception as e:  # noqa: BLE001 - one piece's failure is reported; the home is still built
            report["objects"][o["id"]] = {"ok": False, "error": str(e)[:200]}
            report["warnings"].append(f"piece {o['id']}: {str(e)[:120]}")
    report["timings"]["furnishing"] = _ms(t)
    report["counts"] = {
        "rooms": len(floors), "walls": len(spec["walls"]), "openings": sum(len(w["openings"]) for w in spec["walls"]),
        "railings": len(spec["railings"]), "pieces": len(pieces), "piecesFailed": sum(1 for v in report["objects"].values() if not v["ok"]),
        "materials": len(bpy.data.materials),
    }
    stage("MATERIALS")
    t = time.perf_counter()
    arch_objs = floors + walls + trim + rails
    report["counts"]["texturedSurfaces"] = lib.apply_textures(arch_objs + ceilings)
    report["counts"]["texturedMaterials"] = len({m["id"] for m in spec["materials"] if m["id"] in (params.get("textures") or {})})
    if lib.missing_maps:
        report["warnings"].append(f"materials without maps (drawn in their colour): {sorted(set(lib.missing_maps))[:8]}")
    report["timings"]["materials"] = _ms(t)
    stage("LIGHTING")
    light(spec)

    if spec["outputs"]["render"] and spec["camera"]:
        stage("RENDERING")
        t = time.perf_counter()
        report["device"] = configure_render(spec, params.get("device", "AUTO"))
        camera(spec)
        cut = spec["camera"]["cut"]
        cut_walls = []
        hide(ceilings, True)
        if cut:
            hide(walls, True)
            cut_walls = arch.build_walls(spec, lib, height_for=lambda w: cut["exteriorM"] if w["kind"] == "EXTERIOR" else cut["interiorM"], name="walls-cut")
            lib.apply_textures(cut_walls)
        bpy.context.scene.render.filepath = str(out / "render.png")
        bpy.ops.render.render(write_still=True)
        for o in cut_walls:
            bpy.data.objects.remove(o, do_unlink=True)
        hide(walls, False)
        hide(ceilings, False)
        report["timings"]["render"] = _ms(t)
        report["render"] = {"width": spec["render"]["width"], "height": spec["render"]["height"], "samples": spec["render"]["samples"], "background": spec["camera"]["background"]}

    if spec["outputs"]["scene"] or spec["outputs"]["objects"]:
        stage("EXPORTING")
    if spec["outputs"]["scene"]:
        t = time.perf_counter()
        export_glb(out / "scene.glb", arch_objs + ceilings + list(pieces.values()))
        report["timings"]["exportScene"] = _ms(t)

    if spec["outputs"]["objects"]:
        t = time.perf_counter()
        (out / "objects").mkdir(exist_ok=True)
        for o in spec["objects"]:
            g = o["group"]
            ob = pieces.get(o["id"])
            if not o["runtime"] or not g or g in report["groups"] or ob is None:
                continue
            loc, rot = tuple(ob.location), tuple(ob.rotation_euler)
            ob.location = (0.0, 0.0, 0.0)
            ob.rotation_euler = (0.0, 0.0, 0.0)
            try:
                export_glb(out / "objects" / f"{g}.glb", [ob])
                report["groups"][g] = {"ok": True, "from": o["id"]}
            except Exception as e:  # noqa: BLE001
                report["groups"][g] = {"ok": False, "error": str(e)[:200]}
            ob.location, ob.rotation_euler = loc, rot
        report["timings"]["exportObjects"] = _ms(t)

    report["timings"]["total"] = _ms(t0)
    report["blender"] = bpy.app.version_string
    report["ok"] = True
    return report


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    params_file = argv[0]
    rep_path = Path(json.loads(Path(params_file).read_text())["report"])
    try:
        result = main(params_file)
    except Exception as e:  # noqa: BLE001 - the worker reads the reason from the report
        result = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:400]}", "trace": traceback.format_exc()[-1500:]}
    rep_path.write_text(json.dumps(result))
    sys.exit(0 if result.get("ok") else 3)
