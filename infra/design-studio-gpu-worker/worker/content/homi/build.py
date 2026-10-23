"""HOMI — the HOMATCH AI character, built in Blender from HOMATCH-owned code (Content Studio).

Run by the worker as `blender -b --factory-startup --python build.py -- params.json`. The params are
data validated by worker/content/schema.py (stage, frame count, resolution, samples, device, the job
directory); nothing in them is evaluated. Stage PREVIEW_360 builds the model, saves the master .blend,
exports a GLB, re-imports it into an empty file as a check, and renders a turntable for approval.

Coordinates: metres, Z up, HOMI faces -Y, character's left is +X (objects suffixed _L).
Reference: homatch-content/3D/characters/HOMI/references/HOMI_REF_hero_v001.png (one 3/4 front view).
Everything the reference does not show (back, top rear, feet, lower legs, inner arms) is tagged
`homi_inferred = True` on the object and listed in the report.
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

STAGES = ("BUILD", "FRAMES", "ENCODE")
T0 = time.perf_counter()

# ── materials ───────────────────────────────────────────────────────────

MATS = {
    # name: (base rgb, metallic, roughness, coat, emission rgb, emission strength)
    "HOMI_White_Shell": ((0.86, 0.85, 0.82), 0.0, 0.22, 0.7, None, 0.0),
    "HOMI_Gold_Trim": ((0.88, 0.66, 0.36), 1.0, 0.24, 0.0, None, 0.0),
    "HOMI_Black_Gloss": ((0.004, 0.005, 0.008), 0.0, 0.14, 0.25, None, 0.0),
    "HOMI_Black_Joint": ((0.025, 0.027, 0.032), 0.7, 0.32, 0.3, None, 0.0),
    "HOMI_LED_Blue": ((0.02, 0.05, 0.12), 0.0, 0.3, 0.0, (0.10, 0.45, 1.0), 4.0),
    "HOMI_LED_Ring": ((0.02, 0.30, 1.0), 0.0, 0.2, 0.0, (0.03, 0.55, 1.0), 1.6),
    "HOMI_Eye_Iris": ((0.0, 0.05, 0.40), 0.0, 0.25, 0.0, (0.0, 0.30, 1.0), 0.45),
    "HOMI_Eye_Pupil": ((0.002, 0.004, 0.015), 0.0, 0.1, 0.0, (0.0, 0.01, 0.05), 0.6),
    "HOMI_LED_White": ((0.9, 0.95, 1.0), 0.0, 0.2, 0.0, (0.85, 0.95, 1.0), 4.0),
    "HOMI_Text_White": ((0.92, 0.92, 0.92), 0.0, 0.35, 0.0, (1.0, 1.0, 1.0), 0.6),
    "HOMI_Ear_Glass": ((0.01, 0.02, 0.05), 0.0, 0.05, 1.0, (0.01, 0.05, 0.15), 0.6),
}


def make_materials() -> dict:
    out = {}
    for name, (base, metal, rough, coat, emit, strength) in MATS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = m.node_tree.nodes.get("Principled BSDF")
        p.inputs["Base Color"].default_value = (*base, 1.0)
        p.inputs["Metallic"].default_value = metal
        p.inputs["Roughness"].default_value = rough
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = 0.04
        if emit:
            p.inputs["Emission Color"].default_value = (*emit, 1.0)
            p.inputs["Emission Strength"].default_value = strength
        m.diffuse_color = (*base, 1.0)
        out[name] = m
    return out


# ── mesh helpers ────────────────────────────────────────────────────────

def spow(v: float, e: float) -> float:
    return math.copysign(abs(v) ** e, v)


def new_object(name: str, bm: bmesh.types.BMesh, mat, coll, inferred=False, smooth=True) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = smooth
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob["homi_inferred"] = bool(inferred)
    coll.objects.link(ob)
    return ob


def superellipsoid(rx, ry, rz, n=2.0, nz=None, segs=48, rings=28, taper=None) -> bmesh.types.BMesh:
    """A closed quad-dominant superellipsoid centred on the origin. taper(zn) scales x,y by height (zn in -1..1)."""
    nz = nz or n
    bm = bmesh.new()
    bottom = bm.verts.new((0, 0, -rz))
    grid = []
    for i in range(1, rings):
        v = -math.pi / 2 + math.pi * i / rings
        row = []
        cz, sz = math.cos(v), math.sin(v)
        for j in range(segs):
            u = 2 * math.pi * j / segs
            x = rx * spow(cz, 2 / nz) * spow(math.cos(u), 2 / n)
            y = ry * spow(cz, 2 / nz) * spow(math.sin(u), 2 / n)
            z = rz * spow(sz, 2 / nz)
            if taper:
                t = taper(z / rz)
                x, y = x * t, y * t
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    top = bm.verts.new((0, 0, rz))
    for j in range(segs):
        k = (j + 1) % segs
        bm.faces.new((bottom, grid[0][k], grid[0][j]))
        bm.faces.new((top, grid[-1][j], grid[-1][k]))
        for i in range(len(grid) - 1):
            bm.faces.new((grid[i][j], grid[i][k], grid[i + 1][k], grid[i + 1][j]))
    return bm


def tube(points, radius, closed=False, segs=10, caps=True) -> bmesh.types.BMesh:
    """A swept circle along a polyline (parallel-transport frames)."""
    pts = [Vector(p) for p in points]
    bm = bmesh.new()
    n = len(pts)
    tangents = []
    for i in range(n):
        if closed:
            a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        else:
            a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        tangents.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    normal = tangents[0].cross(ref).normalized()
    rings = []
    for i in range(n):
        if i:
            normal = (normal - tangents[i] * normal.dot(tangents[i])).normalized()
        binormal = tangents[i].cross(normal)
        rings.append([bm.verts.new(pts[i] + radius * (math.cos(2 * math.pi * k / segs) * normal + math.sin(2 * math.pi * k / segs) * binormal)) for k in range(segs)])
    last = n if closed else n - 1
    for i in range(last):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for k in range(segs):
            bm.faces.new((r0[k], r0[(k + 1) % segs], r1[(k + 1) % segs], r1[k]))
    if caps and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm


def chaikin(pts, iterations=3, closed=True):
    for _ in range(iterations):
        out = []
        m = len(pts)
        for i in range(m if closed else m - 1):
            p, q = Vector(pts[i]), Vector(pts[(i + 1) % m])
            out += [p * 0.75 + q * 0.25, p * 0.25 + q * 0.75]
        pts = out if closed else [Vector(pts[0]), *out, Vector(pts[-1])]
    return [tuple(p) for p in pts]


def radial_patch(outline, rings=6, depth=0.0) -> bmesh.types.BMesh:
    """A star-shaped 2D outline (x, z) filled with concentric rings (so it can bend onto a surface).
    depth > 0 makes it a closed slab from y=0 (front) to y=depth (back)."""
    cx = sum(p[0] for p in outline) / len(outline)
    cz = sum(p[1] for p in outline) / len(outline)
    bm = bmesh.new()
    m = len(outline)
    layers = [0.0, depth] if depth > 0 else [0.0]
    sheets = []
    for y in layers:
        centre = bm.verts.new((cx, y, cz))
        grid = []
        for r in range(1, rings + 1):
            f = r / rings
            grid.append([bm.verts.new((cx + (x - cx) * f, y, cz + (z - cz) * f)) for x, z in outline])
        front = y == 0.0
        for j in range(m):
            k = (j + 1) % m
            tri = (centre, grid[0][j], grid[0][k])
            bm.faces.new(tri if front else tuple(reversed(tri)))
            for i in range(rings - 1):
                quad = (grid[i][j], grid[i + 1][j], grid[i + 1][k], grid[i][k])
                bm.faces.new(quad if front else tuple(reversed(quad)))
        sheets.append(grid[-1])
    if depth > 0:
        a, b = sheets
        for j in range(m):
            k = (j + 1) % m
            bm.faces.new((a[k], a[j], b[j], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def flat_polygon(outline, depth) -> bmesh.types.BMesh:
    """A simple (possibly concave) polygon in (x, z), extruded from y=0 to y=depth, closed."""
    bm = bmesh.new()
    front = [bm.verts.new((x, 0.0, z)) for x, z in outline]
    back = [bm.verts.new((x, depth, z)) for x, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    m = len(outline)
    for j in range(m):
        k = (j + 1) % m
        bm.faces.new((front[k], front[j], back[j], back[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def strip(centre, widths, depth) -> bmesh.types.BMesh:
    """A tapered ribbon along a 2D centreline (x, z), extruded to y=depth: brows, mouth."""
    pts = [Vector((x, z)) for x, z in centre]
    left, right = [], []
    for i, p in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))
        left.append(p + nrm * widths[i] / 2)
        right.append(p - nrm * widths[i] / 2)
    outline = [(v.x, v.y) for v in left] + [(v.x, v.y) for v in reversed(right)]
    return flat_polygon(outline, depth)


def disc(r_out, r_in=0.0, segs=48, rings=3, depth=0.002) -> bmesh.types.BMesh:
    if r_in <= 0:
        return radial_patch([(r_out * math.cos(2 * math.pi * k / segs), r_out * math.sin(2 * math.pi * k / segs)) for k in range(segs)], rings, depth)
    bm = bmesh.new()
    loops = []
    for y in (0.0, depth):
        loops.append([[bm.verts.new((r * math.cos(2 * math.pi * k / segs), y, r * math.sin(2 * math.pi * k / segs))) for k in range(segs)] for r in (r_in, r_out)])
    (fi, fo), (bi, bo) = loops
    for k in range(segs):
        j = (k + 1) % segs
        bm.faces.new((fi[k], fo[k], fo[j], fi[j]))
        bm.faces.new((bi[j], bo[j], bo[k], bi[k]))
        bm.faces.new((fo[j], fo[k], bo[k], bo[j]))
        bm.faces.new((fi[k], fi[j], bi[j], bi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def shift(bm, dx=0.0, dz=0.0, scale=1.0):
    for v in bm.verts:
        v.co.x = v.co.x * scale + dx
        v.co.z = v.co.z * scale + dz
    return bm


def project(bm, surface, offset):
    """Wrap a flat (x, y=local depth, z) shape onto a front surface y = surface(x, z): front face sits `offset` proud."""
    for v in bm.verts:
        v.co.y = surface(v.co.x, v.co.z) - offset + v.co.y
    return bm


def transformed(bm, matrix):
    bm.transform(matrix)
    return bm


def mirror_object(ob, coll) -> bpy.types.Object:
    """The +X (left) part mirrored to -X (right): mirrored mesh, mirrored transform, normals kept outward."""
    me = ob.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    name = ob.name[:-2] + "_R" if ob.name.endswith("_L") else ob.name + "_R"
    me.name = name
    m = ob.copy()
    m.data = me
    m.name = name
    s = Matrix.Scale(-1, 4, (1, 0, 0))
    m.matrix_world = s @ ob.matrix_world @ s
    coll.objects.link(m)
    return m


# ── HOMI ────────────────────────────────────────────────────────────────

HEAD_C = Vector((0.0, 0.0, 1.47))
HEAD_A, HEAD_B, HEAD_C_R, HEAD_N = 0.255, 0.215, 0.205, 2.7
CHEST_C = Vector((0.0, 0.0, 1.035))
CHEST_RX, CHEST_RY, CHEST_RZ, CHEST_N = 0.232, 0.155, 0.200, 2.5


def chest_taper(zn: float) -> float:
    # widest across the upper chest, narrowing to the waist
    return 0.80 + 0.20 * min(1.0, (zn + 1.0) / 1.25)


def head_front(x: float, z: float) -> float:
    """y of the head's front surface at (x, z) in world space (z absolute)."""
    s = abs(x / HEAD_A) ** HEAD_N + abs((z - HEAD_C.z) / HEAD_C_R) ** HEAD_N
    return -HEAD_B * max(0.0, 1.0 - s) ** (1.0 / HEAD_N)


