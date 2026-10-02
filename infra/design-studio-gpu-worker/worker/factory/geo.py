"""Geometry primitives the factory builds everything from (bmesh, applied, exportable).

Every mesh is real geometry in metres: boxes with small bevels (nothing real has
a razor edge), cylinders, cones, spheres, extruded polygons. UVs are written in
metres so a material's tile size means the same thing on every surface.
"""
from __future__ import annotations

import math

import bmesh  # type: ignore
import bpy  # type: ignore
from mathutils import Matrix, Vector  # type: ignore


def new_object(name: str, bm: bmesh.types.BMesh, material=None, parent=None, collection=None):
    me = bpy.data.meshes.new(name[:63])
    bm.to_mesh(me)
    bm.free()
    if material is not None:
        me.materials.append(material)
    ob = bpy.data.objects.new(name[:63], me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    if parent is not None:
        ob.parent = parent
    for poly in me.polygons:
        poly.use_smooth = False
    return ob


def empty(name: str, collection=None, parent=None):
    ob = bpy.data.objects.new(name[:63], None)
    ob.empty_display_type = "PLAIN_AXES"
    (collection or bpy.context.scene.collection).objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def box_bm(w: float, d: float, h: float, x: float = 0.0, y: float = 0.0, z0: float = 0.0, bevel: float = 0.0) -> bmesh.types.BMesh:
    """An axis-aligned box w (x) × d (y) × h (z), centred on (x, y), bottom at z0."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((max(w, 1e-4), max(d, 1e-4), max(h, 1e-4))), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z0 + h / 2)), verts=bm.verts)
    b = min(bevel, w / 2.2, d / 2.2, h / 2.2)
    if b > 0.002:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=2, affect="EDGES", profile=0.6)
    return bm


def cylinder_bm(r1: float, r2: float, h: float, x: float = 0.0, y: float = 0.0, z0: float = 0.0, segments: int = 32) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=max(r1, 1e-4), radius2=max(r2, 0.0), depth=max(h, 1e-4))
    bmesh.ops.translate(bm, vec=Vector((x, y, z0 + h / 2)), verts=bm.verts)
    return bm


def sphere_bm(r: float, x: float = 0.0, y: float = 0.0, z: float = 0.0, sx: float = 1.0, sy: float = 1.0, sz: float = 1.0, subdiv: int = 2) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    bmesh.ops.scale(bm, vec=Vector((sx, sy, sz)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z)), verts=bm.verts)
    return bm


def prism_bm(points: list[tuple[float, float]], z0: float, z1: float) -> bmesh.types.BMesh:
    """A polygon extruded from z0 to z1 (a floor slab, a ceiling, a rug)."""
    bm = bmesh.new()
    pts = list(points)
    # Counter-clockwise, so the top face looks up.
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts.reverse()
    verts = [bm.verts.new((p[0], p[1], z1)) for p in pts]
    top = bm.faces.new(verts)
    if z1 - z0 > 1e-4:
        ext = bmesh.ops.extrude_face_region(bm, geom=[top])
        down = [v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=Vector((0, 0, z0 - z1)), verts=down)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def merge(*bms: bmesh.types.BMesh) -> bmesh.types.BMesh:
    """One bmesh from several (each consumed)."""
    out = bmesh.new()
    for b in bms:
        me = bpy.data.meshes.new("_tmp")
        b.to_mesh(me)
        b.free()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
    return out


def transform(bm: bmesh.types.BMesh, m: Matrix) -> bmesh.types.BMesh:
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def rot_z(a: float) -> Matrix:
    return Matrix.Rotation(a, 4, "Z")


def metre_uvs(ob, mode: str = "PLANAR_XY", origin: tuple[float, float] = (0.0, 0.0), axis: tuple[float, float] | None = None) -> None:
    """UVs in metres: planar over the floor, or (along the wall, height) for a wall."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if mode == "WALL" and axis is not None:
                along = (co.x - origin[0]) * axis[0] + (co.y - origin[1]) * axis[1]
                side = -co.x * axis[1] + co.y * axis[0]
                if abs(n.z) > 0.7:
                    uv[li].uv = (along, side)
                elif abs(n.x * axis[0] + n.y * axis[1]) > 0.7:
                    uv[li].uv = (side, co.z)
                else:
                    uv[li].uv = (along, co.z)
            elif mode == "BOX":
                if abs(n.z) >= max(abs(n.x), abs(n.y)):
                    uv[li].uv = (co.x, co.y)
                elif abs(n.x) >= abs(n.y):
                    uv[li].uv = (co.y, co.z)
                else:
                    uv[li].uv = (co.x, co.z)
            else:
                uv[li].uv = (co.x, co.y)


def bend(ob, angle: float, axis: str = "Z") -> None:
    """A straight piece bent into an arc (a curved sofa), applied."""
    mod = ob.modifiers.new("bend", "SIMPLE_DEFORM")
    mod.deform_method = "BEND"
    mod.deform_axis = axis
    mod.angle = angle
    apply_modifiers(ob)


def slice_along_x(ob, n: int) -> None:
    """Cut a mesh into n slices across its length (planes normal to x): a bend then curves smoothly."""
    me = ob.data
    xs = [v.co.x for v in me.vertices]
    if not xs:
        return
    lo, hi = min(xs), max(xs)
    bm = bmesh.new()
    bm.from_mesh(me)
    for i in range(1, n):
        x = lo + (hi - lo) * i / n
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(x, 0.0, 0.0), plane_no=(1.0, 0.0, 0.0))
    bm.to_mesh(me)
    bm.free()
    me.update()


def apply_modifiers(ob) -> None:
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)


def segment_frame(a: tuple[float, float], b: tuple[float, float]):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    u = (dx / length, dy / length) if length > 0 else (1.0, 0.0)
    return length, u, (-u[1], u[0]), math.atan2(dy, dx)
