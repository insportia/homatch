"""Container entry: make sure the approved weights are present, then serve Runpod jobs.

Weights live on the Runpod network volume when one is attached (so a cold
start does not download them again), else on the container disk. The token for
the gated encoder comes from the endpoint's secret environment (HF_TOKEN) and is
never logged.
"""
from __future__ import annotations

import os
from pathlib import Path


def model_dir() -> Path:
    vol = Path("/runpod-volume")
    return vol / "homatch-ds-models" if vol.is_dir() else Path("/models")


def main() -> None:
    d = model_dir()
    os.environ["HM_MODEL_DIR"] = str(d)
    os.environ.setdefault("HF_HOME", str(d / "hf"))
    if not (d / "trellis2" / "pipeline.json").exists() or not (d / "sam2").exists():
        from .prepare_models import main as prepare

        prepare(str(d))
    import runpod  # type: ignore

    from .handler import handle

    runpod.serverless.start({"handler": handle})


if __name__ == "__main__":
    main()