def chest_front(x: float, z: float) -> float:
    zn = (z - CHEST_C.z) / CHEST_RZ
    t = chest_taper(max(-1.0, min(1.0, zn)))
    s = abs(x / (CHEST_RX * t)) ** CHEST_N + abs(zn) ** CHEST_N
    return -CHEST_RY * t * max(0.0, 1.0 - s) ** (1.0 / CHEST_N)


def limb_matrix(p0: Vector, p1: Vector, up=Vector((0, -1, 0))) -> Matrix:
    """Origin at p0 (the joint), local Z along p0→p1, local Y towards `up` (HOMI's front by default)."""
    z = (p1 - p0).normalized()
    y = (up - z * up.dot(z)).normalized()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = p0
    return m


def segment(name, p0, p1, r0, r1, mat, coll, n=2.3, inferred=False, ry_scale=1.0):
    length = (p1 - p0).length
    bm = superellipsoid(1.0, 1.0, length / 2, n=n, nz=2.2, segs=32, rings=20)
    for v in bm.verts:
        f = (v.co.z + length / 2) / length
        r = r0 + (r1 - r0) * f
        v.co.x *= r
        v.co.y *= r * ry_scale
        v.co.z += length / 2
    ob = new_object(name, bm, mat, coll, inferred)
    ob.matrix_world = limb_matrix(p0, p1)
    return ob


