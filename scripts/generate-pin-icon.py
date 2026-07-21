#!/usr/bin/env python3
"""Generate app icons using the location pin design."""

from PIL import Image, ImageDraw
import math
import os

OUT = os.path.join(os.path.dirname(__file__), "../data/icons")

BG       = (36, 56, 47)       # #24382f — app dark green
PIN_FILL = (243, 211, 107)    # #f3d36b — golden (matches current tree icon)
DOT_DARK = (36, 56, 47)       # #24382f — inner circle fill
DOT_RING = (243, 211, 107)    # golden ring around inner dot


def draw_pin_icon(draw, size, cx, cy, r, tip_y, pin_fill, dot_dark, dot_ring, stroke_w=0, stroke_color=None):
    """Draw a location pin centred horizontally at cx, circle centre at cy with radius r, tip at tip_y."""

    d = tip_y - cy  # distance from circle centre to tip

    # Tangent point offsets
    tx = r * math.sqrt(max(0, 1 - (r / d) ** 2))
    ty = cy + (r * r) / d

    # --- pin body (filled) ---
    if stroke_w and stroke_color:
        # Draw stroke version first (slightly larger)
        s = stroke_w
        s_r = r + s
        s_d = (tip_y + s) - cy
        s_tx = s_r * math.sqrt(max(0, 1 - (s_r / s_d) ** 2))
        s_ty = cy + (s_r * s_r) / s_d

        draw.ellipse([cx - s_r, cy - s_r, cx + s_r, cy + s_r], fill=stroke_color)
        draw.polygon([(cx - s_tx, s_ty), (cx, tip_y + s), (cx + s_tx, s_ty)], fill=stroke_color)

    # Filled circle (top part of pin)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=pin_fill)
    # Filled triangle stem
    draw.polygon([(cx - tx, ty), (cx, tip_y), (cx + tx, ty)], fill=pin_fill)

    # --- inner ring & dot ---
    ring_r  = r * 0.46
    inner_r = r * 0.24

    draw.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r], fill=dot_dark)
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=dot_ring)


def make_icon(size, path, maskable=False):
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background
    if maskable:
        # Full bleed for maskable — safe zone is inner 80 %
        draw.rectangle([0, 0, size, size], fill=BG)
        inset = int(size * 0.10)
    else:
        br = max(4, int(size * 0.19))
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=br, fill=BG)
        inset = int(size * 0.12)

    # Pin geometry — fits within the inset safe zone
    cx    = size / 2
    r     = (size - 2 * inset) / 2 * 0.78   # circle radius ≈ 78 % of half-width
    cy    = inset + r * 1.10                  # push circle centre slightly lower than pure-top
    tip_y = size - inset - size * 0.04        # tip sits just above bottom inset

    stroke = max(1, int(r * 0.08))

    draw_pin_icon(draw, size, cx, cy, r, tip_y,
                  PIN_FILL, DOT_DARK, DOT_RING,
                  stroke_w=stroke, stroke_color=BG)

    img = img.convert("RGB")
    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path}")


def make_transparent_logo(size, path):
    """White-background version for favicon / loading logo."""
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    inset = int(size * 0.06)
    cx    = size / 2
    r     = (size - 2 * inset) / 2 * 0.78
    cy    = inset + r * 1.10
    tip_y = size - inset - size * 0.04
    stroke = max(1, int(r * 0.10))

    draw_pin_icon(draw, size, cx, cy, r, tip_y,
                  pin_fill=tuple(BG),          # dark fill for light bg
                  dot_dark=(247, 248, 244),    # cream dot
                  dot_ring=tuple(BG),
                  stroke_w=0, stroke_color=None)

    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path}")


if __name__ == "__main__":
    print("Generating pin app icons…")
    make_icon(192,  os.path.join(OUT, "icon-192.png"))
    make_icon(512,  os.path.join(OUT, "icon-512.png"))
    make_icon(512,  os.path.join(OUT, "icon-maskable-512.png"), maskable=True)
    make_icon(180,  os.path.join(OUT, "apple-touch-icon.png"))

    # Also update the favicon / loading-screen logo (white bg version)
    logo_path = os.path.join(OUT, "trees/logo.png")
    make_transparent_logo(256, logo_path)

    print("Done.")
