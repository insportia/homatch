"""Runpod Serverless entry point for the Design Studio scene factory.

A job is validated before anything runs; a health request reports the tool
versions and the GPU without building anything. Production refuses to run
without the optimisation toolchain (an unoptimised model never ships). No
secret is ever logged or returned.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import time

from .schema import JobError, parse_job

_STARTED = time.time()
_JOBS = {"n": 0}


def tools() -> dict:
    return {
        "blender": os.environ.get("HM_BLENDER", shutil.which("blender") or "/opt/blender/blender"),
        "gltf_transform": shutil.which("gltf-transform"),
        "node": shutil.which("node"),
        "ktx": shutil.which("ktx"),
    }


def _gpu() -> str | None:
    smi = shutil.which("nvidia-smi")
    if not smi:
        return None
    try:
        r = subprocess.run([smi, "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, timeout=10, check=False)
        return r.stdout.strip().splitlines()[0] if r.returncode == 0 and r.stdout.strip() else None
    except Exception:  # noqa: BLE001
        return None


def handle(event: dict) -> dict:
    payload = (event or {}).get("input") or {}
    t = tools()
    if payload.get("health") is True:
        version = None
        try:
            r = subprocess.run([t["blender"], "--version"], capture_output=True, text=True, timeout=60, check=False)
            version = (r.stdout.splitlines() or [""])[0].strip() or None
        except Exception:  # noqa: BLE001
            version = None
        return {"ok": True, "gpu": _gpu(), "blender": version, "tools": {k: bool(v) for k, v in t.items()},
                "warmSeconds": int(time.time() - _STARTED), "jobsServed": _JOBS["n"]}
    try:
        job = parse_job(payload)
    except JobError as e:
        return {"ok": False, "error": f"INVALID_JOB: {e}"}
    missing = [k for k in ("gltf_transform", "node", "ktx") if not t[k]]
    if missing and os.environ.get("HM_ALLOW_UNOPTIMIZED") != "1":
        return {"ok": False, "error": f"TOOLCHAIN_MISSING: {','.join(missing)}"}
    from .pipeline import run_job

    cold = _JOBS["n"] == 0
    _JOBS["n"] += 1

    def progress(stage: str) -> None:
        # Runpod relays this through the job's status while it runs: the customer's real stage.
        try:
            import runpod  # type: ignore

            runpod.serverless.progress_update(event, {"stage": stage})
        except Exception:  # noqa: BLE001 - progress is a courtesy, never a failure
            pass

    try:
        out = run_job(job, t, progress=progress)
    except Exception as e:  # noqa: BLE001 - the reason, never a stack with paths or URLs
        return {"ok": False, "error": f"FACTORY_FAILED: {str(e)[:300]}", "coldStart": cold}
    out["ok"] = True
    out["coldStart"] = cold
    out["gpu"] = _gpu()
    return out