def ball(name, centre, r, mat, coll, inferred=False):
    ob = new_object(name, superellipsoid(r, r, r, segs=24, rings=14), mat, coll, inferred)
    ob.location = centre
    return ob


def ring(name, centre, axis, radius, thickness, mat, coll, inferred=False):
    pts = [(radius * math.cos(2 * math.pi * k / 40), radius * math.sin(2 * math.pi * k / 40), 0) for k in range(40)]
    ob = new_object(name, tube(pts, thickness, closed=True, segs=8), mat, coll, inferred)
    z = Vector(axis).normalized()
    ob.matrix_world = limb_matrix(Vector(centre), Vector(centre) + z) if abs(z.y) < 0.99 else limb_matrix(Vector(centre), Vector(centre) + z, up=Vector((0, 0, 1)))
    return ob


def build_head(M, coll):
    parts = []
    head = new_object("HOMI_Head_Shell", superellipsoid(HEAD_A, HEAD_B, HEAD_C_R, n=HEAD_N, segs=64, rings=40), M["HOMI_White_Shell"], coll)
    head.location = HEAD_C
    parts.append(head)

    # Visor: a rounded-rectangle glass slab following the face's curvature.
    vw, vh, vz = 0.198, 0.132, HEAD_C.z - 0.004
    outline = [(vw * spow(math.cos(t), 0.5), vz + vh * spow(math.sin(t), 0.5)) for t in (2 * math.pi * k / 96 for k in range(96))]
    parts.append(new_object("HOMI_Head_Visor", project(radial_patch(outline, rings=8, depth=0.02), head_front, 0.004), M["HOMI_Black_Gloss"], coll))
    rim = [(x, head_front(x, z) - 0.002, z) for x, z in outline]
    parts.append(new_object("HOMI_Head_VisorRim", tube(rim, 0.0045, closed=True, segs=8), M["HOMI_Black_Joint"], coll))

    # Face (LED on the visor): eyes, brows, mouth. Each is its own object so the rig can drive it.
    face_off = 0.0065
    for side, sx in (("L", 1), ("R", -1)):
        ex, ez = sx * 0.088, HEAD_C.z + 0.012
        layers = [
            ("EyeRing", disc(0.053, 0.040, depth=0.002), "HOMI_LED_Ring", 0.0),
            ("EyeIris", disc(0.0405, depth=0.002), "HOMI_Eye_Iris", 0.0005),
            ("EyePupil", disc(0.021, depth=0.002), "HOMI_Eye_Pupil", 0.0012),
            ("EyeGlint", shift(disc(0.0085, depth=0.001), -0.013 * sx, 0.015), "HOMI_LED_White", 0.002),
            ("EyeGlint2", shift(disc(0.0038, depth=0.001), 0.012 * sx, -0.011), "HOMI_LED_White", 0.002),
        ]
        for nm, bm, mat, lift in layers:
            shift(bm, ex, ez)
            parts.append(new_object(f"HOMI_Face_{nm}_{side}", project(bm, head_front, face_off + lift), M[mat], coll))
        # brow: an arc above the eye, thick in the middle
        bx, bz = ex, ez + 0.040
        arc = [(bx + 0.058 * math.cos(a), bz + 0.030 * math.sin(a)) for a in (math.radians(55 + 70 * i / 16) for i in range(17))]
        widths = [0.004 + 0.008 * math.sin(math.pi * i / 16) for i in range(17)]
        parts.append(new_object(f"HOMI_Face_Brow_{side}", project(strip(arc, widths, 0.002), head_front, face_off), M["HOMI_LED_Ring"], coll))
    # mouth: a filled crescent smile
    mz = HEAD_C.z - 0.072
    top = [(0.040 * math.cos(a), mz + 0.006 * math.sin(a)) for a in (math.radians(180 + 180 * i / 20) for i in range(21))]
    bot = [(0.040 * math.cos(a), mz + 0.024 * math.sin(a)) for a in (math.radians(360 - 180 * i / 20) for i in range(21))]
    mouth = top + bot[1:-1]
    parts.append(new_object("HOMI_Face_Mouth", project(radial_patch(mouth, rings=3, depth=0.002), head_front, face_off), M["HOMI_LED_Ring"], coll))

    # Ear pods: gold rim, black housing, blue LED ring, dark glass centre (axis along X).
    for side, sx in (("L", 1), ("R", -1)):
        c = Vector((sx * (HEAD_A - 0.004), 0.008, HEAD_C.z - 0.005))
        axis = Vector((sx, 0, 0))
        pod = [
            ("EarHousing", disc(0.074, depth=0.040), "HOMI_Black_Joint", 0.000),
            ("EarRimGold", disc(0.080, 0.064, depth=0.022), "HOMI_Gold_Trim", 0.020),
            ("EarLED", disc(0.058, 0.050, depth=0.004), "HOMI_LED_Ring", 0.032),
            ("EarGlass", disc(0.050, depth=0.006), "HOMI_Ear_Glass", 0.030),
        ]
        for nm, bm, mat, out in pod:
            # local: disc lies in XZ facing -Y; turn so it faces outward along ±X, pushed out by `out`
            rot = Matrix.Rotation(math.radians(90 * sx), 4, "Z")
            bm.transform(Matrix.Translation((0, -out, 0)))
            bm.transform(rot)
            ob = new_object(f"HOMI_Head_{nm}_{side}", bm, M[mat], coll)
            ob.location = c + axis * 0.004
            parts.append(ob)

    # Crest: the dark panel on the top-front of the head with a gold outline. Front from the reference;
    # its run over the top to the back is inferred.
    def crest_point(x, phi, lift):
        # phi: angle in the YZ plane from the front (0) over the top (90°) to the back (180°)
        d = Vector((0, -math.cos(math.radians(phi)), math.sin(math.radians(phi))))
        # find the head surface along direction (x offset, d) by bisection on the implicit
        lo, hi = 0.0, 0.4
        for _ in range(40):
            mid = (lo + hi) / 2
            p = Vector((x, d.y * mid, d.z * mid))
            s = abs(p.x / HEAD_A) ** HEAD_N + abs(p.y / HEAD_B) ** HEAD_N + abs(p.z / HEAD_C_R) ** HEAD_N
            lo, hi = (mid, hi) if s < 1 else (lo, mid)
        p = Vector((x, d.y * lo, d.z * lo))
        return HEAD_C + p + p.normalized() * lift
    bm = bmesh.new()
    xs = [-0.075 + 0.15 * i / 8 for i in range(9)]
    phis = [48 + 100 * j / 24 for j in range(25)]
    grid = [[bm.verts.new(crest_point(x * (1 - 0.25 * (j / 24)), phi, 0.004)) for x in xs] for j, phi in enumerate(phis)]
    for j in range(len(phis) - 1):
        for i in range(len(xs) - 1):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.004)
    crest = new_object("HOMI_Head_Crest", bm, M["HOMI_Black_Gloss"], coll, inferred=True)
    parts.append(crest)
    edge = [crest_point(-0.075 * (1 - 0.25 * j / 24), phis[j], 0.006) for j in range(25)]
    edge += [crest_point(0.075 * (1 - 0.25 * j / 24), phis[j], 0.006) for j in reversed(range(25))]
    parts.append(new_object("HOMI_Head_CrestTrim", tube(edge, 0.0028, closed=True, segs=6), M["HOMI_Gold_Trim"], coll, inferred=True))

    # Neck: dark joint with a gold collar under the head.
    parts.append(segment("HOMI_Neck_Joint", Vector((0, 0.005, 1.205)), Vector((0, 0.005, 1.300)), 0.058, 0.050, M["HOMI_Black_Joint"], coll))
    parts.append(ring("HOMI_Neck_CollarGold", (0, 0.005, 1.282), (0, 0, 1), 0.062, 0.006, M["HOMI_Gold_Trim"], coll))
    return parts


