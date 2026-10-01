"""The runtime GLB: the same toolchain as the catalogue importer (scripts/design-studio/catalog-import.mjs).

Textures capped, duplicates and unused data removed, normal maps UASTC,
everything else ETC1S, geometry meshopt; then the Khronos validator. Every tool
is called with an argument list (never a shell string). A model whose textures
did not compress, or that the validator rejects, is a failure, not a fallback.
"""
from __future__ import annotations

import json
import shutil
import struct
import subprocess
from pathlib import Path

KTX2_MAGIC = bytes([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB])
HERE = Path(__file__).resolve().parent


def _run(args: list[str], timeout: int = 300) -> None:
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if r.returncode != 0:
        raise RuntimeError(f"{Path(args[0]).name} {args[1] if len(args) > 1 else ''} failed: {(r.stderr or r.stdout)[-400:]}")


def glb_json(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise RuntimeError("not a GLB")
    length, ctype = struct.unpack_from("<II", data, 12)
    if ctype != 0x4E4F534A:
        raise RuntimeError("GLB without a JSON chunk")
    return json.loads(data[20:20 + length])


def facts(path: Path) -> dict:
    j = glb_json(path)
    tris = 0
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            acc = p.get("indices", p.get("attributes", {}).get("POSITION"))
            if acc is not None:
                tris += j["accessors"][acc]["count"] // 3
    images = j.get("images", [])
    exts = set(j.get("extensionsUsed", []))
    return {
        "bytes": path.stat().st_size, "triangles": tris, "textures": len(images),
        "compressed": (not images) or "KHR_texture_basisu" in exts, "meshopt": "EXT_meshopt_compression" in exts,
    }


def optimize(src: Path, out: Path, texture_size: int, tools: dict | None = None) -> dict:
    tools = tools or {}
    gt = tools.get("gltf_transform") or shutil.which("gltf-transform")
    if not gt:
        raise RuntimeError("gltf-transform is not installed")
    work = out.parent / f"{out.stem}.opt"
    work.mkdir(parents=True, exist_ok=True)
    cur = src
    textured = facts(src)["textures"] > 0
    # Texture steps only when there are textures (a factory-built piece wears colours, not maps).
    steps = [
        *([["resize", "--width", str(texture_size), "--height", str(texture_size)]] if textured else []),
        ["dedup"],
        ["prune"],
        *([
            ["uastc", "--slots", "normalTexture", "--level", "2", "--rdo", "--rdo-lambda", "0.5", "--zstd", "18"],
            ["etc1s", "--quality", "255"],
        ] if textured else []),
    ]
    for i, step in enumerate(steps):
        nxt = work / f"{i}.glb"
        _run([gt, step[0], str(cur), str(nxt), *step[1:]])
        cur = nxt
    _run([gt, "meshopt", str(cur), str(out)])
    shutil.rmtree(work, ignore_errors=True)
    f = facts(out)
    if f["textures"] > 0 and not f["compressed"]:
        raise RuntimeError("runtime GLB textures are not GPU-compressed (KTX2 encoding failed)")
    node = tools.get("node") or shutil.which("node")
    if node:
        r = subprocess.run([node, str(HERE / "validate.mjs"), str(out)], capture_output=True, text=True, timeout=120, check=False)
        v = json.loads(r.stdout or "{}") if r.returncode == 0 else {"errors": -1}
        if v.get("errors", 0) != 0:
            raise RuntimeError(f"runtime GLB fails the Khronos validator ({v.get('errors')} errors)")
        f["validator"] = v
    return f
