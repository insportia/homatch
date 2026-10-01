"""Build-time: bake the approved model weights into the image (no download at request time).

  python -m worker.prepare_models /models

Needs HF_TOKEN at build time for the gated DINOv3 encoder (license accepted on
Hugging Face by the owner; "Built with DINOv3" shown where required). The
TRELLIS.2 config is rewritten so its background remover — RMBG-2.0, which is
licensed for non-commercial use only — is routed to a stub that refuses to
run; it is never downloaded. Inputs are always RGBA with HOMATCH's own mask.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

TRELLIS = "microsoft/TRELLIS.2-4B"
TRELLIS_V1_DECODER = "microsoft/TRELLIS-image-large"
DINOV3 = "facebook/dinov3-vitl16-pretrain-lvd1689m"
SAM2 = "facebook/sam2.1-hiera-small"


def route_rembg_to_stub(cfg: dict) -> dict:
    out = json.loads(json.dumps(cfg))
    out["args"]["rembg_model"] = {"name": "Refused", "args": {}}
    return out


def main(dest: str) -> None:
    from huggingface_hub import snapshot_download  # type: ignore

    root = Path(dest)
    t = root / "trellis2"
    rev = snapshot_download(TRELLIS, local_dir=t)
    cfg = json.loads((t / "pipeline.json").read_text())
    (t / "pipeline.json").write_text(json.dumps(route_rembg_to_stub(cfg), indent=2))
    (t / "REVISION").write_text(Path(rev).name)
    # Shared decoder and the image encoder go to the Hugging Face cache (resolved by repo id at load).
    snapshot_download(TRELLIS_V1_DECODER, allow_patterns=["ckpts/ss_dec_conv3d_16l8_fp16*", "*.json"])
    snapshot_download(DINOV3)
    snapshot_download(SAM2, local_dir=root / "sam2")
    print(json.dumps({"ok": True, "trellis": str(t), "sam2": str(root / "sam2")}))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/models")
