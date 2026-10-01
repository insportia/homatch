"""The picture, its crops and their masks.

Downloaded once per job, bounded and verified; every object gets a square,
padded RGBA crop whose alpha is the object's own mask. The generator is always
given RGBA: its default background remover (a non-commercial model) is never
loaded.
"""
from __future__ import annotations

import hashlib
import io
from typing import Protocol

import numpy as np
import requests
from PIL import Image

from .schema import MAX_IMAGE_BYTES, JobError

Image.MAX_IMAGE_PIXELS = 60_000_000  # a decompression bomb is refused, not decoded


def download_image(url: str, sha256: str | None, timeout: float = 60.0) -> Image.Image:
    with requests.get(url, stream=True, timeout=timeout) as r:
        if r.status_code != 200:
            raise JobError(f"image: HTTP {r.status_code}")
        buf = io.BytesIO()
        for chunk in r.iter_content(1 << 16):
            buf.write(chunk)
            if buf.tell() > MAX_IMAGE_BYTES:
                raise JobError("image: too large")
    data = buf.getvalue()
    if sha256 and hashlib.sha256(data).hexdigest() != sha256:
        raise JobError("image: does not match its recorded hash")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001 - any decode failure is the same refusal
        raise JobError("image: not a readable picture") from e
    if img.format not in ("JPEG", "PNG", "WEBP"):
        raise JobError("image: jpeg, png or webp only")
    return img.convert("RGB")


def crop_box(img: Image.Image, box: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    w, h = img.size
    left, top, right, bottom = box
    return (max(0, int(left * w)), max(0, int(top * h)), min(w, int(round(right * w))), min(h, int(round(bottom * h))))


class Segmenter(Protocol):
    name: str

    def mask(self, crop: Image.Image, prompt_box: tuple[int, int, int, int]) -> np.ndarray:
        """A boolean mask (H, W) of the object inside the crop, prompted by its tight box (crop pixels)."""


class BoxSegmenter:
    """No model: the object's tight box, softened to an ellipse. For tests and as a last fallback."""

    name = "box"

    def mask(self, crop: Image.Image, prompt_box: tuple[int, int, int, int]) -> np.ndarray:
        h, w = crop.size[1], crop.size[0]
        yy, xx = np.mgrid[0:h, 0:w]
        l, t, r, b = prompt_box
        cx, cy = (l + r) / 2, (t + b) / 2
        rx, ry = max(1.0, (r - l) / 2), max(1.0, (b - t) / 2)
        return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0


def object_rgba(img: Image.Image, crop: tuple[float, float, float, float], tight: tuple[float, float, float, float], segmenter: Segmenter, size: int = 1024) -> tuple[Image.Image, float]:
    """The object alone (RGBA, square, centred, padded) and the share of the crop its mask covers."""
    cb = crop_box(img, crop)
    tb = crop_box(img, tight)
    if cb[2] - cb[0] < 8 or cb[3] - cb[1] < 8:
        raise JobError("crop: too small")
    region = img.crop(cb)
    prompt = (tb[0] - cb[0], tb[1] - cb[1], tb[2] - cb[0], tb[3] - cb[1])
    mask = segmenter.mask(region, prompt)
    if mask.shape != (region.size[1], region.size[0]):
        raise JobError("mask: wrong shape")
    coverage = float(mask.mean())
    rgba = region.convert("RGBA")
    rgba.putalpha(Image.fromarray((mask.astype(np.uint8) * 255)))
    # Square canvas, object centred with a margin, as image-to-3D models expect.
    side = int(max(region.size) * 1.15)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(rgba, ((side - region.size[0]) // 2, (side - region.size[1]) // 2))
    return canvas.resize((size, size), Image.LANCZOS), coverage
