"""The Tracker mark: a ring with three coloured arcs, drawn with Pillow."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

TRACK = (52, 56, 84, 255)
ARCS = [(-90, 35, (138, 168, 255, 255)), (35, 120, (98, 210, 194, 255)), (120, 190, (242, 183, 102, 255))]
GREY = (128, 132, 150, 255)
WARN = (242, 130, 108, 255)


def make_image(size: int = 64, state: str = "recording") -> Image.Image:
    s = size * 4  # draw large, then downsample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = s * 0.06
    width = int(s * 0.22)
    box = [pad, pad, s - pad, s - pad]
    d.arc(box, 0, 360, fill=TRACK, width=width)
    for start, end, color in ARCS:
        d.arc(box, start, end, fill=color if state == "recording" else GREY, width=width)
    if state == "error":
        r = s * 0.2
        d.ellipse([s - 2 * r, s - 2 * r, s, s], fill=WARN)
    return img.resize((size, size), Image.LANCZOS)


def write_ico(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    make_image(256).save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return path
