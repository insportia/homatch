"""Planned views: the furnished home seen from the planner's cameras, each with its object map.

For every spec view (sceneSpec.ts SpecView), after the scene is built:

  beauty   Cycles at final quality (adaptive sampling, the denoiser the device
           has, AgX and the views' light and materials from look.py), opaque: a MASTER (dollhouse)
           stands on a soft neutral studio ground with contact shadows, a ROOM view
           is the room itself. Ceilings hidden and walls cut when the view asks.
           -> view-<id>.png (8-bit sRGB)
  ids      the same camera, every target painted one flat emission colour (one
           sample, the narrowest pixel filter, no denoising, no dithering, the Raw
           view transform), so each pixel holds exactly one target's colour.
           -> view-<id>-ids.png (lossless) and view-<id>-legend.json, the legend
           read back FROM the picture: colour, kind, canonical id, room, coverage, box.

Canonical ids are the spec's own: a piece's id, a floor's / ceiling's surface id,
a wall FACE SEGMENT's surface id (the wall geometry is cut at every segment's ends
for views, so one room's side of a wall is its own region), an opening's id, a
stair's id. The scene's real materials, world and settings are restored after
every id pass. Colours come from a fixed sequence over the sorted targets, so the
same scene gives the same colours.
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import bpy  # type: ignore
import numpy as np  # type: ignore  (bundled with Blender)
from mathutils import Vector  # type: ignore

from . import arch, geo, look
from .materials import rgba

STUDIO = "#ecebe8"
GROUND_Z = -arch.SLAB - 0.002


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def palette(n: int) -> list[str]:
    """n distinct colours: an odd multiplier is a bijection mod 2^24, so no two indices share one; nothing near black."""
    out: list[str] = []
    i = 0
    while len(out) < n:
        i += 1
        v = (i * 0x9E3779B1) & 0xFFFFFF
        r, g, b = v >> 16, (v >> 8) & 0xFF, v & 0xFF
        if max(r, g, b) < 48:
            continue
        out.append(f"#{r:02x}{g:02x}{b:02x}")
    return out


# ── what each mesh shows ─────────────────────────────────────────────

class Targets:
    """(kind, id) per mesh, or per polygon for a wall, with each target's room."""

    def __init__(self, spec: dict):
        self.spec = spec
        self.rooms = {r["id"]: r for r in spec["rooms"]}
        self.room_of: dict[tuple[str, str], str | None] = {}

    def _room_at(self, p) -> str | None:
        found = [r for r in self.spec["rooms"] if arch._inside(p, r["polygon"])]
        return min(found, key=lambda r: arch._area(r["polygon"]))["id"] if found else None

    def _key(self, kind: str, tid: str, room: str | None) -> tuple[str, str]:
        k = (kind, tid)
        self.room_of.setdefault(k, room)
        return k

    def _surface_room(self, surface_id: str) -> str | None:
        tail = surface_id.rsplit(":", 1)[-1]
        return tail if tail in self.rooms else None

    def classify(self, ob):
        """A key for the whole mesh, or a list of keys (one per polygon)."""
        hm = ob.get("homatch") or {}
        kind = hm.get("kind") if hasattr(hm, "get") else None
        if hm.get("instance"):
            o = next((x for x in self.spec["objects"] if x["id"] == hm["instance"]), None)
            return self._key("OBJECT", str(hm["instance"]), self._room_at(o["at"]) if o else None)
        if kind == "FLOOR" and hm.get("room") in self.rooms:
            r = self.rooms[hm["room"]]
            return self._key("FLOOR", r["floor"], r["id"])
        if kind == "CEILING" and hm.get("room") in self.rooms and self.rooms[hm["room"]]["ceiling"]:
            r = self.rooms[hm["room"]]
            return self._key("CEILING", r["ceiling"], r["id"])
        if kind == "WALL" and "hm_wall_index" in ob:
            wall = self.spec["walls"][int(ob["hm_wall_index"])]
            return [
                self._key("OTHER", f"wall-body:{wall['id']}", None) if f is None else self._key("WALL", f["surface"], self._surface_room(f["surface"]))
                for f in arch.wall_polygon_faces(ob, wall)
            ]
        if kind in ("DOOR", "WINDOW") and hm.get("opening"):
            return self._key(kind, str(hm["opening"]), None)
        if kind == "STAIR" and hm.get("stair"):
            return self._key("STAIRS", str(hm["stair"]), None)
        if kind == "RAILING" and hm.get("railing"):
            return self._key("OTHER", f"railing:{hm['railing']}", None)
        # Skirting and anything else the factory built: addressable by its own name.
        return self._key("OTHER", ob.name.split(".")[0], None)