def build_torso(M, coll):
    parts = []
    chest = new_object("HOMI_Torso_Chest", superellipsoid(CHEST_RX, CHEST_RY, CHEST_RZ, n=CHEST_N, segs=56, rings=32, taper=chest_taper), M["HOMI_White_Shell"], coll)
    chest.location = CHEST_C
    parts.append(chest)
    # shield-shaped black chest plate with a gold border
    cz = CHEST_C.z
    shield = chaikin([(-0.150, cz + 0.165), (0.150, cz + 0.165), (0.188, cz + 0.070), (0.108, cz - 0.150), (0.0, cz - 0.192),
                      (-0.108, cz - 0.150), (-0.188, cz + 0.070)], iterations=3)
    parts.append(new_object("HOMI_Torso_ChestPlate", project(radial_patch(shield, rings=7, depth=0.012), chest_front, 0.004), M["HOMI_Black_Gloss"], coll))
    border = [(x, chest_front(x, z) - 0.006, z) for x, z in shield]
    parts.append(new_object("HOMI_Torso_ChestTrim", tube(border, 0.0035, closed=True, segs=8), M["HOMI_Gold_Trim"], coll))
    # blue light lines down the sides of the plate
    for side, sx in (("L", 1), ("R", -1)):
        line = [(sx * (0.200 - 0.085 * f ** 1.3), cz + 0.075 - 0.230 * f) for f in (i / 14 for i in range(15))]
        pts = [(x, chest_front(x, z) - 0.003, z) for x, z in line]
        parts.append(new_object(f"HOMI_Torso_LightLine_{side}", tube(pts, 0.0032, segs=8), M["HOMI_LED_Blue"], coll))
    # HOMATCH house mark (gold) and wordmark (white)
    s, lx, lz = 0.086, 0.0, cz + 0.068
    outer = [(-0.5, 0.0), (-0.5, 0.56), (0.0, 1.0), (0.5, 0.56), (0.5, 0.0), (0.37, 0.0), (0.37, 0.49), (0.0, 0.82), (-0.37, 0.49), (-0.37, 0.0)]
    inner = [(-0.25, 0.0), (-0.25, 0.43), (0.0, 0.63), (0.25, 0.43), (0.25, 0.0), (0.13, 0.0), (0.13, 0.37), (0.0, 0.47), (-0.13, 0.37), (-0.13, 0.0)]
    for nm, poly in (("LogoOuter", outer), ("LogoInner", inner)):
        bm = flat_polygon([(lx + x * s, lz + z * s - 0.5 * s) for x, z in poly], 0.002)
        parts.append(new_object(f"HOMI_Torso_{nm}", project(bm, chest_front, 0.0075), M["HOMI_Gold_Trim"], coll, smooth=False))
    parts.append(wordmark("HOMI_Torso_Wordmark", "HOMATCH", 0.0, cz - 0.008, 0.044, M["HOMI_Text_White"], coll))

    # waist, gold belt line, pelvis
    parts.append(segment("HOMI_Torso_Waist", Vector((0, 0.0, 0.790)), Vector((0, 0.0, 0.905)), 0.160, 0.182, M["HOMI_Black_Joint"], coll, n=2.8, ry_scale=0.74))
    parts.append(ring("HOMI_Torso_BeltGold", (0, 0.0, 0.842), (0, 0, 1), 0.176, 0.006, M["HOMI_Gold_Trim"], coll))
    pelvis = new_object("HOMI_Torso_Pelvis", superellipsoid(0.180, 0.130, 0.080, n=2.6, segs=48, rings=20, taper=lambda zn: 0.86 + 0.14 * (zn + 1) / 2), M["HOMI_White_Shell"], coll)
    pelvis.location = (0, 0.0, 0.765)
    parts.append(pelvis)
    plate = chaikin([(-0.055, 0.80), (0.055, 0.80), (0.035, 0.715), (-0.035, 0.715)], 2)
    pelvis_front = lambda x, z: -0.125 * max(0.0, 1 - abs(x / 0.165) ** 2.6 - abs((z - 0.765) / 0.075) ** 2.6) ** (1 / 2.6) * (0.86 + 0.14 * ((z - 0.765) / 0.075 + 1) / 2)
    parts.append(new_object("HOMI_Torso_PelvisPlate", project(radial_patch(plate, rings=3, depth=0.01), pelvis_front, 0.003), M["HOMI_Black_Gloss"], coll))
    # back: plain shell (inferred) — the reference shows no back
    for ob in (chest, pelvis):
        ob["homi_inferred_region"] = "back half"
    return parts


