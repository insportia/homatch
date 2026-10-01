"""HOMATCH materials as Blender PBR materials that survive glTF export.

A surface wears its catalogue material (albedo, normal, ORM maps, tile size,
rotation) or, without one, its colour, roughness and metalness. Node graphs are
limited to what Blender's glTF exporter understands (Principled BSDF, image
textures through a Mapping node → KHR_texture_transform, a multiply tint →
baseColorFactor, Normal Map, ORM channels), so what is rendered is what the
walkthrough receives. Colours arrive as display (sRGB) hex and are converted to
the linear values Blender works in.
"""
from __future__ import annotations

import math

import bpy  # type: ignore


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    return (srgb_to_linear(int(h[0:2], 16) / 255), srgb_to_linear(int(h[2:4], 16) / 255), srgb_to_linear(int(h[4:6], 16) / 255), alpha)


def _bsdf(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    return nt, bsdf


def _set(bsdf, names: tuple[str, ...], value) -> None:
    for n in names:
        if n in bsdf.inputs:
            bsdf.inputs[n].default_value = value
            return


class Library:
    """One Blender material per distinct look: surfaces, slots and fixed finishes are shared, never duplicated."""

    def __init__(self, spec: dict, textures: dict[str, dict[str, str | None]]):
        self.spec = spec
        self.textures = textures
        self.materials = {m["id"]: m for m in spec["materials"]}
        self.surfaces = {s["id"]: s for s in spec["surfaces"]}
        self.cache: dict[str, object] = {}
        self.images: dict[str, object] = {}
        self.missing_maps: list[str] = []

    # ── plain PBR ──────────────────────────────────────────────────
    def plain(self, key: str, color: str, roughness: float, metalness: float = 0.0, *, sheen: float = 0.0, transmission: float = 0.0,
              emission: tuple[str, float] | None = None, alpha: float = 1.0):
        name = f"{key}|{color}|{roughness:.2f}|{metalness:.2f}|{sheen:.1f}|{transmission:.1f}|{alpha:.2f}"
        if name in self.cache:
            return self.cache[name]
        mat = bpy.data.materials.new(key[:63])
        nt, bsdf = _bsdf(mat)
        _set(bsdf, ("Base Color",), rgba(color))
        _set(bsdf, ("Roughness",), float(roughness))
        _set(bsdf, ("Metallic",), float(metalness))
        if sheen > 0:
            _set(bsdf, ("Sheen Weight", "Sheen"), sheen)
        if transmission > 0:
            _set(bsdf, ("Transmission Weight", "Transmission"), transmission)
            _set(bsdf, ("IOR",), 1.45)
        if emission:
            _set(bsdf, ("Emission Color", "Emission"), rgba(emission[0]))
            _set(bsdf, ("Emission Strength",), emission[1])
        if alpha < 1:
            _set(bsdf, ("Alpha",), alpha)
            try:
                mat.surface_render_method = "BLENDED"
            except AttributeError:
                mat.blend_method = "BLEND"
        mat.diffuse_color = rgba(color)
        self.cache[name] = mat
        return mat

    # ── surfaces (floors, walls, ceilings) ─────────────────────────
    def surface(self, surface_id: str, fallback: str = "#f7f5f1"):
        """A surface in its colour (architecture is built first); apply_textures() later dresses it in its maps."""
        s = self.surfaces.get(surface_id)
        if s is None:
            return self.plain("surface-default", fallback, 0.9)
        mat = self.plain(f"surface-{surface_id}", s["color"], s["roughness"], s["metalness"], sheen=0.4 if s["pattern"] == "CARPET" else 0.0)
        mat["hm_surface"] = surface_id
        return mat

    def apply_textures(self, objects) -> int:
        """The MATERIALS stage: every surface slot whose catalogue material has maps wears them. Returns how many."""
        n = 0
        for ob in objects:
            me = getattr(ob, "data", None)
            if me is None or not hasattr(me, "materials"):
                continue
            for i, mat in enumerate(me.materials):
                sid = mat.get("hm_surface") if mat is not None else None
                if not sid:
                    continue
                tex = self.textured_surface(sid)
                if tex is not None:
                    me.materials[i] = tex
                    n += 1
        return n

    def textured_surface(self, surface_id: str):
        s = self.surfaces.get(surface_id)
        if s is None or not s["material"]:
            return None
        key = f"surface:{s['material']}:{s['color']}:{s['roughness']:.2f}:{s['tint'] or ''}"
        if key in self.cache:
            return self.cache[key]
        m = self.materials.get(s["material"])
        maps = self.textures.get(s["material"], {}) if m else {}
        if not (m and maps.get("albedo")):
            if m:
                self.missing_maps.append(m["id"])
            return None
        mat = self._textured(surface_id, m, maps, s)
        self.cache[key] = mat
        return mat

    def _image(self, path: str, non_color: bool):
        key = f"{path}|{non_color}"
        if key not in self.images:
            img = bpy.data.images.load(path, check_existing=True)
            if non_color:
                img.colorspace_settings.name = "Non-Color"
            self.images[key] = img
        return self.images[key]

    def _textured(self, surface_id: str, m: dict, maps: dict, s: dict):
        mat = bpy.data.materials.new(f"surface-{surface_id}"[:63])
        nt, bsdf = _bsdf(mat)
        nodes, links = nt.nodes, nt.links
        coord = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1.0 / m["tileM"][0], 1.0 / m["tileM"][1], 1.0)
        mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(m["rotationDeg"]))
        links.new(coord.outputs["UV"], mapping.inputs["Vector"])

        def tex(path: str, non_color: bool):
            t = nodes.new("ShaderNodeTexImage")
            t.image = self._image(path, non_color)
            t.interpolation = "Cubic" if not non_color else "Linear"
            links.new(mapping.outputs["Vector"], t.inputs["Vector"])
            return t

        albedo = tex(maps["albedo"], False)
        # What the picture showed tints the texture (a multiply → glTF baseColorFactor).
        tint = s.get("tint")
        if tint:
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            links.new(albedo.outputs["Color"], mix.inputs[6])
            mix.inputs[7].default_value = rgba(_tint_factor(tint, m["baseColor"]))
            links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
        if maps.get("normal"):
            nm = nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = m["normalScale"]
            links.new(tex(maps["normal"], True).outputs["Color"], nm.inputs["Color"])
            links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        if maps.get("orm"):
            orm = tex(maps["orm"], True)
            sep = nodes.new("ShaderNodeSeparateColor")
            links.new(orm.outputs["Color"], sep.inputs["Color"])
            links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
            # Many catalogue "ORM" maps are roughness alone (grey): blue is metalness only for a metal.
            if s["metalness"] > 0.5:
                links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
            else:
                _set(bsdf, ("Metallic",), s["metalness"])
        else:
            _set(bsdf, ("Roughness",), s["roughness"])
            _set(bsdf, ("Metallic",), s["metalness"])
        mat.diffuse_color = rgba(s["color"])
        return mat

    # ── a piece's parts ────────────────────────────────────────────
    def slot(self, kind: str, slot: str, color: str):
        """What a part is made of, from the kind and slot (never a per-asset table)."""
        fabric = slot in ("body", "cushion", "linen", "upholstery") and kind in ("SOFA", "ARMCHAIR", "RECLINER", "BED", "CHAIR", "STOOL", "CURTAIN")
        if slot == "leaves":
            return self.plain(f"leaf-{color}", color, 0.55, sheen=0.2)
        if slot == "shade":
            return self.plain(f"shade-{color}", color, 0.7, transmission=0.3)
        if fabric:
            return self.plain(f"fabric-{color}", color, 0.92, sheen=0.6)
        if slot == "legs" and _dark(color):
            return self.plain(f"metal-{color}", color, 0.35, 0.8)
        if slot == "pot":
            return self.plain(f"ceramic-{color}", color, 0.35)
        if slot == "top":
            return self.plain(f"top-{color}", color, 0.45)
        return self.plain(f"{kind.lower()}-{slot}-{color}", color, 0.6)

    # ── fixed finishes ─────────────────────────────────────────────
    def glass(self):
        # As the walkthrough draws it (a faint blue sheet at 22% opacity): glass reads as glass, never as
        # a grey panel, and exports as plain glTF alpha blending.
        return self.plain("glass", "#cfe0ea", 0.05, 0.1, alpha=0.22)

    def frame(self):
        return self.plain("frames", self.spec["frames"], 0.45, 0.2 if _dark(self.spec["frames"]) else 0.0)

    def door_leaf(self):
        return self.plain("door-leaf", "#ece7df", 0.6)

    def wall_body(self):
        return self.plain("wall-body", "#fbfaf8", 0.9)

    def chrome(self):
        return self.plain("chrome", "#c9ccd0", 0.15, 1.0)

    def dark(self):
        return self.plain("dark", "#202226", 0.3, 0.2)

    def ceramic(self):
        return self.plain("ceramic", "#f6f6f4", 0.12)

    def rail(self):
        return self.plain("rail", "#2b2d31", 0.45, 0.4)


def _dark(hex_color: str) -> bool:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70


def _tint_factor(seen: str, base: str) -> str:
    """The multiply that moves a texture's average (≈ its catalogue base colour) toward the colour seen; bounded."""
    def ch(h, i):
        return int(h.lstrip("#")[i:i + 2], 16) / 255

    out = []
    for i in (0, 2, 4):
        k = max(0.25, min(2.4, ch(seen, i) / max(ch(base, i), 0.01)))
        out.append(max(0, min(255, round(min(1.0, k) * 255))))
    return "#%02x%02x%02x" % tuple(out)
