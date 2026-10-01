"""Runpod Serverless entry point for the Design Studio GPU worker.

Models load once per worker (cold start) and are reused while it is warm. A
job is validated before anything runs; a health request reports versions and
the GPU without generating anything. No secret is ever logged or returned.
"""
from __future__ import annotations

import os
import shutil
import time

from .schema import JobError, parse_job

_STATE: dict = {}


def _tools() -> dict:
    return {
        "blender": os.environ.get("HM_BLENDER", shutil.which("blender") or "/opt/blender/blender"),
        "gltf_transform": shutil.which("gltf-transform"),
        "node": shutil.which("node"),
    }


def _models(name: str):
    from .models import make

    if name not in _STATE:
        t = time.perf_counter()
        _STATE[name] = make(name)
        _STATE[f"{name}:loadMs"] = int((time.perf_counter() - t) * 1000)
    return _STATE[name], _STATE.get(f"{name}:loadMs", 0)


def handle(event: dict) -> dict:
    payload = (event or {}).get("input") or {}
    if payload.get("health") is True:
        gpu = None
        try:
            import torch

            gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
        except Exception:  # noqa: BLE001
            gpu = None
        return {"ok": True, "gpu": gpu, "tools": {k: bool(v) for k, v in _tools().items()}, "warm": [k for k in _STATE if ":" not in k]}
    try:
        job = parse_job(payload)
    except JobError as e:
        return {"ok": False, "error": f"INVALID_JOB: {e}"}
    from .pipeline import run_job

    cold = job.model not in _STATE
    (generator, segmenter), load_ms = _models(job.model)
    out = run_job(job, generator, segmenter, _tools())
    out["ok"] = True
    out["coldStart"] = cold
    out["timings"]["modelLoad"] = load_ms if cold else 0
    return out


if __name__ == "__main__":
    import runpod  # type: ignore

    runpod.serverless.start({"handler": handle})
