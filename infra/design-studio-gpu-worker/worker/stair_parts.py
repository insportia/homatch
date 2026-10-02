"""A flight of stairs, as parts — the same rules as src/lib/designStudio/stairParts.ts.

The spec says where a flight is (start edge a→b, the run to its left, the rise,
the number of steps); this says what it is made of, as boxes in the flight's own
frame, so the factory builds the staircase the walkthrough shows:

  TREAD     a board on every step, its nosing proud of the riser below
  RISER     the upright between treads
  STRINGER  the sloped board each side carries the steps on
  RAIL      the handrail 0.9 m above the nosing line (open sides; on the wall when both are walled)
  BALUSTER  one per step under an open side's rail
  POST      a newel at each end of an open side's rail
  GUARD     a DOWN flight's balustrade round its well, at floor level
  WELL      the lining round the hole the flight passes through

Frame: u along a→b (0..width), v up the run to the left of a→b (0..runM), h up.
A part is a box centred at (u, v, h), sized (su, sv, sh), pitched `pitch` radians
about u (positive: rising with v). Pure Python: no bpy.
"""
from __future__ import annotations

import math

DIMS = {
    "treadT": 0.04, "nosing": 0.03, "riserT": 0.02, "stringerT": 0.05, "stringerD": 0.28,
    "railH": 0.9, "railT": 0.05, "balusterT": 0.025, "postT": 0.08, "guardH": 1.0, "wellT": 0.05, "wellH": 0.3,
}


def _r4(n: float) -> float:
    # Math.round(n * 1e4) / 1e4 (half up, as JavaScript rounds).
    return math.floor(n * 10000 + 0.5) / 10000


def _seg_dist(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    len2 = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) if len2 > 0 else 0.0
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def stair_sides(st: dict, walls: list[dict]) -> tuple[bool, bool]:
    """(open_a, open_b): whether the long side through a (u = 0) / b (u = width) has no wall along it."""
    a, b = st["a"], st["b"]
    w = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    climb = (-(b[1] - a[1]) / w, (b[0] - a[0]) / w)

    def walled(o) -> bool:
        for s in walls:
            if all(_seg_dist((o[0] + climb[0] * st["runM"] * f, o[1] + climb[1] * st["runM"] * f), s["start"], s["end"]) <= s["thicknessM"] / 2 + 0.15
                   for f in (0.25, 0.5, 0.75)):
                return True
        return False

    return (not walled(a), not walled(b))


def stair_parts(st: dict, open_a: bool, open_b: bool) -> list[dict]:
    D = DIMS
    a, b = st["a"], st["b"]
    width = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, int(round(st["treads"])))
    run, rise = st["runM"], st["riseM"]
    g, r = run / n, rise / n
    down = st["direction"] == "DOWN"
    parts: list[dict] = []

    def put(kind, u, v, h, su, sv, sh, pitch=0.0):
        parts.append({
            "kind": kind,
            "centre": (_r4(u), _r4(run - v if down else v), _r4(h - rise if down else h)),
            "size": (_r4(su), _r4(sv), _r4(sh)),
            "pitch": _r4(-pitch if down else pitch),
        })

    inner = max(0.1, width - 2 * D["stringerT"])
    for k in range(1, n + 1):
        v0 = (k - 1) * g
        put("TREAD", width / 2, v0 + g / 2 - D["nosing"] / 2, k * r - D["treadT"] / 2, inner, g + D["nosing"], D["treadT"])
        put("RISER", width / 2, v0 + D["riserT"] / 2, (k - 1) * r + (r - D["treadT"]) / 2, inner, D["riserT"], max(0.01, r - D["treadT"]))
    pitch = math.atan2(rise, run)
    slope = math.hypot(run, rise)
    line_mid = r + rise / 2
    s_centre = line_mid + 0.05 - (D["stringerD"] / 2) / math.cos(pitch)
    for u in (D["stringerT"] / 2, width - D["stringerT"] / 2):
        put("STRINGER", u, run / 2, s_centre, D["stringerT"], slope, D["stringerD"], pitch)

    rail_sides = ([D["stringerT"] / 2] if open_a else []) + ([width - D["stringerT"] / 2] if open_b else [])
    wall_rail = not rail_sides
    rails = [0.06] if wall_rail else rail_sides

    def rail_top(v):
        return r + (v * r) / g + D["railH"]

    v_end = run if down else max(g, min(run, ((rise - 0.05 - D["railH"] - r) * g) / r))
    for u in rails:
        put("RAIL", u, v_end / 2, rail_top(v_end / 2), D["railT"], (v_end * slope) / run, D["railT"], pitch)
        if wall_rail:
            continue
        for k in range(1, n + 1):
            v = (k - 1) * g + g / 2
            if v > v_end:
                break
            foot = k * r
            put("BALUSTER", u, v, (rail_top(v) + foot) / 2, D["balusterT"], D["balusterT"], rail_top(v) - foot)
        post_h = r + D["railH"] + 0.1
        put("POST", u, D["postT"] / 2, post_h / 2, D["postT"], D["postT"], post_h)
        if down:
            put("POST", u, run - D["postT"] / 2, rise + post_h / 2, D["postT"], D["postT"], post_h)

    if down:
        def guard(u0, v0, u1, v1):
            length = math.hypot(u1 - u0, v1 - v0)
            along_u = abs(u1 - u0) >= abs(v1 - v0)
            put("GUARD", (u0 + u1) / 2, (v0 + v1) / 2, rise + D["guardH"] - D["railT"] / 2,
                length if along_u else D["railT"], D["railT"] if along_u else length, D["railT"])
            posts = max(2, math.ceil(length / 1.0) + 1)
            for i in range(posts):
                f = i / (posts - 1)
                put("GUARD", u0 + (u1 - u0) * f, v0 + (v1 - v0) * f, rise + (D["guardH"] - D["railT"]) / 2,
                    D["balusterT"] * 1.6, D["balusterT"] * 1.6, D["guardH"] - D["railT"])

        guard(0, 0, width, 0)
        if open_a:
            guard(0, 0, 0, run)
        if open_b:
            guard(width, 0, width, run)
        put("WELL", -D["wellT"] / 2, run / 2, rise / 2, D["wellT"], run, rise)
        put("WELL", width + D["wellT"] / 2, run / 2, rise / 2, D["wellT"], run, rise)
        put("WELL", width / 2, -D["wellT"] / 2, rise / 2, width + 2 * D["wellT"], D["wellT"], rise)
    else:
        h0 = rise + D["wellH"] / 2
        put("WELL", -D["wellT"] / 2, run / 2, h0, D["wellT"], run, D["wellH"])
        put("WELL", width + D["wellT"] / 2, run / 2, h0, D["wellT"], run, D["wellH"])
        put("WELL", width / 2, -D["wellT"] / 2, h0, width + 2 * D["wellT"], D["wellT"], D["wellH"])
        put("WELL", width / 2, run + D["wellT"] / 2, h0, width + 2 * D["wellT"], D["wellT"], D["wellH"])
        put("WELL", width / 2, run / 2, rise + D["wellH"] + D["wellT"] / 2, width + 2 * D["wellT"], run + 2 * D["wellT"], D["wellT"])
    return parts