def wordmark(name, text, x, z, size, mat, coll):
    cu = bpy.data.curves.new(name + "_text", type="FONT")
    cu.body = text
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.size = size
    cu.space_character = 1.12
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    coll.objects.link(tmp)
    tmp.rotation_euler = (math.pi / 2, 0, 0)  # text in XZ, reading from the front
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    me.transform(tmp.matrix_world)
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    for v in bm.verts:
        v.co.y = 0.0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    ext = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.y = 0.0012
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shift(bm, x, z)
    return new_object(name, project(bm, chest_front, 0.0072), mat, coll, smooth=False)


def build_arm_left(M, coll):
    """Left arm (+X) in a relaxed A-pose; returns parts and the joint positions (for the future rig)."""
    parts = []
    sh = Vector((0.300, 0.0, 1.165))
    down = Vector((0.42, -0.04, -0.906)).normalized()
    el = sh + down * 0.265
    fdir = (down + Vector((0, -0.16, 0))).normalized()
    wr = el + fdir * 0.235
    parts.append(ball("HOMI_Arm_ShoulderJoint_L", sh, 0.072, M["HOMI_Black_Joint"], coll))
    pad = new_object("HOMI_Arm_ShoulderPad_L", superellipsoid(0.112, 0.104, 0.098, n=2.3, segs=40, rings=24,
                     taper=None), M["HOMI_White_Shell"], coll)
    pad.location = sh + Vector((0.022, 0, 0.022))
    parts.append(pad)
    parts.append(ring("HOMI_Arm_ShoulderLED_L", sh + Vector((0.050, 0, -0.058)), down, 0.080, 0.0050, M["HOMI_LED_Blue"], coll))
    parts.append(ring("HOMI_Arm_ShoulderBand_L", sh + Vector((0.044, 0, -0.066)), down, 0.088, 0.012, M["HOMI_Black_Joint"], coll))
    parts.append(segment("HOMI_Arm_Upper_L", sh + down * 0.07, el - down * 0.02, 0.066, 0.058, M["HOMI_White_Shell"], coll))
    parts.append(ball("HOMI_Arm_Elbow_L", el, 0.052, M["HOMI_Black_Joint"], coll))
    parts.append(ring("HOMI_Arm_ElbowGold_L", el + fdir * 0.03, fdir, 0.056, 0.005, M["HOMI_Gold_Trim"], coll))
    parts.append(segment("HOMI_Arm_Forearm_L", el + fdir * 0.03, wr - fdir * 0.012, 0.062, 0.072, M["HOMI_White_Shell"], coll))
    # blue line along the outer forearm
    fm = limb_matrix(el, wr)
    line = [fm @ Vector((0.074 - 0.006 * abs(f - 0.6), 0.0, 0.07 + 0.15 * f)) for f in (i / 10 for i in range(11))]
    parts.append(new_object("HOMI_Arm_ForearmLED_L", tube(line, 0.003, segs=6), M["HOMI_LED_Blue"], coll, inferred=True))
    parts.append(ring("HOMI_Arm_WristGold_L", wr - fdir * 0.006, fdir, 0.060, 0.006, M["HOMI_Gold_Trim"], coll))
    parts.append(segment("HOMI_Arm_Wrist_L", wr - fdir * 0.01, wr + fdir * 0.03, 0.040, 0.036, M["HOMI_Black_Joint"], coll))
    parts += build_hand_left(M, coll, wr + fdir * 0.03, fdir, scale=1.22)
    return parts, {"shoulder": sh, "elbow": el, "wrist": wr}


