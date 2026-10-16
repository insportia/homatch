"""Every HOMATCH piece kind, built in Blender from parameters.

Local frame: x across the piece, y toward its FRONT, z up, origin at the centre
of its footprint on the floor (HOMATCH's convention: the back of a sofa is −y).
Each piece is one mesh with a material per part. After building, the piece is
fitted to exactly the size that was read (w × d × h), so what the picture
showed is what stands in the scene. A catalogue MODEL is imported from its own
file and fitted the way the walkthrough fits it.
"""
from __future__ import annotations

import hashlib
import math

import bmesh  # type: ignore
import bpy  # type: ignore
from mathutils import Matrix, Vector  # type: ignore

from . import geo


class Parts:
    def __init__(self):
        self.items: list[tuple[bmesh.types.BMesh, object]] = []

    def add(self, bm, mat):
        self.items.append((bm, mat))
        return bm


def _seed(text: str) -> float:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def _c(colors: dict, slot: str, fallback: str) -> str:
    return colors.get(slot, fallback)


def _legs(p: Parts, W, D, h, r, mat, inset=0.06, round_=True):
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (W / 2 - inset), sy * (D / 2 - inset)
            p.add(geo.cylinder_bm(r, r * 0.85, h, x, y, 0.0, 12) if round_ else geo.box_bm(r * 2, r * 2, h, x, y, 0.0), mat)


def _sofa(p: Parts, lib, kind, W, D, H, colors, seats=None):
    body = lib.slot(kind, "body", _c(colors, "body", "#cfc6b8"))
    cushion = lib.slot(kind, "cushion", _c(colors, "cushion", _c(colors, "body", "#c9c4bc")))
    leg = lib.slot(kind, "legs", _c(colors, "legs", "#3b3128"))
    seat_h = min(0.44, H * 0.55)
    arm = min(0.18, W * 0.09)
    _legs(p, W, D, 0.08, 0.025, leg, 0.08)
    p.add(geo.box_bm(W, D, 0.2, 0, 0, 0.08, bevel=0.03), body)
    p.add(geo.box_bm(W, 0.16, max(0.1, H - 0.26), 0, -D / 2 + 0.08, 0.26, bevel=0.05), body)
    for sx in (-1, 1):
        p.add(geo.box_bm(arm, D, seat_h + 0.12, sx * (W / 2 - arm / 2), 0, 0.08, bevel=0.06), body)
    n = seats or (3 if W > 2.0 else 2 if W > 1.2 else 1)
    cw = (W - 2 * arm) / n
    for i in range(n):
        x = -W / 2 + arm + cw * (i + 0.5)
        p.add(geo.box_bm(cw - 0.012, D - 0.22, seat_h - 0.28, x, 0.05, 0.28, bevel=0.06), cushion)
        p.add(geo.box_bm(cw - 0.02, 0.18, max(0.2, H - seat_h - 0.04), x, -D / 2 + 0.25, seat_h, bevel=0.07), cushion)


def _shell(p: Parts, lib, kind, W, D, H, colors):
    """A shell chair: one curved form wrapping the seat, on slim legs."""
    body = lib.slot(kind, "body", _c(colors, "body", "#d9d2c7"))
    leg = lib.slot(kind, "legs", _c(colors, "legs", "#2f2f30"))
    seat_z = min(0.42, H * 0.5)
    _legs(p, W * 0.8, D * 0.8, seat_z - 0.04, 0.015, leg, 0.03)
    p.add(geo.box_bm(W * 0.86, D * 0.8, 0.1, 0, 0.04, seat_z - 0.06, bevel=0.04), body)
    # The shell: a band around the back and sides, rising toward the back.
    segs = 9
    for i in range(segs):
        a = math.pi * (0.15 + 0.7 * i / (segs - 1))  # from one side round the back to the other
        x = math.cos(a) * W * 0.44
        y = -math.sin(a) * D * 0.42 + 0.02
        hh = (H - seat_z) * (0.55 + 0.45 * math.sin(a))
        bm = geo.box_bm(W * 0.2, 0.06, hh + 0.08, 0, 0, seat_z - 0.06, bevel=0.025)
        geo.transform(bm, geo.rot_z(a - math.pi / 2))
        bmesh.ops.translate(bm, vec=Vector((x, y, 0.0)), verts=bm.verts)
        p.add(bm, body)


