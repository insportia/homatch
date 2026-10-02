"""Architecture from the spec: floor slabs, walls with real openings, doors, windows, railings, baseboards, ceilings, stairs.

Walls are solid pieces between and around their openings (nothing is a texture
of a hole). Each face of each piece wears the surface of the room it looks
into, exactly as the walkthrough paints it. The same builder makes the
section-cut walls a source picture shows (lower walls, openings clipped).
"""
from __future__ import annotations

import math

import bmesh  # type: ignore
import bpy  # type: ignore
from mathutils import Vector  # type: ignore

from . import geo
from ..stair_parts import stair_parts, stair_sides

SLAB = 0.04
BASE_H = 0.08
BASE_T = 0.012


def _collection(name: str):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    return col


def build_floors(spec: dict, lib) -> list:
    col = _collection("floors")
    out = []
    for room in spec["rooms"]:
        ob = geo.new_object(f"floor:{room['id']}", geo.prism_bm(room["polygon"], -SLAB, 0.0), lib.surface(room["floor"], "#d8c4a6"), collection=col)
        geo.metre_uvs(ob, "PLANAR_XY")
        ob["homatch"] = {"kind": "FLOOR", "room": room["id"]}
        out.append(ob)
    return out


def build_ceilings(spec: dict, lib) -> list:
    col = _collection("ceilings")
    out = []
    h = spec["ceilingHeightM"]
    for room in spec["rooms"]:
        if not room["ceiling"]:
            continue
        bm = geo.prism_bm(room["polygon"], h, h + 0.02)
        ob = geo.new_object(f"ceiling:{room['id']}", bm, lib.surface(room["ceiling"], "#fbfbf9"), collection=col)
        geo.metre_uvs(ob, "PLANAR_XY")
        ob["homatch"] = {"kind": "CEILING", "room": room["id"]}
        out.append(ob)
    return out


def _pieces(wall: dict, height: float) -> list[tuple[float, float, float, float]]:
    """(from, to, z0, z1) solid pieces of a wall of this height, around its openings."""
    length = math.hypot(wall["end"][0] - wall["start"][0], wall["end"][1] - wall["start"][1])
    ops = sorted(wall["openings"], key=lambda o: o["offsetM"])
    pieces = []
    cur = 0.0
    for o in ops:
        a = max(0.0, o["offsetM"] - o["widthM"] / 2)
        b = min(length, o["offsetM"] + o["widthM"] / 2)
        if a > cur + 1e-3:
            pieces.append((cur, a, 0.0, height))
        if o["sillM"] > 1e-3:
            pieces.append((a, b, 0.0, min(height, o["sillM"])))
        top = o["sillM"] + o["heightM"]
        if top < height - 1e-3:
            pieces.append((a, b, top, height))
        cur = max(cur, b)
    if cur < length - 1e-3:
        pieces.append((cur, length, 0.0, height))
    return [p for p in pieces if p[1] - p[0] > 1e-3 and p[3] - p[2] > 1e-3]


def build_walls(spec: dict, lib, height_for=None, name: str = "walls") -> list:
    """Walls (and their openings' frames, glass and doors). `height_for(wall)` lowers them for a section cut."""
    col = _collection(name)
    out = []
    _ROOMS["rooms"] = spec["rooms"]
    for wall in spec["walls"]:
        full = wall["heightM"]
        h = min(full, height_for(wall)) if height_for else full
        length, u, n, angle = geo.segment_frame(wall["start"], wall["end"])
        t = wall["thicknessM"]
        sx, sy = wall["start"]
        bm = bmesh.new()
        for (a, b, z0, z1) in _pieces(wall, h):
            piece = geo.box_bm(b - a, t, z1 - z0, (a + b) / 2, 0.0, z0)
            bm = geo.merge(bm, piece)
        geo.transform(bm, geo.rot_z(angle))
        bmesh.ops.translate(bm, vec=Vector((sx, sy, 0.0)), verts=bm.verts)
        ob = geo.new_object(f"wall:{wall['id']}", bm, None, collection=col)
        _dress_wall(ob, wall, lib, (sx, sy), u, n, length)
        ob["homatch"] = {"kind": "WALL", "wall": wall["id"], "exterior": wall["kind"] == "EXTERIOR"}
        out.append(ob)
        for o in wall["openings"]:
            out.extend(_opening(wall, o, h, lib, col, (sx, sy), angle, t))
    return out