def build_hand_left(M, coll, base, fdir, scale=1.0):
    """Palm faces the body (-X); thumb forward. Glossy white phalanges with black knuckles (reference)."""
    parts = []
    hm = limb_matrix(base, base + fdir)  # local Z along the hand, local Y forward, local X outward (back of hand)
    palm = new_object("HOMI_Hand_Palm_L", transformed(superellipsoid(0.024, 0.044, 0.047, n=2.6, segs=32, rings=18), Matrix.Translation((0, 0, 0.047))), M["HOMI_White_Shell"], coll)
    palm.matrix_world = hm
    parts.append(palm)
    fingers = {"Index": (0.031, [0.030, 0.024, 0.020]), "Middle": (0.010, [0.033, 0.026, 0.021]),
               "Ring": (-0.011, [0.030, 0.024, 0.020]), "Pinky": (-0.030, [0.024, 0.019, 0.017])}
    for fname, (y, lengths) in fingers.items():
        p = hm @ Vector((-0.004, y, 0.094))
        d = fdir.copy()
        curl_axis = (hm.to_3x3() @ Vector((0, 1, 0))).normalized()
        for k, L in enumerate(lengths):
            d = (Matrix.Rotation(math.radians(-14), 3, curl_axis) @ d).normalized()  # curl towards the palm (-X local)
            parts.append(ball(f"HOMI_Hand_{fname}Knuckle{k + 1}_L", p, 0.0112 - 0.0012 * k, M["HOMI_Black_Joint"], coll))
            q = p + d * L
            parts.append(segment(f"HOMI_Hand_{fname}{k + 1}_L", p + d * 0.006, q - d * 0.002, 0.0108 - 0.001 * k, 0.0098 - 0.001 * k, M["HOMI_White_Shell"], coll, n=2.2))
            p = q
    # thumb: from the forward side of the palm, pointing forward and down
    tp = hm @ Vector((-0.010, 0.040, 0.030))
    td = (hm.to_3x3() @ Vector((-0.30, 0.62, 0.72))).normalized()
    for k, L in enumerate([0.030, 0.024]):
        parts.append(ball(f"HOMI_Hand_ThumbKnuckle{k + 1}_L", tp, 0.0125 - 0.0012 * k, M["HOMI_Black_Joint"], coll))
        q = tp + td * L
        parts.append(segment(f"HOMI_Hand_Thumb{k + 1}_L", tp + td * 0.006, q, 0.0118, 0.0105, M["HOMI_White_Shell"], coll, n=2.2))
        tp = q
        td = (Matrix.Rotation(math.radians(-12), 3, hm.to_3x3() @ Vector((0, 0, 1))) @ td).normalized()
    # uniform scale about the wrist end: the reference's hands are large and chunky
    bpy.context.view_layer.update()
    s = Matrix.Translation(base) @ Matrix.Scale(scale, 4) @ Matrix.Translation(-base)
    for ob in parts:
        ob.matrix_world = s @ ob.matrix_world
    return parts


def build_leg_left(M, coll):
    """Thighs from the reference (white with dark side panels and blue light); shins and feet inferred."""
    parts = []
    hip = Vector((0.105, 0.0, 0.715))
    knee = Vector((0.112, -0.008, 0.415))
    ankle = Vector((0.116, 0.0, 0.105))
    parts.append(ball("HOMI_Leg_HipJoint_L", hip, 0.066, M["HOMI_Black_Joint"], coll))
    parts.append(segment("HOMI_Leg_Thigh_L", hip + Vector((0, 0, -0.02)), knee + Vector((0, 0, 0.035)), 0.092, 0.070, M["HOMI_White_Shell"], coll))
    tm = limb_matrix(hip, knee)
    panel = [tm @ Vector((0.084 - 0.014 * f, 0.0, 0.04 + 0.21 * f)) for f in (i / 10 for i in range(11))]
    parts.append(new_object("HOMI_Leg_ThighLED_L", tube(panel, 0.0034, segs=6), M["HOMI_LED_Blue"], coll))
    parts.append(ball("HOMI_Leg_Knee_L", knee, 0.058, M["HOMI_Black_Joint"], coll, inferred=True))
    parts.append(ring("HOMI_Leg_KneeGold_L", knee + Vector((0, 0, -0.035)), (0, 0, -1), 0.062, 0.005, M["HOMI_Gold_Trim"], coll, inferred=True))
    parts.append(segment("HOMI_Leg_Shin_L", knee + Vector((0, 0, -0.035)), ankle + Vector((0, 0, 0.03)), 0.072, 0.056, M["HOMI_White_Shell"], coll, inferred=True))
    parts.append(ball("HOMI_Leg_Ankle_L", ankle, 0.036, M["HOMI_Black_Joint"], coll, inferred=True))
    foot = new_object("HOMI_Leg_Foot_L", superellipsoid(0.066, 0.125, 0.046, n=2.8, segs=40, rings=20), M["HOMI_White_Shell"], coll, inferred=True)
    foot.location = (0.116, -0.045, 0.058)
    parts.append(foot)
    sole = new_object("HOMI_Leg_Sole_L", superellipsoid(0.068, 0.127, 0.012, n=3.2, segs=40, rings=10), M["HOMI_Black_Joint"], coll, inferred=True)
    sole.location = (0.116, -0.045, 0.012)
    parts.append(sole)
    return parts, {"hip": hip, "knee": knee, "ankle": ankle}


