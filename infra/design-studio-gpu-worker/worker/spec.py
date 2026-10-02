"""The SceneBuildSpec, validated in the worker (src/lib/designStudio/hybrid/sceneSpec.ts is the other half).

A spec is DATA: numbers, colours, enums and ids, bounded. It is checked here
before Blender starts and again inside Blender before anything is built; a
malformed spec is refused, never repaired. No field is ever evaluated, imported
or executed. Pure Python (Blender's own interpreter imports it too).
"""
from __future__ import annotations

import math
import re

SPEC_VERSION = "hm-scene-1"
LIMITS = {
    "rooms": 80, "polygon_points": 64, "walls": 400, "openings": 16, "faces": 24, "railings": 120,
    "objects": 300, "materials": 48, "surfaces": 1500, "color_slots": 12, "coord": 200.0, "height": 6.0,
    "stairs": 8, "treads": (3, 25), "stair_run": (0.5, 12.0), "stair_width": (0.5, 6.0),
    "views": 12, "view_edge": (256, 3072), "view_samples": (1, 1024), "view_fov": (10, 100),
    "view_ortho": (1, 200), "view_aspect": (0.3, 4), "view_coord": 500.0,
}
# Planned views (sceneSpec.ts VIEW_KINDS / VIEW_PURPOSES).
VIEW_KINDS = {"MASTER", "ROOM"}
VIEW_PURPOSES = {"DOLLHOUSE", "MAIN", "REVERSE", "FUNCTION", "DETAIL", "CONNECTION"}
# How an opening closes (sceneSpec.ts SPEC_LEAVES). Optional: absent means the plan did not say.
LEAVES = {"HINGED", "DOUBLE", "SLIDING", "NONE", "FRENCH", "FIXED", "CASEMENT"}
KINDS = {
    "SOFA", "ARMCHAIR", "TABLE", "ROUND_TABLE", "CABINET", "SHELF", "BED", "RUG", "LAMP", "PLANT", "CHAIR", "STOOL",
    "KITCHEN_RUN", "VANITY", "PLANTER", "WARDROBE", "DRESSER", "FRIDGE", "RECLINER", "TV_UNIT", "SHOWER", "TOILET",
    "BATH", "CURTAIN", "BLIND", "WASHER", "MODEL",
}
FORMS = {"STRAIGHT", "ROUNDED", "CURVED", "ROUND", "OVAL", "SHELL", "L_SHAPED", "U_SHAPED"}
PATTERNS = {"WOOD_PLANK", "WOOD_HERRINGBONE", "TILE", "STONE", "CONCRETE", "CARPET", "PAINT", "FABRIC", "WOOD_GRAIN", "LEATHER"}
PROV = {"OBSERVED", "INFERRED", "DESIGN"}

ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$")
SURFACE_ID = re.compile(r"^(floor|ceiling|wall):[A-Za-z0-9_.:-]{1,120}$")
HEX = re.compile(r"^#[0-9a-f]{6}$")
CODE = re.compile(r"^[a-z0-9][a-z0-9_./-]{0,79}$")
SLOT = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
KIND = re.compile(r"^[A-Z_]{2,20}$")


class SpecError(ValueError):
    pass


def _obj(v, p):
    if not isinstance(v, dict):
        raise SpecError(f"{p}: not an object")
    return v


def _arr(v, p, mx):
    if not isinstance(v, list):
        raise SpecError(f"{p}: not a list")
    if len(v) > mx:
        raise SpecError(f"{p}: more than {mx}")
    return v