def _dress_wall(ob, wall: dict, lib, origin, u, n, length: float) -> None:
    """Each face of the wall wears the surface of the room it looks into."""
    me = ob.data
    slots: dict[str, int] = {}

    def slot_for(mat) -> int:
        if mat.name not in slots:
            me.materials.append(mat)
            slots[mat.name] = len(me.materials) - 1
        return slots[mat.name]

    body = slot_for(lib.wall_body())
    for poly in me.polygons:
        c = poly.center
        along = (c.x - origin[0]) * u[0] + (c.y - origin[1]) * u[1]
        dn = poly.normal.x * n[0] + poly.normal.y * n[1]
        poly.material_index = body
        if abs(dn) < 0.7:
            continue
        side = "L" if dn > 0 else "R"
        face = next((f for f in wall["faces"] if f["side"] == side and f["from"] - 0.02 <= along <= f["to"] + 0.02), None)
        if face is not None:
            poly.material_index = slot_for(lib.surface(face["surface"], "#f7f5f1"))
    geo.metre_uvs(ob, "WALL", origin, u)


def _opening(wall: dict, o: dict, wall_h: float, lib, col, origin, angle: float, t: float) -> list:
    """A window's frame, glass and sill, or a door's frame and leaf — clipped to the wall's (cut) height."""
    out = []
    top = min(o["sillM"] + o["heightM"], wall_h)
    if top <= o["sillM"] + 0.05:
        return out
    w = o["widthM"]
    fw = 0.05
    parts = []
    frame = lib.frame() if o["kind"] == "WINDOW" else lib.plain("door-frame", "#f4f4f2", 0.5)
    # Jambs, head (when below the cut), and for a window a sill.
    parts.append((geo.box_bm(fw, t + 0.02, top - o["sillM"], o["offsetM"] - w / 2 + fw / 2, 0.0, o["sillM"]), frame))
    parts.append((geo.box_bm(fw, t + 0.02, top - o["sillM"], o["offsetM"] + w / 2 - fw / 2, 0.0, o["sillM"]), frame))
    if o["sillM"] + o["heightM"] <= wall_h + 1e-3:
        parts.append((geo.box_bm(w, t + 0.02, fw, o["offsetM"], 0.0, top - fw), frame))
    if o["kind"] == "WINDOW":
        parts.append((geo.box_bm(w, t + 0.02, fw, o["offsetM"], 0.0, o["sillM"]), frame))
        parts.append((geo.box_bm(w + 0.06, t + 0.08, 0.025, o["offsetM"], 0.0, o["sillM"] - 0.025), lib.plain("sill", "#e9e6e0", 0.4)))
        if w > 1.2:
            parts.append((geo.box_bm(0.04, 0.05, top - o["sillM"] - 2 * fw, o["offsetM"], 0.0, o["sillM"] + fw), frame))
        parts.append((geo.box_bm(w - 2 * fw, 0.012, max(0.01, top - o["sillM"] - 2 * fw), o["offsetM"], 0.0, o["sillM"] + fw), lib.glass()))
    else:
        parts.extend(_door_leaves(spec_rooms(wall), wall, o, top, t, lib))
    for i, (bm, mat) in enumerate(parts):
        geo.transform(bm, geo.rot_z(angle))
        bmesh.ops.translate(bm, vec=Vector((origin[0], origin[1], 0.0)), verts=bm.verts)
        ob = geo.new_object(f"{o['kind'].lower()}:{o['id']}:{i}", bm, mat, collection=col)
        ob["homatch"] = {"kind": o["kind"], "opening": o["id"], "wall": wall["id"]}
        out.append(ob)
    return out


# ── Door leaves ───────────────────────────────────────────────────────

OPEN = math.radians(85)
_ROOMS: dict = {"rooms": []}


def spec_rooms(_wall: dict) -> list:
    """The spec's rooms (set by build_walls for the leaves' swing side)."""
    return _ROOMS["rooms"]


def _area(poly) -> float:
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))) / 2


def _inside(p, poly) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        a, b = poly[i], poly[j]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
        j = i
    return inside


def _side_room(rooms: list, wall: dict, o: dict, side: int):
    """The room just beyond one face of the wall at the opening (+1: L, the left walking start->end)."""
    length, u, n, _ = geo.segment_frame(wall["start"], wall["end"])
    reach = wall["thicknessM"] / 2 + 0.3
    p = (wall["start"][0] + u[0] * o["offsetM"] + n[0] * reach * side, wall["start"][1] + u[1] * o["offsetM"] + n[1] * reach * side)
    found = [r for r in rooms if _inside(p, r["polygon"])]
    return min(found, key=lambda r: _area(r["polygon"])) if found else None