def build_homi() -> tuple[bpy.types.Object, dict]:
    M = make_materials()
    root_coll = bpy.data.collections.new("HOMI")
    bpy.context.scene.collection.children.link(root_coll)
    colls = {}
    for nm in ("Head", "Face", "Torso", "Arms", "Hands", "Legs"):
        c = bpy.data.collections.new(f"HOMI_{nm}")
        root_coll.children.link(c)
        colls[nm] = c
    parts = build_head(M, colls["Head"])
    for ob in parts:
        if ob.name.startswith("HOMI_Face_"):
            colls["Head"].objects.unlink(ob)
            colls["Face"].objects.link(ob)
    parts += build_torso(M, colls["Torso"])
    arm, arm_joints = build_arm_left(M, colls["Arms"])
    leg, leg_joints = build_leg_left(M, colls["Legs"])
    for ob in arm:
        if ob.name.startswith("HOMI_Hand_"):
            colls["Arms"].objects.unlink(ob)
            colls["Hands"].objects.link(ob)
    bpy.context.view_layer.update()  # parts placed by .location need their world matrices before mirroring/parenting
    mirrored = []
    for ob in arm + leg:
        mirrored.append(mirror_object(ob, ob.users_collection[0]))
    parts += arm + leg + mirrored
    root = bpy.data.objects.new("HOMI_ROOT", None)
    root.empty_display_type = "PLAIN_AXES"
    root_coll.objects.link(root)
    bpy.context.view_layer.update()
    for ob in parts:
        mw = ob.matrix_world.copy()
        ob.parent = root
        ob.matrix_world = mw
        ob["homi_asset"] = "HOMI"
    joints = {**{f"{k}_L": list(v) for k, v in arm_joints.items()}, **{f"{k}_L": list(v) for k, v in leg_joints.items()},
              "neck": [0, 0.005, 1.205], "head": list(HEAD_C)}
    return root, {"parts": parts, "joints": joints, "materials": list(M)}


def box_uv(me, scale=4.0):
    """UVs for later texture work: a deterministic box projection (metres × scale), one UV map per part."""
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][axis]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co[a] * scale, co[b] * scale)


# ── checks ──────────────────────────────────────────────────────────────

def geometry_report(parts) -> dict:
    tris = verts = 0
    open_edges = {}
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in parts:
        me = ob.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        verts += len(me.vertices)
        bm = bmesh.new()
        bm.from_mesh(me)
        n_open = sum(1 for e in bm.edges if not e.is_manifold)
        bm.free()
        if n_open:
            open_edges[ob.name] = n_open
        for v in me.vertices:
            w = ob.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    size = hi - lo
    return {
        "objects": len(parts), "vertices": verts, "triangles": tris,
        "bbox_min": [round(c, 4) for c in lo], "bbox_max": [round(c, 4) for c in hi],
        "height_m": round(size.z, 4), "width_m": round(size.x, 4), "depth_m": round(size.y, 4),
        "non_manifold": open_edges,
        "inferred": sorted(ob.name for ob in parts if ob.get("homi_inferred")),
        "materials": sorted({s.material.name for ob in parts for s in ob.material_slots if s.material}),
    }


# ── look and render ────────────────────────────────────────────────────

def use_device(scene, device: str) -> str:
    scene.render.engine = "CYCLES"
    if device != "CPU":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.refresh_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                scene.cycles.device = "GPU"
                return kind
    scene.cycles.device = "CPU"
    return "CPU"


