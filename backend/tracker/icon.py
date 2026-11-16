"""The Tracker mark: a three-layer flame on the heat scale, burning on a log, in a charred tile. Drawn with Pillow.

The same paths are used by web/public/favicon.svg and the rail mark in web/src/App.tsx (a 32-unit grid).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

# Tokens from MASTER.md
TILE = (36, 25, 21, 255)  # --surface
H3 = (217, 84, 30, 255)
H4 = (240, 129, 42, 255)
H6 = (253, 227, 160, 255)
LOG = (110, 34, 25, 255)  # --h1, the log the fire sits on
LOG_END = (168, 48, 28, 255)  # --h2, its cut end
ASH = [(88, 70, 61, 255), (138, 125, 118, 255), (178, 157, 144, 255)]  # paused / off: the fire is out
ASH_LOG = ((74, 55, 48, 255), (96, 78, 70, 255))
DANGER = (232, 106, 82, 255)

# Cubic paths on a 32-unit grid: a start point, then (c1, c2, end) segments.
OUTER = [(16, 3.5), ((19.5, 8.5), (25.5, 12), (25.5, 19)), ((25.5, 24.8), (21.3, 28.5), (16, 28.5)),
         ((10.7, 28.5), (6.5, 24.8), (6.5, 19)), ((6.5, 14.6), (9.4, 12.2), (11.2, 9)),
         ((12.2, 12.3), (13.4, 13.6), (14.8, 14.1)), ((15.2, 10.4), (14.7, 6.8), (16, 3.5))]
MIDDLE = [(16, 11.5), ((18.7, 14.8), (21.4, 17.4), (21.4, 21.2)), ((21.4, 24.5), (19, 26.6), (16, 26.6)),
          ((13, 26.6), (10.6, 24.5), (10.6, 21.2)), ((10.6, 18.6), (12.6, 17), (13.8, 15.4)),
          ((14.4, 16.9), (15.1, 17.6), (16, 18)), ((16.3, 15.9), (15.6, 13.8), (16, 11.5))]
CORE = [(16, 18.2), ((17.8, 20.2), (18.9, 21.7), (18.9, 23.2)), ((18.9, 24.9), (17.6, 26), (16, 26)),
        ((14.4, 26), (13.1, 24.9), (13.1, 23.2)), ((13.1, 21.7), (14.2, 20.2), (16, 18.2))]


def _polygon(path, scale: float, steps: int = 24) -> list[tuple[float, float]]:
    pts = [(path[0][0] * scale, path[0][1] * scale)]
    x0, y0 = path[0]
    for (c1, c2, end) in path[1:]:
        for i in range(1, steps + 1):
            t = i / steps
            u = 1 - t
            x = u**3 * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * end[0]
            y = u**3 * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * end[1]
            pts.append((x * scale, y * scale))
        x0, y0 = end
    return pts


def make_image(size: int = 64, state: str = "recording") -> Image.Image:
    s = size * 4  # draw large, then downsample for smooth edges
    k = s / 32
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=8 * k, fill=TILE)
    colors = [H3, H4, H6] if state in ("recording", "error") else ASH
    for path, color in zip((OUTER, MIDDLE, CORE), colors):
        d.polygon(_polygon(path, k), fill=color)
    log, end = (LOG, LOG_END) if state in ("recording", "error") else ASH_LOG
    d.rounded_rectangle([6 * k, 25.2 * k, 26 * k, 29 * k], radius=1.9 * k, fill=log)
    d.ellipse([22.3 * k, 25.2 * k, 26 * k, 29 * k], fill=end)
    if state == "error":
        r = 5.5 * k
        d.ellipse([s - 2 * r - k, s - 2 * r - k, s - k, s - k], fill=DANGER, outline=TILE, width=int(1.5 * k))
    return img.resize((size, size), Image.LANCZOS)


def write_ico(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    make_image(256).save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return path