def swing_side(rooms: list, wall: dict, o: dict) -> int:
    """+1 (L) or -1 (R): the plan's swing, else the larger indoor room (the walkthrough's rule)."""
    if o.get("swing") in ("L", "R"):
        return 1 if o["swing"] == "L" else -1

    def score(side):
        r = _side_room(rooms, wall, o, side)
        return -1.0 if r is None else (-0.5 if r["outdoor"] else _area(r["polygon"]))

    return 1 if score(1) >= score(-1) else -1


def _borders_outdoor(rooms: list, wall: dict, o: dict) -> bool:
    return any((r := _side_room(rooms, wall, o, s)) is not None and r["outdoor"] for s in (1, -1))


def _panel_leaf(lw: float, lh: float, z0: float, lib, mirror: bool = False) -> list:
    """A panelled leaf with lever handles, hinge at x = 0, extending along +x (-x when mirrored), centred on y = 0."""
    d = -1.0 if mirror else 1.0
    cx = d * lw / 2
    slab = geo.box_bm(lw, 0.04, lh, cx, 0.0, z0, bevel=0.004)
    pw = max(0.1, lw - 0.22)
    for y in (0.024, -0.024):
        slab = geo.merge(slab, geo.box_bm(pw, 0.008, lh * 0.36, cx, y, z0 + lh * 0.09, bevel=0.0015))
        slab = geo.merge(slab, geo.box_bm(pw, 0.008, lh * 0.36, cx, y, z0 + lh * 0.53, bevel=0.0015))
    hx = d * (lw - 0.07)
    handle = geo.box_bm(0.05, 0.01, 0.05, hx, 0.025, 1.0 - 0.025)
    handle = geo.merge(handle, geo.box_bm(0.05, 0.01, 0.05, hx, -0.025, 1.0 - 0.025))
    for y in (0.045, -0.045):
        handle = geo.merge(handle, geo.box_bm(0.13, 0.018, 0.018, hx - d * 0.05, y, 1.0 - 0.009, bevel=0.004))
    return [(slab, lib.door_leaf()), (handle, lib.plain("door-handle", "#8f8d89", 0.3, 0.85))]


def _glazed_leaf(lw: float, lh: float, z0: float, lib, mirror: bool = False, bars: int = 2) -> list:
    """A glazed leaf: a frame, glazing bars and a pane, hinge at x = 0."""
    d = -1.0 if mirror else 1.0
    fw = 0.05
    frame = geo.box_bm(lw, 0.05, fw, d * lw / 2, 0.0, z0)
    frame = geo.merge(frame, geo.box_bm(lw, 0.05, fw, d * lw / 2, 0.0, z0 + lh - fw))
    frame = geo.merge(frame, geo.box_bm(fw, 0.05, lh, d * fw / 2, 0.0, z0))
    frame = geo.merge(frame, geo.box_bm(fw, 0.05, lh, d * (lw - fw / 2), 0.0, z0))
    for k in range(1, bars + 1):
        frame = geo.merge(frame, geo.box_bm(lw - 2 * fw, 0.035, 0.03, d * lw / 2, 0.0, z0 + lh * k / (bars + 1) - 0.015))
    pane = geo.box_bm(lw - 2 * fw, 0.01, lh - 2 * fw, d * lw / 2, 0.0, z0 + fw)
    return [(frame, lib.frame()), (pane, lib.glass())]


def _place(parts: list, rz: float, x: float, y: float) -> list:
    for bm, _ in parts:
        geo.transform(bm, geo.rot_z(rz))
        bmesh.ops.translate(bm, vec=Vector((x, y, 0.0)), verts=bm.verts)
    return parts