def studio(scene, size: int, samples: int):
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    world = bpy.data.worlds.new("HOMI_Studio_World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.028, 0.032, 0.040, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world
    lights = bpy.data.collections.new("LOOKDEV_Studio")
    scene.collection.children.link(lights)

    def area(name, loc, energy, size_, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size, ld.color = energy, size_, color
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = (Vector((0, 0, 1.0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        lights.objects.link(ob)
    area("Key", (-2.4, -2.8, 2.8), 520, 2.0, (1.0, 0.96, 0.9))
    area("Fill", (2.8, -2.2, 1.5), 160, 2.5, (0.88, 0.93, 1.0))
    area("Rim", (0.6, 2.8, 2.4), 420, 1.5)
    ground = new_object("LOOKDEV_Ground", disc(4.0, depth=0.0, rings=2, segs=64), _ground_mat(), lights, smooth=False)
    ground.rotation_euler = (math.pi / 2, 0, 0)
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 70
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    cam.location = (0, -3.95, 1.02)
    cam.rotation_euler = (Vector((0, 0, 0.87)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    lights.objects.link(cam)
    scene.camera = cam


def _ground_mat():
    m = bpy.data.materials.new("LOOKDEV_Ground")
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.018, 0.019, 0.022, 1)
    p.inputs["Roughness"].default_value = 0.45
    return m


def encode_mp4(frames_dir: Path, count: int, fps: int, size: int, out: Path):
    seq = bpy.data.scenes.new("HOMI_Encode")
    seq.render.resolution_x = seq.render.resolution_y = size
    seq.render.resolution_percentage = 100
    seq.render.fps = fps
    seq.frame_start, seq.frame_end = 1, count
    ed = seq.sequence_editor_create()
    files = sorted(frames_dir.glob("f[0-9][0-9][0-9][0-9].png"))
    strip_ = ed.strips.new_image("frames", str(files[0]), 1, 1)
    for f in files[1:]:
        strip_.elements.append(f.name)
    s = seq.render.image_settings
    try:
        s.media_type = "VIDEO"
    except (AttributeError, TypeError):
        pass
    s.file_format = "FFMPEG"
    seq.render.ffmpeg.format = "MPEG4"
    seq.render.ffmpeg.codec = "H264"
    seq.render.ffmpeg.constant_rate_factor = "HIGH"
    seq.render.ffmpeg.gopsize = fps
    seq.render.use_sequencer = True
    seq.render.filepath = str(out)
    bpy.ops.render.render(animation=True, scene=seq.name)
    bpy.data.scenes.remove(seq)


def _model(report: dict):
    t = time.perf_counter()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "HOMI_Master"
    scene.unit_settings.system = "METRIC"
    root, built = build_homi()
    for ob in built["parts"]:
        box_uv(ob.data)
    report["geometry"] = geometry_report(built["parts"])
    report["joints"] = built["joints"]
    report["timings"]["build_s"] = round(time.perf_counter() - t, 2)
    return scene, root


def main():
    """BUILD: model, master .blend, GLB, checks, face still. FRAMES: one chunk of turntable frames. ENCODE: frames to MP4.
    The model is deterministic, so every FRAMES chunk rebuilds exactly the geometry BUILD saved."""
    argv = sys.argv[sys.argv.index("--") + 1:]
    params = json.loads(Path(argv[0]).read_text())
    stage = params.get("stage")
    if stage not in STAGES:
        raise SystemExit("unknown stage")
    out = Path(params["out"])
    out.mkdir(parents=True, exist_ok=True)
    report = {"ok": False, "stage": stage, "blender": bpy.app.version_string, "timings": {}}

    if stage == "ENCODE":
        t = time.perf_counter()
        bpy.ops.wm.read_factory_settings(use_empty=True)
        mp4 = out / params["files"]["mp4"]
        encode_mp4(Path(params["frames_dir"]), params["frames"], params["fps"], params["size"], mp4)
        report["timings"]["encode_s"] = round(time.perf_counter() - t, 2)
        report["ok"] = mp4.exists() and mp4.stat().st_size > 0

    elif stage == "FRAMES":
        scene, root = _model(report)
        t = time.perf_counter()
        report["device"] = use_device(scene, params.get("device", "AUTO"))
        studio(scene, params["size"], params["samples"])
        scene.render.image_settings.file_format = "PNG"
        n, start, count = params["frames"], params["start"], params["count"]
        for i in range(start, start + count):
            root.rotation_euler = (0, 0, 2 * math.pi * i / n)
            scene.render.filepath = str(out / f"f{i:04d}.png")
            bpy.ops.render.render(write_still=True)
        report["timings"]["render_s"] = round(time.perf_counter() - t, 2)
        report["ok"] = all((out / f"f{i:04d}.png").exists() for i in range(start, start + count))

    else:  # BUILD
        scene, root = _model(report)
        # master .blend (model only; no look-dev lights inside the asset collection)
        t = time.perf_counter()
        blend = out / params["files"]["blend"]
        bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True, relative_remap=True)
        glb = out / params["files"]["glb"]
        bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=False, export_apply=True, export_yup=True, export_extras=True)
        report["timings"]["save_export_s"] = round(time.perf_counter() - t, 2)
        # face close-up (3/4 front, 85 mm) on the studio set
        t = time.perf_counter()
        report["device"] = use_device(scene, params.get("device", "AUTO"))
        studio(scene, params["size"], params["samples"])
        scene.render.image_settings.file_format = "PNG"
        cam = bpy.data.cameras.new("FaceCam")
        cam.lens = 85
        fc = bpy.data.objects.new("FaceCam", cam)
        fc.location = (-0.55, -1.35, 1.52)
        fc.rotation_euler = (Vector((0, 0, 1.46)) - fc.location).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(fc)
        scene.camera = fc
        scene.render.filepath = str(out / params["files"]["face"])
        bpy.ops.render.render(write_still=True)
        report["timings"]["face_s"] = round(time.perf_counter() - t, 2)
        # the GLB must come back into an empty file with every mesh
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(glb))
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        report["glb_reimport"] = {"meshes": len(meshes), "expected": report["geometry"]["objects"]}
        # the master must reopen with every object and material
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        report["blend_reopen"] = {"objects": len([o for o in bpy.data.objects if o.type == "MESH" and o.get("homi_asset") == "HOMI"]),
                                  "materials": len([m for m in bpy.data.materials if m.name.startswith("HOMI_")]),
                                  "missing_files": sorted(i.filepath for i in bpy.data.images if i.source == "FILE" and not i.packed_file and not Path(bpy.path.abspath(i.filepath)).exists())}
        report["ok"] = (report["glb_reimport"]["meshes"] == report["glb_reimport"]["expected"]
                        and report["blend_reopen"]["objects"] == report["geometry"]["objects"]
                        and not report["blend_reopen"]["missing_files"])

    report["timings"]["total_s"] = round(time.perf_counter() - T0, 2)
    Path(params["report"]).write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
