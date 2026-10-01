"""Image-to-3D and segmentation adapters.

HOMATCH's domain never names a model: the pipeline asks a Generator for a mesh
of the object in an RGBA image, and a Segmenter for the object's mask. The
approved production generator is TRELLIS.2-4B (MIT code and weights); the
background remover its default pipeline would load (RMBG-2.0, non-commercial)
is replaced by a stub that refuses to run — inputs are always RGBA with our own
mask. Masks come from SAM 2.1 (Apache-2.0), prompted with the object's box,
which is projected through the picture's measured camera (no guessing).
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image

MODEL_DIR = Path(os.environ.get("HM_MODEL_DIR", "/models"))


class Generator(Protocol):
    name: str
    version: str

    def generate(self, rgba: Image.Image, seed: int, out_glb: Path, texture_size: int) -> dict:
        """Write a GLB of the object; return facts (triangles before export, …)."""


class MockGenerator:
    """A coloured box with a raised back, as a GLB — no GPU. For tests and dry runs of the whole pipeline."""

    name = "mock"
    version = "mock-1"

    def generate(self, rgba: Image.Image, seed: int, out_glb: Path, texture_size: int) -> dict:
        import trimesh

        arr = np.asarray(rgba.convert("RGBA"))
        alpha = arr[..., 3] > 127
        colour = arr[..., :3][alpha].mean(axis=0) if alpha.any() else np.array([128, 128, 128])
        seat = trimesh.creation.box(extents=(2.2, 0.45, 0.85))  # x width, y up, z depth (glTF is Y-up)
        seat.apply_translation((0, 0.225, 0))
        back = trimesh.creation.box(extents=(2.2, 0.4, 0.2))
        back.apply_translation((0, 0.65, 0.325))  # the back is at +z: the front faces -z (as generated models often do not)
        mesh = trimesh.util.concatenate([seat, back])
        mesh.visual.vertex_colors = np.tile(np.append(colour.astype(np.uint8), 255), (len(mesh.vertices), 1))
        mesh.export(out_glb)
        return {"triangles": int(len(mesh.faces))}


class Trellis2Generator:
    """TRELLIS.2-4B. Loaded once per worker (warm requests reuse it)."""

    name = "trellis2"

    def __init__(self) -> None:
        os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")
        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        from trellis2.pipelines import Trellis2ImageTo3DPipeline, rembg  # type: ignore

        class Refused:  # the non-commercial background remover is never run
            def __init__(self, *_a, **_k) -> None:
                pass

            def __call__(self, *_a, **_k):
                raise RuntimeError("background removal is not licensed here: pass an RGBA image with its mask")

            def to(self, *_a, **_k):
                return self

            def cpu(self):
                return self

            def cuda(self):
                return self

        rembg.Refused = Refused
        local = MODEL_DIR / "trellis2"
        cfg = json.loads((local / "pipeline.json").read_text())
        if cfg["args"].get("rembg_model", {}).get("name") != "Refused":
            raise RuntimeError("the baked TRELLIS.2 config must route background removal to the refusing stub")
        self.pipeline = Trellis2ImageTo3DPipeline.from_pretrained(str(local))
        self.pipeline.cuda()
        self.version = f"TRELLIS.2-4B@{(local / 'REVISION').read_text().strip() if (local / 'REVISION').exists() else 'unknown'}"

    def generate(self, rgba: Image.Image, seed: int, out_glb: Path, texture_size: int) -> dict:
        import o_voxel  # type: ignore

        if rgba.mode != "RGBA":
            raise ValueError("RGBA only")
        mesh = self.pipeline.run(rgba, seed=seed, pipeline_type="1024_cascade")[0]
        mesh.simplify(16777216)
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords, attr_layout=mesh.layout,
            voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=200000, texture_size=texture_size, remesh=True, remesh_band=1, remesh_project=0, verbose=False,
        )
        glb.export(str(out_glb), extension_webp=True)
        return {"triangles": int(len(mesh.faces))}


class Sam2Segmenter:
    """SAM 2.1 (hiera-small), prompted with the object's box and its centre."""

    name = "sam2.1-hiera-small"

    def __init__(self) -> None:
        from sam2.sam2_image_predictor import SAM2ImagePredictor  # type: ignore

        self.predictor = SAM2ImagePredictor.from_pretrained(str(MODEL_DIR / "sam2"))

    def mask(self, crop: Image.Image, prompt_box: tuple[int, int, int, int]) -> np.ndarray:
        import torch

        with torch.inference_mode():
            self.predictor.set_image(np.asarray(crop.convert("RGB")))
            l, t, r, b = prompt_box
            masks, scores, _ = self.predictor.predict(
                box=np.array([l, t, r, b], dtype=np.float32),
                point_coords=np.array([[(l + r) / 2, (t + b) / 2]], dtype=np.float32), point_labels=np.array([1]),
                multimask_output=True,
            )
        return masks[int(np.argmax(scores))].astype(bool)


def make(model: str) -> tuple[Generator, object]:
    from .imaging import BoxSegmenter

    if model == "mock":
        return MockGenerator(), BoxSegmenter()
    return Trellis2Generator(), Sam2Segmenter()
