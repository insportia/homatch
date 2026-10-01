"""Run inside Blender (background): blender -b --factory-startup --python blender_normalize.py -- <params.json>

Takes a generated model and makes it a HOMATCH runtime piece:
  * one object, transforms applied, Y-up glTF in / out;
  * turned so its width runs along X and its FRONT faces -Z (glTF), the
    HOMATCH convention (a piece's front faces local -z);
  * the centre of its footprint at the origin, its lowest point on the floor;
  * scaled to the size the picture showed (uniformly, then each axis
    corrected by at most ±35 %, so a real form is not distorted);
  * decimated to the triangle budget; images capped to the texture size;
  * exported as GLB.
Only the JSON parameters are read. No code from a job, a user or a model is run.
"""
import json
import math
import sys

import bpy  # type: ignore
import bmesh  # type: ignore
from mathutils import Matrix, Vector  # type: ignore

SEATED_OR_BED = {"SOFA", "ARMCHAIR", "CHAIR", "OFFICE_CHAIR", "OUTDOOR_CHAIR", "OUTDOOR_SOFA", "BED_DOUBLE", "BED_SINGLE"}


def params():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    with open(argv[0], "r", encoding="utf-8") as f:
        return json.load(f)


def report(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def main():
    p = params()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=p["input"])
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh in the generated model")
    # Junk: anything not a mesh goes; tiny disconnected fragments are removed below.
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Remove floating specks (loose parts under 0.5 % of the faces).
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    islands = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, island = [f], []
        seen.add(f.index)
        while stack:
            cur = stack.pop()
            island.append(cur)
            for e in cur.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        islands.append(island)
    total = len(bm.faces)
    junk = [f for isl in islands if len(isl) < total * 0.005 for f in isl]
    if junk and len(junk) < total * 0.2:
        bmesh.ops.delete(bm, geom=junk, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()

    # Blender is Z-up (glTF Y-up is converted on import). Horizontal principal axis by PCA on XY.
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    cx = sum(v.x for v in vs) / len(vs)
    cy = sum(v.y for v in vs) / len(vs)
    sxx = sum((v.x - cx) ** 2 for v in vs)
    syy = sum((v.y - cy) ** 2 for v in vs)
    sxy = sum((v.x - cx) * (v.y - cy) for v in vs)
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)  # principal axis angle from X
    width, depth, height = p["sizeM"]
    # The longer horizontal axis is the width when the piece is wider than deep (a sofa), else the depth (a bed).
    rot = -angle if width >= depth else -angle + math.pi / 2
    obj.matrix_world = Matrix.Rotation(rot, 4, "Z") @ obj.matrix_world
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Which side is the front: a seat or a bed is lower at its front than at its back (backrest, headboard).
    vs = [v.co.copy() for v in obj.data.vertices]
    flipped = False
    if p["type"] in SEATED_OR_BED:
        ys = sorted(v.y for v in vs)
        mid = ys[len(ys) // 2]
        top = max(v.z for v in vs)
        high = [v for v in vs if v.z > top * 0.7]
        if high:
            back_side = sum(1 for v in high if v.y > mid) - sum(1 for v in high if v.y < mid)
            # In Blender the HOMATCH front (glTF -Z) is +Y: the back must be at -Y.
            if back_side > 0:
                obj.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ obj.matrix_world
                bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
                flipped = True

    # Size: uniform to the seen size, then each axis within ±35 %.
    vs = [v.co for v in obj.data.vertices]
    ext = Vector((max(v.x for v in vs) - min(v.x for v in vs), max(v.y for v in vs) - min(v.y for v in vs), max(v.z for v in vs) - min(v.z for v in vs)))
    want = Vector((width, depth, height))
    ratios = sorted(want[i] / max(ext[i], 1e-6) for i in range(3))
    uniform = ratios[1]
    per = [max(uniform * 0.65, min(uniform * 1.35, want[i] / max(ext[i], 1e-6))) for i in range(3)]
    obj.scale = Vector(per)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    vs = [v.co for v in obj.data.vertices]
    minx, maxx = min(v.x for v in vs), max(v.x for v in vs)
    miny, maxy = min(v.y for v in vs), max(v.y for v in vs)
    minz = min(v.z for v in vs)
    obj.location = Vector((-(minx + maxx) / 2, -(miny + maxy) / 2, -minz))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    # Triangle budget.
    tris_before = sum(len(f.vertices) - 2 for f in obj.data.polygons)
    if tris_before > p["maxTriangles"]:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = max(0.01, p["maxTriangles"] / tris_before)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    tris = sum(len(f.vertices) - 2 for f in obj.data.polygons)

    # Textures no larger than the budget.
    cap = int(p["textureSize"])
    images = 0
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        images += 1
        if max(img.size) > cap:
            k = cap / max(img.size)
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    obj.name = p.get("name", "piece")
    vs = [v.co for v in obj.data.vertices]
    dims = [max(v.x for v in vs) - min(v.x for v in vs), max(v.y for v in vs) - min(v.y for v in vs), max(v.z for v in vs) - min(v.z for v in vs)]
    bpy.ops.export_scene.gltf(filepath=p["output"], export_format="GLB", use_selection=False, export_yup=True,
                              export_image_format="WEBP" if p.get("webp", True) else "JPEG", export_apply=True)
    report(p["report"], {"trianglesIn": tris_before, "triangles": tris, "images": images, "flipped": flipped,
                         "rotationDeg": round(math.degrees(rot), 2), "dimsM": [round(d, 3) for d in dims]})


main()
