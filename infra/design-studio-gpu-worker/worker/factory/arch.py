"""Architecture from the spec: floor slabs, walls with real openings, doors, windows, railings, baseboards, ceilings.

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
        # The leaf stands open against the room, hinged at the opening's start (a doorway reads as a doorway).
        leaf_h = min(o["heightM"], top) - 0.01
        hinge = o["offsetM"] - w / 2 + fw
        leaf = geo.box_bm(w - 2 * fw, 0.04, leaf_h, (w - 2 * fw) / 2, 0.0, o["sillM"])
        geo.transform(leaf, geo.rot_z(math.pi / 2 * 0.92))
        bmesh.ops.translate(leaf, vec=Vector((hinge, t / 2 + 0.02, 0.0)), verts=leaf.verts)
        parts.append((leaf, lib.door_leaf()))
    for i, (bm, mat) in enumerate(parts):
        geo.transform(bm, geo.rot_z(angle))
        bmesh.ops.translate(bm, vec=Vector((origin[0], origin[1], 0.0)), verts=bm.verts)
        ob = geo.new_object(f"{o['kind'].lower()}:{o['id']}:{i}", bm, mat, collection=col)
        ob["homatch"] = {"kind": o["kind"], "opening": o["id"], "wall": wall["id"]}
        out.append(ob)
    return out


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
