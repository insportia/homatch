"""The photographic look of planned views: light, materials, exposure. Render-only.

Everything here exists only while a planned view renders (views.py) and is undone
after it: the exported scene and walkthrough pieces, the source-camera render and
the object-map id pass never see it.

  light      daylight through the windows (sky a little stronger, a softer sun,
             light portals in every opening to the outside so the sky's light is
             sampled into the room, ROOM views only), each room's ceiling light
             sized to the room, warm or cool as the design says, out of the
             camera's sight; more bounces (diffuse/glossy >= 4, glass transmission)
  materials  a render copy of each untextured material: fabric gets a fine weave
             (bump + roughness variation), wood-coloured parts a grain, everything
             else a faint micro-variation so nothing reads as clay; glass is real
             transmission with an IOR (and lets sunlight through to the floor);
             metals keep their metalness with brushed roughness; catalogue PBR
             materials (image maps) are used exactly as they are
  exposure   AgX with a Medium High Contrast look; a ROOM view measures itself first
             (a small deterministic preview) and sets its exposure so the walls sit
             where interior photography puts them; the dollhouse has a fixed one
  caps       the cut tops of a dollhouse's walls in a clean, slightly darker colour
             so the section reads
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy  # type: ignore
import numpy as np  # type: ignore  (bundled with Blender)
from mathutils import Vector  # type: ignore

from . import arch, geo
from .materials import rgba

LOOK = "AgX - Medium High Contrast"
MASTER_EXPOSURE = -0.25
# Scene-linear luminance a ROOM view's walls are exposed to (AgX MHC shows ~0.18 as mid-grey; painted
# walls in interior photography sit well above it, short of clipping).
WALL_TARGET = 0.36
FRAME_TARGET = 0.24
EV_RANGE = (-2.0, 4.0)
CAP = "#d6d2cb"
SKY_GAIN = 1.6
SUN_ANGLE_DEG = 2.5


def _bsdf(mat):
    if not mat.use_nodes:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def _textured(mat) -> bool:
    return bool(mat.use_nodes and any(n.type == "TEX_IMAGE" for n in mat.node_tree.nodes))


def _base(bsdf) -> tuple[float, float, float]:
    c = bsdf.inputs["Base Color"].default_value
    return (c[0], c[1], c[2])


def _woodlike(rgb) -> bool:
    """A warm mid-to-dark brown (linear): the colour of wood, not of paint or fabric."""
    r, g, b = rgb
    return r > g > b and r < 0.55 and (r - b) > 0.04 and (r - b) / max(r, 1e-4) > 0.35


# A surface's pattern drawn procedurally when no catalogue map dresses it (plan metres, object space):
# (brick width, row height, row offset, mortar width, colour spread, joint darkening, rotation).
PATTERN = {
    "WOOD_PLANK": (1.2, 0.19, 0.5, 0.0025, 0.12, 0.55, 0.0),
    "WOOD_HERRINGBONE": (0.6, 0.1, 0.5, 0.002, 0.12, 0.55, 45.0),
    "TILE": (0.6, 0.6, 0.0, 0.004, 0.05, 1.12, 0.0),
    "STONE": (0.9, 0.45, 0.5, 0.004, 0.08, 0.8, 0.0),
}


class Looks:
    """Render copies of the scene's materials (made once, removed at the end)."""

    def __init__(self, spec: dict | None = None):
        self.surfaces = {x["id"]: x for x in (spec or {}).get("surfaces", [])}
        self.copies: dict[str, object] = {}
        self.swaps: list = []

    def of(self, mat):
        if mat is None or mat.name.startswith("hm-id:"):
            return None
        if mat.name in self.copies:
            return self.copies[mat.name]
        out = self._make(mat)
        self.copies[mat.name] = out
        return out

    def _make(self, mat):
        if _textured(mat):
            return None  # a catalogue PBR material renders exactly as built
        bsdf = _bsdf(mat)
        if bsdf is None:
            return None
        name = mat.name.lower()
        if name.startswith("glass"):
            return self._glass(mat)
        if "Base Color" in bsdf.inputs and bsdf.inputs["Base Color"].is_linked:
            return None
        metal = bsdf.inputs["Metallic"].default_value >= 0.5
        fabric = name.startswith("fabric") or name.startswith("shade")
        wood = not fabric and not metal and _woodlike(_base(bsdf))
        copy = mat.copy()
        copy.name = f"look:{mat.name}"[:63]
        nt = copy.node_tree
        b = _bsdf(copy)
        n, links = nt.nodes, nt.links
        coord = n.new("ShaderNodeTexCoord")
        rough0 = b.inputs["Roughness"].default_value
        # Fine structure (bump) and a slow variation of roughness: object space, metres.
        fine = n.new("ShaderNodeTexNoise")
        fine.inputs["Scale"].default_value = 180.0 if fabric else (90.0 if wood else 60.0)
        fine.inputs["Detail"].default_value = 6.0
        links.new(coord.outputs["Object"], fine.inputs["Vector"])
        bump = n.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.22 if fabric else (0.06 if wood else 0.03)
        bump.inputs["Distance"].default_value = 0.002 if fabric else 0.001
        links.new(fine.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], b.inputs["Normal"])
        slow = n.new("ShaderNodeTexNoise")
        slow.inputs["Scale"].default_value = 4.0
        slow.inputs["Detail"].default_value = 2.0
        links.new(coord.outputs["Object"], slow.inputs["Vector"])
        rr = n.new("ShaderNodeMapRange")
        spread = 0.12 if metal else (0.1 if wood else 0.06)
        rr.inputs["To Min"].default_value = max(0.02, rough0 - spread)
        rr.inputs["To Max"].default_value = min(1.0, rough0 + spread)
        links.new(slow.outputs["Fac"], rr.inputs["Value"])
        links.new(rr.outputs["Result"], b.inputs["Roughness"])
        surface = self.surfaces.get(mat.get("hm_surface") or "")
        pattern = PATTERN.get(surface["pattern"]) if surface and surface.get("pattern") else None
        if pattern:
            self._pattern(copy, b, coord, pattern, wood=surface["pattern"].startswith("WOOD"))
        elif wood:
            # Grain: noise stretched along the piece's length, a few percent darker and lighter.
            mp = n.new("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = (2.0, 40.0, 40.0)
            links.new(coord.outputs["Object"], mp.inputs["Vector"])
            grain = n.new("ShaderNodeTexNoise")
            grain.inputs["Scale"].default_value = 3.0
            grain.inputs["Detail"].default_value = 8.0
            grain.inputs["Distortion"].default_value = 0.6
            links.new(mp.outputs["Vector"], grain.inputs["Vector"])
            ramp = n.new("ShaderNodeMapRange")
            ramp.inputs["To Min"].default_value = 0.86
            ramp.inputs["To Max"].default_value = 1.1
            links.new(grain.outputs["Fac"], ramp.inputs["Value"])
            mix = n.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            c = b.inputs["Base Color"].default_value
            mix.inputs[6].default_value = (c[0], c[1], c[2], 1.0)
            comb = n.new("ShaderNodeCombineColor")
            for k in ("Red", "Green", "Blue"):
                links.new(ramp.outputs["Result"], comb.inputs[k])
            links.new(comb.outputs["Color"], mix.inputs[7])
            links.new(mix.outputs[2], b.inputs["Base Color"])
        return copy

    def _pattern(self, mat, b, coord, p, wood: bool) -> None:
        """Planks, herringbone (as diagonal planks) or tiles: each board/tile its own shade, darker (or lighter)
        joints with a slight bump, wood grain along the boards. The surface's colour stays the average."""
        bw, rh, offset, mortar, spread, joint, rot = p
        n, links = mat.node_tree.nodes, mat.node_tree.links
        mp = n.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(rot))
        links.new(coord.outputs["Object"], mp.inputs["Vector"])
        brick = n.new("ShaderNodeTexBrick")
        brick.offset = offset
        brick.offset_frequency = 2
        brick.squash = 1.0
        brick.inputs["Scale"].default_value = 1.0
        brick.inputs["Mortar Size"].default_value = mortar
        brick.inputs["Mortar Smooth"].default_value = 0.3
        brick.inputs["Brick Width"].default_value = bw
        brick.inputs["Row Height"].default_value = rh
        brick.inputs["Bias"].default_value = 0.0
        c = b.inputs["Base Color"].default_value
        lo = tuple(max(0.0, x * (1 - spread)) for x in c[:3])
        hi = tuple(min(1.0, x * (1 + spread)) for x in c[:3])
        brick.inputs["Color1"].default_value = (*lo, 1.0)
        brick.inputs["Color2"].default_value = (*hi, 1.0)
        brick.inputs["Mortar"].default_value = (*(min(1.0, x * joint) for x in c[:3]), 1.0)
        links.new(mp.outputs["Vector"], brick.inputs["Vector"])
        colour = brick.outputs["Color"]
        if wood:
            g = n.new("ShaderNodeMapping")
            g.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(rot))
            g.inputs["Scale"].default_value = (1.5, 40.0, 40.0)
            links.new(coord.outputs["Object"], g.inputs["Vector"])
            grain = n.new("ShaderNodeTexNoise")
            grain.inputs["Scale"].default_value = 3.0
            grain.inputs["Detail"].default_value = 8.0
            grain.inputs["Distortion"].default_value = 0.5
            links.new(g.outputs["Vector"], grain.inputs["Vector"])
            rng = n.new("ShaderNodeMapRange")
            rng.inputs["To Min"].default_value = 0.9
            rng.inputs["To Max"].default_value = 1.08
            links.new(grain.outputs["Fac"], rng.inputs["Value"])
            comb = n.new("ShaderNodeCombineColor")
            for k in ("Red", "Green", "Blue"):
                links.new(rng.outputs["Result"], comb.inputs[k])
            mix = n.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            links.new(colour, mix.inputs[6])
            links.new(comb.outputs["Color"], mix.inputs[7])
            colour = mix.outputs[2]
        links.new(colour, b.inputs["Base Color"])
        # Joints sit a little below the boards.
        jb = n.new("ShaderNodeBump")
        jb.inputs["Strength"].default_value = 0.35
        jb.inputs["Distance"].default_value = 0.0015
        links.new(brick.outputs["Fac"], jb.inputs["Height"])
        prev = next((lk.from_socket for lk in links if lk.to_socket == b.inputs["Normal"]), None)
        if prev is not None:
            links.new(prev, jb.inputs["Normal"])
        links.new(jb.outputs["Normal"], b.inputs["Normal"])
        if wood:
            # A sealed floor: a little sheen, never a mirror.
            rr = next((lk.from_node for lk in links if lk.to_socket == b.inputs["Roughness"]), None)
            if rr is not None and rr.type == "MAP_RANGE":
                rr.inputs["To Min"].default_value = 0.38
                rr.inputs["To Max"].default_value = 0.55

    def _glass(self, mat):
        """Thin architectural glass: transmission with an IOR for what the camera sees, clear for shadow rays
        (so the sun reaches the floor through a window, as it does)."""
        copy = bpy.data.materials.new(f"look:{mat.name}"[:63])
        copy.use_nodes = True
        nt = copy.node_tree
        n, links = nt.nodes, nt.links
        b = next(x for x in n if x.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = rgba("#f2f7f8")
        b.inputs["Roughness"].default_value = 0.0
        b.inputs["IOR"].default_value = 1.45
        for k in ("Transmission Weight", "Transmission"):
            if k in b.inputs:
                b.inputs[k].default_value = 1.0
                break
        out = next(x for x in n if x.type == "OUTPUT_MATERIAL")
        clear = n.new("ShaderNodeBsdfTransparent")
        path = n.new("ShaderNodeLightPath")
        mix = n.new("ShaderNodeMixShader")
        links.new(path.outputs["Is Shadow Ray"], mix.inputs[0])
        links.new(b.outputs[0], mix.inputs[1])
        links.new(clear.outputs[0], mix.inputs[2])
        links.new(mix.outputs[0], out.inputs["Surface"])
        return copy

    def dress(self, objs) -> None:
        """Every shown mesh wears its render copies (recorded, so undress() puts the originals back exactly)."""
        for o in objs:
            if o.type != "MESH" or o.hide_render:
                continue
            me = o.data
            for i, m in enumerate(me.materials):
                c = self.of(m)
                if c is not None:
                    self.swaps.append((me, i, m))
                    me.materials[i] = c

    def undress(self) -> None:
        for me, i, m in reversed(self.swaps):
            me.materials[i] = m
        self.swaps.clear()

    def remove(self) -> None:
        self.undress()
        for c in self.copies.values():
            if c is not None and c.name in bpy.data.materials:
                bpy.data.materials.remove(c)
        self.copies.clear()


# ── light ────────────────────────────────────────────────────────────

class Lighting:
    """The views' light rig over the scene's own lights (kept and restored)."""

    def __init__(self, spec: dict):
        self.spec = spec
        sc = bpy.context.scene
        self.saved: list = []
        self.portals: list = []
        self.sky = sc.world
        bg = next((n for n in self.sky.node_tree.nodes if n.type == "BACKGROUND"), None) if self.sky and self.sky.use_nodes else None
        if bg is not None:
            self.saved.append((bg.inputs["Strength"], "default_value", bg.inputs["Strength"].default_value))
            bg.inputs["Strength"].default_value *= SKY_GAIN
        for ob in sc.objects:
            if ob.type != "LIGHT":
                continue
            li = ob.data
            if li.type == "SUN":
                self.saved.append((li, "angle", li.angle))
                li.angle = math.radians(SUN_ANGLE_DEG)
            elif ob.name.startswith("room-light:"):
                room = next((r for r in spec["rooms"] if r["id"] == ob.name.split(":", 1)[1]), None)
                self.saved += [(ob, "visible_camera", ob.visible_camera), (li, "size", li.size), (li, "size_y", li.size_y), (li, "spread", li.spread)]
                ob.visible_camera = False  # a soft source, not a white rectangle on the ceiling
                li.spread = math.radians(150)
                if room is not None:
                    xs = [p[0] for p in room["polygon"]]
                    ys = [p[1] for p in room["polygon"]]
                    li.size = max(0.3, (max(xs) - min(xs)) * 0.6)
                    li.size_y = max(0.3, (max(ys) - min(ys)) * 0.6)
        self._make_portals()

    def _make_portals(self) -> None:
        """An area light portal in every opening between a room and the outside, facing in."""
        rooms = self.spec["rooms"]
        for wall in self.spec["walls"]:
            length, u, n, angle = geo.segment_frame(wall["start"], wall["end"])
            for o in wall["openings"]:
                sides = {s: arch._side_room(rooms, wall, o, s) for s in (1, -1)}
                inside = [s for s, r in sides.items() if r is not None and not r["outdoor"]]
                outside = [s for s, r in sides.items() if r is None or r["outdoor"]]
                if len(inside) != 1 or len(outside) != 1:
                    continue
                s_in = inside[0]
                li = bpy.data.lights.new(f"portal:{o['id']}", "AREA")
                li.shape = "RECTANGLE"
                li.size = o["widthM"]
                li.size_y = o["heightM"]
                li.cycles.is_portal = True
                ob = bpy.data.objects.new(f"portal:{o['id']}", li)
                bpy.context.scene.collection.objects.link(ob)
                cx = wall["start"][0] + u[0] * o["offsetM"]
                cy = wall["start"][1] + u[1] * o["offsetM"]
                # Just outside the glass, facing into the room (an area light emits along its -Z).
                off = (wall["thicknessM"] / 2 + 0.03) * -s_in
                ob.location = (cx + n[0] * off, cy + n[1] * off, o["sillM"] + o["heightM"] / 2)
                facing = Vector((n[0] * s_in, n[1] * s_in, 0.0))
                ob.rotation_euler = facing.to_track_quat("-Z", "Z").to_euler()
                self.portals.append(ob)

    def for_view(self, kind: str) -> None:
        # Portals guide the sky into rooms; for a dollhouse seen from outside they would only starve it.
        for p in self.portals:
            p.hide_render = kind != "ROOM"

    def restore(self) -> None:
        for p in self.portals:
            data = p.data
            bpy.data.objects.remove(p, do_unlink=True)
            bpy.data.lights.remove(data)
        self.portals.clear()
        for owner, attr, value in reversed(self.saved):
            setattr(owner, attr, value)
        self.saved.clear()


def quality(sc, v: dict, device: str) -> None:
    """Final-quality Cycles settings for a planned view."""
    sc.render.resolution_x, sc.render.resolution_y = v["width"], v["height"]
    sc.cycles.samples = v["samples"]
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.01
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPTIX" if device == "OPTIX" else "OPENIMAGEDENOISE"
    except TypeError:
        pass
    sc.cycles.max_bounces = 12
    sc.cycles.diffuse_bounces = 6
    sc.cycles.glossy_bounces = 4
    sc.cycles.transmission_bounces = 8
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.sample_clamp_indirect = 10.0
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = LOOK
    except TypeError:
        sc.view_settings.look = "None"
    sc.view_settings.gamma = 1.0


def solve_exposure(v: dict, preview: Path, wall_mask) -> tuple[float, dict]:
    """A ROOM view's exposure from a small preview of itself (deterministic: fixed seed and samples).
    The walls' median luminance (or the whole frame's, without a map) is brought to its target."""
    sc = bpy.context.scene
    w, h = v["width"], v["height"]
    scale = 320 / max(w, h)
    sc.render.resolution_x, sc.render.resolution_y = max(32, round(w * scale)), max(32, round(h * scale))
    sc.cycles.samples = 48
    sc.cycles.use_adaptive_sampling = False
    sc.view_settings.exposure = 0.0
    s = sc.render.image_settings
    s.file_format = "OPEN_EXR"
    s.color_mode = "RGB"
    s.color_depth = "32"
    sc.render.filepath = str(preview)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(preview))
    pw, ph = img.size
    px = np.empty(pw * ph * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    rgb = px.reshape(ph, pw, 4)[::-1, :, :3]
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    used = "frame"
    target = FRAME_TARGET
    values = lum.ravel()
    if wall_mask is not None:
        ys = (np.arange(ph) * wall_mask.shape[0] // ph)
        xs = (np.arange(pw) * wall_mask.shape[1] // pw)
        m = wall_mask[ys][:, xs]
        if m.mean() > 0.04:
            values, used, target = lum[m], "walls", WALL_TARGET
    med = float(np.median(values)) if values.size else 0.0
    ev = EV_RANGE[1] if med <= 1e-6 else max(EV_RANGE[0], min(EV_RANGE[1], math.log2(target / med)))
    return ev, {"measured": round(med, 4), "on": used, "ev": round(ev, 3)}


def wall_mask_from(ids_png: Path, painted: dict):
    """Pixels of the view's walls (from its exact id picture), as a boolean array, top row first."""
    img = bpy.data.images.load(str(ids_png))
    try:
        img.colorspace_settings.name = "Non-Color"
    except TypeError:
        pass
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    rgb = np.rint(px.reshape(h, w, 4)[::-1, :, :3] * 255.0).astype(np.int64)
    codes = (rgb[:, :, 0] << 16) | (rgb[:, :, 1] << 8) | rgb[:, :, 2]
    walls = [int(c[1:], 16) for c, k in painted.items() if k[0] == "WALL"]
    return np.isin(codes, np.array(walls, dtype=np.int64)) if walls else None


def cap_walls(view_walls: list) -> None:
    """The cut top of every wall in a slightly darker clean colour (view-only walls: removed after the view)."""
    mat = bpy.data.materials.get("wall-cap") or _cap_material()
    for o in view_walls:
        if o.type != "MESH" or (o.get("homatch") or {}).get("kind") != "WALL":
            continue
        me = o.data
        me.materials.append(mat)
        k = len(me.materials) - 1
        for p in me.polygons:
            if p.normal.z > 0.7:
                p.material_index = k


def _cap_material():
    m = bpy.data.materials.new("wall-cap")
    m.use_nodes = True
    b = next(x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = rgba(CAP)
    b.inputs["Roughness"].default_value = 0.85
    return m