def _chair(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#a07b55"))
    leg = lib.slot(kind, "legs", _c(colors, "legs", _c(colors, "body", "#3b3128")))
    seat = min(0.46, H * 0.55)
    _legs(p, W, D, seat - 0.04, 0.018, leg, 0.04)
    p.add(geo.box_bm(W, D * 0.92, 0.05, 0, 0.02, seat - 0.05, bevel=0.012), body)
    if kind != "STOOL" and H > seat + 0.15:
        p.add(geo.box_bm(W * 0.94, 0.035, H - seat, 0, -D / 2 + 0.03, seat, bevel=0.012), body)


def _stool(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#a07b55"))
    leg = lib.slot(kind, "legs", _c(colors, "legs", "#2f2f30"))
    r = min(W, D) / 2
    p.add(geo.cylinder_bm(r, r, 0.05, 0, 0, H - 0.05, 28), body)
    _legs(p, W * 0.8, D * 0.8, H - 0.05, 0.015, leg, 0.03)
    p.add(geo.cylinder_bm(r * 0.62, r * 0.62, 0.015, 0, 0, H * 0.3, 24), leg)


def _table(p: Parts, lib, kind, W, D, H, colors, form):
    top = lib.slot(kind, "top", _c(colors, "top", "#b08a62"))
    leg = lib.slot(kind, "legs", _c(colors, "legs", _c(colors, "top", "#3b3128")))
    if form in ("ROUND", "OVAL") or kind == "ROUND_TABLE":
        r = min(W, D) / 2
        disc = p.add(geo.cylinder_bm(r, r, 0.035, 0, 0, H - 0.035, 48), top)
        bmesh.ops.scale(disc, vec=Vector((W / (2 * r), D / (2 * r), 1.0)), verts=disc.verts)
        p.add(geo.cylinder_bm(0.05, 0.05, H - 0.035, 0, 0, 0.0, 20), leg)
        p.add(geo.cylinder_bm(min(W, D) * 0.28, min(W, D) * 0.24, 0.03, 0, 0, 0.0, 32), leg)
        return
    p.add(geo.box_bm(W, D, 0.04, 0, 0, H - 0.04, bevel=0.008), top)
    _legs(p, W, D, H - 0.04, 0.025, leg, 0.06, round_=False)


def _bed(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#b9b0a3"))
    linen = lib.slot(kind, "linen", _c(colors, "linen", "#f1eee8"))
    mattress = lib.plain("mattress", "#f4f2ee", 0.9, sheen=0.4)
    base_top = 0.32
    _legs(p, W, D, 0.06, 0.03, lib.slot(kind, "legs", "#3b3128"), 0.08)
    p.add(geo.box_bm(W, D, base_top - 0.06, 0, 0, 0.06, bevel=0.02), body)
    p.add(geo.box_bm(W - 0.06, D - 0.12, 0.22, 0, 0.03, base_top, bevel=0.05), mattress)
    top = base_top + 0.22
    p.add(geo.box_bm(W - 0.02, D * 0.64, 0.07, 0, D / 2 - D * 0.32 - 0.01, top - 0.04, bevel=0.035), linen)
    n = 1 if W < 1.2 else 2
    pw = (W - 0.2) / n
    for i in range(n):
        p.add(geo.box_bm(pw - 0.06, 0.38, 0.13, -W / 2 + 0.1 + pw * (i + 0.5), -D / 2 + 0.32, top - 0.01, bevel=0.06), linen)
    if H > top + 0.15:
        p.add(geo.box_bm(W, 0.08, H, 0, -D / 2 + 0.04, 0.0, bevel=0.02), body)


def _rug(p: Parts, lib, kind, W, D, H, colors, form):
    mat = lib.plain(f"rug-{_c(colors, 'body', '#bdb3a4')}", _c(colors, "body", "#bdb3a4"), 0.98, sheen=0.5)
    h = max(0.008, min(H, 0.02))
    if form in ("ROUND", "OVAL"):
        disc = p.add(geo.cylinder_bm(0.5, 0.5, h, 0, 0, 0.0, 64), mat)
        bmesh.ops.scale(disc, vec=Vector((W, D, 1.0)), verts=disc.verts)
    else:
        p.add(geo.box_bm(W, D, h, 0, 0, 0.0, bevel=0.003), mat)


def _foliage(p: Parts, lib, key: str, color: str, cx, cy, z0, w, d, h, count=11):
    leaves = lib.slot("PLANT", "leaves", color)
    for i in range(count):
        s = _seed(f"{key}:{i}")
        s2 = _seed(f"{key}:{i}:b")
        s3 = _seed(f"{key}:{i}:c")
        r = max(0.04, min(w, d) * (0.18 + 0.14 * s))
        x = cx + (s2 - 0.5) * w * 0.6
        y = cy + (s3 - 0.5) * d * 0.6
        z = z0 + r + (h - 2 * r) * (i / max(1, count - 1)) * (0.6 + 0.4 * s)
        p.add(geo.sphere_bm(r, x, y, z, 1.0, 1.0, 0.8 + 0.4 * s2, subdiv=1), leaves)


def _plant(p: Parts, lib, kind, W, D, H, colors, key):
    pot = lib.slot(kind, "pot", _c(colors, "pot", "#d8d2c8"))
    leaves = _c(colors, "leaves", "#3f6b3a")
    if kind == "PLANTER" and W > D * 1.6:
        ph = H * 0.5 if H < 1.2 else 0.45
        p.add(geo.box_bm(W, D, ph, 0, 0, 0.0, bevel=0.01), pot)
        n = max(2, round(W / 0.45))
        for i in range(n):
            x = -W / 2 + W * (i + 0.5) / n
            _foliage(p, lib, f"{key}:{i}", leaves, x, 0.0, ph, W / n, D, H - ph, count=5)
        return
    pot_h = H * 0.5 if kind == "PLANTER" else min(0.42, H * 0.3)
    r = min(W, D) * (0.42 if kind == "PLANTER" else 0.3)
    p.add(geo.cylinder_bm(r * 0.78, r, pot_h, 0, 0, 0.0, 28), pot)
    _foliage(p, lib, key, leaves, 0.0, 0.0, pot_h * 0.85, W, D, H - pot_h * 0.85)


def _lamp(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#2f2f30"))
    shade = lib.slot(kind, "shade", _c(colors, "shade", "#f1ebe0"))
    r = min(W, D) / 2
    p.add(geo.cylinder_bm(r * 0.6, r * 0.6, 0.03, 0, 0, 0.0, 24), body)
    p.add(geo.cylinder_bm(0.012, 0.012, H * 0.8, 0, 0, 0.03, 10), body)
    p.add(geo.cylinder_bm(r, r * 0.7, H * 0.25, 0, 0, H * 0.75, 28), shade)


def _panels(p: Parts, mat, handle, W, H, z0, y, cols, rows=1, horizontal_handles=False):
    pw, ph = W / cols, H / rows
    for c in range(cols):
        for r in range(rows):
            x = -W / 2 + pw * (c + 0.5)
            z = z0 + ph * r
            p.add(geo.box_bm(pw - 0.006, 0.02, ph - 0.006, x, y, z + 0.003, bevel=0.003), mat)
            if horizontal_handles:
                p.add(geo.box_bm(min(0.16, pw * 0.4), 0.02, 0.012, x, y + 0.02, z + ph * 0.75), handle)
            else:
                hx = x + (pw / 2 - 0.05) * (1 if c % 2 == 0 else -1)
                p.add(geo.box_bm(0.012, 0.02, min(0.3, ph * 0.3), hx, y + 0.02, z + ph * 0.45), handle)


def _cabinet(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#e8e4dc"))
    handle = lib.chrome()
    plinth = 0.06 if kind in ("WARDROBE", "DRESSER", "CABINET") else 0.0
    p.add(geo.box_bm(W, D - 0.02, H - plinth, 0, -0.01, plinth, bevel=0.004), body)
    if plinth:
        p.add(geo.box_bm(W - 0.04, D - 0.08, plinth, 0, -0.04, 0.0), lib.dark())
    front = D / 2 - 0.01
    if kind == "DRESSER":
        _panels(p, body, handle, W, H - plinth, plinth, front, max(1, round(W / 0.9)), rows=3, horizontal_handles=True)
    elif kind == "WARDROBE":
        _panels(p, body, handle, W, H - plinth, plinth, front, max(2, round(W / 0.5)))
    else:
        _panels(p, body, handle, W, H - plinth, plinth, front, max(1, round(W / 0.6)))


def _tv_unit(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#cbbfae"))
    uh = min(0.5, H)
    p.add(geo.box_bm(W, D, uh - 0.08, 0, 0, 0.08, bevel=0.005), body)
    _legs(p, W, D, 0.08, 0.015, lib.dark(), 0.05)
    _panels(p, body, lib.chrome(), W, uh - 0.1, 0.09, D / 2, max(2, round(W / 0.6)), horizontal_handles=True)
    if H > 0.75:
        th = min(1.0, (H - uh) * 0.92)
        tw = min(W * 0.85, th * 1.78)
        p.add(geo.box_bm(tw, 0.04, th, 0, -D / 2 + 0.14, uh + 0.08, bevel=0.004), lib.plain("screen", "#0e0f11", 0.08, 0.2))
        p.add(geo.box_bm(0.25, 0.18, 0.08, 0, -D / 2 + 0.14, uh), lib.dark())


def _shelf(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#cdb79b"))
    t = 0.022
    for sx in (-1, 1):
        p.add(geo.box_bm(t, D, H, sx * (W / 2 - t / 2), 0, 0.0), body)
    p.add(geo.box_bm(W, 0.01, H, 0, -D / 2 + 0.005, 0.0), body)
    n = max(2, round(H / 0.36))
    for i in range(n + 1):
        p.add(geo.box_bm(W - 2 * t, D - 0.01, t, 0, 0.005, min(H - t, i * (H - t) / n)), body)


def _kitchen(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#ece8e1"))
    top = lib.slot(kind, "top", _c(colors, "top", "#d9d6d0"))
    base_h = min(0.86, H)
    p.add(geo.box_bm(W - 0.02, D - 0.08, 0.1, 0, -0.05, 0.0), lib.dark())
    p.add(geo.box_bm(W, D - 0.04, base_h - 0.14, 0, -0.02, 0.1, bevel=0.003), body)
    _panels(p, body, lib.chrome(), W, base_h - 0.14, 0.1, D / 2 - 0.03, max(1, round(W / 0.6)), horizontal_handles=True)
    if kind == "VANITY":
        p.add(geo.box_bm(W, D, 0.04, 0, 0, base_h - 0.04, bevel=0.006), top)
        p.add(geo.cylinder_bm(min(W, D) * 0.28, min(W, D) * 0.24, 0.06, 0, 0.02, base_h - 0.01, 32), lib.ceramic())
        p.add(geo.cylinder_bm(0.012, 0.012, 0.18, 0, -D / 2 + 0.08, base_h, 10), lib.chrome())
        return
    p.add(geo.box_bm(W + 0.01, D + 0.02, 0.04, 0, 0, base_h - 0.04, bevel=0.004), top)
    if W > 1.5:
        p.add(geo.box_bm(0.56, 0.48, 0.006, -W * 0.22, 0.02, base_h), lib.plain("hob", "#111214", 0.1, 0.2))
        p.add(geo.box_bm(0.5, 0.4, 0.008, W * 0.22, 0.02, base_h - 0.004), lib.chrome())
        p.add(geo.cylinder_bm(0.012, 0.012, 0.28, W * 0.22, -D / 2 + 0.08, base_h, 10), lib.chrome())
    if H > 1.6:
        wh = min(0.72, H - 1.45)
        p.add(geo.box_bm(W, 0.35, wh, 0, -D / 2 + 0.175, H - wh, bevel=0.003), body)
        _panels(p, body, lib.chrome(), W, wh, H - wh, -D / 2 + 0.35, max(1, round(W / 0.6)))


def _fridge(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#e9eaec"))
    p.add(geo.box_bm(W, D - 0.03, H, 0, -0.015, 0.0, bevel=0.01), body)
    split = H * 0.62
    p.add(geo.box_bm(W - 0.01, 0.03, split - 0.01, 0, D / 2 - 0.015, 0.0, bevel=0.006), body)
    p.add(geo.box_bm(W - 0.01, 0.03, H - split - 0.01, 0, D / 2 - 0.015, split, bevel=0.006), body)
    for z0, hh in ((split * 0.55, split * 0.35), (split + 0.06, (H - split) * 0.35)):
        p.add(geo.box_bm(0.02, 0.03, hh, W / 2 - 0.06, D / 2 + 0.01, z0), lib.chrome())


def _washer(p: Parts, lib, kind, W, D, H, colors):
    body = lib.slot(kind, "body", _c(colors, "body", "#f2f2f2"))
    p.add(geo.box_bm(W, D, H, 0, 0, 0.0, bevel=0.012), body)
    door = geo.cylinder_bm(min(W, H) * 0.3, min(W, H) * 0.3, 0.03, 0, 0, 0.0, 40)
    geo.transform(door, Matrix.Rotation(math.pi / 2, 4, "X"))
    bmesh.ops.translate(door, vec=Vector((0.0, D / 2 + 0.015, H * 0.45)), verts=door.verts)
    p.add(door, lib.plain("washer-glass", "#3a3f46", 0.08, 0.3))


def _shower(p: Parts, lib, kind, W, D, H, colors):
    p.add(geo.box_bm(W, D, 0.04, 0, 0, 0.0, bevel=0.006), lib.ceramic())
    p.add(geo.box_bm(W, 0.01, H - 0.06, 0, D / 2 - 0.005, 0.04), lib.glass())
    p.add(geo.box_bm(0.01, D, H - 0.06, W / 2 - 0.005, 0, 0.04), lib.glass())
    p.add(geo.cylinder_bm(0.1, 0.1, 0.012, 0, -D / 2 + 0.15, H - 0.12, 24), lib.chrome())


def _toilet(p: Parts, lib, kind, W, D, H, colors):
    c = lib.ceramic()
    bowl = p.add(geo.cylinder_bm(0.5, 0.42, 0.4, 0, 0, 0.0, 32), c)
    bmesh.ops.scale(bowl, vec=Vector((W * 0.9, D * 0.62, 1.0)), verts=bowl.verts)
    bmesh.ops.translate(bowl, vec=Vector((0.0, D * 0.12, 0.0)), verts=bowl.verts)
    p.add(geo.box_bm(W, D * 0.28, max(0.2, H - 0.4), 0, -D / 2 + D * 0.14, 0.4, bevel=0.02), c)
    p.add(geo.box_bm(W * 0.9, D * 0.6, 0.03, 0, D * 0.12, 0.4, bevel=0.012), c)


def _bath(p: Parts, lib, kind, W, D, H, colors):
    c = lib.ceramic()
    outer = geo.box_bm(W, D, H, 0, 0, 0.0, bevel=0.03)
    p.add(outer, c)
    p.add(geo.box_bm(W - 0.14, D - 0.14, 0.012, 0, 0, H - 0.012), lib.plain("bath-water", "#e7ecef", 0.05))
    p.add(geo.cylinder_bm(0.012, 0.012, 0.2, -W / 2 + 0.12, -D / 2 + 0.05, H, 10), lib.chrome())


def _curtain(p: Parts, lib, kind, W, D, H, colors):
    mat = lib.slot("CURTAIN", "body", _c(colors, "body", "#e8e2d6"))
    n = max(6, round(W / 0.07))
    for i in range(n):
        x = -W / 2 + W * (i + 0.5) / n
        p.add(geo.cylinder_bm(W / n * 0.62, W / n * 0.62, H - 0.04, x, 0.0, 0.0, 8), mat)
    p.add(geo.cylinder_bm(0.012, 0.012, W, 0, 0, 0.0, 10), lib.chrome())
    rail = p.items[-1][0]
    geo.transform(rail, Matrix.Rotation(math.pi / 2, 4, "Y"))
    bmesh.ops.translate(rail, vec=Vector((W / 2, 0.0, H - 0.02)), verts=rail.verts)


def _blind(p: Parts, lib, kind, W, D, H, colors):
    mat = lib.slot("BLIND", "body", _c(colors, "body", "#ece8e0"))
    n = max(4, round(H / 0.05))
    for i in range(n):
        p.add(geo.box_bm(W, max(0.02, D), 0.006, 0, 0, H * i / n), mat)


# ── Design forms (walkthrough/designGraph.ts DESIGN_FORMS): the selected design's own geometry ──────────────────
# Mirrors src/components/designStudio/canvas/procedural.ts, so the reference render the visual check judges shows the
# same pieces the walkthrough draws. Hardware is aged brass.

BRASS = "#b08a55"


def _framed(p: Parts, mat, W, H, z0, y, cols, rows=1, handle=None):
    """Framed (shaker) fronts: a panel per door with a raised frame round it, a slim bar pull."""
    pw, ph = W / cols, H / rows
    for c in range(cols):
        for r in range(rows):
            x = -W / 2 + pw * (c + 0.5)
            z = z0 + ph * r
            p.add(geo.box_bm(pw - 0.006, 0.02, ph - 0.006, x, y, z + 0.003, bevel=0.003), mat)
            rail = min(0.06, pw * 0.14)
            for dz in (0.003, ph - rail - 0.003):
                p.add(geo.box_bm(pw - 0.01, 0.012, rail, x, y + 0.016, z + dz, bevel=0.002), mat)
            for dx in (-1, 1):
                p.add(geo.box_bm(rail, 0.012, ph - 2 * rail - 0.006, x + dx * (pw / 2 - rail / 2 - 0.004), y + 0.016, z + rail + 0.003, bevel=0.002), mat)
            if handle is not None:
                hx = x + (pw / 2 - 0.06) * (1 if c % 2 == 0 else -1)
                hh = min(0.16, ph * 0.22)
                hz = z + ph * 0.45 if ph > 1.2 else z + ph - hh - 0.06
                p.add(geo.box_bm(0.012, 0.03, hh, hx, y + 0.035, hz), handle)


def _shaker_kitchen(p: Parts, lib, kind, W, D, H, colors):
    """A shaker kitchen run: framed fronts, brass pulls, a stone worktop and splashback, framed wall cabinets with a
    warm light line beneath (H is the top of the wall cabinets)."""
    body = lib.slot(kind, "body", _c(colors, "body", "#4b3022"))
    top = lib.slot(kind, "top", _c(colors, "top", "#c7b59b"))
    brass = lib.plain("brass", BRASS, 0.32, 0.85)
    base_h = 0.9
    p.add(geo.box_bm(W - 0.02, D - 0.08, 0.1, 0, -0.05, 0.0), lib.dark())
    p.add(geo.box_bm(W, D - 0.04, base_h - 0.14, 0, -0.02, 0.1, bevel=0.003), body)
    _framed(p, body, W, base_h - 0.14, 0.1, D / 2 - 0.03, max(1, round(W / 0.6)), handle=brass)
    p.add(geo.box_bm(W + 0.01, D + 0.02, 0.04, 0, 0, base_h - 0.04, bevel=0.004), top)
    if W > 1.5:
        p.add(geo.box_bm(0.56, 0.48, 0.006, -W * 0.22, 0.02, base_h), lib.plain("hob", "#111214", 0.1, 0.2))
        p.add(geo.box_bm(0.5, 0.4, 0.008, W * 0.22, 0.02, base_h - 0.004), lib.chrome())
        p.add(geo.cylinder_bm(0.012, 0.012, 0.28, W * 0.22, -D / 2 + 0.08, base_h, 10), brass)
    wy = base_h + 0.55
    if H > wy + 0.3:
        wh = H - wy
        wd = min(0.36, D * 0.6)
        p.add(geo.box_bm(W, 0.012, wy - base_h, 0, -D / 2 + 0.006, base_h), top)  # splashback
        p.add(geo.box_bm(W, wd, wh, 0, -D / 2 + wd / 2, wy, bevel=0.003), body)
        _framed(p, body, W, wh, wy, -D / 2 + wd, max(1, round(W / 0.5)), handle=brass)
        p.add(geo.box_bm(W - 0.06, 0.03, 0.01, 0, -D / 2 + wd - 0.05, wy - 0.012), lib.plain("under-light", "#ffe2b8", 0.5, emission=("#ffcf94", 3.0)))


def _fluted_vanity(p: Parts, lib, kind, W, D, H, colors):
    """A vanity with vertical flutes across its fronts, a honed stone top, a basin and a brass tap."""
    body = lib.slot(kind, "body", _c(colors, "body", "#4b3022"))
    top = lib.slot(kind, "top", _c(colors, "top", "#c7b59b"))
    base_h = min(0.86, H)
    p.add(geo.box_bm(W - 0.02, D - 0.08, 0.1, 0, -0.05, 0.0), lib.dark())
    p.add(geo.box_bm(W, D - 0.04, base_h - 0.14, 0, -0.02, 0.1, bevel=0.003), body)
    n = max(4, round(W / 0.035))
    for i in range(n):
        p.add(geo.cylinder_bm(0.012, 0.012, base_h - 0.16, -W / 2 + W * (i + 0.5) / n, D / 2 - 0.015, 0.11, 8), body)
    p.add(geo.box_bm(W, D, 0.04, 0, 0, base_h - 0.04, bevel=0.006), top)
    p.add(geo.cylinder_bm(min(W, D) * 0.28, min(W, D) * 0.24, 0.06, 0, 0.02, base_h - 0.01, 32), lib.ceramic())
    p.add(geo.cylinder_bm(0.012, 0.012, 0.18, 0, -D / 2 + 0.08, base_h, 10), lib.plain("brass", BRASS, 0.32, 0.85))


def _club_chair(p: Parts, lib, kind, W, D, H, colors):
    """A deep club chair: upholstered base, thick seat cushion, curved back, rolled arms, tapered wooden legs."""
    body = lib.slot(kind, "body", _c(colors, "body", "#4d5842"))
    leg = lib.slot(kind, "legs", _c(colors, "legs", "#4b3022"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.add(geo.cylinder_bm(0.022, 0.014, 0.12, sx * (W / 2 - 0.08), sy * (D / 2 - 0.08), 0.0, 10), leg)
    p.add(geo.box_bm(W, D, 0.22, 0, 0, 0.12, bevel=0.08), body)
    p.add(geo.box_bm(W - 0.26, D - 0.2, 0.16, 0, 0.05, 0.32, bevel=0.07), body)
    p.add(geo.box_bm(W - 0.06, 0.2, H - 0.3, 0, -D / 2 + 0.1, 0.3, bevel=0.09), body)
    for sx in (-1, 1):
        p.add(geo.box_bm(0.15, D - 0.04, 0.3, sx * (W / 2 - 0.075), 0, 0.3, bevel=0.07), body)
        roll = geo.cylinder_bm(0.085, 0.085, D - 0.06, 0, 0, 0.0, 20)
        geo.transform(roll, Matrix.Rotation(math.pi / 2, 4, "X"))
        bmesh.ops.translate(roll, vec=Vector((sx * (W / 2 - 0.075), (D - 0.06) / 2, 0.6)), verts=roll.verts)
        p.add(roll, body)


def _tv_wall(p: Parts, lib, kind, W, D, H, colors):
    """A built-in television wall: framed full-height panelling (H tall), a cornice, a framed console, the screen in
    a recessed niche, shelves either side, a warm light line under the cornice."""
    body = lib.slot(kind, "body", _c(colors, "body", "#4b3022"))
    brass = lib.plain("brass", BRASS, 0.32, 0.85)
    back = -D / 2 + 0.02
    p.add(geo.box_bm(W, 0.04, H, 0, back, 0.0), body)
    panels = max(3, round(W / 0.5))
    pw = W / panels
    for i in range(panels):
        xc = -W / 2 + pw * (i + 0.5)
        z0, ph = 1.02, H - 1.02 - 0.12
        for dz in (z0, z0 + ph):
            p.add(geo.box_bm(pw - 0.06, 0.015, 0.03, xc, back + 0.025, dz), body)
        for dx in (-1, 1):
            p.add(geo.box_bm(0.03, 0.015, ph, xc + dx * (pw / 2 - 0.045), back + 0.025, z0), body)
    p.add(geo.box_bm(W + 0.04, 0.08, 0.06, 0, back + 0.02, H - 0.06), body)
    ch = 0.55
    p.add(geo.box_bm(W - 0.04, D - 0.12, 0.06, 0, 0.02, 0.0), lib.dark())
    p.add(geo.box_bm(W, D - 0.04, ch - 0.08, 0, 0, 0.06), body)
    p.add(geo.box_bm(W + 0.02, D, 0.03, 0, 0, ch - 0.02), body)
    _framed(p, body, W, ch - 0.12, 0.08, D / 2 - 0.02, max(2, round(W / 0.55)), handle=brass)
    sw = min(1.5, W * 0.6)
    sh = sw * 0.5625
    sz = ch + 0.22
    p.add(geo.box_bm(sw + 0.16, 0.02, sh + 0.16, 0, back + 0.03, sz - 0.08), lib.plain("niche", "#2a211b", 0.85))
    p.add(geo.box_bm(sw + 0.02, 0.03, sh + 0.02, 0, back + 0.055, sz), lib.plain("screen", "#0e0f11", 0.08, 0.2))
    for sx in (-1, 1):
        x = sx * (sw / 2 + min(0.32, (W - sw) / 4) + 0.06)
        if abs(x) + 0.2 > W / 2:
            continue
        for z in (sz + 0.05, sz + sh * 0.6):
            p.add(geo.box_bm(0.36, 0.22, 0.025, x, back + 0.13, z), body)
    p.add(geo.box_bm(W - 0.1, 0.02, 0.012, 0, back + 0.06, H - 0.085), lib.plain("tv-light", "#ffd9a8", 0.5, emission=("#ffc98a", 3.0)))


def _built_in_wardrobe(p: Parts, lib, kind, W, D, H, colors):
    """A built-in wardrobe: floor to ceiling on a plinth, framed doors with brass pulls, a cornice."""
    body = lib.slot(kind, "body", _c(colors, "body", "#4b3022"))
    plinth = 0.08
    p.add(geo.box_bm(W - 0.04, D - 0.08, plinth, 0, -0.04, 0.0), lib.dark())
    p.add(geo.box_bm(W, D - 0.02, H - plinth, 0, -0.01, plinth, bevel=0.004), body)
    p.add(geo.box_bm(W + 0.04, D + 0.02, 0.06, 0, 0, H - 0.06), body)
    _framed(p, body, W, H - plinth - 0.08, plinth, D / 2 - 0.01, max(2, round(W / 0.6)), handle=lib.plain("brass", BRASS, 0.32, 0.85))


def _upholstered_bed(p: Parts, lib, kind, W, D, H, colors):
    """A fully upholstered bed: the frame in the upholstery, the bedding, pillows, and a tall channel-tufted
    headboard (H tall) of separate soft ribs."""
    body = lib.slot(kind, "body", _c(colors, "body", "#cbbba3"))
    linen = lib.slot(kind, "linen", _c(colors, "linen", "#f1e9dc"))
    mattress = lib.plain("mattress", "#f4f2ee", 0.9, sheen=0.4)
    base_top = 0.32
    p.add(geo.box_bm(W, D, base_top - 0.04, 0, 0, 0.04, bevel=0.04), body)
    p.add(geo.box_bm(W - 0.06, D - 0.12, 0.22, 0, 0.03, base_top, bevel=0.05), mattress)
    top = base_top + 0.22
    p.add(geo.box_bm(W - 0.02, D * 0.64, 0.07, 0, D / 2 - D * 0.32 - 0.01, top - 0.04, bevel=0.035), linen)
    n = 1 if W < 1.2 else 2
    pw = (W - 0.2) / n
    for i in range(n):
        p.add(geo.box_bm(pw - 0.06, 0.38, 0.13, -W / 2 + 0.1 + pw * (i + 0.5), -D / 2 + 0.32, top - 0.01, bevel=0.06), linen)
    hw = W + 0.12
    p.add(geo.box_bm(hw, 0.12, H, 0, -D / 2 - 0.02, 0.0, bevel=0.05), body)
    ribs = max(5, round((W + 0.08) / 0.18))
    rw = (W + 0.08) / ribs
    for i in range(ribs):
        p.add(geo.box_bm(rw - 0.012, 0.05, H - 0.16, -(W + 0.08) / 2 + rw * (i + 0.5), -D / 2 + 0.06, 0.16, bevel=0.022), body)


def _bordered_rug(p: Parts, lib, kind, W, D, H, colors):
    """A hand-knotted rug: a border in its second colour, the field, a fine inner line."""
    h = max(0.008, min(H, 0.02))
    border = lib.plain(f"rug-border-{_c(colors, 'accent', '#b88768')}", _c(colors, "accent", "#b88768"), 0.98, sheen=0.5)
    field = lib.plain(f"rug-{_c(colors, 'body', '#d8c2a5')}", _c(colors, "body", "#d8c2a5"), 0.98, sheen=0.5)
    b = min(0.16, min(W, D) * 0.08)
    p.add(geo.box_bm(W, D, h, 0, 0, 0.0), border)
    p.add(geo.box_bm(W - 2 * b, D - 2 * b, h + 0.002, 0, 0, 0.0), field)
    for sy in (-1, 1):
        p.add(geo.box_bm(W - 2 * b - 0.08, 0.02, h + 0.004, 0, sy * (D / 2 - b - 0.06), 0.0), border)
    for sx in (-1, 1):
        p.add(geo.box_bm(0.02, D - 2 * b - 0.1, h + 0.004, sx * (W / 2 - b - 0.06), 0, 0.0), border)


DESIGN_BUILDERS = {
    ("KITCHEN_RUN", "SHAKER"): _shaker_kitchen,
    ("VANITY", "FLUTED"): _fluted_vanity,
    ("ARMCHAIR", "CLUB"): _club_chair,
    ("TV_UNIT", "TV_WALL"): _tv_wall,
    ("WARDROBE", "BUILT_IN"): _built_in_wardrobe,
    ("BED", "UPHOLSTERED"): _upholstered_bed,
    ("RUG", "BORDERED"): _bordered_rug,
}


BUILDERS = {
    "SOFA": lambda p, l, k, W, D, H, c, f, key: _sofa(p, l, k, W, D, H, c),
    "ARMCHAIR": lambda p, l, k, W, D, H, c, f, key: _shell(p, l, k, W, D, H, c) if f == "SHELL" else _sofa(p, l, k, W, D, H, c, seats=1),
    "RECLINER": lambda p, l, k, W, D, H, c, f, key: _sofa(p, l, k, W, D, H, c, seats=1),
    "CHAIR": lambda p, l, k, W, D, H, c, f, key: _shell(p, l, k, W, D, H, c) if f == "SHELL" else _chair(p, l, k, W, D, H, c),
    "STOOL": lambda p, l, k, W, D, H, c, f, key: _stool(p, l, k, W, D, H, c),
    "TABLE": lambda p, l, k, W, D, H, c, f, key: _table(p, l, k, W, D, H, c, f),
    "ROUND_TABLE": lambda p, l, k, W, D, H, c, f, key: _table(p, l, k, W, D, H, c, f),
    "BED": lambda p, l, k, W, D, H, c, f, key: _bed(p, l, k, W, D, H, c),
    "RUG": lambda p, l, k, W, D, H, c, f, key: _rug(p, l, k, W, D, H, c, f),
    "PLANT": lambda p, l, k, W, D, H, c, f, key: _plant(p, l, k, W, D, H, c, key),
    "PLANTER": lambda p, l, k, W, D, H, c, f, key: _plant(p, l, k, W, D, H, c, key),
    "LAMP": lambda p, l, k, W, D, H, c, f, key: _lamp(p, l, k, W, D, H, c),
    "CABINET": lambda p, l, k, W, D, H, c, f, key: _cabinet(p, l, k, W, D, H, c),
    "DRESSER": lambda p, l, k, W, D, H, c, f, key: _cabinet(p, l, k, W, D, H, c),
    "WARDROBE": lambda p, l, k, W, D, H, c, f, key: _cabinet(p, l, k, W, D, H, c),
    "TV_UNIT": lambda p, l, k, W, D, H, c, f, key: _tv_unit(p, l, k, W, D, H, c),
    "SHELF": lambda p, l, k, W, D, H, c, f, key: _shelf(p, l, k, W, D, H, c),
    "KITCHEN_RUN": lambda p, l, k, W, D, H, c, f, key: _kitchen(p, l, k, W, D, H, c),
    "VANITY": lambda p, l, k, W, D, H, c, f, key: _kitchen(p, l, k, W, D, H, c),
    "FRIDGE": lambda p, l, k, W, D, H, c, f, key: _fridge(p, l, k, W, D, H, c),
    "WASHER": lambda p, l, k, W, D, H, c, f, key: _washer(p, l, k, W, D, H, c),
    "SHOWER": lambda p, l, k, W, D, H, c, f, key: _shower(p, l, k, W, D, H, c),
    "TOILET": lambda p, l, k, W, D, H, c, f, key: _toilet(p, l, k, W, D, H, c),
    "BATH": lambda p, l, k, W, D, H, c, f, key: _bath(p, l, k, W, D, H, c),
    "CURTAIN": lambda p, l, k, W, D, H, c, f, key: _curtain(p, l, k, W, D, H, c),
    "BLIND": lambda p, l, k, W, D, H, c, f, key: _blind(p, l, k, W, D, H, c),
}

BEND = {"CURVED": math.radians(75), "ROUNDED": math.radians(35)}


def build_piece(o: dict, lib, collection):
    """One piece as one mesh object, at the origin, fitted to its read size; returns the object."""
    W, D, H = o["size"]["w"], o["size"]["d"], o["size"]["h"]
    kind, form = o["kind"], o["form"]
    p = Parts()
    if kind == "SOFA" and form == "L_SHAPED":
        main_d = min(D, 0.95)
        chaise = min(0.9, W * 0.4)
        sub = Parts()
        _sofa(sub, lib, kind, W, main_d, H, o["colors"])
        for bm, m in sub.items:
            bmesh.ops.translate(bm, vec=Vector((0.0, -D / 2 + main_d / 2, 0.0)), verts=bm.verts)
            p.add(bm, m)
        cushion = lib.slot(kind, "cushion", _c(o["colors"], "cushion", _c(o["colors"], "body", "#c9c4bc")))
        body = lib.slot(kind, "body", _c(o["colors"], "body", "#cfc6b8"))
        p.add(geo.box_bm(chaise, D - main_d + 0.1, 0.2, W / 2 - chaise / 2, D / 2 - (D - main_d + 0.1) / 2, 0.08, bevel=0.03), body)
        p.add(geo.box_bm(chaise - 0.02, D - main_d + 0.08, 0.16, W / 2 - chaise / 2, D / 2 - (D - main_d + 0.08) / 2, 0.28, bevel=0.06), cushion)
    elif (kind, form) in DESIGN_BUILDERS:
        DESIGN_BUILDERS[(kind, form)](p, lib, kind, W, D, H, o["colors"])
    else:
        BUILDERS.get(kind, BUILDERS["CABINET"])(p, lib, kind, W, D, H, o["colors"], form, o["id"])
    mats: list = []
    bm = bmesh.new()
    for part, mat in p.items:
        if mat not in mats:
            mats.append(mat)
        idx = mats.index(mat)
        for f in part.faces:
            f.material_index = idx
        bm = geo.merge(bm, part)
    ob = geo.new_object(f"obj:{o['id']}", bm, None, collection=collection)
    for m in mats:
        ob.data.materials.append(m)
    if form in BEND and kind in ("SOFA", "ARMCHAIR", "RECLINER"):
        geo.slice_along_x(ob, 16)
        geo.bend(ob, BEND[form], "Z")
    fit(ob, W, D, H, exact=True)
    geo.metre_uvs(ob, "BOX")
    return ob


def fit(ob, W: float, D: float, H: float, exact: bool) -> None:
    """Fit an object to w × d × h: exactly (a piece HOMATCH built), or as the walkthrough fits a model."""
    me = ob.data
    if not me.vertices:
        return
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    sx = W / max(max(xs) - min(xs), 1e-6)
    sy = D / max(max(ys) - min(ys), 1e-6)
    sz = H / max(max(zs) - min(zs), 1e-6)
    if not exact:
        ratios = sorted([sx, sy, sz])
        med = ratios[1]
        close = all(abs(r / med - 1) <= 0.12 for r in (sx, sy, sz))
        if not close:
            sx = sy = sz = med
    cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
    for v in me.vertices:
        v.co.x = (v.co.x - cx) * sx
        v.co.y = (v.co.y - cy) * sy
        v.co.z = (v.co.z - z0) * sz
    me.update()


def import_model(o: dict, path: str, collection):
    """A catalogue model (its own GLB), joined into one mesh and fitted like the walkthrough fits it."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [x for x in bpy.data.objects if x not in before]
    meshes = [x for x in new if x.type == "MESH"]
    if not meshes:
        for x in new:
            bpy.data.objects.remove(x, do_unlink=True)
        raise RuntimeError("model has no mesh")
    for x in meshes:
        mw = x.matrix_world.copy()
        x.parent = None
        x.matrix_world = mw
    bpy.ops.object.select_all(action="DESELECT")
    for x in meshes:
        x.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for x in new:
        if x != ob and x.name in bpy.data.objects:
            bpy.data.objects.remove(x, do_unlink=True)
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    collection.objects.link(ob)
    ob.name = f"obj:{o['id']}"[:63]
    fit(ob, o["size"]["w"], o["size"]["d"], o["size"]["h"], exact=False)
    return ob