def _door_leaves(rooms: list, wall: dict, o: dict, top: float, t: float, lib) -> list:
    """A door's leaf or leaves by how it closes: HINGED / DOUBLE / FRENCH open ~85 deg into the room,
    SLIDING stands slid along the wall's face, NONE has none; a balcony door with no leaf given slides, glazed."""
    leaf = o.get("leaf")
    if leaf == "NONE":
        return []
    w = o["widthM"]
    fw = 0.05
    lh = min(o["heightM"], top) - 0.015
    z0 = o["sillM"]
    side = swing_side(rooms, wall, o)
    face = side * max(0.0, t / 2 - 0.035)
    x0 = o["offsetM"] - w / 2 + fw
    x1 = o["offsetM"] + w / 2 - fw
    balcony = _borders_outdoor(rooms, wall, o)
    if leaf == "SLIDING":
        parts = _panel_leaf(w + 0.04, lh, z0, lib)
        # Slid open along the face it hangs on, as the walkthrough first shows it.
        return _place(parts, 0.0, x0 - 0.02 + 0.95 * w, side * (t / 2 + 0.035))
    if leaf is None and balcony:
        half = (x1 - x0) / 2 + 0.02
        fixed = _glazed_leaf(half, lh, z0, lib, bars=0)
        moving = _glazed_leaf(half, lh, z0, lib, bars=0)
        return _place(fixed, 0.0, x1 - half, -0.03 * side) + _place(moving, 0.0, x0, 0.03 * side)
    if leaf in ("DOUBLE", "FRENCH"):
        half = (x1 - x0) / 2 - 0.003
        make = _glazed_leaf if leaf == "FRENCH" else _panel_leaf
        rot = 0.0 if (leaf == "FRENCH" and balcony) else side * OPEN
        a = make(half, lh, z0, lib)
        b = make(half, lh, z0, lib, mirror=True)
        return _place(a, rot, x0, face) + _place(b, -rot, x1, face)
    # HINGED (or a door the plan does not describe): one panelled leaf, open into the room.
    return _place(_panel_leaf(x1 - x0, lh, z0, lib), side * OPEN, x0, face)


# ── Stairs ────────────────────────────────────────────────────────────

WOOD_PATTERNS = {"WOOD_PLANK", "WOOD_HERRINGBONE", "WOOD_GRAIN"}


def _flight_frame(st: dict):
    a, b = st["a"], st["b"]
    w = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    along = ((b[0] - a[0]) / w, (b[1] - a[1]) / w)
    climb = (-along[1], along[0])
    return w, along, climb, math.atan2(along[1], along[0])


def stair_rect(st: dict) -> list:
    """The flight's footprint: a, b, and the run to their left."""
    w, along, climb, _ = _flight_frame(st)
    a, b, r = st["a"], st["b"], st["runM"]
    return [tuple(a), tuple(b), (b[0] + climb[0] * r, b[1] + climb[1] * r), (a[0] + climb[0] * r, a[1] + climb[1] * r)]


def _cut(target, rect: list, z0: float, z1: float) -> None:
    """A hole through a slab where a flight passes (an exact boolean, applied)."""
    cutter = geo.new_object("_stair_cutter", geo.prism_bm(rect, z0, z1))
    mod = target.modifiers.new("stair", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    try:
        mod.solver = "EXACT"
    except (AttributeError, TypeError):
        pass
    geo.apply_modifiers(target)
    bpy.data.objects.remove(cutter, do_unlink=True)


def _stair_wood(spec: dict, st: dict, lib):
    """Treads wear the floor they rise from when it is wood; otherwise a plain oak."""
    w, along, climb, _ = _flight_frame(st)
    c = (st["a"][0] + along[0] * w / 2 + climb[0] * st["runM"] / 2, st["a"][1] + along[1] * w / 2 + climb[1] * st["runM"] / 2)
    for room in spec["rooms"]:
        if _inside(c, room["polygon"]):
            s = next((x for x in spec["surfaces"] if x["id"] == room["floor"]), None)
            if s and s["pattern"] in WOOD_PATTERNS:
                return lib.surface(room["floor"], "#c19a6b")
    return lib.plain("stair-wood", "#c19a6b", 0.55)


def build_stairs(spec: dict, lib, floors: list, ceilings: list) -> tuple[list, list]:
    """Every flight: treads (with nosing), risers, stringers, rails and balusters on open sides, the lined well,
    and the hole it passes through (the ceiling going up, the floor going down). Returns (stairs, ceiling-wells)."""
    col = _collection("stairs")
    out: list = []
    wells: list = []
    paint = lib.plain("stair-paint", "#f1eee8", 0.45)
    roles = {"TREAD": "wood", "RAIL": "wood", "POST": "wood", "RISER": "paint", "STRINGER": "paint", "BALUSTER": "metal", "GUARD": "metal", "WELL": "well"}
    for st in spec.get("stairs", []):
        open_a, open_b = stair_sides(st, spec["walls"])
        _, _, _, angle = _flight_frame(st)
        mats = {
            "wood": _stair_wood(spec, st, lib), "paint": paint, "metal": lib.rail(),
            "well": lib.plain("stair-well", "#fbfbf9" if st["direction"] == "UP" else "#f7f5f1", 0.9),
        }
        groups: dict = {}
        for part in stair_parts(st, open_a, open_b):
            u, v, h = part["centre"]
            su, sv, sh = part["size"]
            bm = geo.box_bm(su, sv, sh, 0.0, 0.0, -sh / 2, bevel=0.003 if part["kind"] in ("TREAD", "RAIL", "POST") else 0.0)
            geo.transform(bm, geo.Matrix.Rotation(part["pitch"], 4, "X"))
            bmesh.ops.translate(bm, vec=Vector((u, v, h)), verts=bm.verts)
            role = roles[part["kind"]]
            groups[role] = geo.merge(groups[role], bm) if role in groups else bm
        for role, bm in groups.items():
            geo.transform(bm, geo.rot_z(angle))
            bmesh.ops.translate(bm, vec=Vector((st["a"][0], st["a"][1], 0.0)), verts=bm.verts)
            ob = geo.new_object(f"stair:{st['id']}:{role}", bm, mats[role], collection=col)
            geo.metre_uvs(ob, "BOX")
            ob["homatch"] = {"kind": "STAIR", "stair": st["id"], "part": role}
            (wells if role == "well" and st["direction"] == "UP" else out).append(ob)
        # The hole it passes through, in every slab that contains it.
        rect = stair_rect(st)
        targets = ceilings if st["direction"] == "UP" else floors
        for ob in targets:
            room_id = ob.get("homatch", {}).get("room") if hasattr(ob, "get") else None
            room = next((r for r in spec["rooms"] if r["id"] == room_id), None)
            if room is not None and all(_inside(p, room["polygon"]) or _near_edge(p, room["polygon"]) for p in rect):
                _cut(ob, rect, -1.0, spec["ceilingHeightM"] + 1.0)
    return out, wells


def _near_edge(p, poly, eps: float = 1e-3) -> bool:
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        len2 = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) if len2 > 0 else 0.0
        if math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= eps:
            return True
    return False