# ── cameras, backdrop, settings ──────────────────────────────────────

def view_camera(v: dict):
    cam = bpy.data.cameras.new(f"view:{v['id']}")
    cam.sensor_fit = "VERTICAL"
    if v["orthoScale"] is not None:
        cam.type = "ORTHO"
        cam.ortho_scale = v["orthoScale"]
        cam.clip_start, cam.clip_end = 0.01, 5000.0
    else:
        cam.angle_y = math.radians(v["fovDeg"])
        cam.clip_start, cam.clip_end = 0.03, 2000.0
    ob = bpy.data.objects.new(f"view-camera:{v['id']}", cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(v["position"])
    ob.rotation_euler = (Vector(v["target"]) - Vector(v["position"])).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = ob
    return ob


def studio_world(world):
    """The sky lights the home as before; a camera ray that misses it sees a soft neutral studio instead."""
    w = world.copy()
    w.name = "hm-world-studio"
    nt = w.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")
    sky = next(n for n in nt.nodes if n.type == "BACKGROUND")
    studio = nt.nodes.new("ShaderNodeBackground")
    studio.inputs["Color"].default_value = rgba(STUDIO)
    studio.inputs["Strength"].default_value = 1.0
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(sky.outputs[0], mix.inputs[1])
    nt.links.new(studio.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return w


def ground(spec: dict):
    """A wide matte ground just under the slabs: it takes the home's contact shadows."""
    xs = [p[0] for r in spec["rooms"] for p in r["polygon"]] or [0.0]
    ys = [p[1] for r in spec["rooms"] for p in r["polygon"]] or [0.0]
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    half = 400.0
    pts = [(cx - half, cy - half), (cx + half, cy - half), (cx + half, cy + half), (cx - half, cy + half)]
    mat = bpy.data.materials.new("studio-ground")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = rgba(STUDIO)
    bsdf.inputs["Roughness"].default_value = 0.95
    ob = geo.new_object("studio-ground", geo.prism_bm(pts, GROUND_Z - 0.01, GROUND_Z), mat)
    return ob


_SETTINGS = (
    ("cycles", "samples"), ("cycles", "use_adaptive_sampling"), ("cycles", "adaptive_threshold"), ("cycles", "use_denoising"),
    ("cycles", "denoiser"), ("cycles", "filter_width"), ("cycles", "pixel_filter_type"), ("cycles", "max_bounces"),
    ("cycles", "diffuse_bounces"), ("cycles", "glossy_bounces"), ("cycles", "transmission_bounces"),
    ("cycles", "transparent_max_bounces"), ("cycles", "volume_bounces"), ("cycles", "sample_clamp_indirect"), ("render", "film_transparent"),
    ("render", "dither_intensity"), ("render", "resolution_x"), ("render", "resolution_y"),
    ("view_settings", "view_transform"), ("view_settings", "look"), ("view_settings", "exposure"), ("view_settings", "gamma"),
)


def _owner(sc, part: str):
    return getattr(sc, part)


def save_settings(sc) -> dict:
    return {(p, a): getattr(_owner(sc, p), a) for p, a in _SETTINGS if hasattr(_owner(sc, p), a)}


def restore_settings(sc, saved: dict) -> None:
    for (p, a), v in saved.items():
        try:
            setattr(_owner(sc, p), a, v)
        except (TypeError, AttributeError):
            pass


def _png(sc, color_mode: str = "RGB") -> None:
    s = sc.render.image_settings
    s.file_format = "PNG"
    s.color_mode = color_mode
    s.color_depth = "8"
    s.compression = 15


# ── the passes ───────────────────────────────────────────────────────

def beauty(v: dict, path: Path) -> None:
    """The picture itself, with the settings look.quality() set and the exposure chosen for it."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = v["width"], v["height"]
    sc.cycles.samples = v["samples"]
    sc.cycles.use_adaptive_sampling = True
    _png(sc)
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def id_pass(v: dict, path: Path, targets: Targets, objs: list, hidden_extra: list) -> dict:
    """Flat colours, exactly: returns {colour: (kind, id)} for every colour painted."""
    sc = bpy.context.scene
    saved = save_settings(sc)
    world = sc.world
    black = bpy.data.worlds.new("hm-id-world")
    black.use_nodes = True
    bg = next(n for n in black.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bg.inputs["Strength"].default_value = 0.0
    sc.world = black
    for o in hidden_extra:
        o.hide_render = True

    shown = [o for o in objs if o.type == "MESH" and not o.hide_render and o.name in bpy.data.objects]
    per = {o.name: targets.classify(o) for o in shown}
    keys = sorted({k for ks in per.values() for k in (ks if isinstance(ks, list) else [ks])})
    colours = dict(zip(keys, palette(len(keys))))
    mats: dict = {}

    def flat(key):
        if key not in mats:
            m = bpy.data.materials.new(f"hm-id:{key[0]}:{key[1]}"[:63])
            m.use_nodes = True
            nt = m.node_tree
            nt.nodes.clear()
            em = nt.nodes.new("ShaderNodeEmission")
            h = colours[key].lstrip("#")
            # The Raw view writes the value itself: c/255 comes back as c.
            em.inputs["Color"].default_value = (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255, 1.0)
            em.inputs["Strength"].default_value = 1.0
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            nt.links.new(em.outputs[0], out.inputs["Surface"])
            mats[key] = m
        return mats[key]

    swaps = []
    try:
        for o in shown:
            ks = per[o.name]
            me = o.data.copy()
            me.materials.clear()
            if isinstance(ks, list):
                uniq = sorted(set(ks))
                for k in uniq:
                    me.materials.append(flat(k))
                idx = {k: i for i, k in enumerate(uniq)}
                me.polygons.foreach_set("material_index", [idx[k] for k in ks])
            else:
                me.materials.append(flat(ks))
                me.polygons.foreach_set("material_index", [0] * len(me.polygons))
            swaps.append((o, o.data, me))
            o.data = me
        sc.render.resolution_x, sc.render.resolution_y = v["width"], v["height"]
        sc.cycles.samples = 1
        sc.cycles.use_adaptive_sampling = False
        sc.cycles.use_denoising = False
        sc.cycles.filter_width = 0.01
        sc.cycles.pixel_filter_type = "BOX"
        for a in ("max_bounces", "diffuse_bounces", "glossy_bounces", "transmission_bounces", "transparent_max_bounces", "volume_bounces"):
            setattr(sc.cycles, a, 0)
        sc.render.film_transparent = False
        sc.render.dither_intensity = 0.0
        sc.view_settings.view_transform = "Raw"
        sc.view_settings.look = "None"
        sc.view_settings.exposure = 0.0
        sc.view_settings.gamma = 1.0
        _png(sc)
        sc.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
    finally:
        # The scene's own materials, world and settings, exactly as they were.
        for o, original, copy in swaps:
            o.data = original
            bpy.data.meshes.remove(copy)
        for m in mats.values():
            bpy.data.materials.remove(m)
        sc.world = world
        bpy.data.worlds.remove(black)
        for o in hidden_extra:
            o.hide_render = False
        restore_settings(sc, saved)
    return {c: k for k, c in colours.items()}


def legend(path: Path, painted: dict, targets: Targets) -> tuple[dict, int]:
    """The object map read back from the id picture: every colour present, its target, coverage and box."""
    img = bpy.data.images.load(str(path))
    try:
        img.colorspace_settings.name = "Non-Color"
    except TypeError:
        pass
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    rgb = np.rint(px.reshape(h, w, 4)[::-1, :, :3] * 255.0).astype(np.int64)  # top row first
    codes = (rgb[:, :, 0] << 16) | (rgb[:, :, 1] << 8) | rgb[:, :, 2]
    flat = codes.ravel()
    uniq, inverse, counts = np.unique(flat, return_inverse=True, return_counts=True)
    order = np.argsort(inverse, kind="stable")
    ys, xs = np.divmod(order, w)
    starts = np.concatenate(([0], np.cumsum(counts)[:-1]))
    x0, x1 = np.minimum.reduceat(xs, starts), np.maximum.reduceat(xs, starts)
    y0, y1 = np.minimum.reduceat(ys, starts), np.maximum.reduceat(ys, starts)
    entries = []
    unmatched = 0
    total = float(w * h)
    for i, code in enumerate(uniq.tolist()):
        if code == 0:
            continue  # the empty world behind everything
        colour = f"#{code:06x}"
        key = painted.get(colour)
        if key is None:
            unmatched += int(counts[i])
            continue
        entries.append({
            "color": colour, "kind": key[0], "id": key[1], "roomId": targets.room_of.get(key),
            "coverage": round(int(counts[i]) / total, 6),
            "box": [round(int(x0[i]) / w, 4), round(int(y0[i]) / h, 4), round((int(x1[i]) + 1) / w, 4), round((int(y1[i]) + 1) / h, 4)],
        })
    entries.sort(key=lambda e: (-e["coverage"], e["kind"], e["id"]))
    return {"width": w, "height": h, "entries": entries}, unmatched


def render_views(spec: dict, lib, out: Path, ctx: dict, stage, hide) -> dict:
    """Every planned view: (objectMap) the exact id picture and legend, then the picture with the views' look
    (look.py). One view's failure is reported, not fatal; the scene is left exactly as it was found."""
    sc = bpy.context.scene
    report: dict = {}
    sky = sc.world
    lighting = look.Lighting(spec)
    studio = studio_world(sky)
    floor_ground = ground(spec)
    looks = look.Looks(spec)
    base = save_settings(sc)
    try:
        for v in spec["views"]:
            stage("RENDERING")
            t = time.perf_counter()
            view_walls: list = []
            cam = None
            try:
                cam = view_camera(v)
                hide(ctx["walls"], True)
                hide(ctx["ceilings"], v["hideCeilings"])
                cut = v["cut"]
                height_for = (lambda w: cut["exteriorM"] if w["kind"] == "EXTERIOR" else cut["interiorM"]) if cut else None
                view_walls = arch.build_walls(spec, lib, height_for=height_for, name="walls-view", split_faces=True)
                lib.apply_textures(view_walls)
                if cut:
                    look.cap_walls(view_walls)
                lighting.for_view(v["kind"])
                sc.world = studio if v["kind"] == "MASTER" else sky
                floor_ground.hide_render = False
                entry: dict = {"ok": True, "width": v["width"], "height": v["height"], "samples": v["samples"]}
                painted = None
                ids = out / f"view-{v['id']}-ids.png"
                if v["objectMap"]:
                    # The id pass first, over the scene's own materials: exact, and independent of the look.
                    t2 = time.perf_counter()
                    targets = Targets(spec)
                    painted = id_pass(v, ids, targets, list(sc.objects), [floor_ground])
                    om, unmatched = legend(ids, painted, targets)
                    (out / f"view-{v['id']}-legend.json").write_text(json.dumps(om, separators=(",", ":")))
                    entry.update({"idMs": _ms(t2), "ids": ids.name, "legend": f"view-{v['id']}-legend.json", "entries": len(om["entries"]),
                                  "targets": len(painted), "unmatchedPixels": unmatched})
                t = time.perf_counter()
                looks.dress(list(sc.objects))
                look.quality(sc, v, ctx["device"])
                if v["kind"] == "ROOM":
                    mask = look.wall_mask_from(ids, painted) if painted else None
                    ev, how = look.solve_exposure(v, out / f"view-{v['id']}-preview.exr", mask)
                    entry["exposure"] = how
                else:
                    ev = look.MASTER_EXPOSURE
                    entry["exposure"] = {"ev": ev, "on": "fixed"}
                sc.view_settings.exposure = ev
                image = out / f"view-{v['id']}.png"
                beauty(v, image)
                entry.update({"ms": _ms(t), "image": image.name})
                report[v["id"]] = entry
            except Exception as e:  # noqa: BLE001 - one view's failure is reported; the others still render
                report[v["id"]] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}
            finally:
                looks.undress()
                for o in view_walls:
                    bpy.data.objects.remove(o, do_unlink=True)
                if cam is not None:
                    data = cam.data
                    bpy.data.objects.remove(cam, do_unlink=True)
                    bpy.data.cameras.remove(data)
                hide(ctx["walls"], False)
                hide(ctx["ceilings"], False)
                restore_settings(sc, base)
    finally:
        sc.world = sky
        looks.remove()
        lighting.restore()
        cap = bpy.data.materials.get("wall-cap")
        if cap is not None:
            bpy.data.materials.remove(cap)
        mat = floor_ground.data.materials[0] if floor_ground.data.materials else None
        bpy.data.objects.remove(floor_ground, do_unlink=True)
        if mat is not None:
            bpy.data.materials.remove(mat)
        bpy.data.worlds.remove(studio)
    return report