def _num(v, p, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise SpecError(f"{p}: not a number in [{lo}, {hi}]")
    return float(v)


def _id(v, p, rx=ID):
    if not isinstance(v, str) or not rx.match(v):
        raise SpecError(f"{p}: bad id")
    return v


def _hex(v, p):
    if not isinstance(v, str) or not HEX.match(v.lower()):
        raise SpecError(f"{p}: bad colour")
    return v.lower()


def _one(v, p, allowed):
    if v not in allowed:
        raise SpecError(f"{p}: not allowed")
    return v


def _bool(v, p):
    if not isinstance(v, bool):
        raise SpecError(f"{p}: not a boolean")
    return v


def _xy(v, p):
    a = _arr(v, p, 2)
    if len(a) != 2:
        raise SpecError(f"{p}: not a point")
    c = LIMITS["coord"]
    return (_num(a[0], p, -c, c), _num(a[1], p, -c, c))


def _xyz(v, p, lim=2000.0):
    a = _arr(v, p, 3)
    if len(a) != 3:
        raise SpecError(f"{p}: not a 3D point")
    return tuple(_num(x, p, -lim, lim) for x in a)


def validate_spec(raw) -> dict:
    """The spec as plain, bounded data, or SpecError. Unknown fields are dropped."""
    r = _obj(raw, "spec")
    if r.get("version") != SPEC_VERSION or r.get("units") != "m" or r.get("coordinateSystem") != "PLAN_XY_Z_UP":
        raise SpecError("version/units: unsupported")
    src = _obj(r.get("source"), "source")
    H = LIMITS["height"]
    out: dict = {
        "source": {
            "kind": _one(src.get("kind"), "source.kind", {"PICTURE", "FLOOR_PLAN", "DESIGN"}),
            "architecture": _one(src.get("architecture"), "source.architecture", PROV),
            "furnishing": _one(src.get("furnishing"), "source.furnishing", PROV),
        },
        "ceilingHeightM": _num(r.get("ceilingHeightM"), "ceilingHeightM", 1.8, H),
    }
    surfaces = []
    for i, s in enumerate(_arr(r.get("surfaces"), "surfaces", LIMITS["surfaces"])):
        s = _obj(s, f"surfaces[{i}]")
        mat = s.get("material")
        if mat is not None and (not isinstance(mat, str) or not ID.match(mat)):
            raise SpecError(f"surfaces[{i}].material: bad id")
        pat = s.get("pattern")
        surfaces.append({
            "id": _id(s.get("id"), f"surfaces[{i}].id", SURFACE_ID), "material": mat, "color": _hex(s.get("color"), f"surfaces[{i}].color"),
            "roughness": _num(s.get("roughness"), f"surfaces[{i}].roughness", 0, 1), "metalness": _num(s.get("metalness"), f"surfaces[{i}].metalness", 0, 1),
            "pattern": None if pat is None else _one(pat, f"surfaces[{i}].pattern", PATTERNS),
            "tint": None if s.get("tint") is None else _hex(s.get("tint"), f"surfaces[{i}].tint"),
        })
    sids = {s["id"] for s in surfaces}
    if len(sids) != len(surfaces):
        raise SpecError("surfaces: duplicate id")

    def sref(v, p):
        if v not in sids:
            raise SpecError(f"{p}: unknown surface")
        return v

    materials = []
    for i, m in enumerate(_arr(r.get("materials"), "materials", LIMITS["materials"])):
        m = _obj(m, f"materials[{i}]")
        tile = _arr(m.get("tileM"), f"materials[{i}].tileM", 2)
        if len(tile) != 2:
            raise SpecError(f"materials[{i}].tileM: two numbers")
        materials.append({
            "id": _id(m.get("id"), f"materials[{i}].id"), "baseColor": _hex(m.get("baseColor"), f"materials[{i}].baseColor"),
            "roughness": _num(m.get("roughness"), "roughness", 0, 1), "metalness": _num(m.get("metalness"), "metalness", 0, 1),
            "tileM": (_num(tile[0], "tileM", 0.02, 20), _num(tile[1], "tileM", 0.02, 20)),
            "rotationDeg": _num(m.get("rotationDeg"), "rotationDeg", -360, 360), "normalScale": _num(m.get("normalScale"), "normalScale", 0, 4),
        })
    mids = {m["id"] for m in materials}
    for s in surfaces:
        if s["material"] and s["material"] not in mids:
            raise SpecError(f"surface {s['id']}: material not declared")

    rooms = []
    for i, m in enumerate(_arr(r.get("rooms"), "rooms", LIMITS["rooms"])):
        m = _obj(m, f"rooms[{i}]")
        poly = [_xy(p, f"rooms[{i}].polygon") for p in _arr(m.get("polygon"), f"rooms[{i}].polygon", LIMITS["polygon_points"])]
        if len(poly) < 3:
            raise SpecError(f"rooms[{i}].polygon: fewer than 3 points")
        rooms.append({
            "id": _id(m.get("id"), f"rooms[{i}].id"), "kind": _id(m.get("kind"), f"rooms[{i}].kind", KIND), "polygon": poly,
            "outdoor": _bool(m.get("outdoor"), f"rooms[{i}].outdoor"), "floor": sref(m.get("floor"), f"rooms[{i}].floor"),
            "ceiling": None if m.get("ceiling") is None else sref(m.get("ceiling"), f"rooms[{i}].ceiling"),
        })

    walls = []
    for i, w in enumerate(_arr(r.get("walls"), "walls", LIMITS["walls"])):
        w = _obj(w, f"walls[{i}]")
        a, b = _xy(w.get("start"), f"walls[{i}].start"), _xy(w.get("end"), f"walls[{i}].end")
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length < 0.05:
            raise SpecError(f"walls[{i}]: degenerate")
        h = _num(w.get("heightM"), f"walls[{i}].heightM", 0.3, H)
        ops = []
        for j, o in enumerate(_arr(w.get("openings"), f"walls[{i}].openings", LIMITS["openings"])):
            o = _obj(o, f"walls[{i}].openings[{j}]")
            wd = _num(o.get("widthM"), "widthM", 0.2, max(0.2, length))
            sill = _num(o.get("sillM"), "sillM", 0, h - 0.1)
            ops.append({
                "id": _id(o.get("id"), "opening.id"), "kind": _one(o.get("kind"), "opening.kind", {"DOOR", "WINDOW"}),
                "offsetM": _num(o.get("offsetM"), "offsetM", wd / 2 - 0.01, length - wd / 2 + 0.01), "widthM": wd,
                "sillM": sill, "heightM": _num(o.get("heightM"), "heightM", 0.1, h - sill),
                # Additive (still hm-scene-1): None when the plan does not say how it closes.
                "leaf": None if o.get("leaf") is None else _one(o.get("leaf"), "opening.leaf", LEAVES),
                "swing": None if o.get("swing") is None else _one(o.get("swing"), "opening.swing", {"L", "R"}),
            })
        faces = []
        for j, f in enumerate(_arr(w.get("faces"), f"walls[{i}].faces", LIMITS["faces"])):
            f = _obj(f, f"walls[{i}].faces[{j}]")
            fr = _num(f.get("from"), "from", -0.01, length + 0.01)
            faces.append({"side": _one(f.get("side"), "side", {"L", "R"}), "from": fr, "to": _num(f.get("to"), "to", fr, length + 0.01), "surface": sref(f.get("surface"), "face.surface")})
        walls.append({
            "id": _id(w.get("id"), f"walls[{i}].id"), "kind": _one(w.get("kind"), "wall.kind", {"EXTERIOR", "INTERIOR"}), "start": a, "end": b,
            "thicknessM": _num(w.get("thicknessM"), "thicknessM", 0.03, 1), "heightM": h, "openings": ops, "faces": faces,
        })

    railings = []
    for i, q in enumerate(_arr(r.get("railings"), "railings", LIMITS["railings"])):
        q = _obj(q, f"railings[{i}]")
        railings.append({"id": _id(q.get("id"), "railing.id"), "a": _xy(q.get("a"), "railing.a"), "b": _xy(q.get("b"), "railing.b"), "heightM": _num(q.get("heightM"), "railing.heightM", 0.5, 1.6)})

    # Stairs: additive and optional (still hm-scene-1); absent is none.
    stairs = []
    raw_stairs = r.get("stairs")
    for i, q in enumerate([] if raw_stairs is None else _arr(raw_stairs, "stairs", LIMITS["stairs"])):
        q = _obj(q, f"stairs[{i}]")
        p = f"stairs[{i}]"
        a, b = _xy(q.get("a"), f"{p}.a"), _xy(q.get("b"), f"{p}.b")
        _num(math.hypot(b[0] - a[0], b[1] - a[1]), f"{p}.width", *LIMITS["stair_width"])
        treads = _num(q.get("treads"), f"{p}.treads", *LIMITS["treads"])
        if treads != int(treads):
            raise SpecError(f"{p}.treads: not a whole number")
        stairs.append({
            "id": _id(q.get("id"), f"{p}.id"), "a": a, "b": b, "runM": _num(q.get("runM"), f"{p}.runM", *LIMITS["stair_run"]),
            "riseM": _num(q.get("riseM"), f"{p}.riseM", 0.5, H), "treads": int(treads),
            "direction": _one(q.get("direction"), f"{p}.direction", {"UP", "DOWN"}),
        })
    if len({s["id"] for s in stairs}) != len(stairs):
        raise SpecError("stairs: duplicate id")

    objects = []
    seen = set()
    for i, o in enumerate(_arr(r.get("objects"), "objects", LIMITS["objects"])):
        o = _obj(o, f"objects[{i}]")
        p = f"objects[{i}]"
        kind = _one(o.get("kind"), f"{p}.kind", KINDS)
        size = _obj(o.get("size"), f"{p}.size")
        colors_raw = _obj(o.get("colors") or {}, f"{p}.colors")
        if len(colors_raw) > LIMITS["color_slots"]:
            raise SpecError(f"{p}.colors: too many slots")
        colors = {}
        for k, v in colors_raw.items():
            if not isinstance(k, str) or not SLOT.match(k):
                raise SpecError(f"{p}.colors: bad slot")
            colors[k] = _hex(v, f"{p}.colors.{k}")
        model = o.get("model")
        if model is not None and (not isinstance(model, str) or not CODE.match(model)):
            raise SpecError(f"{p}.model: bad asset code")
        if kind == "MODEL" and not model:
            raise SpecError(f"{p}.model: a MODEL needs its asset code")
        oid = _id(o.get("id"), f"{p}.id")
        if oid in seen:
            raise SpecError("objects: duplicate id")
        seen.add(oid)
        form = o.get("form")
        group = o.get("group")
        objects.append({
            "id": oid, "kind": kind, "model": model, "form": None if form is None else _one(form, f"{p}.form", FORMS),
            "size": {"w": _num(size.get("w"), f"{p}.size.w", 0.02, 12), "d": _num(size.get("d"), f"{p}.size.d", 0.02, 12), "h": _num(size.get("h"), f"{p}.size.h", 0.005, H)},
            "at": _xy(o.get("at"), f"{p}.at"), "elevationM": _num(o.get("elevationM"), f"{p}.elevationM", 0, H), "rotation": _num(o.get("rotation"), f"{p}.rotation", -7, 7),
            "colors": colors, "provenance": _one(o.get("provenance"), f"{p}.provenance", PROV), "runtime": _bool(o.get("runtime"), f"{p}.runtime"),
            "group": None if group is None else _id(group, f"{p}.group"),
        })

    lt = _obj(r.get("lighting"), "lighting")
    cam = r.get("camera")
    camera = None
    if cam is not None:
        cam = _obj(cam, "camera")
        cut = cam.get("cut")
        camera = {
            "position": _xyz(cam.get("position"), "camera.position"), "target": _xyz(cam.get("target"), "camera.target"),
            "fovDeg": _num(cam.get("fovDeg"), "camera.fovDeg", 0.05, 120), "near": _num(cam.get("near"), "camera.near", 0.001, 100),
            "far": _num(cam.get("far"), "camera.far", 1, 5000), "aspect": _num(cam.get("aspect"), "camera.aspect", 0.2, 5),
            "background": None if cam.get("background") is None else _hex(cam.get("background"), "camera.background"),
            "cut": None if cut is None else {"exteriorM": _num(_obj(cut, "camera.cut").get("exteriorM"), "cut", 0.2, H), "interiorM": _num(cut.get("interiorM"), "cut", 0.2, H)},
        }
    # Views: additive and optional (still hm-scene-1); absent is none.
    room_ids = {m["id"] for m in rooms}
    views = []
    raw_views = r.get("views")
    for i, q in enumerate([] if raw_views is None else _arr(raw_views, "views", LIMITS["views"])):
        q = _obj(q, f"views[{i}]")
        p = f"views[{i}]"
        pos = _xyz(q.get("position"), f"{p}.position", LIMITS["view_coord"])
        tgt = _xyz(q.get("target"), f"{p}.target", LIMITS["view_coord"])
        if math.dist(pos, tgt) < 0.01:
            raise SpecError(f"{p}.target: the camera looks at itself")
        fov = None if q.get("fovDeg") is None else _num(q.get("fovDeg"), f"{p}.fovDeg", *LIMITS["view_fov"])
        ortho = None if q.get("orthoScale") is None else _num(q.get("orthoScale"), f"{p}.orthoScale", *LIMITS["view_ortho"])
        if (fov is None) == (ortho is None):
            raise SpecError(f"{p}.fovDeg: either fovDeg or orthoScale")
        room = q.get("roomId")
        if room is not None and room not in room_ids:
            raise SpecError(f"{p}.roomId: unknown room")
        cut = q.get("cut")
        if cut is not None:
            cut = _obj(cut, f"{p}.cut")
            cut = {"exteriorM": _num(cut.get("exteriorM"), f"{p}.cut.exteriorM", 0.2, H), "interiorM": _num(cut.get("interiorM"), f"{p}.cut.interiorM", 0.2, H)}

        def whole(v, path, lo, hi):
            n = _num(v, path, lo, hi)
            if n != int(n):
                raise SpecError(f"{path}: not a whole number")
            return int(n)

        views.append({
            "id": _id(q.get("id"), f"{p}.id"), "kind": _one(q.get("kind"), f"{p}.kind", VIEW_KINDS),
            "purpose": _one(q.get("purpose"), f"{p}.purpose", VIEW_PURPOSES), "roomId": room, "position": pos, "target": tgt,
            "fovDeg": fov, "orthoScale": ortho, "aspect": _num(q.get("aspect"), f"{p}.aspect", *LIMITS["view_aspect"]),
            "width": whole(q.get("width"), f"{p}.width", *LIMITS["view_edge"]), "height": whole(q.get("height"), f"{p}.height", *LIMITS["view_edge"]),
            "samples": whole(q.get("samples"), f"{p}.samples", *LIMITS["view_samples"]), "cut": cut,
            "hideCeilings": _bool(q.get("hideCeilings"), f"{p}.hideCeilings"), "objectMap": _bool(q.get("objectMap"), f"{p}.objectMap"),
        })
    if len({v["id"] for v in views}) != len(views):
        raise SpecError("views: duplicate id")

    rr = _obj(r.get("render"), "render")
    outs = _obj(r.get("outputs"), "outputs")
    out.update({
        "rooms": rooms, "walls": walls, "railings": railings, "stairs": stairs, "surfaces": surfaces, "materials": materials, "objects": objects,
        "frames": _hex(r.get("frames"), "frames"),
        "lighting": {
            "timeOfDay": _one(lt.get("timeOfDay"), "lighting.timeOfDay", {"DAY", "SUNSET", "EVENING", "NIGHT"}),
            "temperature": _one(lt.get("temperature"), "lighting.temperature", {"WARM", "NEUTRAL", "COOL"}),
            "interior": _num(lt.get("interior"), "lighting.interior", 0, 1), "sun": _xyz(lt.get("sun"), "lighting.sun", 10),
        },
        "camera": camera, "views": views,
        "render": {"width": int(_num(rr.get("width"), "render.width", 256, 2560)), "height": int(_num(rr.get("height"), "render.height", 256, 2560)), "samples": int(_num(rr.get("samples"), "render.samples", 1, 512))},
        "outputs": {"render": _bool(outs.get("render"), "outputs.render"), "scene": _bool(outs.get("scene"), "outputs.scene"), "objects": _bool(outs.get("objects"), "outputs.objects")},
    })
    return out