def build_baseboards(spec: dict, lib) -> list:
    """Skirting along every interior face, broken at doors."""
    col = _collection("trim")
    out = []
    mat = lib.plain("baseboard", "#f2f0ec", 0.5)
    for wall in spec["walls"]:
        length, u, n, angle = geo.segment_frame(wall["start"], wall["end"])
        doors = [(o["offsetM"] - o["widthM"] / 2, o["offsetM"] + o["widthM"] / 2) for o in wall["openings"] if o["kind"] == "DOOR" or o["sillM"] < BASE_H]
        bm = bmesh.new()
        any_piece = False
        for f in wall["faces"]:
            spans = [(max(0.0, f["from"]), min(length, f["to"]))]
            for (a, b) in doors:
                spans = [s for sp in spans for s in ((sp[0], min(sp[1], a)), (max(sp[0], b), sp[1])) if s[1] - s[0] > 0.05]
            off = (wall["thicknessM"] / 2 + BASE_T / 2) * (1 if f["side"] == "L" else -1)
            for (a, b) in spans:
                bm = geo.merge(bm, geo.box_bm(b - a, BASE_T, BASE_H, (a + b) / 2, off, 0.0))
                any_piece = True
        if not any_piece:
            bm.free()
            continue
        geo.transform(bm, geo.rot_z(angle))
        bmesh.ops.translate(bm, vec=Vector((wall["start"][0], wall["start"][1], 0.0)), verts=bm.verts)
        out.append(geo.new_object(f"trim:{wall['id']}", bm, mat, collection=col))
    return out


def build_railings(spec: dict, lib) -> list:
    col = _collection("railings")
    out = []
    for r in spec["railings"]:
        length, u, n, angle = geo.segment_frame(r["a"], r["b"])
        h = r["heightM"]
        glass = geo.box_bm(length, 0.02, h - 0.1, length / 2, 0.0, 0.05)
        metal = geo.box_bm(length, 0.06, 0.05, length / 2, 0.0, h - 0.05, bevel=0.01)
        posts = max(2, round(length / 1.5) + 1)
        for k in range(posts):
            metal = geo.merge(metal, geo.box_bm(0.04, 0.04, h - 0.05, length * k / (posts - 1), 0.0, 0.0))
        for bm, mat, tag in ((glass, lib.glass(), "glass"), (metal, lib.rail(), "rail")):
            geo.transform(bm, geo.rot_z(angle))
            bmesh.ops.translate(bm, vec=Vector((r["a"][0], r["a"][1], 0.0)), verts=bm.verts)
            ob = geo.new_object(f"railing:{r['id']}:{tag}", bm, mat, collection=col)
            ob["homatch"] = {"kind": "RAILING", "railing": r["id"]}
            out.append(ob)
    return out
