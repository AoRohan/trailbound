"""Generate Trailbound's app icons.

Pure stdlib: writes PNGs with zlib + struct rather than pulling in Pillow, so
this runs anywhere Python does and adds nothing to the project's dependencies.

The mark is a winding trail climbing to the right, with waypoint dots on it —
the same road the game draws, reduced to something legible at 48 pixels.

    python tools/make_icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"

BG_TOP = (0x16, 0x1C, 0x24)
BG_BOTTOM = (0x0C, 0x0F, 0x13)
ROAD = (0x8F, 0xD6, 0xA0)
ROAD_DIM = (0x3E, 0x6B, 0x50)
DOT = (0xFF, 0xC8, 0x61)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c1, c2, t: float):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def trail_x(t: float, size: float, inset: float) -> float:
    """Horizontal position of the road at vertical fraction `t` (0 = bottom).

    The curve is written so it can never leave the safe box: the base runs from
    0.24 to 0.76 of the usable width and the S-wobble is capped at 0.16, giving
    a worst case of 0.08–0.92.
    """
    usable = size - inset * 2
    base = 0.24 + 0.52 * t
    wobble = math.sin(t * math.pi * 1.9) * 0.16
    return inset + usable * min(max(base + wobble, 0.02), 0.98)


def render(size: int, safe: float) -> bytes:
    """Render one icon. `safe` shrinks the mark for maskable variants."""
    inset = size * (0.5 - safe / 2)
    span = size - inset * 2
    road_w = size * 0.055
    dot_r = size * 0.048

    stops = (0.10, 0.5, 0.90)
    dots = [trail_x(t, size, inset) for t in stops]
    dot_ys = [size - inset - span * t for t in stops]

    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter: none
        for x in range(size):
            r, g, b = mix(BG_TOP, BG_BOTTOM, y / max(1, size - 1))

            # Distance to the road's centre line at this height. The road exists
            # only inside the safe box, so nothing can bleed to the icon edge.
            t = (size - inset - y) / max(1.0, span)
            if 0.0 <= t <= 1.0:
                cx = trail_x(t, size, inset)
                d = abs(x - cx)
                if d < road_w:
                    edge = 1.0 - min(1.0, d / road_w)
                    shade = mix(ROAD_DIM, ROAD, min(1.0, t + 0.25))
                    a = min(1.0, edge * 3.2)
                    r = int(lerp(r, shade[0], a))
                    g = int(lerp(g, shade[1], a))
                    b = int(lerp(b, shade[2], a))

            # Waypoints.
            for dx, dy in zip(dots, dot_ys):
                dd = math.hypot(x - dx, y - dy)
                if dd < dot_r:
                    a = min(1.0, (1.0 - dd / dot_r) * 3.0)
                    r = int(lerp(r, DOT[0], a))
                    g = int(lerp(g, DOT[1], a))
                    b = int(lerp(b, DOT[2], a))

            rows.extend((r & 255, g & 255, b & 255))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    targets = [
        ("icon-192.png", 192, 0.86),
        ("icon-512.png", 512, 0.86),
        # Maskable icons get cropped to a circle on Android, so the mark has to
        # sit inside the middle 80%.
        ("icon-maskable-512.png", 512, 0.62),
    ]
    for name, size, safe in targets:
        path = OUT / name
        path.write_bytes(render(size, safe))
        print(f"wrote {path.relative_to(OUT.parent.parent)} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
